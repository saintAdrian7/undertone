/**
 * Whisper invents text on silence and noise: thanks to an imaginary audience, a lone "you",
 * bracketed sound tags, or one phrase looping. These never belong in a transcript.
 */

/** Whole-segment ghosts, compared after normalisation (lower case, no punctuation). */
const GHOSTS = new Set([
  'thank you',
  'thanks',
  'thank you for watching',
  'thanks for watching',
  'thank you so much for watching',
  'thanks for listening',
  'you',
  'bye',
  'the end',
  'subscribe',
  'please subscribe',
  'like and subscribe',
])

const LONE_TAG = /^\s*[[(][^\])]*[\])]\s*$/
const HAS_WORD = /[\p{L}\p{N}]/u
const MIN_LOOP_CLAUSES = 3

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** The segment's text with surrounding whitespace removed, or null when it should be dropped. */
export function cleanTranscript(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length < 2) return null
  if (!HAS_WORD.test(trimmed)) return null
  if (LONE_TAG.test(trimmed)) return null
  const normalised = normalise(trimmed)
  if (!normalised) return null
  if (GHOSTS.has(normalised) || normalised.startsWith('subtitles by') || normalised.startsWith('subtitled by')) return null
  // The same short clause three or more times with nothing else is a decoder loop, not speech.
  const clauses = trimmed.split(/[.,!?;:]+/).map(normalise).filter(Boolean)
  if (clauses.length >= MIN_LOOP_CLAUSES && clauses.every((clause) => clause === clauses[0])) return null
  return trimmed
}
