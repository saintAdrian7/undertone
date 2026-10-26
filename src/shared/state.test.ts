import { describe, expect, it } from 'vitest'
import { AppStateSchema, defaultState, applyPatch, RendererPatchSchema, MAX_TRANSCRIPT_ENTRIES, MAX_TRANSCRIPT_TEXT_CHARS, MAX_CHAT_HEIGHT } from './state'

describe('RendererPatchSchema', () => {
  it('accepts the fields the renderer may change', () => {
    const patch = RendererPatchSchema.parse({ isListening: true, showChat: true, isInvisible: true, screenUse: 'off', chatExpandedHeight: 600 })
    expect(patch).toEqual({ isListening: true, showChat: true, isInvisible: true, screenUse: 'off', chatExpandedHeight: 600 })
  })

  it('rejects fields owned by the main process', () => {
    for (const forbidden of [{ shortcuts: { ask: 'CommandOrControl+C' } }, { windowsLoaded: true }, { isCapturingScreenshot: true }, { isRecordingShortcut: true }]) {
      expect(() => RendererPatchSchema.parse(forbidden)).toThrow()
    }
  })

  it('caps the chat height', () => {
    expect(() => RendererPatchSchema.parse({ chatExpandedHeight: MAX_CHAT_HEIGHT + 1 })).toThrow()
  })

  it('rejects transcript replacement from the renderer; the main process owns it through operations', () => {
    const entry = { id: 'a', role: 'me', createdAt: '2026-10-19T10:00:00.000Z', relativeMs: 0, status: 'done', text: 'x' }
    expect(() => RendererPatchSchema.parse({ transcript: [entry] })).toThrow()
  })

  it('caps transcript length and entry text in the state schema', () => {
    const entry = { id: 'a', role: 'me', createdAt: '2026-10-19T10:00:00.000Z', relativeMs: 0, status: 'done', text: 'x' }
    expect(() => applyPatch(defaultState(), { transcript: Array.from({ length: MAX_TRANSCRIPT_ENTRIES + 1 }, () => entry) } as never)).toThrow()
    expect(() => applyPatch(defaultState(), { transcript: [{ ...entry, text: 'x'.repeat(MAX_TRANSCRIPT_TEXT_CHARS + 1) }] } as never)).toThrow()
  })
})

describe('AppState', () => {
  it('provides safe defaults', () => {
    const s = defaultState()
    expect(s.isInvisible).toBe(false)
    expect(s.noFocusWhenInvisible).toBe(false)
    expect(s.isCapturingScreenshot).toBe(false)
    expect(s.showChat).toBe(false)
    expect(s.isListening).toBe(false)
    expect(s.screenUse).toBe('required')
    expect(s.transcript).toEqual([])
    expect(s.shortcuts.ask).toBe('CommandOrControl+Enter')
  })

  it('parses a full state object', () => {
    const parsed = AppStateSchema.parse(defaultState())
    expect(parsed).toEqual(defaultState())
  })

  it('applies a patch immutably', () => {
    const before = defaultState()
    const after = applyPatch(before, { isInvisible: true })
    expect(after.isInvisible).toBe(true)
    expect(before.isInvisible).toBe(false)
    expect(after).not.toBe(before)
  })

  it('rejects an invalid patch', () => {
    const before = defaultState()
    expect(() => applyPatch(before, { screenUse: 'sometimes' } as never)).toThrow()
  })
})
