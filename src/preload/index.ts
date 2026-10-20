import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { IpcBridge } from '@shared/ipc'

// Runtime allowlists: a script in the renderer cannot reach channels outside the contract.
const INVOKE_CHANNELS = new Set<string>([IPC.getState, IPC.patchState, IPC.transcriptApply, IPC.ask, IPC.cancelAsk])
const SEND_CHANNELS = new Set<string>([IPC.toggleSession, IPC.controlResetPosition, IPC.toggleChat, IPC.quit])
const EVENT_CHANNELS = new Set<string>([
  IPC.stateUpdated,
  IPC.chatSubmit,
  IPC.chatClear,
  IPC.chatScroll,
  IPC.answerStarted,
  IPC.answerChunk,
  IPC.answerDone,
  IPC.answerError,
])

const assertAllowed = (allowed: Set<string>, channel: string) => {
  if (!allowed.has(channel)) throw new Error(`IPC channel not allowed: ${channel}`)
}

const bridge: IpcBridge = {
  invoke: (channel, request) => {
    assertAllowed(INVOKE_CHANNELS, channel)
    return ipcRenderer.invoke(channel, request)
  },
  send: (channel, payload) => {
    assertAllowed(SEND_CHANNELS, channel)
    ipcRenderer.send(channel, payload)
  },
  on: (channel, listener) => {
    assertAllowed(EVENT_CHANNELS, channel)
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.off(channel, wrapped)
    }
  },
}

contextBridge.exposeInMainWorld('ipc', bridge)
contextBridge.exposeInMainWorld('platform', process.platform)
