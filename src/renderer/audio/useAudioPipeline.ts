import { useEffect, useState } from 'react'
import { IPC } from '@shared/ipc'
import type { AppState, RendererPatch } from '@shared/state'
import type { ModelStatus } from '../stt/whisper-provider'
import { startListening, type ListeningSession } from './listening'

const env = import.meta.env
const WHISPER_MODEL = env.VITE_WHISPER_MODEL ?? 'onnx-community/whisper-base'
// Bundled by scripts/copy-assets.mjs into the renderer's public folder, so nothing executable is fetched at runtime.
// The ONNX runtime resolves relative paths against its own script (Vite's dependency cache in dev), so make them absolute.
const assetUrl = (override: string | undefined, fallback: string): string => new URL(override ?? fallback, document.baseURI).href
const VAD_ASSETS_URL = assetUrl(env.VITE_VAD_ASSETS_URL, 'vendor/vad/')
const ORT_WASM_URL = assetUrl(env.VITE_ORT_WASM_URL, 'vendor/ort/')
const TRANSFORMERS_WASM_URL = assetUrl(env.VITE_TRANSFORMERS_ORT_WASM_URL, 'vendor/ort-transformers/')

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export interface AudioPipelineState {
  error: string | null
  modelStatus: ModelStatus
  /** Advisory text such as "transcription is falling behind", or null. */
  notice: string | null
}

/** Runs microphone and loopback capture, VAD and transcription while the app is listening. */
export function useAudioPipeline(state: AppState, patch: (patch: RendererPatch) => Promise<void>): AudioPipelineState {
  const [error, setError] = useState<string | null>(null)
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!state.isListening) return
    setError(null)
    setNotice(null)
    let disposed = false
    let session: ListeningSession | null = null
    const sessionStartedAt = state.sessionStartedAt ? Date.parse(state.sessionStartedAt) : Date.now()
    const report = (cause: unknown) => setError(describe(cause))

    startListening({
      sessionStartedAt,
      micDeviceId: state.micDeviceId,
      whisperModel: WHISPER_MODEL,
      vadAssetsUrl: VAD_ASSETS_URL,
      ortWasmUrl: ORT_WASM_URL,
      transformersWasmUrl: TRANSFORMERS_WASM_URL,
      onActivity: (role, active) => {
        if (!disposed) patch(role === 'me' ? { meHasVoiceActivity: active } : { themHasVoiceActivity: active }).catch(report)
      },
      // The main process owns the transcript; we only send operations, so echoes can never roll it back.
      onTranscriptOp: (op) => {
        if (!disposed) window.ipc.invoke(IPC.transcriptApply, op).catch(report)
      },
      onModelStatus: (status) => {
        if (!disposed) setModelStatus(status)
      },
      onError: setError,
      onNotice: (message) => {
        if (!disposed) setNotice(message)
      },
    })
      .then((started) => {
        if (disposed) void started.stop()
        else session = started
      })
      .catch((cause: unknown) => {
        if (disposed) return
        report(cause)
        patch({ isListening: false }).catch(report)
      })

    return () => {
      disposed = true
      void session?.stop()
    }
    // Only the listening flag should restart capture; the session start time travels with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isListening])

  return { error, modelStatus, notice }
}
