import { describe, expect, it } from 'vitest'
import type { TranscriptEntry } from '@shared/state'
import { buildMessages, formatTranscript, systemPromptFor, MAX_TRANSCRIPT_ENTRIES, MAX_QUESTION_CHARS, MAX_ENTRY_CHARS, SYSTEM_PROMPT } from './prompt'

const entry = (patch: Partial<TranscriptEntry>): TranscriptEntry => ({
  id: 'x',
  role: 'them',
  createdAt: '2026-10-19T10:00:00.000Z',
  relativeMs: 0,
  status: 'done',
  text: '',
  ...patch,
})

describe('formatTranscript', () => {
  it('labels speakers and prefixes relative mm:ss timestamps', () => {
    const text = formatTranscript([
      entry({ role: 'them', relativeMs: 12_000, text: 'Tell me about yourself.' }),
      entry({ role: 'me', relativeMs: 75_500, text: 'Sure.' }),
    ])
    expect(text).toBe('[00:12] Interviewer: Tell me about yourself.\n[01:15] Me: Sure.')
  })

  it('skips entries that are still transcribing or empty', () => {
    const text = formatTranscript([
      entry({ status: 'transcribing', relativeMs: 1000 }),
      entry({ status: 'done', relativeMs: 2000, text: '' }),
      entry({ status: 'done', relativeMs: 3000, text: 'Hi' }),
    ])
    expect(text).toBe('[00:03] Interviewer: Hi')
  })

  it('keeps only the most recent entries', () => {
    const many = Array.from({ length: MAX_TRANSCRIPT_ENTRIES + 5 }, (_, i) =>
      entry({ relativeMs: i * 1000, text: `line ${i}` }),
    )
    const lines = formatTranscript(many).split('\n')
    expect(lines.length).toBe(MAX_TRANSCRIPT_ENTRIES)
    expect(lines[0]).toContain('line 5')
  })
})

describe('buildMessages', () => {
  it('produces a system prompt and a single user turn with transcript and question', () => {
    const { system, messages } = buildMessages({
      question: 'What should I say?',
      transcript: [entry({ relativeMs: 0, text: 'Why this role?' })],
    })
    expect(system).toBe(SYSTEM_PROMPT)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe('user')
    const blocks = messages[0]?.content ?? []
    expect(blocks.some((b) => b.type === 'text' && b.text.includes('[00:00] Interviewer: Why this role?'))).toBe(true)
    expect(blocks.some((b) => b.type === 'text' && b.text.includes('What should I say?'))).toBe(true)
    expect(blocks.some((b) => b.type === 'image')).toBe(false)
  })

  it('includes the screenshot as an image block when provided', () => {
    const { messages } = buildMessages({
      question: 'Explain the slide',
      transcript: [],
      screenshot: { dataBase64: 'QUJD', contentType: 'image/png' },
    })
    const image = messages[0]?.content.find((b) => b.type === 'image')
    expect(image).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } })
  })

  it('appends a mode instruction to the system prompt', () => {
    const { system } = buildMessages({ question: 'q', transcript: [], modeInstruction: 'Be brief.' })
    expect(system.endsWith('Be brief.')).toBe(true)
  })

  it('truncates an oversized question and transcript entries', () => {
    const { messages } = buildMessages({
      question: 'q'.repeat(MAX_QUESTION_CHARS + 50),
      transcript: [entry({ relativeMs: 0, text: 't'.repeat(MAX_ENTRY_CHARS + 50) })],
    })
    const texts = messages[0]?.content.filter((b) => b.type === 'text').map((b) => b.text) ?? []
    expect(texts.join('\n').length).toBeLessThan(MAX_QUESTION_CHARS + MAX_ENTRY_CHARS + 200)
    expect(texts.some((t) => t.includes('q'.repeat(MAX_QUESTION_CHARS + 1)))).toBe(false)
  })

  it('tells the model that transcript and screenshot content are untrusted', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('untrusted')
  })

  it('asks for natural spoken language rather than assistant prose', () => {
    const lower = SYSTEM_PROMPT.toLowerCase()
    expect(lower).toContain('contractions')
    expect(lower).toMatch(/no bullet|without bullet|not use bullet/)
  })

  it('includes the user profile in the system prompt when one is set', () => {
    const { system } = buildMessages({ question: 'q', transcript: [], profile: 'Jane Doe, 6 years in payments.' })
    expect(system).toContain('Jane Doe, 6 years in payments.')
    expect(systemPromptFor(null)).toBe(SYSTEM_PROMPT)
    expect(systemPromptFor('CV text')).toContain('CV text')
  })

  it('uses a default question when the user submits nothing', () => {
    const { messages } = buildMessages({ question: '   ', transcript: [] })
    const text = messages[0]?.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') ?? ''
    expect(text).toContain('What should I say next?')
  })
})
