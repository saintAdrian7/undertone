import { MAX_CHAT_HEIGHT, type AppState } from '@shared/state'
import type { Point, Size } from './geometry'

export const CONTROL_SIZE: Size = { width: 320, height: 50 }
export const CHAT_WIDTH = 540
export const CHAT_MIN_HEIGHT = 140

export type OverlayKind = 'control' | 'chat'

/**
 * Plain object mirroring the `BrowserWindowConstructorOptions` fields the overlay uses.
 * Declared locally so this module can be unit-tested without loading Electron.
 */
export interface OverlayWindowOptions {
  width: number
  height: number
  x?: number
  y?: number
  alwaysOnTop: boolean
  frame: boolean
  transparent: boolean
  hasShadow: boolean
  skipTaskbar: boolean
  resizable: boolean
  movable: boolean
  minimizable: boolean
  closable: boolean
  fullscreenable: boolean
  focusable: boolean
  show: boolean
  title: string
}

/** Hide the overlay from screen capture when invisible, or while taking our own screenshot. */
export function contentProtectionFor(state: AppState): boolean {
  return state.isInvisible || state.isCapturingScreenshot
}

/** Avoid taking keyboard focus when the user asked to stay invisible to focus-tracking apps. */
export function isFocusable(state: AppState): boolean {
  return !(state.isInvisible && state.noFocusWhenInvisible)
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

/** The chat window follows its measured content height, within the minimum and the cap. */
export function chatHeightFor(state: AppState): number {
  if (!state.chatWindowIsExpanded) return CHAT_MIN_HEIGHT
  return clamp(state.chatExpandedHeight, CHAT_MIN_HEIGHT, MAX_CHAT_HEIGHT)
}

export function overlayWindowOptions(kind: OverlayKind, state: AppState, position?: Point): OverlayWindowOptions {
  const size: Size =
    kind === 'control' ? { width: state.controlWidth, height: CONTROL_SIZE.height } : { width: CHAT_WIDTH, height: chatHeightFor(state) }
  return {
    ...size,
    ...position,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: kind === 'control',
    minimizable: false,
    closable: false,
    fullscreenable: false,
    focusable: isFocusable(state),
    show: false,
    title: 'Meeting Copilot',
  }
}
