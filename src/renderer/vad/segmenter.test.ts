import { describe, expect, it } from 'vitest'
import { initialSegmenter, reduceSegmenter, shouldForceEnd, gateEcho, MAX_SEGMENT_MS } from './segmenter'

const audio = new Float32Array([0.1, 0.2])

describe('reduceSegmenter', () => {
  it('marks activity and remembers the start time on speech start', () => {
    const { state, emit } = reduceSegmenter(initialSegmenter(), { type: 'speech-start', at: 1000 })
    expect(state).toEqual({ speaking: true, startedAt: 1000 })
    expect(emit).toEqual([{ type: 'activity', active: true }])
  })

  it('emits a segment with timing on speech end', () => {
    const started = reduceSegmenter(initialSegmenter(), { type: 'speech-start', at: 1000 }).state
    const { state, emit } = reduceSegmenter(started, { type: 'speech-end', at: 2500, audio })
    expect(state).toEqual({ speaking: false, startedAt: null })
    expect(emit).toEqual([
      { type: 'activity', active: false },
      { type: 'segment', audio, startedAt: 1000, endedAt: 2500 },
    ])
  })

  it('drops a speech end that had no start', () => {
    const { state, emit } = reduceSegmenter(initialSegmenter(), { type: 'speech-end', at: 2500, audio })
    expect(state).toEqual({ speaking: false, startedAt: null })
    expect(emit).toEqual([{ type: 'activity', active: false }])
  })

  it('clears activity on a misfire without emitting a segment', () => {
    const started = reduceSegmenter(initialSegmenter(), { type: 'speech-start', at: 1000 }).state
    const { state, emit } = reduceSegmenter(started, { type: 'misfire' })
    expect(state).toEqual({ speaking: false, startedAt: null })
    expect(emit).toEqual([{ type: 'activity', active: false }])
  })
})

describe('shouldForceEnd', () => {
  it('is false while not speaking', () => {
    expect(shouldForceEnd(initialSegmenter(), 999999)).toBe(false)
  })
  it('is false before the cap is reached', () => {
    expect(shouldForceEnd({ speaking: true, startedAt: 0 }, MAX_SEGMENT_MS - 1)).toBe(false)
  })
  it('is true once a segment has run for the cap', () => {
    expect(shouldForceEnd({ speaking: true, startedAt: 0 }, MAX_SEGMENT_MS)).toBe(true)
  })
})

describe('gateEcho', () => {
  const frame = new Float32Array([0.3, -0.3, 0.9])
  it('silences the microphone while the other side is speaking', () => {
    const out = gateEcho('me', true, frame)
    expect(Array.from(out)).toEqual([0, 0, 0])
    expect(out).not.toBe(frame)
  })
  it('passes the microphone through when the other side is quiet', () => {
    expect(gateEcho('me', false, frame)).toBe(frame)
  })
  it('never gates the far side', () => {
    expect(gateEcho('them', true, frame)).toBe(frame)
  })
})
