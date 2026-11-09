import { describe, expect, it } from 'vitest'
import { MAX_TOP_CROP_FRACTION, topCropFraction } from './page-crop'

const display = { x: 0, y: 0, width: 1920, height: 1080 }

describe('topCropFraction', () => {
  it('is the share of the display above the page', () => {
    expect(topCropFraction(182, display)).toBeCloseTo(182 / 1080)
  })

  it('measures from the display it is given, not from the virtual desktop origin', () => {
    expect(topCropFraction(-1080 + 131, { x: 0, y: -1080, width: 1920, height: 1080 })).toBeCloseTo(131 / 1080)
  })

  it('crops nothing when the page starts at or above the top of the display', () => {
    expect(topCropFraction(0, display)).toBeNull()
    expect(topCropFraction(-20, display)).toBeNull()
  })

  it('crops nothing when the page would start implausibly far down, which means a small or odd window', () => {
    expect(topCropFraction(Math.ceil(1080 * MAX_TOP_CROP_FRACTION) + 1, display)).toBeNull()
  })

  it('crops nothing for an empty display', () => {
    expect(topCropFraction(100, { x: 0, y: 0, width: 0, height: 0 })).toBeNull()
  })
})
