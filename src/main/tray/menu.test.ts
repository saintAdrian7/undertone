import { describe, expect, it, vi } from 'vitest'
import { defaultState, type AppState } from '@shared/state'
import { trayMenuTemplate, type TrayActions } from './menu'

const state = (patch: Partial<AppState> = {}): AppState => ({ ...defaultState(), ...patch })

function actions(): TrayActions {
  return { toggleChat: vi.fn(), toggleInvisible: vi.fn(), toggleListening: vi.fn(), openSettings: vi.fn(), quit: vi.fn() }
}

const labels = (items: ReturnType<typeof trayMenuTemplate>) => items.map((item) => item.label ?? item.type)

describe('trayMenuTemplate', () => {
  it('describes the current state in its labels', () => {
    expect(labels(trayMenuTemplate(state(), actions()))).toEqual([
      'Start listening',
      'Show panel',
      'Enable invisibility',
      'Settings…',
      'separator',
      'Quit Undertone',
    ])
    expect(labels(trayMenuTemplate(state({ isListening: true, showChat: true, isInvisible: true }), actions()))).toEqual([
      'Stop listening',
      'Hide panel',
      'Disable invisibility',
      'Settings…',
      'separator',
      'Quit Undertone',
    ])
  })

  it('wires each item to its action', () => {
    const a = actions()
    const items = trayMenuTemplate(state(), a)
    items[0]?.click?.()
    items[1]?.click?.()
    items[2]?.click?.()
    items[3]?.click?.()
    items[5]?.click?.()
    expect(a.toggleListening).toHaveBeenCalledTimes(1)
    expect(a.toggleChat).toHaveBeenCalledTimes(1)
    expect(a.toggleInvisible).toHaveBeenCalledTimes(1)
    expect(a.openSettings).toHaveBeenCalledTimes(1)
    expect(a.quit).toHaveBeenCalledTimes(1)
  })
})
