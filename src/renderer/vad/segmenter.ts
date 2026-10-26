import type { SpeakerRole } from '@shared/state'

/** Hard cap on one utterance so a stuck VAD never produces an unbounded recording. */
export const MAX_SEGMENT_MS = 20_000

export interface SegmenterState {
  speaking: boolean
  startedAt: number | null
}

export type SegmenterEvent =
  | { type: 'speech-start'; at: number }
  | { type: 'speech-end'; at: number; audio: Float32Array }
  | { type: 'misfire' }

export type SegmenterEmit =
  | { type: 'activity'; active: boolean }
  | { type: 'segment'; audio: Float32Array; startedAt: number; endedAt: number }

export interface SegmenterOutput {
  state: SegmenterState
  emit: SegmenterEmit[]
}

const IDLE: SegmenterState = { speaking: false, startedAt: null }

export function initialSegmenter(): SegmenterState {
  return { ...IDLE }
}

/** Pure reducer over VAD events. Returns the next state and the side effects to apply. */
export function reduceSegmenter(state: SegmenterState, event: SegmenterEvent): SegmenterOutput {
  switch (event.type) {
    case 'speech-start':
      return { state: { speaking: true, startedAt: event.at }, emit: [{ type: 'activity', active: true }] }
    case 'misfire':
      return { state: { ...IDLE }, emit: [{ type: 'activity', active: false }] }
    case 'speech-end': {
      const emit: SegmenterEmit[] = [{ type: 'activity', active: false }]
      if (state.startedAt !== null) {
        emit.push({ type: 'segment', audio: event.audio, startedAt: state.startedAt, endedAt: event.at })
      }
      return { state: { ...IDLE }, emit }
    }
  }
}

export function shouldForceEnd(state: SegmenterState, now: number, maxSegmentMs = MAX_SEGMENT_MS): boolean {
  if (!state.speaking || state.startedAt === null) return false
  return now - state.startedAt >= maxSegmentMs
}

/**
 * Echo guard: while the far side is speaking, the microphone is likely picking up the
 * speakers, so its frames are replaced with silence rather than transcribed as "me".
 */
export function gateEcho(role: SpeakerRole, themHasVoiceActivity: boolean, frame: Float32Array): Float32Array {
  if (role === 'me' && themHasVoiceActivity) return new Float32Array(frame.length)
  return frame
}
