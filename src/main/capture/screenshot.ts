import type { DisplayLike, Size } from '../overlay/geometry'
import { pickDisplaySource, thumbnailSizeFor, type ScreenSource } from './sources'

/** The subset of Electron's `NativeImage` the capture path uses. */
export interface CaptureThumbnail {
  isEmpty(): boolean
  toPNG(): Uint8Array
  toJPEG(quality: number): Uint8Array
  getSize(): Size
  resize(options: { width: number }): CaptureThumbnail
}

export interface CaptureSource extends ScreenSource {
  thumbnail: CaptureThumbnail
}

export interface CaptureDeps {
  display: DisplayLike & { id: number }
  getSources(options: { types: ['screen']; thumbnailSize: Size }): Promise<CaptureSource[]>
  /** Toggles the overlay's content protection so our own windows never appear in the capture. */
  setCapturing(flag: boolean): void | Promise<void>
  sleep?: (ms: number) => Promise<void>
  attempts?: number
  retryDelayMs?: number
}

export interface ScreenshotResult {
  dataBase64: string
  contentType: 'image/png' | 'image/jpeg'
}

/** Keeps every image comfortably under the model API's per-image limit. */
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024
const JPEG_QUALITY = 80
const DEFAULT_ATTEMPTS = 3
const DEFAULT_RETRY_DELAY_MS = 500
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const encode = (bytes: Uint8Array, contentType: ScreenshotResult['contentType']): ScreenshotResult => ({
  dataBase64: Buffer.from(bytes).toString('base64'),
  contentType,
})

/** PNG when it fits, otherwise JPEG, otherwise a half-width JPEG. */
export function fitScreenshot(thumbnail: CaptureThumbnail): ScreenshotResult {
  const png = thumbnail.toPNG()
  if (png.byteLength <= MAX_SCREENSHOT_BYTES) return encode(png, 'image/png')
  const jpeg = thumbnail.toJPEG(JPEG_QUALITY)
  if (jpeg.byteLength <= MAX_SCREENSHOT_BYTES) return encode(jpeg, 'image/jpeg')
  const smaller = thumbnail.resize({ width: Math.round(thumbnail.getSize().width / 2) }).toJPEG(JPEG_QUALITY)
  if (smaller.byteLength <= MAX_SCREENSHOT_BYTES) return encode(smaller, 'image/jpeg')
  throw new Error('Unable to capture screenshot: image too large even after downscaling')
}

async function captureOnce(deps: CaptureDeps): Promise<ScreenshotResult> {
  const sources = await deps.getSources({ types: ['screen'], thumbnailSize: thumbnailSizeFor(deps.display.bounds) })
  const source = pickDisplaySource(sources, deps.display.id)
  if (!source) throw new Error(`Unable to capture screenshot: no display source found for display ${deps.display.id}`)
  if (source.thumbnail.isEmpty()) throw new Error('Unable to capture screenshot: thumbnail is empty')
  return fitScreenshot(source.thumbnail)
}

/** Captures the display under the overlay with the overlay hidden from capture, retrying transient empty frames. */
export async function captureScreenshot(deps: CaptureDeps): Promise<ScreenshotResult> {
  const attempts = deps.attempts ?? DEFAULT_ATTEMPTS
  const sleep = deps.sleep ?? defaultSleep
  const delay = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  await deps.setCapturing(true)
  try {
    let lastError: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await captureOnce(deps)
      } catch (error) {
        lastError = error
        if (attempt < attempts) await sleep(delay)
      }
    }
    throw lastError
  } finally {
    await deps.setCapturing(false)
  }
}
