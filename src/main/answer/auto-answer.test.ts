import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutoAnswerScheduler, looksLikeQuestion, AUTO_ANSWER_DELAY_MS } from './auto-answer'
import type { JudgeInput } from './judge'

describe('looksLikeQuestion', () => {
  it('accepts direct questions and interview prompts', () => {
    for (const text of [
      'Why do you want this role?',
      'tell me about yourself',
      'Walk me through your last project.',
      'Can you describe a time you disagreed with a manager',
      'What would you say is your biggest weakness',
      'How did you handle that',
    ]) {
      expect(looksLikeQuestion(text), text).toBe(true)
    }
  })
  it('rejects acknowledgements, small talk and fragments', () => {
    for (const text of ['Okay.', 'Thanks, that makes sense.', 'Great', 'um', 'Let me share my screen.', '']) {
      expect(looksLikeQuestion(text), text).toBe(false)
    }
  })
})

describe('createAutoAnswerScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires once the interviewer has been quiet for the delay after a question', () => {
    const trigger = vi.fn()
    const scheduler = createAutoAnswerScheduler({ trigger })
    scheduler.onInterviewerLine('Why this role?')
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS - 1)
    expect(trigger).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('does not fire for non-questions', () => {
    const trigger = vi.fn()
    const scheduler = createAutoAnswerScheduler({ trigger })
    scheduler.onInterviewerLine('Okay, thanks.')
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS * 2)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('waits while the interviewer keeps talking and restarts the delay afterwards', () => {
    const trigger = vi.fn()
    const scheduler = createAutoAnswerScheduler({ trigger })
    scheduler.onInterviewerLine('Why this role?')
    scheduler.onInterviewerActivity(true)
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS * 3)
    expect(trigger).not.toHaveBeenCalled()
    scheduler.onInterviewerActivity(false)
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS)
    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('fires at once when the user starts answering before the delay has passed', () => {
    const trigger = vi.fn()
    const scheduler = createAutoAnswerScheduler({ trigger })
    scheduler.onInterviewerLine('Why this role?')
    scheduler.onUserActivity(true)
    expect(trigger).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS * 2)
    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('ignores user activity while the interviewer is still talking (speaker echo)', () => {
    const trigger = vi.fn()
    const scheduler = createAutoAnswerScheduler({ trigger })
    scheduler.onInterviewerLine('Why this role?')
    scheduler.onInterviewerActivity(true)
    scheduler.onUserActivity(true)
    expect(trigger).not.toHaveBeenCalled()
    scheduler.onUserActivity(false)
    scheduler.onInterviewerActivity(false)
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS)
    expect(trigger).toHaveBeenCalledTimes(1)
  })

  describe('with a judge', () => {
    const verdict = (patch: Partial<{ isAsk: boolean; directedAtUser: boolean; complete: boolean; action: 'answer' | 'silent'; score: number }> = {}) => ({
      isAsk: true,
      directedAtUser: true,
      complete: true,
      action: 'answer' as const,
      score: 0.9,
      questionText: null,
      ...patch,
    })
    const context = { turns: [], lastAnswered: null, userName: null }

    it('asks the judge as soon as the interviewer is quiet and answers at commit when it says answer', async () => {
      const trigger = vi.fn()
      const judge = vi.fn(async (_input: JudgeInput) => verdict())
      const scheduler = createAutoAnswerScheduler({ trigger, judge, getContext: () => context })
      scheduler.onInterviewerLine('Tell me about yourself')
      expect(judge).toHaveBeenCalledTimes(1)
      expect(judge.mock.calls[0]![0]).toMatchObject({ candidate: 'Tell me about yourself', context })
      await vi.advanceTimersByTimeAsync(AUTO_ANSWER_DELAY_MS)
      expect(trigger).toHaveBeenCalledTimes(1)
    })

    it('stays silent when the judge says ignore, even though the heuristic would have fired', async () => {
      const trigger = vi.fn()
      const scheduler = createAutoAnswerScheduler({ trigger, judge: async () => verdict({ directedAtUser: false }), getContext: () => context })
      scheduler.onInterviewerLine('Why this role?')
      await vi.advanceTimersByTimeAsync(AUTO_ANSWER_DELAY_MS * 2)
      expect(trigger).not.toHaveBeenCalled()
    })

    it('waits on an incomplete candidate and judges the accumulated text when more arrives', async () => {
      const trigger = vi.fn()
      const judge = vi.fn(async ({ candidate }: { candidate: string }) => verdict({ complete: candidate.includes('project') }))
      const scheduler = createAutoAnswerScheduler({ trigger, judge, getContext: () => context })
      scheduler.onInterviewerLine('Tell me about')
      await vi.advanceTimersByTimeAsync(AUTO_ANSWER_DELAY_MS)
      expect(trigger).not.toHaveBeenCalled()
      scheduler.onInterviewerLine('your last project')
      await vi.advanceTimersByTimeAsync(AUTO_ANSWER_DELAY_MS)
      expect(judge).toHaveBeenLastCalledWith(expect.objectContaining({ candidate: 'Tell me about your last project' }))
      expect(trigger).toHaveBeenCalledTimes(1)
    })

    it('falls back to the heuristic when the judge returns nothing', async () => {
      const trigger = vi.fn()
      const scheduler = createAutoAnswerScheduler({ trigger, judge: async () => null, getContext: () => context })
      scheduler.onInterviewerLine('Why this role?')
      await vi.advanceTimersByTimeAsync(AUTO_ANSWER_DELAY_MS)
      expect(trigger).toHaveBeenCalledTimes(1)
      scheduler.onInterviewerLine('Okay, thanks.')
      await vi.advanceTimersByTimeAsync(AUTO_ANSWER_DELAY_MS)
      expect(trigger).toHaveBeenCalledTimes(1)
    })

    it('never answers the same question twice', async () => {
      const trigger = vi.fn()
      const scheduler = createAutoAnswerScheduler({ trigger, judge: async () => verdict(), getContext: () => context })
      scheduler.onInterviewerLine('Why this role?')
      await vi.advanceTimersByTimeAsync(AUTO_ANSWER_DELAY_MS)
      scheduler.onInterviewerLine('Why this role?')
      await vi.advanceTimersByTimeAsync(AUTO_ANSWER_DELAY_MS)
      expect(trigger).toHaveBeenCalledTimes(1)
    })

    it('fires on the heuristic when the user starts talking before the judge has answered', async () => {
      const trigger = vi.fn()
      const scheduler = createAutoAnswerScheduler({ trigger, judge: () => new Promise(() => undefined), getContext: () => context })
      scheduler.onInterviewerLine('Why this role?')
      scheduler.onUserActivity(true)
      expect(trigger).toHaveBeenCalledTimes(1)
    })

    it('does not fire for acknowledgements without even asking the judge', async () => {
      const trigger = vi.fn()
      const judge = vi.fn(async (_input: JudgeInput) => verdict())
      const scheduler = createAutoAnswerScheduler({ trigger, judge, getContext: () => context })
      scheduler.onInterviewerLine('Okay, makes sense.')
      await vi.advanceTimersByTimeAsync(AUTO_ANSWER_DELAY_MS)
      expect(judge).not.toHaveBeenCalled()
      expect(trigger).not.toHaveBeenCalled()
    })
  })

  it('cancel drops a pending question', () => {
    const trigger = vi.fn()
    const scheduler = createAutoAnswerScheduler({ trigger })
    scheduler.onInterviewerLine('And why now?')
    scheduler.cancel()
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS * 2)
    expect(trigger).not.toHaveBeenCalled()
  })
})
