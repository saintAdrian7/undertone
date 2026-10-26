import { describe, expect, it } from 'vitest'
import { cleanTranscript } from './hallucination-filter'

describe('cleanTranscript', () => {
  it('keeps ordinary speech, trimmed', () => {
    expect(cleanTranscript('  Tell me about a time you failed.  ')).toBe('Tell me about a time you failed.')
    expect(cleanTranscript('Yes.')).toBe('Yes.')
    expect(cleanTranscript('I think so, thank you.')).toBe('I think so, thank you.')
  })

  it('drops the classic Whisper ghosts on silence', () => {
    for (const ghost of ['Thank you for watching.', 'thanks for watching!', 'You', 'you.', 'Bye.', '...', '.', 'Subtitles by the Amara.org community', 'Thank you.']) {
      expect(cleanTranscript(ghost), ghost).toBeNull()
    }
  })

  it('drops bracketed or parenthesised tags on their own', () => {
    for (const tag of ['[BLANK_AUDIO]', '[Music]', '(applause)', '[ Silence ]', '♪']) {
      expect(cleanTranscript(tag), tag).toBeNull()
    }
    expect(cleanTranscript('[laughs] that was a good one')).toBe('[laughs] that was a good one')
  })

  it('drops text shorter than two characters', () => {
    expect(cleanTranscript('a')).toBeNull()
    expect(cleanTranscript('')).toBeNull()
  })

  it('drops a short phrase looping three or more times, but not real repetition inside a sentence', () => {
    expect(cleanTranscript('Thank you. Thank you. Thank you. Thank you.')).toBeNull()
    expect(cleanTranscript('I see, I see, I see, I see, I see.')).toBeNull()
    expect(cleanTranscript('No, no, no, that is not what I meant at all.')).toBe('No, no, no, that is not what I meant at all.')
  })
})
