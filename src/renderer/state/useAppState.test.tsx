// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { defaultState } from '@shared/state'
import { IPC } from '@shared/ipc'
import { installFakeIpc, type FakeIpc } from '../test/fake-ipc'
import { useAppState } from './useAppState'

let ipc: FakeIpc

beforeEach(() => {
  ipc = installFakeIpc()
  ipc.respond(IPC.getState, () => defaultState())
  ipc.respond(IPC.patchState, (patch) => ({ ...defaultState(), ...patch }))
})

describe('useAppState', () => {
  it('starts with null and loads the state from the main process', async () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current.state).toBeNull()
    await waitFor(() => expect(result.current.state).not.toBeNull())
    expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.getState, undefined)
    expect(result.current.state?.screenUse).toBe('required')
  })

  it('updates when the main process broadcasts a new state', async () => {
    const { result } = renderHook(() => useAppState())
    await waitFor(() => expect(result.current.state).not.toBeNull())
    act(() => ipc.emit(IPC.stateUpdated, { ...defaultState(), isInvisible: true }))
    expect(result.current.state?.isInvisible).toBe(true)
  })

  it('sends patches through invoke and applies the response', async () => {
    const { result } = renderHook(() => useAppState())
    await waitFor(() => expect(result.current.state).not.toBeNull())
    await act(() => result.current.patch({ showChat: true }))
    expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.patchState, { showChat: true })
    expect(result.current.state?.showChat).toBe(true)
  })

  it('unsubscribes from state events on unmount', async () => {
    const { unmount, result } = renderHook(() => useAppState())
    await waitFor(() => expect(result.current.state).not.toBeNull())
    expect(ipc.listenerCount(IPC.stateUpdated)).toBe(1)
    unmount()
    expect(ipc.listenerCount(IPC.stateUpdated)).toBe(0)
  })
})
