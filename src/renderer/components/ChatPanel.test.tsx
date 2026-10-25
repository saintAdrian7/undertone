// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TranscriptEntry } from '@shared/state'
import { ChatPanel, type ChatPanelProps } from './ChatPanel'

const entry = (patch: Partial<TranscriptEntry>): TranscriptEntry => ({
  id: 'e',
  role: 'them',
  createdAt: '2026-10-19T10:00:00.000Z',
  relativeMs: 0,
  status: 'done',
  text: '',
  ...patch,
})

function setup(overrides: Partial<ChatPanelProps> = {}) {
  const props: ChatPanelProps = {
    transcript: [],
    answer: '',
    status: 'idle',
    error: null,
    onAsk: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  }
  render(<ChatPanel {...props} />)
  return props
}

describe('ChatPanel', () => {
  it('renders transcript lines with speaker labels and a placeholder while transcribing', () => {
    setup({
      transcript: [
        entry({ id: '1', role: 'them', relativeMs: 12_000, text: 'Why this role?' }),
        entry({ id: '2', role: 'me', relativeMs: 20_000, status: 'transcribing' }),
      ],
    })
    expect(screen.getByText('Why this role?')).toBeTruthy()
    expect(screen.getByText(/interviewer/i)).toBeTruthy()
    expect(screen.getByText('00:12')).toBeTruthy()
    expect(screen.getByText(/transcribing/i)).toBeTruthy()
  })

  it('submits the question on Enter and clears the input', () => {
    const props = setup()
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'What should I say?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onAsk).toHaveBeenCalledWith('What should I say?')
    expect(input.value).toBe('')
  })

  it('does not submit on Shift+Enter', () => {
    const props = setup()
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(props.onAsk).not.toHaveBeenCalled()
  })

  it('shows a thinking indicator while streaming with no text yet', () => {
    setup({ status: 'streaming', answer: '' })
    expect(screen.getByText(/thinking/i)).toBeTruthy()
  })

  it('renders the streamed answer', () => {
    setup({ status: 'streaming', answer: 'Say hello.' })
    expect(screen.getByText('Say hello.')).toBeTruthy()
  })

  it('renders errors', () => {
    setup({ status: 'error', error: 'Claude request failed: 401' })
    expect(screen.getByText(/401/)).toBeTruthy()
  })

  it('shows a badge when a screenshot was sent with the question', () => {
    setup({ status: 'streaming', answer: 'x', screenshotAttached: true })
    expect(screen.getByText(/screenshot attached/i)).toBeTruthy()
  })

  it('shows that the speech model is loading', () => {
    setup({ modelStatus: 'loading' })
    expect(screen.getByText(/loading speech model/i)).toBeTruthy()
  })

  it('clears via the clear button', () => {
    const props = setup({ status: 'done', answer: 'x' })
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(props.onClear).toHaveBeenCalledTimes(1)
  })

  it('offers a resume upload, then shows the uploaded name with replace and remove', () => {
    const onPickProfile = vi.fn()
    const onClearProfile = vi.fn()
    const base: ChatPanelProps = { transcript: [], answer: '', status: 'idle', error: null, onAsk: vi.fn(), onClear: vi.fn(), onPickProfile, onClearProfile }
    const { rerender } = render(<ChatPanel {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /upload resume/i }))
    expect(onPickProfile).toHaveBeenCalledTimes(1)
    rerender(<ChatPanel {...base} profileName="cv.pdf" profileError="Use a .txt, .md or .pdf file" />)
    expect(screen.getByText(/cv\.pdf/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /remove resume/i }))
    expect(onClearProfile).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toContain('.pdf file')
  })
})
