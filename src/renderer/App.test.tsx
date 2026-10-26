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

  it('toggles the chat panel and invisibility from the bar', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /ask/i }))
    expect(ipc.bridge.send).toHaveBeenCalledWith(IPC.toggleChat, undefined)
    fireEvent.click(screen.getByRole('button', { name: /invisib/i }))
    await waitFor(() => expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.patchState, { isInvisible: true }))
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

  it('shows audio pipeline errors in the chat window', async () => {
    window.location.hash = '#/chat'
    audioError.value = 'Microphone permission denied'
    render(<App />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/microphone permission denied/i)).toBeTruthy()
  })
})
