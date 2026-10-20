import type { AppState, ShortcutKey } from '@shared/state'
import { diffRegistrations, shortcutsToRegister, type Registrations } from './registry'

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

export interface ShortcutSyncerDeps {
  /** `globalShortcut.register`; returns false when another app owns the accelerator. */
  register(accelerator: string, handler: () => void): boolean
  unregister(accelerator: string): void
  actions: Record<ShortcutKey, () => void>
  log: { error(message: string): void }
}

export interface ShortcutSyncer {
  sync(state: AppState): void
  /** Accelerators currently registered, by shortcut key. */
  active(): Record<string, string>
  dispose(): void
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function createShortcutSyncer(deps: ShortcutSyncerDeps): ShortcutSyncer {
  let registered: Registrations = {}
  // Accelerators that could not be registered; retried only once the user changes them.
  const failed = new Set<string>()

  return {
    sync(state) {
      const enabled = shortcutsToRegister(state)
      const next: Registrations = {}
      for (const key of KEYS) {
        const accelerator = enabled[key] ? state.shortcuts[key] : null
        next[key] = accelerator && failed.has(accelerator) ? null : accelerator
      }
      const diff = diffRegistrations(registered, next)
      for (const accelerator of diff.unregister) deps.unregister(accelerator)
      for (const [key, accelerator] of diff.register) {
        try {
          if (!deps.register(accelerator, deps.actions[key as ShortcutKey])) {
            deps.log.error(`Failed to register global shortcut ${accelerator} for ${key} (another app may own it)`)
            failed.add(accelerator)
            next[key] = null
          }
        } catch (error) {
          deps.log.error(`Invalid accelerator ${accelerator} for ${key}: ${describe(error)}`)
          failed.add(accelerator)
          next[key] = null
        }
      }
      registered = next
    },

    active() {
      return Object.fromEntries(Object.entries(registered).filter((entry): entry is [string, string] => !!entry[1]))
    },

    dispose() {
      for (const accelerator of Object.values(registered)) if (accelerator) deps.unregister(accelerator)
      registered = {}
    },
  }
}
