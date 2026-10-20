import { MAX_TRANSCRIPT_ENTRIES, type SpeakerRole, type TranscriptEntry } from './state'
import type { TranscriptOp } from './ipc'

export { formatRelative } from './time'

export interface PlaceholderInput {
  id: string
  role: SpeakerRole
  startedAt: number
  sessionStartedAt: number
}

const byTime = (a: TranscriptEntry, b: TranscriptEntry): number => Date.parse(a.createdAt) - Date.parse(b.createdAt)

/** Adds a "transcribing" entry at its chronological position. Never mutates the input list. */
export function addPlaceholder(transcript: readonly TranscriptEntry[], input: PlaceholderInput): TranscriptEntry[] {
  const entry: TranscriptEntry = {
    id: input.id,
    role: input.role,
    createdAt: new Date(input.startedAt).toISOString(),
    relativeMs: input.startedAt - input.sessionStartedAt,
    status: 'transcribing',
    text: '',
  }
  return [...transcript, entry].sort(byTime)
}

export function resolveEntry(transcript: readonly TranscriptEntry[], id: string, text: string): TranscriptEntry[] {
  return transcript.map((entry) => (entry.id === id ? { ...entry, status: 'done', text } : entry))
}

export function removeEntry(transcript: readonly TranscriptEntry[], id: string): TranscriptEntry[] {
  return transcript.filter((entry) => entry.id !== id)
}

/** The single entry point the main process uses to apply renderer-sent transcript operations. */
export function applyTranscriptOp(transcript: readonly TranscriptEntry[], op: TranscriptOp): TranscriptEntry[] {
  switch (op.op) {
    case 'add':
      return addPlaceholder(transcript, op).slice(-MAX_TRANSCRIPT_ENTRIES)
    case 'resolve':
      return resolveEntry(transcript, op.id, op.text)
    case 'remove':
      return removeEntry(transcript, op.id)
    case 'clear':
      return []
  }
}
