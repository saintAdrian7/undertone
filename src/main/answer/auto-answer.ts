import type { TranscriptEntry } from '@shared/state'
import { prefilterCandidate, routeVerdict, type Judge, type JudgeContext, type Route } from './judge'

/** How long the interviewer must stay quiet after a question before the answer is generated. */
export const AUTO_ANSWER_DELAY_MS = 1200
/** Interviewer lines older than this no longer belong to the current candidate question. */
const CANDIDATE_MAX_AGE_MS = 90_000

const MIN_WORDS = 3
const OPENERS =
  /^(what|why|how|when|where|which|who|whom|whose|can|could|would|will|do|does|did|are|is|were|was|have|has|had|should|shall|may|might|tell me|tell us|walk me|walk us|talk me|talk us|describe|explain|give me|give us|share|say|name|so,? (what|why|how|when|where|which|who|can|could|would|do|does|did|are|is|have|has|should|tell|walk|describe|explain))\b/
const ASKS = /\b(tell me|tell us|walk me through|walk us through|describe|explain|elaborate|your (thoughts|experience|approach|background)|what about)\b/

/**
 * A cheap guess at whether an interviewer's line asks the user something. Transcripts rarely carry
 * question marks, so sentence openers and asking verbs count as well. The judge, when configured,
 * decides; this is the prefilter and the fallback.
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
  /** When present, decides whether a candidate deserves an answer; null verdicts fall back to the heuristic. */
  judge?: Judge
  getContext?(): Omit<JudgeContext, 'lastAnswered'>
  delayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  now?: () => number
}

export interface AutoAnswerScheduler {
  onInterviewerLine(text: string): void
  onInterviewerActivity(active: boolean): void
  onUserActivity(active: boolean): void
  cancel(): void
}

const normalise = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

/**
 * Fires `trigger` once after the interviewer asks something and then stays quiet for the delay,
 * or sooner if the user starts talking first. Consecutive interviewer lines accumulate into one
 * candidate. With a judge, the judge is asked as soon as the interviewer is quiet and its verdict
 * is applied at commit; without one, or when it fails, the heuristic decides.
 */
export function createAutoAnswerScheduler(deps: AutoAnswerDeps): AutoAnswerScheduler {
  const delayMs = deps.delayMs ?? AUTO_ANSWER_DELAY_MS
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const now = deps.now ?? (() => Date.now())

  let candidate = ''
  let candidateAt = 0
  let pending = false
  let interviewerSpeaking = false
  let timer: unknown = null
  let lastJudged: string | null = null
  let lastAnswered: string | null = null
  let judging: { candidate: string; promise: Promise<Route | null> } | null = null

  const disarm = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  const fire = (text: string) => {
    pending = false
    if (lastAnswered !== null && normalise(text) === normalise(lastAnswered)) return
    lastAnswered = text
    candidate = ''
    deps.trigger()
  }

  const startJudge = () => {
    if (!deps.judge || !candidate || judging?.candidate === candidate) return
    if (prefilterCandidate(candidate, { lastJudged, lastAnswered }) !== 'judge') return
    const text = candidate
    lastJudged = text
    const context = { ...(deps.getContext?.() ?? { turns: [], userName: null }), lastAnswered }
    judging = {
      candidate: text,
      promise: deps
        .judge({ candidate: text, context })
        .then((verdict) => (verdict ? routeVerdict(verdict) : null))
        .catch(() => null),
    }
  }

  /** Applies the judge's route, or the heuristic when there is none, to the candidate as it stands. */
  const decide = (text: string, route: Route | null) => {
    if (candidate !== text || !pending) return
    if (route === 'answer') fire(text)
    else if (route === 'ignore') pending = false
    else if (route === 'wait') return
    else if (looksLikeQuestion(text)) fire(text)
    else pending = false
  }

  const commit = async () => {
    timer = null
    const text = candidate
    if (!pending || !text) return
    if (!deps.judge) {
      decide(text, null)
      return
    }
    const route = judging?.candidate === text ? await judging.promise : null
    decide(text, route)
  }

  const arm = () => {
    disarm()
    timer = setTimer(() => void commit(), delayMs)
  }

  return {
    onInterviewerLine(text) {
      const line = text.trim()
      if (!line) return
      const at = now()
      if (candidate && at - candidateAt > CANDIDATE_MAX_AGE_MS) candidate = ''
      candidate = candidate ? `${candidate} ${line}` : line
      candidateAt = at
      if (deps.judge) {
        if (prefilterCandidate(candidate, { lastJudged, lastAnswered }) === 'skip') return
        pending = true
        if (!interviewerSpeaking) {
          startJudge()
          arm()
        }
        return
      }
      if (!looksLikeQuestion(line)) return
      pending = true
      if (!interviewerSpeaking) arm()
    },
    onInterviewerActivity(active) {
      interviewerSpeaking = active
      if (active) disarm()
      else if (pending) {
        startJudge()
        arm()
      }
    },
    onUserActivity(active) {
      // The user started answering before the quiet period ended: they need the words now.
      // The mic can pick the far side up through the speakers, so only a solo start counts.
      if (!active || !pending || interviewerSpeaking) return
      disarm()
      const text = candidate
      if (looksLikeQuestion(text)) fire(text)
      else if (deps.judge && judging?.candidate === text) {
        void judging.promise.then((route) => decide(text, route))
      }
    },
    cancel() {
      pending = false
      candidate = ''
      judging = null
      disarm()
    },
  }
}
