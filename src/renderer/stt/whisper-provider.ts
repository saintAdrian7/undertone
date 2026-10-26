import type { TranscriptionInput, TranscriptionProvider, TranscriptionResult } from '@shared/providers'
import { cleanTranscript } from './hallucination-filter'

export const WHISPER_SAMPLE_RATE = 16000

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'

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
export type AsrPipelineFactory = (model: string) => Promise<AsrPipeline>

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
  async (model) => {
    const { pipeline, env } = await import('@huggingface/transformers')
    if (wasmPaths) {
      const wasm = (env.backends.onnx as { wasm?: { wasmPaths?: string } }).wasm
      if (wasm) wasm.wasmPaths = wasmPaths
    }
    const gpu = typeof navigator !== 'undefined' ? (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu : undefined
    const hasAdapter = gpu ? (await gpu.requestAdapter().catch(() => null)) !== null : false
    const load = (device: 'webgpu' | 'wasm') => pipeline('automatic-speech-recognition', model, { device })
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

  constructor(private readonly options: WhisperProviderOptions) {}

  private load(): Promise<AsrPipeline> {
    if (!this.loading) {
      const factory = this.options.pipelineFactory ?? createDefaultPipelineFactory(this.options.wasmPaths)
      this.state = 'loading'
      this.loading = factory(this.options.model)
        .then((pipeline) => {
          this.state = 'ready'
          return pipeline
        })
        .catch((error: unknown) => {
          this.loading = null
          this.state = 'error'
          throw error
        })
    }
    return this.loading
  }

  status(): ModelStatus {
    return this.state
  }

  /** Loads the model ahead of the first utterance so transcription does not stall on it. */
  async preload(): Promise<void> {
    await this.load()
  }

  async dispose(): Promise<void> {
    const pending = this.loading
    this.loading = null
    this.state = 'idle'
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
