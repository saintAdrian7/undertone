import type { TranscriptionInput, TranscriptionProvider, TranscriptionResult } from '@shared/providers'
import { cleanTranscript } from './hallucination-filter'

export const WHISPER_SAMPLE_RATE = 16000

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Bytes of model files fetched so far, summed over every file the loader has reported. */
export interface ModelProgress {
  loaded: number
  total: number
  percent: number
}

export interface ModelState {
  status: ModelStatus
  /** Download progress while loading; null once nothing is downloading. */
  progress: ModelProgress | null
}

/** What transformers.js passes to `progress_callback`; only the fields we read. */
export interface LoadProgressEvent {
  status: string
  file?: string
  loaded?: number
  total?: number
}

export type Device = 'webgpu' | 'wasm'

/**
 * The weights to fetch for each backend. WebGPU runs 4-bit matmuls fine, so the decoder (the big
 * file) comes as q4 at 124 MB instead of the 208 MB fp32 default; WASM takes the 8-bit set, 77 MB in all.
 */
export function pipelineOptionsFor(device: Device): { device: Device; dtype: string | Record<string, string> } {
  return device === 'webgpu' ? { device, dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } } : { device, dtype: 'q8' }
}

/** Folds per-file loader events into one figure. Files that come from the cache report `done` without a size and are left out. */
export function createProgressTracker(): { update(event: LoadProgressEvent): ModelProgress | null } {
  const files = new Map<string, { loaded: number; total: number }>()
  const summary = (): ModelProgress | null => {
    let loaded = 0
    let total = 0
    for (const file of files.values()) {
      loaded += file.loaded
      total += file.total
    }
    return total > 0 ? { loaded, total, percent: Math.round((loaded / total) * 100) } : null
  }
  return {
    update(event) {
      if (!event.file) return summary()
      if (event.status === 'progress' && typeof event.total === 'number' && event.total > 0) {
        files.set(event.file, { loaded: event.loaded ?? 0, total: event.total })
      } else if (event.status === 'done') {
        const file = files.get(event.file)
        if (file) file.loaded = file.total
      }
      return summary()
    },
  }
}

export interface AsrOptions {
  language?: string
  task?: 'transcribe'
  chunk_length_s?: number
  /** Blocks the decoder from emitting the same n-gram twice, which is how "thank you, thank you, ..." loops start. */
  no_repeat_ngram_size?: number
}

/** English-only checkpoints (`*.en`) reject `language` and `task`; transformers.js throws if they are given. */
export const isEnglishOnlyModel = (model: string): boolean => /\.en$|[-_]en$|english/i.test(model)

const NO_REPEAT_NGRAM = 6

export type AsrPipeline = ((audio: Float32Array, options: AsrOptions) => Promise<{ text: string }>) & {
  dispose?: () => Promise<void> | void
}
export type AsrPipelineFactory = (model: string, onProgress?: (event: LoadProgressEvent) => void) => Promise<AsrPipeline>

export interface WhisperProviderOptions {
  model: string
  /** Base URL for the ONNX runtime WASM files transformers.js loads; keeps it off the CDN default. */
  wasmPaths?: string
  pipelineFactory?: AsrPipelineFactory
}

const WHISPER_CHUNK_SECONDS = 30

