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
}

/** Streams answer text chunks. Implementations live in the main process so API keys stay there. */
export interface AnswerProvider {
  stream(request: AnswerRequest, signal?: AbortSignal): AsyncIterable<string>
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
