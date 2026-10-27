// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultState, type AppState } from '@shared/state'
import { IPC } from '@shared/ipc'
import { installFakeIpc, type FakeIpc } from '../test/fake-ipc'

const listening = vi.hoisted(() => ({
  startListening: vi.fn(),
  warmSpeechModel: vi.fn((_options: unknown) => vi.fn()),
  stop: vi.fn(async () => undefined),
}))
vi.mock('./listening', () => ({ startListening: listening.startListening, warmSpeechModel: listening.warmSpeechModel }))

import { useAudioPipeline } from './useAudioPipeline'
import type { ListeningOptions } from './listening'

const state = (patch: Partial<AppState> = {}): AppState => ({ ...defaultState(), ...patch })
let ipc: FakeIpc

beforeEach(() => {
  ipc = installFakeIpc()
  ipc.respond(IPC.transcriptApply, () => defaultState())
  listening.startListening.mockReset()
  listening.warmSpeechModel.mockClear()
  listening.stop.mockClear()
  listening.startListening.mockImplementation(async () => ({ stop: listening.stop }))
})

type WarmOptions = Parameters<typeof import('./listening').warmSpeechModel>[0]

describe('useAudioPipeline', () => {
  it('does nothing while not listening', () => {
    const patch = vi.fn(async () => undefined)
    renderHook(() => useAudioPipeline(state(), patch))
    expect(listening.startListening).not.toHaveBeenCalled()
  })

  it('starts a session when listening begins and stops it on unmount', async () => {
    const patch = vi.fn(async () => undefined)
    const { unmount } = renderHook(() =>
      useAudioPipeline(state({ isListening: true, sessionStartedAt: '2026-10-19T10:00:00.000Z' }), patch),
    )
    await waitFor(() => expect(listening.startListening).toHaveBeenCalledTimes(1))
    const options = listening.startListening.mock.calls[0]?.[0] as ListeningOptions
    expect(options.sessionStartedAt).toBe(Date.parse('2026-10-19T10:00:00.000Z'))
    // The ONNX runtime resolves relative paths against its own script, so the URLs must be absolute.
    expect(options.vadAssetsUrl).toBe(new URL('vendor/vad/', document.baseURI).href)
    expect(options.ortWasmUrl).toBe(new URL('vendor/ort/', document.baseURI).href)
    expect(options.transformersWasmUrl).toBe(new URL('vendor/ort-transformers/', document.baseURI).href)
    unmount()
    await waitFor(() => expect(listening.stop).toHaveBeenCalledTimes(1))
  })

  it('forwards activity as a state patch and transcript operations to the main process', async () => {
    const patch = vi.fn(async () => undefined)
    renderHook(() => useAudioPipeline(state({ isListening: true }), patch))
    await waitFor(() => expect(listening.startListening).toHaveBeenCalled())
    const options = listening.startListening.mock.calls[0]?.[0] as ListeningOptions
    act(() => options.onActivity('them', true))
    expect(patch).toHaveBeenCalledWith({ themHasVoiceActivity: true })
    act(() => options.onTranscriptOp({ op: 'remove', id: 'a' }))
    expect(ipc.bridge.invoke).toHaveBeenCalledWith(IPC.transcriptApply, { op: 'remove', id: 'a' })
  })

  it('reports a start failure and turns listening off', async () => {
    listening.startListening.mockRejectedValueOnce(new Error('Permission denied'))
    const patch = vi.fn(async () => undefined)
    const { result } = renderHook(() => useAudioPipeline(state({ isListening: true }), patch))
    await waitFor(() => expect(result.current.error).toBe('Permission denied'))
    expect(patch).toHaveBeenCalledWith({ isListening: false })
  })

  it('warms the speech model at startup, before listening begins, and exposes its download progress', async () => {
    const patch = vi.fn(async () => undefined)
    const stopWarming = vi.fn()
    listening.warmSpeechModel.mockReturnValueOnce(stopWarming)
    const { result, unmount } = renderHook(() => useAudioPipeline(state(), patch))
    expect(listening.warmSpeechModel).toHaveBeenCalledTimes(1)
    expect(listening.startListening).not.toHaveBeenCalled()
    const options = listening.warmSpeechModel.mock.calls[0]?.[0] as WarmOptions
    expect(options.transformersWasmUrl).toBe(new URL('vendor/ort-transformers/', document.baseURI).href)
    act(() => options.onModelStatus?.('loading'))
    act(() => options.onModelProgress?.({ loaded: 50, total: 200, percent: 25 }))
    expect(result.current.modelStatus).toBe('loading')
    expect(result.current.modelProgress).toEqual({ loaded: 50, total: 200, percent: 25 })
    unmount()
    expect(stopWarming).toHaveBeenCalledTimes(1)
  })

  it('exposes the speech model status reported by the listening session', async () => {
    const patch = vi.fn(async () => undefined)
    const { result } = renderHook(() => useAudioPipeline(state({ isListening: true }), patch))
    await waitFor(() => expect(listening.startListening).toHaveBeenCalled())
    const options = listening.startListening.mock.calls[0]?.[0] as ListeningOptions
    act(() => options.onModelStatus?.('loading'))
    expect(result.current.modelStatus).toBe('loading')
    act(() => options.onModelStatus?.('ready'))
    expect(result.current.modelStatus).toBe('ready')
  })
})
