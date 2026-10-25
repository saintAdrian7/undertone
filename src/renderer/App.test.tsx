// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultState } from '@shared/state'
import { IPC } from '@shared/ipc'
import { installFakeIpc, type FakeIpc } from './test/fake-ipc'

const audioError = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('./audio/useAudioPipeline', () => ({ useAudioPipeline: () => ({ error: audioError.value, modelStatus: 'idle' }) }))

import { App } from './App'

let ipc: FakeIpc

beforeEach(() => {
  ipc = installFakeIpc()
  ipc.respond(IPC.getState, () => defaultState())
  ipc.respond(IPC.patchState, (patch) => ({ ...defaultState(), ...patch }))
  ipc.respond(IPC.ask, () => undefined)
  audioError.value = null
  window.location.hash = ''
})

describe('App', () => {
  it('renders the control bar on the default route', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /start/i })).toBeTruthy())
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('renders the chat panel on the /chat route', async () => {
    window.location.hash = '#/chat'
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy())
  })

  it('starts a session when Start is clicked', async () => {
    render(<App />)
    const start = await screen.findByRole('button', { name: /start/i })
    fireEvent.click(start)
    expect(ipc.bridge.send).toHaveBeenCalledWith(IPC.toggleSession, undefined)
  })

  it('toggles the chat panel from the bar', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /^ask$/i }))
    expect(ipc.bridge.send).toHaveBeenCalledWith(IPC.toggleChat, undefined)
  })

  it('toggles invisibility from the panel menu', async () => {
    window.location.hash = '#/chat'
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /more/i }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /hidden from screen share/i }))
    await waitFor(() => expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.patchState, { isInvisible: true }))
  })

  it('hides the panel from its chevron', async () => {
    window.location.hash = '#/chat'
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /hide panel/i }))
    expect(ipc.bridge.send).toHaveBeenCalledWith(IPC.toggleChat, undefined)
  })

  it('asks the default question when the global shortcut fires', async () => {
    window.location.hash = '#/chat'
    render(<App />)
    await screen.findByRole('textbox')
    // The listener is registered in a passive effect, which can run after the first paint.
    await waitFor(() => expect(ipc.listenerCount(IPC.chatSubmit)).toBe(1))
    ipc.emit(IPC.chatSubmit, undefined)
    await waitFor(() =>
      expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.ask, expect.objectContaining({ question: '' })),
    )
  })

  it('applies the chosen accent to the document', async () => {
    ipc.respond(IPC.getState, () => ({ ...defaultState(), accent: 'violet' }))
    render(<App />)
    await waitFor(() => expect(document.documentElement.dataset.accent).toBe('violet'))
  })

  it('renders the settings screen on the /settings route', async () => {
    window.location.hash = '#/settings'
    ipc.respond(IPC.appInfo, () => ({ name: 'Undertone', version: '0.1.0', repository: 'https://github.com/x/y' }))
    ipc.respond(IPC.llmGet, () => null)
    ipc.respond(IPC.profileGet, () => null)
    render(<App />)
    expect(await screen.findByRole('heading', { name: /general/i })).toBeTruthy()
  })

  it('shows audio pipeline errors in the chat window', async () => {
    window.location.hash = '#/chat'
    audioError.value = 'Microphone permission denied'
    render(<App />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/microphone permission denied/i)).toBeTruthy()
  })
})
