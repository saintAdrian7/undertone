import type { TranscriptEntry } from './state'

export interface Screenshot {
  dataBase64: string
  contentType: string
}

export interface AnswerRequest {
  question: string
  transcript: TranscriptEntry[]
  screenshot?: Screenshot
  modeInstruction?: string
  /** The user's resume or notes, so answers draw on their real experience. */
  profile?: string | null
}

/** Streams answer text chunks. Implementations live in the main process so API keys stay there. */
export interface AnswerProvider {
  stream(request: AnswerRequest, signal?: AbortSignal): AsyncIterable<string>
  /** Prepares anything long-lived ahead of the first ask, such as a child process. */
  warm?(profile: string | null): void
  /** Releases anything long-lived, such as a child process. */
  dispose?(): Promise<void>
}

export interface TranscriptionInput {
  samples: Float32Array
  sampleRate: number
  language?: string
}

export interface TranscriptionResult {
  text: string
}

export interface TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>
}
