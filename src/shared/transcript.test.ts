import { describe, expect, it } from 'vitest'
import type { TranscriptEntry } from './state'
import { addPlaceholder, applyTranscriptOp, removeEntry, resolveEntry } from './transcript'

const sessionStart = Date.parse('2026-10-19T10:00:00.000Z')

describe('addPlaceholder', () => {
  it('appends a transcribing entry with relative timing, sorted by time', () => {
    const existing: TranscriptEntry[] = [
      { id: 'b', role: 'me', createdAt: '2026-10-19T10:00:10.000Z', relativeMs: 10_000, status: 'done', text: 'later' },
    ]
    const next = addPlaceholder(existing, { id: 'a', role: 'them', startedAt: sessionStart + 5_000, sessionStartedAt: sessionStart })
    expect(next.map((e) => e.id)).toEqual(['a', 'b'])
    expect(next[0]).toMatchObject({ id: 'a', role: 'them', relativeMs: 5_000, status: 'transcribing', text: '' })
    expect(existing).toHaveLength(1)
  })
})

describe('resolveEntry and removeEntry', () => {
  const list = addPlaceholder([], { id: 'a', role: 'me', startedAt: sessionStart, sessionStartedAt: sessionStart })
  it('fills in text and marks done', () => {
    expect(resolveEntry(list, 'a', 'Hello')[0]).toMatchObject({ status: 'done', text: 'Hello' })
  })
  it('ignores unknown ids', () => {
    expect(resolveEntry(list, 'zzz', 'x')).toEqual(list)
  })
  it('removes by id', () => {
    expect(removeEntry(list, 'a')).toEqual([])
  })
})

describe('applyTranscriptOp', () => {
  it('adds, resolves and removes through one entry point', () => {
    let list: TranscriptEntry[] = []
    list = applyTranscriptOp(list, { op: 'add', id: 'a', role: 'them', startedAt: sessionStart, sessionStartedAt: sessionStart })
    expect(list).toHaveLength(1)
    list = applyTranscriptOp(list, { op: 'resolve', id: 'a', text: 'hi' })
    expect(list[0]).toMatchObject({ status: 'done', text: 'hi' })
    list = applyTranscriptOp(list, { op: 'remove', id: 'a' })
    expect(list).toEqual([])
  })

  it('drops the oldest entries beyond the cap', () => {
    let list: TranscriptEntry[] = []
    for (let i = 0; i < 205; i++) {
      list = applyTranscriptOp(list, { op: 'add', id: `e${i}`, role: 'me', startedAt: sessionStart + i * 1000, sessionStartedAt: sessionStart })
    }
    expect(list).toHaveLength(200)
    expect(list[0]?.id).toBe('e5')
  })

  it('clears everything', () => {
    const list = applyTranscriptOp([], { op: 'add', id: 'a', role: 'me', startedAt: sessionStart, sessionStartedAt: sessionStart })
    expect(applyTranscriptOp(list, { op: 'clear' })).toEqual([])
  })
})
