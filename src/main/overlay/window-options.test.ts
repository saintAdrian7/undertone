import { describe, expect, it } from 'vitest'
import { defaultState, type AppState } from '@shared/state'
import {
  contentProtectionFor,
  isFocusable,
  chatHeightFor,
  overlayWindowOptions,
  CONTROL_SIZE,
  CHAT_WIDTH,
  CHAT_MIN_HEIGHT,
} from './window-options'

const state = (patch: Partial<AppState> = {}): AppState => ({ ...defaultState(), ...patch })

describe('contentProtectionFor', () => {
  it('is off by default', () => {
    expect(contentProtectionFor(state())).toBe(false)
  })
  it('is on when the user enables invisibility', () => {
    expect(contentProtectionFor(state({ isInvisible: true }))).toBe(true)
  })
  it('is on while a screenshot is being captured, even when visible', () => {
    expect(contentProtectionFor(state({ isCapturingScreenshot: true }))).toBe(true)
  })
})

describe('isFocusable', () => {
  it('is focusable by default', () => {
    expect(isFocusable(state())).toBe(true)
  })
  it('stays focusable when invisible but the no-focus option is off', () => {
    expect(isFocusable(state({ isInvisible: true }))).toBe(true)
  })
  it('is not focusable when invisible and no-focus is on', () => {
    expect(isFocusable(state({ isInvisible: true, noFocusWhenInvisible: true }))).toBe(false)
  })
})

describe('chatHeightFor', () => {
  it('uses the collapsed height by default', () => {
    expect(chatHeightFor(state())).toBe(140)
  })
  it('uses the expanded height when expanded', () => {
    expect(chatHeightFor(state({ chatWindowIsExpanded: true, chatExpandedHeight: 420 }))).toBe(420)
  })
  it('never shrinks the expanded height below 350', () => {
    expect(chatHeightFor(state({ chatWindowIsExpanded: true, chatExpandedHeight: 100 }))).toBe(350)
  })
})

describe('overlayWindowOptions', () => {
  it('builds a capture-proof floating control window', () => {
    const opts = overlayWindowOptions('control', state(), { x: 10, y: 20 })
    expect(opts).toMatchObject({
      alwaysOnTop: true,
      frame: false,
      transparent: true,
      hasShadow: false,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      closable: false,
      fullscreenable: false,
      show: false,
      focusable: true,
      width: CONTROL_SIZE.width,
      height: CONTROL_SIZE.height,
      x: 10,
      y: 20,
    })
  })
  it('builds the chat window at the fixed width and state-derived height', () => {
    const opts = overlayWindowOptions('chat', state({ chatWindowIsExpanded: true, chatExpandedHeight: 500 }))
    expect(opts).toMatchObject({ width: CHAT_WIDTH, height: 500, movable: false })
  })
  it('passes through focusability from state', () => {
    const opts = overlayWindowOptions('chat', state({ isInvisible: true, noFocusWhenInvisible: true }))
    expect(opts.focusable).toBe(false)
  })
})
