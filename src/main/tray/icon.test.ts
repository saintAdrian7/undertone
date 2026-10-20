import { describe, expect, it } from 'vitest'
import { renderTrayIconPng, TRAY_ICON_SIZE } from './icon'

const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length))

describe('renderTrayIconPng', () => {
  it('produces a PNG with the 8-byte signature and a 16x16 RGBA header', () => {
    const png = renderTrayIconPng()
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    expect(ascii(png, 12, 4)).toBe('IHDR')
    expect(view.getUint32(16)).toBe(TRAY_ICON_SIZE)
    expect(view.getUint32(20)).toBe(TRAY_ICON_SIZE)
    expect(png[24]).toBe(8) // bit depth
    expect(png[25]).toBe(6) // colour type RGBA
  })

  it('contains image data and ends with IEND', () => {
    const png = renderTrayIconPng()
    const text = Buffer.from(png).toString('latin1')
    expect(text).toContain('IDAT')
    expect(ascii(png, png.byteLength - 8, 4)).toBe('IEND')
  })

  it('is deterministic and distinguishes the listening state', () => {
    expect(Buffer.from(renderTrayIconPng()).equals(Buffer.from(renderTrayIconPng()))).toBe(true)
    expect(Buffer.from(renderTrayIconPng({ listening: true })).equals(Buffer.from(renderTrayIconPng()))).toBe(false)
  })
})
