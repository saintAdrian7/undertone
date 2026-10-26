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
    onToggleInvisible: vi.fn(),
    onToggleScreenUse: vi.fn(),
  }
  render(<ControlBar {...props} />)
  return props
}

describe('ControlBar', () => {
  it('shows whether screenshots are attached to questions and toggles it', () => {
    const props = setup({ screenUse: 'required' })
    const button = screen.getByRole('button', { name: /screen/i })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(props.onToggleScreenUse).toHaveBeenCalledTimes(1)
  })

  it('offers to start listening when idle', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    expect(props.onToggleListening).toHaveBeenCalledTimes(1)
  })

  it('offers to stop while listening', () => {
    const props = setup({ isListening: true })
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(props.onToggleListening).toHaveBeenCalledTimes(1)
  })

  it('toggles the chat panel', () => {
    const props = setup({ isListening: true })
    fireEvent.click(screen.getByRole('button', { name: /ask/i }))
    expect(props.onToggleChat).toHaveBeenCalledTimes(1)
  })

  it('toggles invisibility and reflects the current mode', () => {
    const props = setup({ isInvisible: true })
    const button = screen.getByRole('button', { name: /invisib/i })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(props.onToggleInvisible).toHaveBeenCalledTimes(1)
  })

  it('shows who is speaking', () => {
    setup({ isListening: true, themHasVoiceActivity: true })
    expect(screen.getByText(/interviewer/i)).toBeTruthy()
  })
})
