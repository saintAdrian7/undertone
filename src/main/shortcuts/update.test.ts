import { describe, expect, it } from 'vitest'
import { ShortcutsSchema } from '@shared/state'
import { applyShortcutUpdate, DEFAULT_SHORTCUTS } from './update'

describe('applyShortcutUpdate', () => {
  const current = ShortcutsSchema.parse({})

  it('changes one accelerator and leaves the others alone', () => {
    const next = applyShortcutUpdate(current, { key: 'ask', accelerator: 'CommandOrControl+K' })
    expect(next.ask).toBe('CommandOrControl+K')
    expect(next.clear).toBe(current.clear)
  })

  it('restores the default when the accelerator is null', () => {
    const changed = applyShortcutUpdate(current, { key: 'ask', accelerator: 'F9' })
    expect(applyShortcutUpdate(changed, { key: 'ask', accelerator: null }).ask).toBe(DEFAULT_SHORTCUTS.ask)
  })

  it('refuses an accelerator already used by another action', () => {
    expect(() => applyShortcutUpdate(current, { key: 'ask', accelerator: current.clear })).toThrow(/already used/)
  })
})
