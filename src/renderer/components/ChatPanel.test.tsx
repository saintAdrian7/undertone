// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
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
    isListening: false,
    onAsk: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  }
  const view = render(<ChatPanel {...props} />)
  return { props, ...view }
}

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: /more/i }))
  return screen.getByRole('menu')
}

describe('ChatPanel', () => {
  it('renders interviewer lines as plain text and my lines as bubbles, with times and a transcribing placeholder', () => {
    setup({
      transcript: [
        entry({ id: '1', role: 'them', relativeMs: 12_000, text: 'Why this role?' }),
        entry({ id: '2', role: 'me', relativeMs: 20_000, status: 'transcribing' }),
        entry({ id: '3', role: 'me', relativeMs: 25_000, text: 'Because growth.' }),
      ],
    })
    expect(screen.getByText('Why this role?')).toBeTruthy()
    expect(screen.getByText(/interviewer/i)).toBeTruthy()
    expect(screen.getByText('00:12')).toBeTruthy()
    expect(screen.getByText(/transcribing/i)).toBeTruthy()
    expect(screen.getByText('Because growth.').closest('.me')).toBeTruthy()
  })

  it('shows the empty state with a start button when nothing has been said and we are not listening', () => {
    const { props } = setup({ onToggleListening: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: /start listening/i }))
    expect(props.onToggleListening).toHaveBeenCalledTimes(1)
  })

  it('shows a listening hint instead of the start button while listening with nothing said yet', () => {
    setup({ isListening: true, onToggleListening: vi.fn() })
    expect(screen.queryByRole('button', { name: /start listening/i })).toBeNull()
    expect(screen.getByText(/listening/i)).toBeTruthy()
  })

  it('submits the question on Enter and clears the composer', () => {
    const { props } = setup()
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'What should I say?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(props.onAsk).toHaveBeenCalledWith('What should I say?')
    expect(box.value).toBe('')
  })

  it('does not submit on Shift+Enter', () => {
    const { props } = setup()
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'x' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(props.onAsk).not.toHaveBeenCalled()
  })

  it('sends the draft, or the default question when empty, from the send button', () => {
    const { props } = setup()
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(props.onAsk).toHaveBeenCalledWith('')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(props.onAsk).toHaveBeenLastCalledWith('hi')
  })

  it('shows a thinking indicator while streaming with no text yet', () => {
    setup({ status: 'streaming', answer: '' })
    expect(screen.getByText(/thinking/i)).toBeTruthy()
  })

  it('renders the streamed answer with a screenshot caption when one was sent', () => {
    setup({ status: 'streaming', answer: 'Say hello.', screenshotAttached: true })
    expect(screen.getByText('Say hello.')).toBeTruthy()
    expect(screen.getByText(/screenshot attached/i)).toBeTruthy()
  })

  it('shows errors in a strip with retry and dismiss', () => {
    const { props } = setup({ status: 'error', error: 'Claude request failed: 401', lastQuestion: 'why', onRetry: vi.fn() })
    const strip = screen.getByRole('alert')
    expect(strip.textContent).toContain('401')
    fireEvent.click(within(strip).getByRole('button', { name: /retry/i }))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
    fireEvent.click(within(strip).getByRole('button', { name: /dismiss/i }))
    expect(props.onClear).toHaveBeenCalledTimes(1)
  })

  it('shows that the speech model is loading', () => {
    setup({ modelStatus: 'loading' })
    expect(screen.getByText(/loading speech model/i)).toBeTruthy()
  })

  it('hides the panel from the chevron button', () => {
    const { props } = setup({ onHide: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: /hide panel/i }))
    expect(props.onHide).toHaveBeenCalledTimes(1)
  })

  it('keeps the toggles and clear in the more menu', () => {
    const { props } = setup({
      status: 'done',
      answer: 'x',
      autoAnswer: true,
      isInvisible: false,
      screenUse: 'required',
      onToggleAutoAnswer: vi.fn(),
      onToggleInvisible: vi.fn(),
      onToggleScreenUse: vi.fn(),
      onQuit: vi.fn(),
    })
    const menu = openMenu()
    const auto = within(menu).getByRole('menuitemcheckbox', { name: /automatic answers/i })
    expect(auto.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(auto)
    expect(props.onToggleAutoAnswer).toHaveBeenCalledTimes(1)
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: /hidden from screen share/i }))
    expect(props.onToggleInvisible).toHaveBeenCalledTimes(1)
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: /screenshot/i }))
    expect(props.onToggleScreenUse).toHaveBeenCalledTimes(1)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /clear/i }))
    expect(props.onClear).toHaveBeenCalledTimes(1)
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /quit/i }))
    expect(props.onQuit).toHaveBeenCalledTimes(1)
  })

  it('offers a resume upload in the menu, then shows the uploaded name with replace and remove', () => {
    const onPickProfile = vi.fn()
    const onClearProfile = vi.fn()
    const base: ChatPanelProps = {
      transcript: [],
      answer: '',
      status: 'idle',
      error: null,
      isListening: false,
      onAsk: vi.fn(),
      onClear: vi.fn(),
      onPickProfile,
      onClearProfile,
    }
    const { rerender } = render(<ChatPanel {...base} />)
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: /upload resume/i }))
    expect(onPickProfile).toHaveBeenCalledTimes(1)
    rerender(<ChatPanel {...base} profileName="cv.pdf" profileError="Use a .txt, .md or .pdf file" />)
    const menu = openMenu()
    expect(within(menu).getByText(/cv\.pdf/)).toBeTruthy()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /remove resume/i }))
    expect(onClearProfile).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toContain('.pdf file')
  })
})
