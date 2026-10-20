import { describe, expect, it } from 'vitest'
import { int16ToFloat32, resampleLinear, encodeWav } from './pcm'

const int16Bytes = (values: number[]): Uint8Array => new Uint8Array(new Int16Array(values).buffer)

describe('int16ToFloat32', () => {
  it('maps the full signed 16-bit range onto [-1, 1]', () => {
    const out = int16ToFloat32(int16Bytes([0, 32767, -32768, 16384]))
    expect(out.length).toBe(4)
    expect(out[0]).toBeCloseTo(0, 6)
    expect(out[1]).toBeCloseTo(1, 6)
    expect(out[2]).toBeCloseTo(-1, 6)
    expect(out[3]).toBeCloseTo(0.5, 3)
  })

  it('ignores a trailing odd byte', () => {
    const bytes = new Uint8Array([0, 0, 255, 127, 9])
    expect(int16ToFloat32(bytes).length).toBe(2)
  })
})

describe('resampleLinear', () => {
  it('reduces 48 kHz to 16 kHz by a factor of three', () => {
    const input = new Float32Array(48).fill(0.25)
    const out = resampleLinear(input, 48000, 16000)
    expect(out.length).toBe(16)
    expect(Array.from(out).every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true)
  })

  it('returns the same samples when rates match', () => {
    const input = new Float32Array([0.1, 0.2, 0.3])
    expect(Array.from(resampleLinear(input, 16000, 16000))).toEqual([0.1, 0.2, 0.3].map((v) => Math.fround(v)))
  })

  it('interpolates between neighbouring samples', () => {
    const input = new Float32Array([0, 1])
    const out = resampleLinear(input, 2, 4)
    expect(out.length).toBe(4)
    expect(out[1]).toBeCloseTo(0.5, 6)
  })
})

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM header with the given sample rate', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 16000)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    const ascii = (offset: number, len: number) => String.fromCharCode(...wav.subarray(offset, offset + len))
    expect(ascii(0, 4)).toBe('RIFF')
    expect(ascii(8, 4)).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(6)
    expect(wav.byteLength).toBe(44 + 6)
  })

  it('clips samples outside [-1, 1]', () => {
    const wav = encodeWav(new Float32Array([2, -2]), 16000)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32768)
  })
})