/** Loads a Whisper ONNX model through transformers.js on WebGPU when an adapter exists, else WASM. */
const createDefaultPipelineFactory =
  (wasmPaths?: string): AsrPipelineFactory =>
  async (model, onProgress) => {
    const { pipeline, env } = await import('@huggingface/transformers')
    if (wasmPaths) {
      const wasm = (env.backends.onnx as { wasm?: { wasmPaths?: string } }).wasm
      if (wasm) wasm.wasmPaths = wasmPaths
    }
    const gpu = typeof navigator !== 'undefined' ? (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu : undefined
    const hasAdapter = gpu ? (await gpu.requestAdapter().catch(() => null)) !== null : false
    const load = (device: Device) =>
      pipeline('automatic-speech-recognition', model, {
        // transformers.js types dtype per model; ours is a plain string-or-record, which is what it accepts at runtime.
        ...(pipelineOptionsFor(device) as { device: Device }),
        progress_callback: (event: LoadProgressEvent) => onProgress?.(event),
      })
    const asr = hasAdapter ? await load('webgpu').catch(() => load('wasm')) : await load('wasm')
    const run: AsrPipeline = async (audio, options) => {
      // transformers.js types its config loosely; our AsrOptions is a strict subset of it.
      const output = (await asr(audio, options as Parameters<typeof asr>[1])) as { text: string } | Array<{ text: string }>
      return Array.isArray(output) ? { text: output.map((o) => o.text).join(' ') } : output
    }
    run.dispose = () => asr.dispose()
    return run
  }

export class WhisperProvider implements TranscriptionProvider {
  private loading: Promise<AsrPipeline> | null = null
  private state: ModelStatus = 'idle'
  private progress: ModelProgress | null = null
  private readonly listeners = new Set<(state: ModelState) => void>()

  constructor(private readonly options: WhisperProviderOptions) {}

  private publish(status: ModelStatus, progress: ModelProgress | null): void {
    this.state = status
    this.progress = progress
    const snapshot: ModelState = { status, progress }
    for (const listener of this.listeners) listener(snapshot)
  }

  private load(): Promise<AsrPipeline> {
    if (!this.loading) {
      const factory = this.options.pipelineFactory ?? createDefaultPipelineFactory(this.options.wasmPaths)
      const tracker = createProgressTracker()
      this.publish('loading', null)
      this.loading = factory(this.options.model, (event) => {
        if (this.state === 'loading') this.publish('loading', tracker.update(event))
      })
        .then((pipeline) => {
          this.publish('ready', null)
          return pipeline
        })
        .catch((error: unknown) => {
          this.loading = null
          this.publish('error', null)
          throw error
        })
    }
    return this.loading
  }

  status(): ModelStatus {
    return this.state
  }

  /** Calls `listener` with the current state at once, then on every change, until the returned function is called. */
  subscribe(listener: (state: ModelState) => void): () => void {
    this.listeners.add(listener)
    listener({ status: this.state, progress: this.progress })
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Loads the model ahead of the first utterance so transcription does not stall on it. */
  async preload(): Promise<void> {
    await this.load()
  }

  async dispose(): Promise<void> {
    const pending = this.loading
    this.loading = null
    this.state = 'idle'
    this.progress = null
    const pipeline = await pending?.catch(() => null)
    await pipeline?.dispose?.()
  }

  async transcribe({ samples, sampleRate, language }: TranscriptionInput): Promise<TranscriptionResult> {
    if (sampleRate !== WHISPER_SAMPLE_RATE) {
      throw new Error(`Whisper expects ${WHISPER_SAMPLE_RATE} Hz audio, received ${sampleRate} Hz`)
    }
    const run = await this.load()
    const options: AsrOptions = { no_repeat_ngram_size: NO_REPEAT_NGRAM }
    if (!isEnglishOnlyModel(this.options.model)) {
      options.task = 'transcribe'
      if (language) options.language = language
    }
    // The chunked pipeline only earns its cost past one 30 s Whisper window; most utterances are far shorter.
    if (samples.length > WHISPER_SAMPLE_RATE * WHISPER_CHUNK_SECONDS) options.chunk_length_s = WHISPER_CHUNK_SECONDS
    const { text } = await run(samples, options)
    return { text: cleanTranscript(text) ?? '' }
  }
}

let shared: { model: string; provider: WhisperProvider } | null = null

/** One model instance per renderer, reused across listening sessions. */
export function getSharedWhisperProvider(options: WhisperProviderOptions): WhisperProvider {
  if (!shared || shared.model !== options.model) {
    const previous = shared?.provider
    shared = { model: options.model, provider: new WhisperProvider(options) }
    void previous?.dispose()
  }
  return shared.provider
}

export async function disposeSharedWhisperProvider(): Promise<void> {
  const current = shared
  shared = null
  await current?.provider.dispose()
}
