export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Point, Size {}

/** The subset of Electron's `Display` the overlay needs. Kept local so this module stays pure. */
export interface DisplayLike {
  bounds: Rect
  workArea: Rect
}

const TOP_MARGIN_PX = 25
const CHAT_GAP_PX = 6

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

/** Centre of the display horizontally, just below the top of the work area. */
export function initialControlPosition(display: DisplayLike, width: number): Point {
  return {
    x: display.bounds.x + Math.round((display.bounds.width - width) / 2),
    y: display.workArea.y + TOP_MARGIN_PX,
  }
}

/** Keeps a window fully inside the display's work area. */
export function clampToWorkArea(rect: Rect, display: DisplayLike): Rect {
  const { workArea } = display
  return {
    ...rect,
    x: clamp(rect.x, workArea.x, workArea.x + workArea.width - rect.width),
    y: clamp(rect.y, workArea.y, workArea.y + workArea.height - rect.height),
  }
}

/** Position for the chat panel: horizontally centred under the control bar with a small gap. */
export function chatAnchorFor(control: Rect, chat: Size): Rect {
  return {
    x: control.x + Math.round((control.width - chat.width) / 2),
    y: control.y + control.height + CHAT_GAP_PX,
    width: chat.width,
    height: chat.height,
  }
}
