import { describe, expect, it } from 'vitest'
import { selectLoopbackSource, pickDisplaySource, thumbnailSizeFor, MAX_SCREENSHOT_SIDE } from './sources'

const a = { id: 'screen:0:0', display_id: '1' }
const b = { id: 'screen:1:0', display_id: '2' }

describe('selectLoopbackSource', () => {
  it('returns the first screen with loopback audio', () => {
    expect(selectLoopbackSource([a, b])).toEqual({ video: a, audio: 'loopback' })
  })
  it('returns an empty response when there are no sources', () => {
    expect(selectLoopbackSource([])).toEqual({})
  })
})

describe('pickDisplaySource', () => {
  it('prefers the source matching the display id', () => {
    expect(pickDisplaySource([a, b], 2)).toBe(b)
  })
  it('falls back to the first source when nothing matches', () => {
    expect(pickDisplaySource([a, b], 9)).toBe(a)
  })
  it('returns undefined when there are no sources', () => {
    expect(pickDisplaySource([], 1)).toBeUndefined()
  })
})

describe('thumbnailSizeFor', () => {
  it('keeps small displays at native size', () => {
    expect(thumbnailSizeFor({ width: 1280, height: 720 })).toEqual({ width: 1280, height: 720 })
  })
  it('keeps a display whose longest side equals the cap', () => {
    expect(thumbnailSizeFor({ width: MAX_SCREENSHOT_SIDE, height: 1080 })).toEqual({ width: 1920, height: 1080 })
  })
  it('scales larger displays down so the longest side is the cap', () => {
    expect(thumbnailSizeFor({ width: 3840, height: 2160 })).toEqual({ width: 1920, height: 1080 })
  })
  it('scales portrait displays by their height', () => {
    expect(thumbnailSizeFor({ width: 1080, height: 3840 })).toEqual({ width: 540, height: 1920 })
  })
})
