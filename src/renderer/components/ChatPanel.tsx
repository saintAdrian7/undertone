import { useState, type KeyboardEvent } from 'react'
import { ArrowUp, ChevronDown, CircleAlert, Ellipsis, MessageCircleMore, RotateCw, X } from 'lucide-react'
import type { TranscriptEntry } from '@shared/state'
import { formatRelative } from '@shared/time'
import type { ModelProgress, ModelStatus } from '../stt/whisper-provider'

const MB = 1_000_000

/** "Downloading speech model… 38% (75 of 200 MB)" while bytes are still arriving; the plain line otherwise (cached, or being compiled). */
export function modelLoadingLine(progress: ModelProgress | null): string {
  if (!progress || progress.loaded >= progress.total) return 'Loading speech model…'
  return `Downloading speech model… ${progress.percent}% (${Math.round(progress.loaded / MB)} of ${Math.round(progress.total / MB)} MB)`
}
import { Menu, type MenuItem } from './Menu'

export type AnswerStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface ChatPanelProps {
  transcript: TranscriptEntry[]
  answer: string
  status: AnswerStatus
  error: string | null
  isListening: boolean
  screenshotAttached?: boolean
  modelStatus?: ModelStatus
  /** Download progress while the speech model loads. */
  modelProgress?: ModelProgress | null
  /** Advisory line from the audio pipeline, such as transcription falling behind. */
  notice?: string | null
  lastQuestion?: string
  profileName?: string | null
  profileError?: string | null
  autoAnswer?: boolean
  isInvisible?: boolean
  screenUse?: 'off' | 'required'
  onAsk(question: string): void
  onClear(): void
  onRetry?(): void
  onHide?(): void
  onToggleListening?(): void
  onToggleAutoAnswer?(): void
  onToggleInvisible?(): void
  onToggleScreenUse?(): void
  onPickProfile?(): void
  onClearProfile?(): void
  onDismissProfileError?(): void
  onQuit?(): void
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

export function ChatPanel(props: ChatPanelProps) {
  const { transcript, answer, status, error, isListening, screenshotAttached = false, modelStatus = 'idle', profileName = null, profileError = null } = props
  const [draft, setDraft] = useState('')

  const submit = (text: string) => {
    props.onAsk(text.trim())
    setDraft('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (draft.trim()) submit(draft)
  }

  const hasContent = transcript.length > 0 || answer.length > 0 || status !== 'idle'
  const expanded = hasContent || isListening || props.onToggleListening !== undefined
  const stripMessage = status === 'error' && error ? error : profileError
  const dismissStrip = status === 'error' && error ? props.onClear : (props.onDismissProfileError ?? props.onClear)

  const menu: MenuItem[] = [
    ...(props.onToggleAutoAnswer ? [{ kind: 'check', label: 'Automatic answers', checked: props.autoAnswer ?? false, onSelect: props.onToggleAutoAnswer } as const] : []),
    ...(props.onToggleScreenUse
      ? [{ kind: 'check', label: 'Send a screenshot with each question', checked: props.screenUse === 'required', onSelect: props.onToggleScreenUse } as const]
      : []),
    ...(props.onToggleInvisible ? [{ kind: 'check', label: 'Hidden from screen share', checked: props.isInvisible ?? false, onSelect: props.onToggleInvisible } as const] : []),
    ...(props.onPickProfile
      ? profileName
        ? [
            { kind: 'separator' } as const,
            { kind: 'label', label: `Resume: ${profileName}` } as const,
            { kind: 'action', label: 'Replace resume', onSelect: props.onPickProfile } as const,
            ...(props.onClearProfile ? [{ kind: 'action', label: 'Remove resume', onSelect: props.onClearProfile } as const] : []),
          ]
        : [{ kind: 'separator' } as const, { kind: 'action', label: 'Upload resume (.txt, .md or .pdf)', onSelect: props.onPickProfile } as const]
      : []),
    { kind: 'separator' },
    { kind: 'action', label: 'Clear answer', onSelect: props.onClear },
    ...(props.onQuit ? [{ kind: 'action', label: 'Quit', onSelect: props.onQuit } as const] : []),
  ]

  return (
    <div className={`panel ${expanded ? 'expanded' : ''}`}>
      <div className="panel-inner">
        {props.onHide && (
          <div className="hide-zone">
            <button type="button" className="btn grey" aria-label="Hide panel" tabIndex={-1} onClick={props.onHide}>
              <ChevronDown aria-hidden="true" />
            </button>
          </div>
        )}
        {modelStatus === 'loading' && <p className="model-status">{modelLoadingLine(props.modelProgress ?? null)}</p>}
        {props.notice && <p className="model-status">{props.notice}</p>}
        {hasContent ? (
          <div className="messages" aria-label="Conversation">
            {transcript.map((entry) =>
              entry.role === 'them' ? (
                <div key={entry.id} className="line them">
                  <span className="time">
                    Interviewer · <span>{formatRelative(entry.relativeMs)}</span>
                  </span>
                  {entry.status === 'transcribing' ? <em>transcribing…</em> : entry.text}
                </div>
              ) : (
                <div key={entry.id} className="me">
                  <span className="time">{formatRelative(entry.relativeMs)}</span>
                  {entry.status === 'transcribing' ? <em>transcribing…</em> : entry.text}
                </div>
              ),
            )}
            {status !== 'idle' && (
              <div className="answer" aria-live="polite">
                {screenshotAttached && <span className="caption">Screenshot attached</span>}
                {status === 'streaming' && !answer ? (
                  <p className="thinking">
                    <span className="dot" aria-hidden="true" />
                    <span className="sr-only">Thinking…</span>
                  </p>
                ) : (
                  answer
                )}
              </div>
            )}
          </div>
        ) : (
          expanded && (
            <div className="empty">
              <MessageCircleMore className="glyph" aria-hidden="true" />
              {isListening ? (
                <span>Listening… answers appear here as the interviewer asks.</span>
              ) : (
                <>
                  {props.onToggleListening && (
                    <button type="button" className="btn accent" tabIndex={-1} onClick={props.onToggleListening}>
                      Start listening
                    </button>
                  )}
                  <span>Answers appear here as the interviewer asks.</span>
                </>
              )}
            </div>
          )
        )}
        <div className="composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Ask about your screen or conversation, or ${isMac ? '⌘' : 'Ctrl'}+Enter for the next thing to say`}
            aria-label="Question"
            rows={3}
          />
          <Menu
            items={menu}
            trigger={(triggerProps) => (
              <button type="button" className="more" aria-label="More" tabIndex={-1} {...triggerProps}>
                <Ellipsis aria-hidden="true" style={{ width: 16, height: 16 }} />
              </button>
            )}
          />
          <button type="button" className="btn accent send" aria-label="Send message" tabIndex={-1} onClick={() => submit(draft)}>
            <ArrowUp aria-hidden="true" />
          </button>
        </div>
        {stripMessage && (
          <div className="error-strip" role="alert">
            <CircleAlert aria-hidden="true" style={{ width: 16, height: 16, flexShrink: 0 }} />
            <span className="message">{stripMessage}</span>
            {status === 'error' && props.onRetry && (
              <button type="button" className="chip" tabIndex={-1} onClick={props.onRetry}>
                <RotateCw aria-hidden="true" /> Retry
              </button>
            )}
            <button type="button" className="chip" tabIndex={-1} onClick={dismissStrip}>
              <X aria-hidden="true" /> Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
