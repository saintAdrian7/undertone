import type { AppState } from '@shared/state'
import { chatAnchorFor, clampToWorkArea, initialControlPosition, type DisplayLike, type Point, type Rect } from './geometry'
import {
  CHAT_WIDTH,
  CONTROL_SIZE,
  chatHeightFor,
  contentProtectionFor,
  isFocusable,
  overlayWindowOptions,
  type OverlayKind,
  type OverlayWindowOptions,
} from './window-options'

/** The subset of Electron's `BrowserWindow` the manager drives, so tests can supply a fake. */
export interface OverlayWindow {
  setContentProtection(enabled: boolean): void
  setFocusable(enabled: boolean): void
  isFocusable(): boolean
  setSkipTaskbar(skip: boolean): void
  show(): void
  hide(): void
  isVisible(): boolean
  getBounds(): Rect
  setPosition(x: number, y: number): void
  setSize(width: number, height: number): void
  setOpacity(value: number): void
  isDestroyed(): boolean
  destroy(): void
  loadRoute(route: string): void
}

export interface OverlayManagerDeps {
  createWindow(kind: OverlayKind, options: OverlayWindowOptions): OverlayWindow
  primaryDisplay(): DisplayLike
  displayMatching(rect: Rect): DisplayLike
  platform: NodeJS.Platform
  schedule(fn: () => void, delayMs: number): void
}

export interface OverlayManager {
  update(state: AppState): void
  getWindow(kind: OverlayKind): OverlayWindow | null
  forEachWindow(fn: (window: OverlayWindow, kind: OverlayKind) => void): void
  moveControlBy(delta: { deltaX?: number; deltaY?: number }): void
  setControlPosition(point: Point): void
  resetControlPosition(): void
  dispose(): void
}

/** Transparent windows paint a white frame on first show on Windows; showing at opacity 0 hides it. */
export const FADE_IN_DELAY_MS = 30

const ROUTES: Record<OverlayKind, string> = { control: '/control', chat: '/chat' }

export function createOverlayManager(deps: OverlayManagerDeps): OverlayManager {
  const windows: Record<OverlayKind, OverlayWindow | null> = { control: null, chat: null }

  const live = (kind: OverlayKind): OverlayWindow | null => {
    const w = windows[kind]
    return w && !w.isDestroyed() ? w : null
  }

  function ensureWindows(state: AppState): { control: OverlayWindow; chat: OverlayWindow } {
    let control = live('control')
    if (!control) {
      const position = initialControlPosition(deps.primaryDisplay(), CONTROL_SIZE.width)
      control = deps.createWindow('control', overlayWindowOptions('control', state, position))
      control.loadRoute(ROUTES.control)
      windows.control = control
    }
    let chat = live('chat')
    if (!chat) {
      chat = deps.createWindow('chat', overlayWindowOptions('chat', state))
      chat.loadRoute(ROUTES.chat)
      windows.chat = chat
      anchorChat()
    }
    return { control, chat }
  }

  function showWithoutFlash(window: OverlayWindow): void {
    if (deps.platform === 'darwin') {
      window.show()
      return
    }
    window.setOpacity(0)
    window.show()
    deps.schedule(() => {
      if (!window.isDestroyed()) window.setOpacity(1)
    }, FADE_IN_DELAY_MS)
  }

  function syncVisibility(window: OverlayWindow, shouldShow: boolean): void {
    if (shouldShow === window.isVisible()) return
    if (shouldShow) showWithoutFlash(window)
    else window.hide()
  }

  function syncFocus(window: OverlayWindow, state: AppState): void {
    const focusable = isFocusable(state)
    if (focusable === window.isFocusable()) return
    window.setFocusable(focusable)
    window.setSkipTaskbar(true)
  }

  function anchorChat(): void {
    const control = live('control')
    const chat = live('chat')
    if (!control || !chat) return
    const current = chat.getBounds()
    const anchored = chatAnchorFor(control.getBounds(), { width: current.width, height: current.height })
    const target = clampToWorkArea(anchored, deps.displayMatching(anchored))
    if (target.x !== current.x || target.y !== current.y) chat.setPosition(target.x, target.y)
  }

  function placeControl(point: Point): void {
    const control = live('control')
    if (!control) return
    const bounds = control.getBounds()
    const wanted = { ...bounds, ...point }
    const clamped = clampToWorkArea(wanted, deps.displayMatching(wanted))
    if (clamped.x !== bounds.x || clamped.y !== bounds.y) control.setPosition(clamped.x, clamped.y)
    anchorChat()
  }

  return {
    update(state) {
      const { control, chat } = ensureWindows(state)
      const protect = contentProtectionFor(state)
      control.setContentProtection(protect)
      chat.setContentProtection(protect)
      syncFocus(control, state)
      syncFocus(chat, state)

      const height = chatHeightFor(state)
      if (chat.getBounds().height !== height) {
        chat.setSize(CHAT_WIDTH, height)
        anchorChat()
      }

      const controlVisible = state.windowsLoaded
      const chatVisible = state.windowsLoaded && state.showChat
      syncVisibility(control, controlVisible)
      syncVisibility(chat, chatVisible)
    },

    getWindow: (kind) => live(kind),

    forEachWindow(fn) {
      for (const kind of ['control', 'chat'] as const) {
        const w = live(kind)
        if (w) fn(w, kind)
      }
    },

    moveControlBy({ deltaX = 0, deltaY = 0 }) {
      const control = live('control')
      if (!control) return
      const { x, y } = control.getBounds()
      placeControl({ x: x + deltaX, y: y + deltaY })
    },

    setControlPosition: placeControl,

    resetControlPosition() {
      const control = live('control')
      if (!control) return
      placeControl(initialControlPosition(deps.displayMatching(control.getBounds()), CONTROL_SIZE.width))
    },

    dispose() {
      for (const kind of ['control', 'chat'] as const) {
        live(kind)?.destroy()
        windows[kind] = null
      }
    },
  }
}
