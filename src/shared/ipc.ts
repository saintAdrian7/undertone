import { z } from 'zod'
import { MAX_TRANSCRIPT_TEXT_CHARS, ShortcutsSchema, SpeakerRoleSchema, type AppState, type RendererPatch } from './state'
import { IPC } from './ipc-channels'
import { validateBaseUrl } from './base-url'

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
  [IPC.profileGet]: { request: undefined; response: ProfileInfo | null }
  [IPC.appInfo]: { request: undefined; response: AppInfo }
  [IPC.llmGet]: { request: undefined; response: PublicLlmSettings | null }
  /** Resolves to an error message, or null when the model was switched. */
  [IPC.llmSet]: { request: LlmSettingsRequest; response: string | null }
  /** The separate model for quick decisions (the auto-answer judge), or null when the main one is used. */
  [IPC.llmBackgroundGet]: { request: undefined; response: PublicLlmSettings | null }
  /** Null switches back to the main model. Resolves to an error message, or null on success. */
  [IPC.llmBackgroundSet]: { request: LlmSettingsRequest | null; response: string | null }
  /** Rejects when the accelerator is already taken. */
  [IPC.shortcutsSet]: { request: ShortcutUpdate; response: AppState }
}

/** Window positions; bounded so a bad renderer cannot park the overlay in the far distance. */
const COORD_LIMIT = 20_000
export const ControlDragSchema = z.strictObject({
  x: z.number().int().min(-COORD_LIMIT).max(COORD_LIMIT),
  y: z.number().int().min(-COORD_LIMIT).max(COORD_LIMIT),
})
export type ControlDrag = z.infer<typeof ControlDragSchema>

/** One shortcut change from the Settings window; `null` restores the default. */
export const ShortcutUpdateSchema = z.strictObject({
  key: ShortcutsSchema.keyof(),
  accelerator: z.string().min(1).max(64).nullable(),
})
export type ShortcutUpdate = z.infer<typeof ShortcutUpdateSchema>

export const LlmProviderSchema = z.enum(['anthropic', 'openai', 'claude-code'])

/** Model settings from the Settings window. A missing `apiKey` keeps the stored one. */
const isValidBaseUrl = (value: string | null): boolean => {
  if (value === null) return true
  try {
    validateBaseUrl(value)
    return true
  } catch {
    return false
  }
}

export const LlmSettingsRequestSchema = z.strictObject({
  provider: LlmProviderSchema,
  /** Model names as the providers spell them; never something that could read as a CLI flag. */
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,199}$/, 'Model name contains characters that are not allowed'),
  baseUrl: z
    .string()
    .max(500)
    .nullable()
    .refine(isValidBaseUrl, { message: 'Base URL must use https (plain http is allowed only for localhost) and carry no credentials, query or fragment' }),
  apiKey: z.string().max(500).optional(),
})
export type LlmSettingsRequest = z.infer<typeof LlmSettingsRequestSchema>

/** The model configuration as the renderer may see it: never the key, only whether one is set. */
export interface PublicLlmSettings {
  provider: z.infer<typeof LlmProviderSchema>
  model: string
  baseUrl: string | null
  hasApiKey: boolean
  /** Whether it came from the Settings window or from `.env`. */
  source: 'settings' | 'env'
}

export interface AppInfo {
  name: string
  version: string
  repository: string
}

export interface ProfileInfo {
  name: string
  text: string
}

export interface SendMap {
  [IPC.toggleSession]: undefined
  [IPC.controlResetPosition]: undefined
  [IPC.controlDrag]: ControlDrag
  [IPC.controlDragEnd]: undefined
  [IPC.openSettings]: undefined
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
