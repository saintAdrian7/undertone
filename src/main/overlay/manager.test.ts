import { describe, expect, it, vi } from 'vitest'
import { defaultState, type AppState } from '@shared/state'
import type { DisplayLike, Rect } from './geometry'
import { createOverlayManager, type OverlayWindow, type OverlayManagerDeps } from './manager'
import { CONTROL_SIZE, CHAT_WIDTH, type OverlayWindowOptions } from './window-options'

const display: DisplayLike = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
}

class FakeWindow implements OverlayWindow {
  bounds: Rect
  visible = false
  focusable: boolean
  opacity = 1
  destroyed = false
  contentProtection: boolean | null = null
  routes: string[] = []
  readonly calls: string[] = []

  constructor(options: OverlayWindowOptions) {
    this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width, height: options.height }
    this.focusable = options.focusable
  }
  setContentProtection(enabled: boolean) { this.contentProtection = enabled; this.calls.push(`protect:${enabled}`) }
  setFocusable(enabled: boolean) { this.focusable = enabled; this.calls.push(`focusable:${enabled}`) }
  isFocusable() { return this.focusable }
  setSkipTaskbar(skip: boolean) { this.calls.push(`skipTaskbar:${skip}`) }
  show() { this.visible = true; this.calls.push('show') }
  hide() { this.visible = false; this.calls.push('hide') }
  isVisible() { return this.visible }
  getBounds() { return { ...this.bounds } }
  setPosition(x: number, y: number) { this.bounds = { ...this.bounds, x, y }; this.calls.push(`pos:${x},${y}`) }
  setSize(width: number, height: number) { this.bounds = { ...this.bounds, width, height }; this.calls.push(`size:${width}x${height}`) }
  setOpacity(value: number) { this.opacity = value; this.calls.push(`opacity:${value}`) }
  isDestroyed() { return this.destroyed }
  destroy() { this.destroyed = true; this.calls.push('destroy') }
  loadRoute(route: string) { this.routes.push(route) }
}

function setup(platform: NodeJS.Platform = 'win32') {
  const windows: Record<string, FakeWindow> = {}
  const timers: Array<() => void> = []
  const deps: OverlayManagerDeps = {
    createWindow: (kind, options) => (windows[kind] = new FakeWindow(options)),
    primaryDisplay: () => display,
    displayMatching: () => display,
    platform,
    schedule: (fn) => { timers.push(fn) },
  }
  const manager = createOverlayManager(deps)
  const state = (patch: Partial<AppState> = {}): AppState => ({ ...defaultState(), windowsLoaded: true, isListening: true, ...patch })
  return { manager, windows, timers, state }
}

describe('createOverlayManager', () => {
  it('creates the control and chat windows on first update and loads their routes', () => {
    const { manager, windows } = setup()
    manager.update(defaultState())
    expect(windows.control?.routes).toEqual(['/control'])
    expect(windows.chat?.routes).toEqual(['/chat'])
    expect(windows.control?.bounds).toMatchObject({ x: 800, y: 25, ...CONTROL_SIZE })
    expect(windows.chat?.bounds).toMatchObject({ x: 690, y: 81, width: CHAT_WIDTH, height: 140 })
  })

  it('applies content protection to both windows from state', () => {
    const { manager, windows, state } = setup()
    manager.update(state({ isInvisible: true }))
    expect(windows.control?.contentProtection).toBe(true)
    expect(windows.chat?.contentProtection).toBe(true)
    manager.update(state({ isInvisible: false }))
    expect(windows.chat?.contentProtection).toBe(false)
  })

  it('shows the control bar once loaded and shows the chat only when requested', () => {
    const { manager, windows, state } = setup()
    manager.update(state({ showChat: false }))
    expect(windows.control?.visible).toBe(true)
    expect(windows.chat?.visible).toBe(false)
    manager.update(state({ showChat: true }))
    expect(windows.chat?.visible).toBe(true)
    manager.update(state({ showChat: false }))
    expect(windows.chat?.visible).toBe(false)
  })

  it('keeps everything hidden until the windows have loaded', () => {
    const { manager, windows } = setup()
    manager.update({ ...defaultState(), isListening: true, showChat: true, windowsLoaded: false })
    expect(windows.control?.visible).toBe(false)
    expect(windows.chat?.visible).toBe(false)
  })

  it('shows at zero opacity on Windows and fades in on the next tick', () => {
    const { manager, windows, timers, state } = setup('win32')
    manager.update(state())
    const control = windows.control!
    expect(control.calls.slice(control.calls.indexOf('opacity:0'))).toEqual(expect.arrayContaining(['opacity:0', 'show']))
    expect(control.opacity).toBe(0)
    timers.forEach((fn) => fn())
    expect(control.opacity).toBe(1)
  })

  it('shows immediately on macOS', () => {
    const { manager, windows, timers, state } = setup('darwin')
    manager.update(state())
    expect(windows.control?.calls).not.toContain('opacity:0')
    expect(timers).toHaveLength(0)
  })

  it('updates focusability and keeps the taskbar entry hidden when the setting changes', () => {
    const { manager, windows, state } = setup()
    manager.update(state())
    manager.update(state({ isInvisible: true, noFocusWhenInvisible: true }))
    expect(windows.control?.focusable).toBe(false)
    expect(windows.control?.calls).toContain('skipTaskbar:true')
    expect(windows.chat?.focusable).toBe(false)
  })

  it('moves the control bar within the work area and re-anchors the chat', () => {
    const { manager, windows, state } = setup()
    manager.update(state({ showChat: true }))
    manager.moveControlBy({ deltaX: 5000, deltaY: -100 })
    expect(windows.control?.bounds).toMatchObject({ x: 1920 - CONTROL_SIZE.width, y: 0 })
    expect(windows.chat?.bounds).toMatchObject({ x: 1920 - CHAT_WIDTH, y: 56 })
  })

  it('resets the control bar to its initial position', () => {
    const { manager, windows, state } = setup()
    manager.update(state())
    manager.moveControlBy({ deltaX: 100, deltaY: 100 })
    manager.resetControlPosition()
    expect(windows.control?.bounds).toMatchObject({ x: 800, y: 25 })
  })

  it('resizes the chat when the expanded height changes', () => {
    const { manager, windows, state } = setup()
    manager.update(state({ showChat: true }))
    manager.update(state({ showChat: true, chatWindowIsExpanded: true, chatExpandedHeight: 480 }))
    expect(windows.chat?.bounds.height).toBe(480)
  })

  it('resizes the control bar to the measured width and re-anchors the chat', () => {
    const { manager, windows, state } = setup()
    manager.update(state({ showChat: true }))
    manager.update(state({ showChat: true, controlWidth: 420 }))
    expect(windows.control?.bounds.width).toBe(420)
    const control = windows.control!.bounds
    expect(windows.chat?.bounds.x).toBe(control.x + Math.round((420 - CHAT_WIDTH) / 2))
  })

  it('destroys both windows on dispose', () => {
    const { manager, windows } = setup()
    manager.update(defaultState())
    manager.dispose()
    expect(windows.control?.destroyed).toBe(true)
    expect(windows.chat?.destroyed).toBe(true)
    expect(manager.getWindow('control')).toBeNull()
  })

  it('exposes a broadcast helper that reaches every live window', () => {
    const { manager, windows } = setup()
    manager.update(defaultState())
    const send = vi.fn()
    manager.forEachWindow((w) => send(w))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith(windows.control)
  })
})
