import { useRef, type MouseEvent } from 'react'
import { ChevronDown, Mic, Sparkles, Square, Zap } from 'lucide-react'
import type { AppState } from '@shared/state'
import { APP_NAME } from '@shared/brand'
import { Logo } from './Logo'

export interface ControlBarProps {
  state: AppState
  onToggleListening(): void
  onToggleChat(): void
  onToggleAutoAnswer(): void
  /** A plain click on the pill body (not a drag). */
  onOpenSettings(): void
  /** The pill is dragged by hand so a click can still be told from a drag. */
  onDrag?(position: { x: number; y: number }): void
  onDragEnd?(): void
  onResetPosition?(): void
}

/** Movement beyond this many pixels between mouse-down and click counts as a drag, not a click. */
const CLICK_SLOP_PX = 2

export function ControlBar({
  state,
  onToggleListening,
  onToggleChat,
  onToggleAutoAnswer,
  onOpenSettings,
  onDrag,
  onDragEnd,
  onResetPosition,
}: ControlBarProps) {
  const press = useRef<{ x: number; y: number; windowX: number; windowY: number } | null>(null)
  const dragging = useRef(false)

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return
    press.current = { x: event.screenX, y: event.screenY, windowX: window.screenX, windowY: window.screenY }
    dragging.current = false
    const move = (e: globalThis.MouseEvent) => {
      const start = press.current
      if (!start) return
      if (Math.hypot(e.screenX - start.x, e.screenY - start.y) > CLICK_SLOP_PX) dragging.current = true
      if (dragging.current) onDrag?.({ x: Math.round(start.windowX + e.screenX - start.x), y: Math.round(start.windowY + e.screenY - start.y) })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('blur', up)
      if (dragging.current) onDragEnd?.()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('blur', up)
  }

  const onClick = (event: MouseEvent) => {
    const start = press.current
    press.current = null
    const moved = start ? Math.hypot(event.screenX - start.x, event.screenY - start.y) : 0
    if (dragging.current || moved > CLICK_SLOP_PX || event.detail > 1) return
    onOpenSettings()
  }

  const { showChat, isListening, isAnswering, autoAnswer } = state

  return (
    <div className="pill" role="toolbar" aria-label={APP_NAME}>
      <div className="pill-main">
        <button
          type="button"
          className="pill-body"
          aria-label="Open settings"
          tabIndex={-1}
          onMouseDown={onMouseDown}
          onClick={onClick}
          onDoubleClick={onResetPosition}
        />
        <span className="pill-bg" aria-hidden="true" />
        <Logo className="pill-logo" />
        <div className="pill-actions">
          <button
            type="button"
            className={`btn ask ${showChat ? 'grey' : 'accent'}`}
            aria-label={showChat ? 'Hide' : 'Ask'}
            tabIndex={-1}
            onClick={onToggleChat}
          >
            <span className="layer accent" style={{ opacity: showChat ? 0 : 1 }} aria-hidden="true" />
            <span className="layer grey" style={{ opacity: showChat ? 1 : 0 }} aria-hidden="true" />
            <span className="content">
              {showChat ? <ChevronDown aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
              <span className={isAnswering && !showChat ? 'shimmer' : undefined}>{showChat ? 'Hide' : 'Ask'}</span>
            </span>
          </button>
          <button
            type="button"
            className={`btn round ${autoAnswer ? 'accent' : 'grey'}`}
            aria-label="Automatic answers"
            aria-pressed={autoAnswer}
            title={autoAnswer ? 'Answers appear on their own after each interviewer question' : 'Answers only when you ask'}
            tabIndex={-1}
            onClick={onToggleAutoAnswer}
          >
            <Zap aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn round grey"
            aria-label={isListening ? 'Stop listening' : 'Start listening'}
            tabIndex={-1}
            onClick={onToggleListening}
          >
            {isListening ? <Square aria-hidden="true" fill="currentColor" /> : <Mic aria-hidden="true" style={{ width: 18, height: 18 }} />}
          </button>
        </div>
      </div>
    </div>
  )
}
