import { describe, expect, it, vi } from 'vitest'
import { captureScreenshot, fitScreenshot, MAX_SCREENSHOT_BYTES, type CaptureDeps, type CaptureSource, type CaptureThumbnail } from './screenshot'

const png = (bytes: number[]): CaptureThumbnail => ({
  isEmpty: () => bytes.length === 0,
  toPNG: () => new Uint8Array(bytes),
  toJPEG: () => new Uint8Array(bytes.slice(0, Math.ceil(bytes.length / 2))),
  getSize: () => ({ width: 1920, height: 1080 }),
  resize: () => png(bytes.slice(0, Math.ceil(bytes.length / 4))),
})

/** A thumbnail whose encodings have controllable sizes, for the size-cap tests. */
const sized = (pngBytes: number, jpegBytes: number, resizedJpegBytes: number): CaptureThumbnail => ({
  isEmpty: () => false,
  toPNG: () => new Uint8Array(pngBytes),
  toJPEG: () => new Uint8Array(jpegBytes),
  getSize: () => ({ width: 1920, height: 1080 }),
  resize: () => ({
    isEmpty: () => false,
    toPNG: () => new Uint8Array(resizedJpegBytes),
    toJPEG: () => new Uint8Array(resizedJpegBytes),
    getSize: () => ({ width: 960, height: 540 }),
    resize: () => {
      throw new Error('not expected')
    },
  }),
})

describe('fitScreenshot', () => {
  it('keeps PNG when it is within the cap', () => {
    expect(fitScreenshot(sized(100, 50, 10)).contentType).toBe('image/png')
  })
  it('falls back to JPEG when the PNG is too large', () => {
    const result = fitScreenshot(sized(MAX_SCREENSHOT_BYTES + 1, 100, 10))
    expect(result.contentType).toBe('image/jpeg')
    expect(Buffer.from(result.dataBase64, 'base64')).toHaveLength(100)
  })
  it('downscales when even the JPEG is too large', () => {
    const result = fitScreenshot(sized(MAX_SCREENSHOT_BYTES + 1, MAX_SCREENSHOT_BYTES + 1, 10))
    expect(result.contentType).toBe('image/jpeg')
    expect(Buffer.from(result.dataBase64, 'base64')).toHaveLength(10)
  })
  it('fails clearly when nothing fits', () => {
    expect(() => fitScreenshot(sized(MAX_SCREENSHOT_BYTES + 1, MAX_SCREENSHOT_BYTES + 1, MAX_SCREENSHOT_BYTES + 1))).toThrow(/too large/)
  })
})

const source = (displayId: string, bytes: number[]): CaptureSource => ({
  id: `screen:${displayId}`,
  display_id: displayId,
  thumbnail: png(bytes),
})

const display = { id: 2, bounds: { x: 0, y: 0, width: 3840, height: 2160 }, workArea: { x: 0, y: 0, width: 3840, height: 2100 } }

function deps(overrides: Partial<CaptureDeps> = {}): CaptureDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    display,
    getSources: vi.fn(async () => {
      calls.push('getSources')
      return [source('1', [1]), source('2', [2, 3])]
    }),
    setCapturing: (flag) => { calls.push(`capturing:${flag}`) },
    sleep: async () => { calls.push('sleep') },
    ...overrides,
  }
}

describe('captureScreenshot', () => {
  it('hides the overlay before capturing and restores it afterwards', async () => {
    const d = deps()
    await captureScreenshot(d)
    expect(d.calls).toEqual(['capturing:true', 'getSources', 'capturing:false'])
  })

  it('returns the matching display as base64 PNG', async () => {
    const result = await captureScreenshot(deps())
    expect(result).toEqual({ dataBase64: Buffer.from([2, 3]).toString('base64'), contentType: 'image/png' })
  })

  it('requests a thumbnail no larger than the cap, preserving aspect ratio', async () => {
    const d = deps()
    await captureScreenshot(d)
    expect(d.getSources).toHaveBeenCalledWith({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
  })

  it('retries when the thumbnail is empty and succeeds on a later attempt', async () => {
    let attempt = 0
    const d = deps({
      getSources: vi.fn(async () => {
        attempt++
        return [source('2', attempt < 3 ? [] : [9])]
      }),
    })
    const result = await captureScreenshot({ ...d, attempts: 3 })
    expect(attempt).toBe(3)
    expect(result.dataBase64).toBe(Buffer.from([9]).toString('base64'))
    expect(d.calls.filter((c) => c === 'sleep')).toHaveLength(2)
  })

  it('gives up after the configured attempts and still restores the overlay', async () => {
    const d = deps({ getSources: vi.fn(async () => [source('2', [])]) })
    await expect(captureScreenshot({ ...d, attempts: 2 })).rejects.toThrow(/empty/)
    expect(d.calls.at(-1)).toBe('capturing:false')
  })

  it('fails clearly when no screen source exists', async () => {
    const d = deps({ getSources: vi.fn(async () => []) })
    await expect(captureScreenshot({ ...d, attempts: 1 })).rejects.toThrow(/no display source/)
  })
})
