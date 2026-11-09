export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A browser bar is never this tall; a page "starting" lower means a small window or a wrong answer. */
export const MAX_TOP_CROP_FRACTION = 0.4

/**
 * The share of the display, from the top, that sits above the browser's page (tabs, address bar,
 * bookmarks), or null when nothing should be cut. Both arguments are in the same (physical) pixels.
 */
export function topCropFraction(pageTop: number, display: Rect): number | null {
  if (display.height <= 0) return null
  const fraction = (pageTop - display.y) / display.height
  if (!(fraction > 0) || fraction > MAX_TOP_CROP_FRACTION) return null
  return fraction
}
