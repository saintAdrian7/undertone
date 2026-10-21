import { IPC, type AskRequest, type EventMap } from '@shared/ipc'
import type { AnswerProvider, Screenshot } from '@shared/providers'
import type { AppState } from '@shared/state'

export type EventSender = <C extends keyof EventMap>(channel: C, payload: EventMap[C]) => void

export interface AnswerServiceDeps {
  provider: AnswerProvider | null
  getState(): AppState
  capture(): Promise<Screenshot>
  log: { warn(message: string): void }
}

export interface AnswerService {
  /** Streams an answer to `send`. A new ask aborts the one in flight. */
  ask(request: AskRequest, send: EventSender): Promise<void>
  cancel(requestId: string): void
  inFlightId(): string | null
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function createAnswerService(deps: AnswerServiceDeps): AnswerService {
  let inFlight: { requestId: string; controller: AbortController } | null = null

  return {
    async ask({ requestId, question }, send) {
      if (!deps.provider) {
        send(IPC.answerError, {
          requestId,
          message: 'No model is configured. Set ANTHROPIC_API_KEY, or LLM_PROVIDER and LLM_MODEL, in .env and restart the app.',
        })
        return
      }
      // One answer at a time: a new question aborts the previous stream and its token spend.
      inFlight?.controller.abort()
      const controller = new AbortController()
      inFlight = { requestId, controller }
      const isCurrent = () => inFlight?.requestId === requestId && !controller.signal.aborted

      let screenshot: Screenshot | undefined
      if (deps.getState().screenUse === 'required') {
        try {
          screenshot = await deps.capture()
        } catch (error) {
          deps.log.warn(`Screenshot failed, answering without it: ${describe(error)}`)
        }
      }
      try {
        if (!isCurrent()) return
        send(IPC.answerStarted, { requestId, screenshotAttached: screenshot !== undefined })
        // Read the transcript after the capture so the prompt reflects what was said while it ran.
        const request = { question, transcript: deps.getState().transcript, screenshot }
        for await (const chunk of deps.provider.stream(request, controller.signal)) {
          if (!isCurrent()) break
          send(IPC.answerChunk, { requestId, text: chunk })
        }
        if (isCurrent()) send(IPC.answerDone, { requestId })
      } catch (error) {
        if (isCurrent()) send(IPC.answerError, { requestId, message: describe(error) })
      } finally {
        if (inFlight?.requestId === requestId) inFlight = null
      }
    },

    cancel(requestId) {
      if (inFlight?.requestId === requestId) inFlight.controller.abort()
    },

    inFlightId: () => inFlight?.requestId ?? null,
  }
}
