// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultState } from '@shared/state'
import { IPC } from '@shared/ipc'
import { installFakeIpc, type FakeIpc } from '../test/fake-ipc'
import { SettingsApp } from './SettingsApp'

let ipc: FakeIpc

beforeEach(() => {
  ipc = installFakeIpc()
  ipc.respond(IPC.getState, () => defaultState())
  ipc.respond(IPC.patchState, (patch) => ({ ...defaultState(), ...patch }))
  ipc.respond(IPC.appInfo, () => ({ name: 'Undertone', version: '0.1.0', repository: 'https://github.com/x/y' }))
  ipc.respond(IPC.llmGet, () => ({ provider: 'claude-code', model: 'sonnet', baseUrl: null, hasApiKey: false, source: 'env' }))
  ipc.respond(IPC.llmSet, () => null)
  ipc.respond(IPC.profileGet, () => ({ name: 'cv.pdf', text: 'Jane Doe, engineer.' }))
  ipc.respond(IPC.profileClear, () => undefined)
  ipc.respond(IPC.shortcutsSet, () => defaultState())
})

const goto = async (page: RegExp) => {
  fireEvent.click(await screen.findByRole('link', { name: page }))
}

describe('SettingsApp', () => {
  it('opens on General with the sidebar sections', async () => {
    render(<SettingsApp />)
    expect(await screen.findByRole('heading', { name: /general/i })).toBeTruthy()
    for (const name of [/general/i, /model/i, /profile/i, /audio/i, /shortcuts/i, /about/i]) {
      expect(screen.getByRole('link', { name })).toBeTruthy()
    }
  })

  it('patches the overlay toggles and the accent from General', async () => {
    render(<SettingsApp />)
    fireEvent.click(await screen.findByRole('switch', { name: /automatic answers/i }))
    await waitFor(() => expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.patchState, { autoAnswer: false }))
    fireEvent.click(screen.getByRole('switch', { name: /hidden from screen share/i }))
    await waitFor(() => expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.patchState, { isInvisible: true }))
    fireEvent.click(screen.getByRole('radio', { name: /jade/i }))
    await waitFor(() => expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.patchState, { accent: 'jade' }))
  })

  it('shows the current model without its key and saves a new provider', async () => {
    render(<SettingsApp />)
    await goto(/model/i)
    const provider = (await screen.findByRole('combobox', { name: /provider/i })) as HTMLSelectElement
    expect(provider.value).toBe('claude-code')
    expect(screen.getByText(/from \.env/i)).toBeTruthy()
    fireEvent.change(provider, { target: { value: 'openai' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^model$/i }), { target: { value: 'llama3' } })
    fireEvent.change(screen.getByRole('textbox', { name: /base url/i }), { target: { value: 'http://localhost:11434/v1' } })
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'k' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.llmSet, { provider: 'openai', model: 'llama3', baseUrl: 'http://localhost:11434/v1', apiKey: 'k' }),
    )
  })

  it('previews the uploaded resume on Profile', async () => {
    render(<SettingsApp />)
    await goto(/profile/i)
    expect(await screen.findByText(/jane doe, engineer/i)).toBeTruthy()
    expect(screen.getByText(/cv\.pdf/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.profileClear, undefined))
  })

  it('records a shortcut on key press and resets it on double click', async () => {
    render(<SettingsApp />)
    await goto(/shortcuts/i)
    const row = (await screen.findByText(/ask for an answer/i)).closest('li')!
    const field = within(row).getByRole('button')
    fireEvent.click(field)
    fireEvent.keyDown(field, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.shortcutsSet, { key: 'ask', accelerator: 'CommandOrControl+K' }))
    fireEvent.doubleClick(field)
    await waitFor(() => expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.shortcutsSet, { key: 'ask', accelerator: null }))
  })

  it('shows name, version and repository on About', async () => {
    render(<SettingsApp />)
    await goto(/about/i)
    expect(await screen.findByText(/0\.1\.0/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /github/i })).toBeTruthy()
  })
})
