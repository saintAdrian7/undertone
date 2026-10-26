// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { IPC, type AskRequest } from '@shared/ipc'
import { installFakeIpc, type FakeIpc } from '../test/fake-ipc'
import { useAnswer } from './useAnswer'

let ipc: FakeIpc
let lastRequest: AskRequest | null

beforeEach(() => {
  ipc = installFakeIpc()
  lastRequest = null
  ipc.respond(IPC.ask, (request) => {
    lastRequest = request
  })
  ipc.respond(IPC.cancelAsk, () => undefined)
})

describe('useAnswer', () => {
  it('starts idle with an empty answer', () => {
    const { result } = renderHook(() => useAnswer())
    expect(result.current).toMatchObject({ answer: '', status: 'idle', error: null })
  })

  it('sends the question and accumulates chunks for that request', async () => {
    const { result } = renderHook(() => useAnswer())
    await act(() => result.current.ask('What next?'))
    expect(result.current.status).toBe('streaming')
    expect(lastRequest?.question).toBe('What next?')
    const id = lastRequest!.requestId
    act(() => ipc.emit(IPC.answerChunk, { requestId: id, text: 'Say ' }))
    act(() => ipc.emit(IPC.answerChunk, { requestId: id, text: 'hello.' }))
    expect(result.current.answer).toBe('Say hello.')
    act(() => ipc.emit(IPC.answerDone, { requestId: id }))
    expect(result.current.status).toBe('done')
  })

  it('ignores chunks from an older request', async () => {
    const { result } = renderHook(() => useAnswer())
    await act(() => result.current.ask('first'))
    const first = lastRequest!.requestId
    await act(() => result.current.ask('second'))
    const second = lastRequest!.requestId
    expect(first).not.toBe(second)
    act(() => ipc.emit(IPC.answerChunk, { requestId: first, text: 'stale' }))
    act(() => ipc.emit(IPC.answerChunk, { requestId: second, text: 'fresh' }))
    expect(result.current.answer).toBe('fresh')
  })

  it('cancels the previous request when a new question is asked while streaming', async () => {
    const { result } = renderHook(() => useAnswer())
    await act(() => result.current.ask('first'))
    const first = lastRequest!.requestId
    await act(() => result.current.ask('second'))
    expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.cancelAsk, { requestId: first })
  })

  it('remembers whether a screenshot was attached to the current answer', async () => {
    const { result } = renderHook(() => useAnswer())
    expect(result.current.screenshotAttached).toBe(false)
    await act(() => result.current.ask('q'))
    act(() => ipc.emit(IPC.answerStarted, { requestId: lastRequest!.requestId, screenshotAttached: true }))
    expect(result.current.screenshotAttached).toBe(true)
    act(() => ipc.emit(IPC.answerStarted, { requestId: 'stale', screenshotAttached: false }))
    expect(result.current.screenshotAttached).toBe(true)
    act(() => result.current.clear())
    expect(result.current.screenshotAttached).toBe(false)
  })

  it('surfaces errors for the current request', async () => {
    const { result } = renderHook(() => useAnswer())
    await act(() => result.current.ask('q'))
    act(() => ipc.emit(IPC.answerError, { requestId: lastRequest!.requestId, message: 'Claude request failed: 401' }))
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Claude request failed: 401')
  })

  it('clears the answer and returns to idle', async () => {
    const { result } = renderHook(() => useAnswer())
    await act(() => result.current.ask('q'))
    act(() => ipc.emit(IPC.answerChunk, { requestId: lastRequest!.requestId, text: 'x' }))
    act(() => result.current.clear())
    expect(result.current).toMatchObject({ answer: '', status: 'idle', error: null })
  })
})
