import { deflateSync } from 'node:zlib'

export const TRAY_ICON_SIZE = 16

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const IDLE_COLOUR = [0x6e, 0xe7, 0xb7] as const
const LISTENING_COLOUR = [0xfc, 0xa5, 0xa5] as const

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, crc])
}

export interface TrayIconOptions {
  listening?: boolean
}

/**
 * Draws a small anti-aliased disc and encodes it as a PNG at runtime, so no binary icon has to live in the repo.
 */
export function renderTrayIconPng({ listening = false }: TrayIconOptions = {}): Uint8Array {
  const size = TRAY_ICON_SIZE
  const [r, g, b] = listening ? LISTENING_COLOUR : IDLE_COLOUR
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  const centre = (size - 1) / 2
  const radius = size / 2 - 1
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - centre, y - centre)
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - distance))
      const offset = y * stride + 1 + x * 4
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      raw[offset + 3] = Math.round(coverage * 255)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  header[10] = 0 // compression
  header[11] = 0 // filter
  header[12] = 0 // interlace
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
