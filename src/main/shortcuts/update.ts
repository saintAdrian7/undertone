import type { ShortcutUpdate } from '@shared/ipc'
import { ShortcutsSchema, type ShortcutKey, type Shortcuts } from '@shared/state'

export const DEFAULT_SHORTCUTS: Shortcuts = ShortcutsSchema.parse({})

/** One shortcut changed (or reset to its default when `accelerator` is null); no two actions may share one. */
export function applyShortcutUpdate(current: Shortcuts, update: ShortcutUpdate): Shortcuts {
  const accelerator = update.accelerator ?? DEFAULT_SHORTCUTS[update.key]
  const clash = (Object.keys(current) as ShortcutKey[]).find((key) => key !== update.key && current[key] === accelerator)
  if (clash) throw new Error(`${accelerator} is already used by ${clash}`)
  return { ...current, [update.key]: accelerator }
}
