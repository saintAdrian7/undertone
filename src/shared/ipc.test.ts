import { describe, expect, it } from 'vitest'
import { AskRequestSchema, CancelRequestSchema, TranscriptOpSchema, MAX_QUESTION_CHARS } from './ipc'

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
