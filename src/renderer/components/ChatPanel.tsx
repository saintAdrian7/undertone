import { useState, type KeyboardEvent } from 'react'
import type { TranscriptEntry } from '@shared/state'
import { formatRelative } from '@shared/time'
import type { ModelStatus } from '../stt/whisper-provider'

export type AnswerStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface ChatPanelProps {
  transcript: TranscriptEntry[]
  answer: string
  status: AnswerStatus
  error: string | null
  screenshotAttached?: boolean
  modelStatus?: ModelStatus
  profileName?: string | null
  profileError?: string | null
  onAsk(question: string): void
  onClear(): void
  onPickProfile?(): void
  onClearProfile?(): void
}

const speaker = (entry: TranscriptEntry): string => (entry.role === 'them' ? 'Interviewer' : 'Me')

export function ChatPanel({
  transcript,
  answer,
  status,
  error,
  screenshotAttached = false,
  modelStatus = 'idle',
  profileName = null,
  profileError = null,
  onAsk,
  onClear,
  onPickProfile,
  onClearProfile,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('')

  const submit = () => {
    const question = draft.trim()
    if (!question) return
    onAsk(question)
    setDraft('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    submit()
  }

  return (
    <div className="chat-panel">
      {onPickProfile && (
        <div className="profile-row">
          {profileName ? (
            <>
              <span className="profile-name" title="Answers draw on this resume">
                Resume: {profileName}
              </span>
              <button type="button" className="link" onClick={onPickProfile} aria-label="Replace resume">
                Replace
              </button>
              {onClearProfile && (
                <button type="button" className="link" onClick={onClearProfile} aria-label="Remove resume">
                  Remove
                </button>
              )}
            </>
          ) : (
            <button type="button" className="link" onClick={onPickProfile} aria-label="Upload resume">
              Upload resume (.txt, .md or .pdf) so answers sound like you
            </button>
          )}
          {profileError && <span role="alert">{profileError}</span>}
        </div>
      )}
      {modelStatus === 'loading' && <p className="model-status">Loading speech model…</p>}
      <ol className="transcript" aria-label="Transcript">
        {transcript.map((entry) => (
          <li key={entry.id} className={entry.role}>
            <span className="time">{formatRelative(entry.relativeMs)}</span>
            <span className="speaker">{speaker(entry)}</span>
            <span className="text">{entry.status === 'transcribing' ? <em>transcribing…</em> : entry.text}</span>
          </li>
        ))}
      </ol>
      <section className="answer" aria-live="polite">
        {status !== 'idle' && screenshotAttached && <span className="badge">Screenshot attached</span>}
        {status === 'streaming' && !answer && <p className="thinking">Thinking…</p>}
        {answer && <p className="answer-text">{answer}</p>}
        {status === 'error' && error && <p role="alert">{error}</p>}
      </section>
      <div className="composer">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask anything. Enter to send."
          aria-label="Question"
        />
        <button type="button" onClick={onClear} aria-label="Clear">
          Clear
        </button>
      </div>
    </div>
  )
}
