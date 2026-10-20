import { describe, expect, it } from 'vitest'
import { defaultState, type AppState } from '@shared/state'
import { shortcutsToRegister, diffRegistrations } from './registry'

const state = (patch: Partial<AppState> = {}): AppState => ({ ...defaultState(), ...patch })

describe('shortcutsToRegister', () => {
  it('registers nothing while windows are not loaded', () => {
    const r = shortcutsToRegister(state())
    expect(Object.values(r).every((v) => v === false)).toBe(true)
  })
  it('registers only toggleSession once windows are loaded but idle', () => {
    const r = shortcutsToRegister(state({ windowsLoaded: true }))
    expect(r.toggleSession).toBe(true)
    expect(r.ask).toBe(false)
    expect(r.moveUp).toBe(false)
  })
  it('registers movement and visibility while listening', () => {
    const r = shortcutsToRegister(state({ windowsLoaded: true, isListening: true }))
    expect(r.toggleVisibility).toBe(true)
    expect(r.moveLeft).toBe(true)
    expect(r.ask).toBe(false)
  })
  it('registers ask, clear and scroll only when the chat is shown', () => {
    const r = shortcutsToRegister(state({ windowsLoaded: true, isListening: true, showChat: true }))
    expect(r.ask).toBe(true)
    expect(r.clear).toBe(true)
    expect(r.scrollDown).toBe(true)
  })
  it('registers nothing while the user is recording a new shortcut', () => {
    const r = shortcutsToRegister(
      state({ windowsLoaded: true, isListening: true, showChat: true, isRecordingShortcut: true }),
    )
    expect(Object.values(r).every((v) => v === false)).toBe(true)
  })
})

describe('diffRegistrations', () => {
  it('registers new accelerators and unregisters removed ones', () => {
    const prev = { ask: 'CommandOrControl+Enter', clear: null }
    const next = { ask: 'CommandOrControl+Enter', clear: 'CommandOrControl+R' }
    expect(diffRegistrations(prev, next)).toEqual({
      register: [['clear', 'CommandOrControl+R']],
      unregister: [],
    })
  })
  it('re-registers when an accelerator changes', () => {
    const prev = { ask: 'CommandOrControl+Enter' }
    const next = { ask: 'Alt+Enter' }
    expect(diffRegistrations(prev, next)).toEqual({
      register: [['ask', 'Alt+Enter']],
      unregister: ['CommandOrControl+Enter'],
    })
  })
  it('unregisters when a shortcut is disabled', () => {
    expect(diffRegistrations({ ask: 'Alt+Enter' }, { ask: null })).toEqual({
      register: [],
      unregister: ['Alt+Enter'],
    })
  })
})
