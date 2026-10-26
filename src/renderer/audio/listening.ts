import { MicVAD } from '@ricky0123/vad-web'
import type { SpeakerRole } from '@shared/state'
import type { TranscriptionProvider } from '@shared/providers'
import type { TranscriptOp } from '@shared/ipc'
import { createLimiter } from '@shared/limiter'
import { initialSegmenter, reduceSegmenter, type SegmenterState } from '../vad/segmenter'
import { WHISPER_SAMPLE_RATE, getSharedWhisperProvider, type ModelStatus } from '../stt/whisper-provider'

export interface ListeningOptions {
  sessionStartedAt: number
  whisperModel: string
  vadAssetsUrl: string
  ortWasmUrl: string
  /** Where transformers.js should load its own ONNX runtime WASM from; defaults to `ortWasmUrl`. */
  transformersWasmUrl?: string
  onActivity(role: SpeakerRole, active: boolean): void
  /** Transcript changes are emitted as operations; the main process applies them. */
  onTranscriptOp(op: TranscriptOp): void
  onModelStatus?(status: ModelStatus): void
  onError(message: string): void
  transcriptionProvider?: TranscriptionProvider
}

export interface ListeningSession {
  stop(): Promise<void>
}

const MAX_CONCURRENT_TRANSCRIPTIONS = 2
const VAD_REDEMPTION_MS = 300
const VAD_PRE_SPEECH_PAD_MS = 300

const newId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const stopTracks = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop())

/** System audio on Windows: a one-pixel display capture whose video track we discard. */
async function getLoopbackStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: { width: 1, height: 1, frameRate: 1 },
  })
  for (const track of stream.getVideoTracks()) track.stop()
  return stream
}

export async function startListening(options: ListeningOptions): Promise<ListeningSession> {
  let transcription: TranscriptionProvider
  if (options.transcriptionProvider) {
    transcription = options.transcriptionProvider
  } else {
    // One model per renderer, loaded ahead of the first utterance and kept across sessions.
    const whisper = getSharedWhisperProvider({ model: options.whisperModel, wasmPaths: options.transformersWasmUrl ?? options.ortWasmUrl })
    transcription = whisper
    options.onModelStatus?.(whisper.status() === 'ready' ? 'ready' : 'loading')
    whisper
      .preload()
      .then(() => options.onModelStatus?.('ready'))
      .catch((error: unknown) => {
        options.onModelStatus?.('error')
        options.onError(`Speech model failed to load: ${describe(error)}`)
      })
  }
  const limit = createLimiter(MAX_CONCURRENT_TRANSCRIPTIONS)
  const activity: Record<SpeakerRole, boolean> = { me: false, them: false }
  const streams: MediaStream[] = []
  const vads: MicVAD[] = []
  let stopped = false

  async function createRoleVad(role: SpeakerRole, stream: MediaStream): Promise<MicVAD> {
    let segmenter: SegmenterState = initialSegmenter()
    let startedWhileFarSideSpoke = false

    const apply = (output: ReturnType<typeof reduceSegmenter>) => {
      if (stopped) return
      segmenter = output.state
      for (const emit of output.emit) {
        if (emit.type === 'activity') {
          activity[role] = emit.active
          options.onActivity(role, emit.active)
          continue
        }
        // Echo guard: a "me" utterance that began while the far side was talking is most likely the speakers.
        if (role === 'me' && startedWhileFarSideSpoke) continue
        void transcribeSegment(role, emit.audio, emit.startedAt)
      }
    }

    const vad = await MicVAD.new({
      getStream: async () => stream,
      model: 'v5',
      baseAssetPath: options.vadAssetsUrl,
      onnxWASMBasePath: options.ortWasmUrl,
      redemptionMs: VAD_REDEMPTION_MS,
      preSpeechPadMs: VAD_PRE_SPEECH_PAD_MS,
      onSpeechStart: () => {
        startedWhileFarSideSpoke = role === 'me' && activity.them
        apply(reduceSegmenter(segmenter, { type: 'speech-start', at: Date.now() }))
      },
      onVADMisfire: () => apply(reduceSegmenter(segmenter, { type: 'misfire' })),
      onSpeechEnd: (audio) => apply(reduceSegmenter(segmenter, { type: 'speech-end', at: Date.now(), audio })),
    })
    vads.push(vad)
    return vad
  }

  async function transcribeSegment(role: SpeakerRole, audio: Float32Array, startedAt: number): Promise<void> {
    const id = newId()
    options.onTranscriptOp({ op: 'add', id, role, startedAt, sessionStartedAt: options.sessionStartedAt })
    try {
      const { text } = await limit(async () => {
        if (stopped) return { text: '' }
        return transcription.transcribe({ samples: audio, sampleRate: WHISPER_SAMPLE_RATE })
      })
      options.onTranscriptOp(text ? { op: 'resolve', id, text } : { op: 'remove', id })
    } catch (error) {
      options.onTranscriptOp({ op: 'remove', id })
      options.onError(`Transcription failed: ${describe(error)}`)
    }
  }

  async function teardown(): Promise<void> {
    stopped = true
    await Promise.allSettled(vads.map((vad) => vad.destroy()))
    for (const stream of streams) stopTracks(stream)
  }

  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    streams.push(mic)
    const loopback = await getLoopbackStream()
    streams.push(loopback)
    await Promise.all([createRoleVad('me', mic), createRoleVad('them', loopback)])
    for (const vad of vads) vad.start()
  } catch (error) {
    // Release the microphone and anything else acquired before the failure.
    await teardown()
    throw error
  }

  return { stop: teardown }
}
