import { vi } from 'vitest'
import type { EventMap, InvokeMap, IpcBridge } from '@shared/ipc'

type Listener = (payload: unknown) => void

export interface FakeIpc {
  bridge: IpcBridge & { invoke: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }
  /** Simulates an event arriving from the main process. */
  emit<C extends keyof EventMap>(channel: C, payload: EventMap[C]): void
  /** Registers the response an `invoke` on `channel` should resolve with. */
  respond<C extends keyof InvokeMap>(
    channel: C,
    handler: (request: InvokeMap[C]['request']) => InvokeMap[C]['response'] | Promise<InvokeMap[C]['response']>,
  ): void
  listenerCount(channel: keyof EventMap): number
}

/** Installs a fake `window.ipc` for renderer tests and returns handles to drive it. */
export function installFakeIpc(): FakeIpc {
  const listeners = new Map<string, Set<Listener>>()
  const responders = new Map<string, (request: unknown) => unknown>()

  const invoke = vi.fn(async (channel: string, request: unknown) => {
    const responder = responders.get(channel)
    if (!responder) throw new Error(`No fake responder for ${channel}`)
    return responder(request)
  })
  const send = vi.fn()
  const on = (channel: string, listener: Listener) => {
    const set = listeners.get(channel) ?? new Set<Listener>()
    set.add(listener)
    listeners.set(channel, set)
    return () => {
      set.delete(listener)
    }
  }

  const bridge = { invoke, send, on } as unknown as FakeIpc['bridge']
  window.ipc = bridge
  window.platform = 'win32'

  return {
    bridge,
    emit: (channel, payload) => {
      for (const listener of listeners.get(channel) ?? []) listener(payload)
    },
    respond: (channel, handler) => {
      responders.set(channel, handler as (request: unknown) => unknown)
    },
    listenerCount: (channel) => listeners.get(channel)?.size ?? 0,
  }
}
