import type { TranscriptEntry } from '@shared/state'

/** How long the interviewer must stay quiet after a question before the answer is generated. */
export const AUTO_ANSWER_DELAY_MS = 1200

const MIN_WORDS = 3
const OPENERS =
  /^(what|why|how|when|where|which|who|whom|whose|can|could|would|will|do|does|did|are|is|were|was|have|has|had|should|shall|may|might|tell me|tell us|walk me|walk us|talk me|talk us|describe|explain|give me|give us|share|say|name|so,? (what|why|how|when|where|which|who|can|could|would|do|does|did|are|is|have|has|should|tell|walk|describe|explain))\b/
const ASKS = /\b(tell me|tell us|walk me through|walk us through|describe|explain|elaborate|your (thoughts|experience|approach|background)|what about)\b/

/**
 * A cheap guess at whether an interviewer's line asks the user something. Transcripts rarely carry
 * question marks, so sentence openers and asking verbs count as well.
 */
export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed) return false
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (trimmed.endsWith('?') && words.length >= 2) return true
  if (words.length < MIN_WORDS) return false
  return OPENERS.test(trimmed) || ASKS.test(trimmed)
}

/** Interviewer lines that finished transcribing between two states. */
export function newlyFinishedInterviewerLines(before: readonly TranscriptEntry[], after: readonly TranscriptEntry[]): TranscriptEntry[] {
  const finished = new Set(before.filter((entry) => entry.status === 'done').map((entry) => entry.id))
  return after.filter((entry) => entry.role === 'them' && entry.status === 'done' && entry.text.trim() && !finished.has(entry.id))
}

export interface AutoAnswerDeps {
  trigger(): void
  delayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface AutoAnswerScheduler {
  onInterviewerLine(text: string): void
  onInterviewerActivity(active: boolean): void
  onUserActivity(active: boolean): void
  cancel(): void
}

/**
 * Fires `trigger` once after the interviewer asks something and then stays quiet for the delay,
 * or sooner if the user starts talking first. Follow-up lines keep the question pending.
 */
export function createAutoAnswerScheduler(deps: AutoAnswerDeps): AutoAnswerScheduler {
  const delayMs = deps.delayMs ?? AUTO_ANSWER_DELAY_MS
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let pending = false
  let interviewerSpeaking = false
  let timer: unknown = null

  const disarm = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }
  const arm = () => {
    disarm()
    timer = setTimer(() => {
      timer = null
      pending = false
      deps.trigger()
    }, delayMs)
  }

  return {
    onInterviewerLine(text) {
      if (!looksLikeQuestion(text)) return
      pending = true
      if (!interviewerSpeaking) arm()
    },
    onInterviewerActivity(active) {
      interviewerSpeaking = active
      if (active) disarm()
      else if (pending) arm()
    },
    onUserActivity(active) {
      // The user started answering before the quiet period ended: they need the words now, not in a second.
      // The mic can pick the far side up through the speakers, so only a solo start counts.
      if (active && pending && !interviewerSpeaking) {
        pending = false
        disarm()
        deps.trigger()
      }
    },
    cancel() {
      pending = false
      disarm()
    },
  }
}
