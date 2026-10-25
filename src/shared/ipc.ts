import { z } from 'zod'
import { MAX_TRANSCRIPT_TEXT_CHARS, SpeakerRoleSchema, type AppState, type RendererPatch } from './state'
import { IPC } from './ipc-channels'

export { IPC, type IpcChannel } from './ipc-channels'

export const MAX_QUESTION_CHARS = 2000

const RequestId = z.string().min(1).max(64)

export const AskRequestSchema = z.strictObject({
  requestId: RequestId,
  question: z.string().max(MAX_QUESTION_CHARS),
})
export type AskRequest = z.infer<typeof AskRequestSchema>

export const CancelRequestSchema = z.strictObject({ requestId: RequestId })
export type CancelRequest = z.infer<typeof CancelRequestSchema>

/** Transcript changes are sent as operations so the main process stays the single owner of the array. */
export const TranscriptOpSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('add'),
    id: RequestId,
    role: SpeakerRoleSchema,
    startedAt: z.number(),
    sessionStartedAt: z.number(),
  }),
  z.strictObject({ op: z.literal('resolve'), id: RequestId, text: z.string().max(MAX_TRANSCRIPT_TEXT_CHARS) }),
  z.strictObject({ op: z.literal('remove'), id: RequestId }),
  z.strictObject({ op: z.literal('clear') }),
])
export type TranscriptOp = z.infer<typeof TranscriptOpSchema>

export interface AnswerStartedEvent {
  requestId: string
  screenshotAttached: boolean
}

export interface AnswerChunkEvent {
  requestId: string
  text: string
}

export interface AnswerDoneEvent {
  requestId: string
}

export interface AnswerErrorEvent {
  requestId: string
  message: string
}

export interface InvokeMap {
  [IPC.getState]: { request: undefined; response: AppState }
  [IPC.patchState]: { request: RendererPatch; response: AppState }
  [IPC.transcriptApply]: { request: TranscriptOp; response: AppState }
  [IPC.ask]: { request: AskRequest; response: void }
  [IPC.cancelAsk]: { request: CancelRequest; response: void }
  /** Opens a file picker for a resume; resolves to an error message, or null when the profile changed or the user cancelled. */
  [IPC.profilePick]: { request: undefined; response: string | null }
  [IPC.profileClear]: { request: undefined; response: void }
}

export interface SendMap {
  [IPC.toggleSession]: undefined
  [IPC.controlResetPosition]: undefined
  [IPC.toggleChat]: undefined
  [IPC.quit]: undefined
}

export interface EventMap {
  [IPC.stateUpdated]: AppState
  [IPC.chatSubmit]: undefined
  [IPC.chatClear]: undefined
  [IPC.chatScroll]: { deltaY: number }
  [IPC.answerStarted]: AnswerStartedEvent
  [IPC.answerChunk]: AnswerChunkEvent
  [IPC.answerDone]: AnswerDoneEvent
  [IPC.answerError]: AnswerErrorEvent
}

/** The API the preload script exposes on `window.ipc`. */
export interface IpcBridge {
  invoke<C extends keyof InvokeMap>(channel: C, request: InvokeMap[C]['request']): Promise<InvokeMap[C]['response']>
  send<C extends keyof SendMap>(channel: C, payload: SendMap[C]): void
  on<C extends keyof EventMap>(channel: C, listener: (payload: EventMap[C]) => void): () => void
}

declare global {
  interface Window {
    ipc: IpcBridge
    platform: NodeJS.Platform
  }
}
