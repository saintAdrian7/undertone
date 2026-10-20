import type { Size } from '../overlay/geometry'

/** The fields of Electron's `DesktopCapturerSource` this module relies on. */
export interface ScreenSource {
  id: string
  display_id?: string
}

export const MAX_SCREENSHOT_SIDE = 1920

/**
 * Response for `session.setDisplayMediaRequestHandler`: the first screen with Windows
 * loopback audio, so `getDisplayMedia({audio:true})` returns system audio without a picker.
 */
export function selectLoopbackSource<T extends ScreenSource>(sources: readonly T[]): { video: T; audio: 'loopback' } | Record<string, never> {
  const first = sources[0]
  return first ? { video: first, audio: 'loopback' } : {}
}

/** The source for a given Electron display id, falling back to the first screen. */
export function pickDisplaySource<T extends ScreenSource>(sources: readonly T[], displayId: number): T | undefined {
  return sources.find((s) => s.display_id === String(displayId)) ?? sources[0]
}

/** Thumbnail size that keeps the longest side at or below the cap, preserving aspect ratio. */
export function thumbnailSizeFor(bounds: Size, maxSide = MAX_SCREENSHOT_SIDE): Size {
  const longest = Math.max(bounds.width, bounds.height)
  if (longest <= maxSide) return { width: bounds.width, height: bounds.height }
  const scale = maxSide / longest
  return { width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) }
}
