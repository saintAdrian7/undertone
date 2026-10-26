import { describe, expect, it, vi } from 'vitest'
import { defaultState, type AppState, type ShortcutKey } from '@shared/state'
import { createShortcutSyncer, type ShortcutSyncerDeps } from './syncer'

const state = (patch: Partial<AppState> = {}): AppState => ({ ...defaultState(), windowsLoaded: true, ...patch })

const KEYS: ShortcutKey[] = [
  'toggleVisibility',
  'ask',
  'clear',
  'toggleSession',
  'moveUp',
  'moveDown',
  'moveLeft',
  'moveRight',
  'scrollUp',
  'scrollDown',
]

function setup(overrides: Partial<ShortcutSyncerDeps> = {}) {
  const registered = new Map<string, () => void>()
  const deps: ShortcutSyncerDeps = {
    register: vi.fn((accelerator: string, handler: () => void) => {
      registered.set(accelerator, handler)
      return true
    }),
    unregister: vi.fn((accelerator: string) => {
      registered.delete(accelerator)
    }),
    actions: Object.fromEntries(KEYS.map((key) => [key, vi.fn()])) as unknown as Record<ShortcutKey, () => void>,
    log: { error: vi.fn() },
    ...overrides,
  }
  return { syncer: createShortcutSyncer(deps), deps, registered }
}

describe('createShortcutSyncer', () => {
  it('registers only the session toggle when idle', () => {
    const { syncer, registered } = setup()
    syncer.sync(state())
    expect([...registered.keys()]).toEqual(['CommandOrControl+Shift+\\'])
  })

  it('registers movement and ask shortcuts as the state allows, and wires them to actions', () => {
    const { syncer, registered, deps } = setup()
    syncer.sync(state({ isListening: true, showChat: true }))
    expect(registered.has('CommandOrControl+Enter')).toBe(true)
    registered.get('CommandOrControl+Enter')?.()
    expect(deps.actions.ask).toHaveBeenCalledTimes(1)
  })

  it('unregisters shortcuts that are no longer allowed', () => {
    const { syncer, registered, deps } = setup()
    syncer.sync(state({ isListening: true, showChat: true }))
    syncer.sync(state())
    expect(deps.unregister).toHaveBeenCalledWith('CommandOrControl+Enter')
    expect([...registered.keys()]).toEqual(['CommandOrControl+Shift+\\'])
  })

  it('logs a failed registration and does not record it as active', () => {
    const { syncer, deps } = setup({ register: vi.fn(() => false) })
    syncer.sync(state())
    expect(deps.log.error).toHaveBeenCalledWith(expect.stringContaining('CommandOrControl+Shift+\\'))
    expect(syncer.active()).toEqual({})
  })

  it('does not retry an accelerator another app owns on every state change', () => {
    const { syncer, deps } = setup({ register: vi.fn(() => false) })
    syncer.sync(state())
    syncer.sync(state({ showChat: true }))
    syncer.sync(state({ showChat: false }))
    expect(deps.register).toHaveBeenCalledTimes(1)
    expect(deps.log.error).toHaveBeenCalledTimes(1)
  })

  it('survives an invalid accelerator that makes registration throw', () => {
    const { syncer, deps } = setup({
      register: vi.fn(() => {
        throw new Error('invalid accelerator')
      }),
    })
    expect(() => syncer.sync(state())).not.toThrow()
    expect(deps.log.error).toHaveBeenCalled()
  })

  it('unregisters everything on dispose', () => {
    const { syncer, registered } = setup()
    syncer.sync(state({ isListening: true, showChat: true }))
    syncer.dispose()
    expect(registered.size).toBe(0)
  })
})
