// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultState, type AppState } from '@shared/state'
import { ControlBar } from './ControlBar'

const state = (patch: Partial<AppState> = {}): AppState => ({ ...defaultState(), ...patch })

function setup(patch: Partial<AppState> = {}) {
  const props = {
    state: state(patch),
    onToggleListening: vi.fn(),
    onToggleChat: vi.fn(),
    onToggleAutoAnswer: vi.fn(),
    onOpenSettings: vi.fn(),
  }
  render(<ControlBar {...props} />)
  return props
}

describe('ControlBar', () => {
  it('offers Ask while the panel is hidden and Hide while it is shown', () => {
    const props = setup({ showChat: false })
    const ask = screen.getByRole('button', { name: /^ask$/i })
    expect(ask.className).toContain('accent')
    fireEvent.click(ask)
    expect(props.onToggleChat).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /^hide$/i })).toBeNull()
  })

  it('shows Hide with the neutral style when the panel is open', () => {
    setup({ showChat: true })
    const hide = screen.getByRole('button', { name: /^hide$/i })
    expect(hide.className).not.toContain('accent')
    expect(screen.queryByRole('button', { name: /^ask$/i })).toBeNull()
  })

  it('shimmers the Ask label while an answer is streaming', () => {
    setup({ isAnswering: true })
    expect(screen.getByText('Ask').className).toContain('shimmer')
  })

  it('offers to start listening when idle and to stop while listening', () => {
    const idle = setup()
    fireEvent.click(screen.getByRole('button', { name: /start listening/i }))
    expect(idle.onToggleListening).toHaveBeenCalledTimes(1)
  })

  it('offers to stop while listening', () => {
    const props = setup({ isListening: true })
    fireEvent.click(screen.getByRole('button', { name: /stop listening/i }))
    expect(props.onToggleListening).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /start listening/i })).toBeNull()
  })

  it('shows whether answers come automatically and toggles it', () => {
    const props = setup({ autoAnswer: false })
    const button = screen.getByRole('button', { name: /automatic answers/i })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.className).not.toContain('accent')
    fireEvent.click(button)
    expect(props.onToggleAutoAnswer).toHaveBeenCalledTimes(1)
  })

  it('opens settings from the pill body, but not after a drag', () => {
    const props = setup()
    const body = screen.getByRole('button', { name: /open settings/i })
    fireEvent.mouseDown(body, { screenX: 10, screenY: 10 })
    fireEvent.click(body, { screenX: 11, screenY: 10 })
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(body, { screenX: 10, screenY: 10 })
    fireEvent.click(body, { screenX: 40, screenY: 10 })
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('no longer carries the invisibility, screen or quit controls', () => {
    setup()
    expect(screen.queryByRole('button', { name: /invisib/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /screen/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /quit/i })).toBeNull()
  })
})
