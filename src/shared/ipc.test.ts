import { describe, expect, it } from 'vitest'
import { AskRequestSchema, CancelRequestSchema, LlmSettingsRequestSchema, ShortcutUpdateSchema, TranscriptOpSchema, MAX_QUESTION_CHARS } from './ipc'

describe('ShortcutUpdateSchema', () => {
  it('accepts a known action with an accelerator or null and nothing else', () => {
    expect(ShortcutUpdateSchema.parse({ key: 'ask', accelerator: 'CommandOrControl+K' })).toEqual({ key: 'ask', accelerator: 'CommandOrControl+K' })
    expect(ShortcutUpdateSchema.parse({ key: 'ask', accelerator: null }).accelerator).toBeNull()
    expect(() => ShortcutUpdateSchema.parse({ key: 'nope', accelerator: 'F1' })).toThrow()
    expect(() => ShortcutUpdateSchema.parse({ key: 'ask', accelerator: 'x'.repeat(100) })).toThrow()
  })
})

describe('LlmSettingsRequestSchema', () => {
  it('accepts a provider choice with optional key and base url', () => {
    expect(LlmSettingsRequestSchema.parse({ provider: 'claude-code', model: 'haiku', baseUrl: null })).toEqual({
      provider: 'claude-code',
      model: 'haiku',
      baseUrl: null,
    })
    expect(LlmSettingsRequestSchema.parse({ provider: 'openai', model: 'm', baseUrl: 'https://x/v1', apiKey: 'k' }).apiKey).toBe('k')
    expect(() => LlmSettingsRequestSchema.parse({ provider: 'bing', model: 'm', baseUrl: null })).toThrow()
    expect(() => LlmSettingsRequestSchema.parse({ provider: 'openai', model: '', baseUrl: null })).toThrow()
  })
})

describe('TranscriptOpSchema', () => {
  it('accepts add, resolve, remove and clear operations', () => {
    expect(TranscriptOpSchema.parse({ op: 'add', id: 'a', role: 'me', startedAt: 1, sessionStartedAt: 0 })).toMatchObject({ op: 'add' })
    expect(TranscriptOpSchema.parse({ op: 'resolve', id: 'a', text: 'hi' })).toMatchObject({ op: 'resolve' })
    expect(TranscriptOpSchema.parse({ op: 'remove', id: 'a' })).toMatchObject({ op: 'remove' })
    expect(TranscriptOpSchema.parse({ op: 'clear' })).toEqual({ op: 'clear' })
  })
  it('rejects unknown ops, oversized text and extra fields', () => {
    expect(() => TranscriptOpSchema.parse({ op: 'nuke' })).toThrow()
    expect(() => TranscriptOpSchema.parse({ op: 'resolve', id: 'a', text: 'x'.repeat(4001) })).toThrow()
    expect(() => TranscriptOpSchema.parse({ op: 'remove', id: 'a', extra: true })).toThrow()
  })
})

describe('AskRequestSchema', () => {
  it('accepts a request id and question', () => {
    expect(AskRequestSchema.parse({ requestId: 'abc', question: 'hi' })).toEqual({ requestId: 'abc', question: 'hi' })
  })
  it('rejects missing, oversized or extra fields', () => {
    expect(() => AskRequestSchema.parse(undefined)).toThrow()
    expect(() => AskRequestSchema.parse({ requestId: '', question: 'hi' })).toThrow()
    expect(() => AskRequestSchema.parse({ requestId: 'a', question: 'q'.repeat(MAX_QUESTION_CHARS + 1) })).toThrow()
    expect(() => AskRequestSchema.parse({ requestId: 'a', question: 'hi', extra: 1 })).toThrow()
  })
})

describe('CancelRequestSchema', () => {
  it('requires a request id', () => {
    expect(CancelRequestSchema.parse({ requestId: 'abc' })).toEqual({ requestId: 'abc' })
    expect(() => CancelRequestSchema.parse(null)).toThrow()
    expect(() => CancelRequestSchema.parse({})).toThrow()
  })
})
