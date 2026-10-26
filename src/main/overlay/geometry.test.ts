import { describe, expect, it } from 'vitest'
import { clampToWorkArea, initialControlPosition, chatAnchorFor } from './geometry'

const display = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
}

describe('initialControlPosition', () => {
  it('centres the bar horizontally and puts it 25px below the work area top', () => {
    expect(initialControlPosition(display, 163)).toEqual({ x: 879, y: 25 })
  })

  it('respects a display offset on multi-monitor setups', () => {
    const second = {
      bounds: { x: 1920, y: 0, width: 1000, height: 800 },
      workArea: { x: 1920, y: 30, width: 1000, height: 770 },
    }
    expect(initialControlPosition(second, 100)).toEqual({ x: 2370, y: 55 })
  })
})

describe('clampToWorkArea', () => {
  it('leaves bounds inside the work area unchanged', () => {
    expect(clampToWorkArea({ x: 100, y: 100, width: 163, height: 50 }, display)).toEqual({
      x: 100,
      y: 100,
      width: 163,
      height: 50,
    })
  })

  it('clamps bounds that overflow the right and bottom edges', () => {
    expect(clampToWorkArea({ x: 1900, y: 1030, width: 163, height: 50 }, display)).toEqual({
      x: 1757,
      y: 990,
      width: 163,
      height: 50,
    })
  })

  it('clamps negative positions to the work area origin', () => {
    expect(clampToWorkArea({ x: -40, y: -10, width: 163, height: 50 }, display)).toEqual({
      x: 0,
      y: 0,
      width: 163,
      height: 50,
    })
  })
})

describe('chatAnchorFor', () => {
  it('centres the chat under the control bar with a 6px gap', () => {
    const anchor = chatAnchorFor({ x: 879, y: 25, width: 163, height: 50 }, { width: 540, height: 140 })
    expect(anchor).toEqual({ x: 691, y: 81, width: 540, height: 140 })
  })
})
