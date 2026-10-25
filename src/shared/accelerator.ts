/** The slice of a keyboard event needed to build an Electron accelerator. */
export interface KeyLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'OS', 'Hyper', 'Super'])

const NAMED_KEYS: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
}

const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/

/**
 * Turns a key press into an Electron accelerator, or null when it would not make a usable global
 * shortcut (a modifier alone, or a bare key other than a function key).
 */
export function acceleratorFromKey(event: KeyLike): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const modifiers: string[] = []
  if (event.ctrlKey || event.metaKey) modifiers.push('CommandOrControl')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.altKey) modifiers.push('Alt')
  const key = NAMED_KEYS[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key)
  if (modifiers.length === 0 && !FUNCTION_KEY.test(key)) return null
  return [...modifiers, key].join('+')
}

const GLYPHS: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↵' }

/** Human-readable form of an accelerator for the current platform. */
export function formatAccelerator(accelerator: string, platform: string): string {
  const mac = platform === 'darwin'
  return accelerator
    .split('+')
    .map((part) => {
      if (part === 'CommandOrControl' || part === 'CmdOrCtrl') return mac ? '⌘' : 'Ctrl'
      if (part === 'Alt') return mac ? '⌥' : 'Alt'
      if (part === 'Shift') return mac ? '⇧' : 'Shift'
      return GLYPHS[part] ?? part
    })
    .join('+')
}
