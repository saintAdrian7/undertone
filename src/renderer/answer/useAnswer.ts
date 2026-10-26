import { useCallback, useEffect, useRef, useState } from 'react'
import { IPC } from '@shared/ipc'

export type AnswerStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface AnswerHandle {
  answer: string
  status: AnswerStatus
  error: string | null
  /** Whether the main process attached a screenshot to the current question. */
  screenshotAttached: boolean
  ask(question: string): Promise<void>
  clear(): void
}

const newRequestId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Asks the main process for an answer and accumulates the streamed chunks for the latest request only. */
export function useAnswer(): AnswerHandle {
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<AnswerStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [screenshotAttached, setScreenshotAttached] = useState(false)
  const currentRequest = useRef<string | null>(null)
  const streaming = useRef(false)

  useEffect(() => {
    const isCurrent = (requestId: string) => requestId === currentRequest.current
    const unsubscribers = [
      window.ipc.on(IPC.answerStarted, ({ requestId, screenshotAttached: attached }) => {
        if (isCurrent(requestId)) setScreenshotAttached(attached)
      }),
      window.ipc.on(IPC.answerChunk, ({ requestId, text }) => {
        if (isCurrent(requestId)) setAnswer((previous) => previous + text)
      }),
      window.ipc.on(IPC.answerDone, ({ requestId }) => {
        if (!isCurrent(requestId)) return
        streaming.current = false
        setStatus('done')
      }),
      window.ipc.on(IPC.answerError, ({ requestId, message }) => {
        if (!isCurrent(requestId)) return
        streaming.current = false
        setStatus('error')
        setError(message)
      }),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [])

  /** Cancels whatever is streaming right now. Fire and forget: main stops the stream on its side. */
  const cancelCurrent = useCallback(() => {
    const previous = currentRequest.current
    if (!previous || !streaming.current) return
    streaming.current = false
    window.ipc.invoke(IPC.cancelAsk, { requestId: previous }).catch(() => undefined)
  }, [])

  const ask = useCallback(
    async (question: string) => {
      cancelCurrent()
      // Claim the request synchronously so overlapping calls cannot both proceed with the same "previous".
      const requestId = newRequestId()
      currentRequest.current = requestId
      streaming.current = true
      setAnswer('')
      setError(null)
      setScreenshotAttached(false)
      setStatus('streaming')
      try {
        await window.ipc.invoke(IPC.ask, { requestId, question })
      } catch (cause) {
        if (currentRequest.current !== requestId) return
        streaming.current = false
        setStatus('error')
        setError(describe(cause))
      }
    },
    [cancelCurrent],
  )

  const clear = useCallback(() => {
    cancelCurrent()
    currentRequest.current = null
    setAnswer('')
    setError(null)
    setScreenshotAttached(false)
    setStatus('idle')
  }, [cancelCurrent])

  return { answer, status, error, screenshotAttached, ask, clear }
}
