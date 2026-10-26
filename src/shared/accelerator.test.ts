import { describe, expect, it } from 'vitest'
import { acceleratorFromKey, formatAccelerator } from './accelerator'

describe('acceleratorFromKey', () => {
  it('maps modifier combinations to Electron accelerators', () => {
    expect(acceleratorFromKey({ key: 'k', ctrlKey: true })).toBe('CommandOrControl+K')
    expect(acceleratorFromKey({ key: 'k', metaKey: true })).toBe('CommandOrControl+K')
    expect(acceleratorFromKey({ key: 'ArrowUp', shiftKey: true, altKey: true })).toBe('Shift+Alt+Up')
    expect(acceleratorFromKey({ key: 'Enter', ctrlKey: true })).toBe('CommandOrControl+Enter')
    expect(acceleratorFromKey({ key: '\\', ctrlKey: true, shiftKey: true })).toBe('CommandOrControl+Shift+\\')
    expect(acceleratorFromKey({ key: ' ', ctrlKey: true })).toBe('CommandOrControl+Space')
    expect(acceleratorFromKey({ key: 'F5' })).toBe('F5')
  })

  it('rejects a modifier on its own and bare letters', () => {
    expect(acceleratorFromKey({ key: 'Control', ctrlKey: true })).toBeNull()
    expect(acceleratorFromKey({ key: 'Shift', shiftKey: true })).toBeNull()
    expect(acceleratorFromKey({ key: 'k' })).toBeNull()
  })
})

describe('formatAccelerator', () => {
  it('renders accelerators the way the platform shows them', () => {
    expect(formatAccelerator('CommandOrControl+Shift+Up', 'win32')).toBe('Ctrl+Shift+↑')
    expect(formatAccelerator('CommandOrControl+Enter', 'darwin')).toBe('⌘+↵')
  })
})
