import { describe, expect, it, vi } from 'vitest'
import type { AnswerProvider } from '@shared/providers'
import { buildJudgeMessages, createJudge, JUDGE_DEADLINE_MS, JUDGE_SYSTEM_PROMPT, parseJudgeVerdict, prefilterCandidate, routeVerdict } from './judge'

const context = {
  turns: [
    { role: 'them' as const, text: 'So tell me about your last project.' },
    { role: 'me' as const, text: 'It was a payments migration.' },
  ],
  lastAnswered: null as string | null,
  userName: null as string | null,
}

describe('buildJudgeMessages', () => {
  it('fences the candidate as data, puts context before it and the rules and schema last', () => {
    const text = buildJudgeMessages({ candidate: 'Why did you leave?', context })
    const candidateAt = text.indexOf('Why did you leave?')
    const contextAt = text.indexOf('payments migration')
    const rulesAt = text.lastIndexOf('"is_ask"')
    expect(contextAt).toBeGreaterThan(-1)
    expect(contextAt).toBeLessThan(candidateAt)
    expect(rulesAt).toBeGreaterThan(candidateAt)
    expect(text).toMatch(/<candidate>[\s\S]*Why did you leave\?[\s\S]*<\/candidate>/)
  })

  it('adds the last answered question after the candidate, and the name rule only when someone else is addressed', () => {
    const withAnswered = buildJudgeMessages({ candidate: 'Why did you leave?', context: { ...context, lastAnswered: 'Why did you leave your job?' } })
    expect(withAnswered.indexOf('Why did you leave your job?')).toBeGreaterThan(withAnswered.indexOf('</candidate>'))
    const plain = buildJudgeMessages({ candidate: 'Can you walk us through it?', context: { ...context, userName: 'Jane' } })
    expect(plain).not.toContain('Jane')
    const addressed = buildJudgeMessages({ candidate: 'Mark, can you walk us through it?', context: { ...context, userName: 'Jane' } })
    expect(addressed).toContain('Jane')
  })

  it('keeps the tail of long turns and candidates within the budget', () => {
    const long = 'x'.repeat(5000) + ' END'
    const text = buildJudgeMessages({ candidate: long, context: { ...context, turns: [{ role: 'them', text: long }] } })
    expect(text.length).toBeLessThan(4000)
    expect(text).toContain('END')
  })
})

describe('parseJudgeVerdict', () => {
  const candidate = 'Why did you leave your last job?'

  it('reads a bare JSON object', () => {
    const verdict = parseJudgeVerdict(
      '{"is_ask":true,"directed_at_user":true,"complete":true,"action":"answer","score":0.9,"question_text":"Why did you leave your last job?"}',
      candidate,
    )
    expect(verdict).toMatchObject({ isAsk: true, directedAtUser: true, complete: true, action: 'answer', score: 0.9, questionText: candidate })
  })

  it('tolerates prose and code fences around the JSON and clamps the score', () => {
    const verdict = parseJudgeVerdict('Sure:\n```json\n{"is_ask":true,"directed_at_user":true,"complete":true,"action":"answer","score":1.7}\n```', candidate)
    expect(verdict?.score).toBe(1)
  })

  it('drops a quoted question that is not in the candidate, and rejects garbage', () => {
    const verdict = parseJudgeVerdict('{"is_ask":true,"directed_at_user":true,"complete":true,"action":"answer","score":0.8,"question_text":"What is your salary?"}', candidate)
    expect(verdict?.questionText).toBeNull()
    expect(parseJudgeVerdict('not json', candidate)).toBeNull()
    expect(parseJudgeVerdict('{"is_ask":"yes"}', candidate)).toBeNull()
  })
})

describe('routeVerdict', () => {
  const base = { isAsk: true, directedAtUser: true, complete: true, action: 'answer' as const, score: 0.9, questionText: null }
  it('answers a complete directed ask above the floor, waits on incomplete, ignores the rest', () => {
    expect(routeVerdict(base)).toBe('answer')
    expect(routeVerdict({ ...base, complete: false })).toBe('wait')
    expect(routeVerdict({ ...base, isAsk: false })).toBe('ignore')
    expect(routeVerdict({ ...base, directedAtUser: false })).toBe('ignore')
    expect(routeVerdict({ ...base, action: 'silent' })).toBe('ignore')
    expect(routeVerdict({ ...base, score: 0.2 })).toBe('ignore')
  })
})

describe('prefilterCandidate', () => {
  it('skips acknowledgements, duplicates and the last answered text, waits on tiny fragments, judges the rest', () => {
    expect(prefilterCandidate('Okay, makes sense.', { lastJudged: null, lastAnswered: null })).toBe('skip')
    expect(prefilterCandidate('Why this role', { lastJudged: 'Why this role', lastAnswered: null })).toBe('skip')
    expect(prefilterCandidate('Why this role?', { lastJudged: null, lastAnswered: 'Why this role?' })).toBe('skip')
    expect(prefilterCandidate('And the', { lastJudged: null, lastAnswered: null })).toBe('wait')
    expect(prefilterCandidate('Why?', { lastJudged: null, lastAnswered: null })).toBe('judge')
    expect(prefilterCandidate('Tell me about a time you failed', { lastJudged: null, lastAnswered: null })).toBe('judge')
  })
})

describe('createJudge', () => {
  const streamOf = (parts: string[], delayMs = 0): AnswerProvider => ({
    async *stream() {
      for (const part of parts) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        yield part
      }
    },
  })

  it('asks the provider with the judge prompt and returns the parsed verdict', async () => {
    const provider = streamOf(['{"is_ask":true,"directed_at_user":true,', '"complete":true,"action":"answer","score":0.9}'])
    const stream = vi.spyOn(provider, 'stream')
    const judge = createJudge({ getProvider: () => provider })
    const verdict = await judge({ candidate: 'Why did you leave?', context })
    expect(verdict?.action).toBe('answer')
    const request = stream.mock.calls[0]![0]
    expect(request.question).toContain('<candidate>')
    expect(request.transcript).toEqual([])
  })

  it('returns null when the provider is slow, without waiting for it', async () => {
    vi.useFakeTimers()
    try {
      const judge = createJudge({ getProvider: () => streamOf(['{}'], JUDGE_DEADLINE_MS * 2), deadlineMs: JUDGE_DEADLINE_MS })
      const pending = judge({ candidate: 'Why?', context })
      await vi.advanceTimersByTimeAsync(JUDGE_DEADLINE_MS + 1)
      expect(await pending).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns null when no provider is configured or the provider fails', async () => {
    expect(await createJudge({ getProvider: () => null })({ candidate: 'Why?', context })).toBeNull()
    const failing: AnswerProvider = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('down')
      },
    }
    expect(await createJudge({ getProvider: () => failing })({ candidate: 'Why?', context })).toBeNull()
  })

  it('exposes a system prompt that demands JSON only', () => {
    expect(JUDGE_SYSTEM_PROMPT.toLowerCase()).toContain('json')
  })
})
