const INT16_MAX = 32767
const INT16_MIN = -32768
const WAV_HEADER_BYTES = 44

/** Little-endian signed 16-bit PCM bytes to normalised floats in [-1, 1]. A trailing odd byte is ignored. */
export function int16ToFloat32(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.byteLength / 2)
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2)
  const out = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    const sample = view.getInt16(i * 2, true)
    out[i] = sample < 0 ? sample / -INT16_MIN : sample / INT16_MAX
  }
  return out
}

/** Linear-interpolation resampler. Adequate for speech going into a VAD or ASR model. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return new Float32Array(input)
  const ratio = fromRate / toRate
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  const last = input.length - 1
  for (let i = 0; i < outLength; i++) {
    const position = i * ratio
    const index = Math.floor(position)
    const next = Math.min(index + 1, last)
    const fraction = position - index
    const a = input[index] ?? 0
    const b = input[next] ?? a
    out[i] = a + (b - a) * fraction
  }
  return out
}

/** Encodes mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)
  let offset = WAV_HEADER_BYTES
  for (const sample of samples) {
    const clipped = Math.max(-1, Math.min(1, sample))
    view.setInt16(offset, clipped < 0 ? clipped * -INT16_MIN : clipped * INT16_MAX, true)
    offset += 2
  }
  return new Uint8Array(buffer)
}
