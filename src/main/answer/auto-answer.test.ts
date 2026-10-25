import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutoAnswerScheduler, looksLikeQuestion, AUTO_ANSWER_DELAY_MS } from './auto-answer'

describe('looksLikeQuestion', () => {
  it('accepts direct questions and interview prompts', () => {
    for (const text of [
      'Why do you want this role?',
      'tell me about yourself',
      'Walk me through your last project.',
      'Can you describe a time you disagreed with a manager',
      'What would you say is your biggest weakness',
      'How did you handle that',
    ]) {
      expect(looksLikeQuestion(text), text).toBe(true)
    }
  })
  it('rejects acknowledgements, small talk and fragments', () => {
    for (const text of ['Okay.', 'Thanks, that makes sense.', 'Great', 'um', 'Let me share my screen.', '']) {
      expect(looksLikeQuestion(text), text).toBe(false)
    }
  })
})

describe('createAutoAnswerScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires once the interviewer has been quiet for the delay after a question', () => {
    const trigger = vi.fn()
    const scheduler = createAutoAnswerScheduler({ trigger })
    scheduler.onInterviewerLine('Why this role?')
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS - 1)
    expect(trigger).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('does not fire for non-questions', () => {
    const trigger = vi.fn()
    const scheduler = createAutoAnswerScheduler({ trigger })
    scheduler.onInterviewerLine('Okay, thanks.')
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS * 2)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('waits while the interviewer keeps talking and restarts the delay afterwards', () => {
    const trigger = vi.fn()
    const scheduler = createAutoAnswerScheduler({ trigger })
    scheduler.onInterviewerLine('Why this role?')
    scheduler.onInterviewerActivity(true)
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS * 3)
    expect(trigger).not.toHaveBeenCalled()
    scheduler.onInterviewerActivity(false)
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS)
    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('cancels when the user starts answering themselves or when disabled', () => {
    const trigger = vi.fn()
    const scheduler = createAutoAnswerScheduler({ trigger })
    scheduler.onInterviewerLine('Why this role?')
    scheduler.onUserActivity(true)
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS * 2)
    expect(trigger).not.toHaveBeenCalled()
    scheduler.onInterviewerLine('And why now?')
    scheduler.cancel()
    vi.advanceTimersByTime(AUTO_ANSWER_DELAY_MS * 2)
    expect(trigger).not.toHaveBeenCalled()
  })
})
