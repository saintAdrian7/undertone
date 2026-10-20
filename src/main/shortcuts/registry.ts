import type { AppState, ShortcutKey } from '@shared/state'

export type ShortcutEnablement = Record<ShortcutKey, boolean>

/** Which global shortcuts should be active for the given state. */
export function shortcutsToRegister(state: AppState): ShortcutEnablement {
  if (state.isRecordingShortcut) {
    return {
      toggleVisibility: false,
      ask: false,
      clear: false,
      toggleSession: false,
      moveUp: false,
      moveDown: false,
      moveLeft: false,
      moveRight: false,
      scrollUp: false,
      scrollDown: false,
    }
  }
  const loaded = state.windowsLoaded
  const active = loaded && state.isListening
  const chatOpen = active && state.showChat
  return {
    toggleVisibility: active,
    ask: chatOpen,
    clear: chatOpen,
    toggleSession: loaded,
    moveUp: active,
    moveDown: active,
    moveLeft: active,
    moveRight: active,
    scrollUp: chatOpen,
    scrollDown: chatOpen,
  }
}

export type Registrations = Record<string, string | null | undefined>

export interface RegistrationDiff {
  register: Array<[key: string, accelerator: string]>
  unregister: string[]
}

/** Computes which accelerators to (un)register to move from `prev` to `next`. */
export function diffRegistrations(prev: Registrations, next: Registrations): RegistrationDiff {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  const diff: RegistrationDiff = { register: [], unregister: [] }
  for (const key of keys) {
    const before = prev[key] ?? null
    const after = next[key] ?? null
    if (before === after) continue
    if (before) diff.unregister.push(before)
    if (after) diff.register.push([key, after])
  }
  return diff
}
