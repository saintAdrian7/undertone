import type { AppState } from '@shared/state'

export interface ControlBarProps {
  state: AppState
  onToggleListening(): void
  onToggleChat(): void
  onToggleInvisible(): void
  onToggleScreenUse(): void
  onToggleAutoAnswer(): void
  onQuit?(): void
}

function speakerLabel(state: AppState): string {
  if (state.themHasVoiceActivity) return 'Interviewer'
  if (state.meHasVoiceActivity) return 'Me'
  return 'Listening'
}

export function ControlBar({
  state,
  onToggleListening,
  onToggleChat,
  onToggleInvisible,
  onToggleScreenUse,
  onToggleAutoAnswer,
  onQuit,
}: ControlBarProps) {
  const screenOn = state.screenUse === 'required'
  return (
    <div className="control-bar" role="toolbar" aria-label="Meeting Copilot">
      <button
        type="button"
        className={state.isListening ? 'listening' : ''}
        onClick={onToggleListening}
        aria-label={state.isListening ? 'Stop listening' : 'Start listening'}
      >
        {state.isListening ? 'Stop' : 'Start'}
      </button>
      <button type="button" onClick={onToggleChat} aria-label="Ask" aria-pressed={state.showChat}>
        Ask
      </button>
      <button
        type="button"
        onClick={onToggleInvisible}
        aria-label="Invisibility"
        aria-pressed={state.isInvisible}
        title={state.isInvisible ? 'Hidden from screen share' : 'Visible to screen share'}
      >
        {state.isInvisible ? 'Hidden' : 'Shown'}
      </button>
      <button
        type="button"
        onClick={onToggleScreenUse}
        aria-label="Screen capture"
        aria-pressed={screenOn}
        title={screenOn ? 'A screenshot is sent with each question' : 'Questions are sent without a screenshot'}
      >
        {screenOn ? 'Screen on' : 'Screen off'}
      </button>
      <button
        type="button"
        onClick={onToggleAutoAnswer}
        aria-label="Automatic answers"
        aria-pressed={state.autoAnswer}
        title={state.autoAnswer ? 'Answers appear on their own after each interviewer question' : 'Answers only when you ask'}
      >
        {state.autoAnswer ? 'Auto on' : 'Auto off'}
      </button>
      {state.isListening && <span className="speaker">{speakerLabel(state)}</span>}
      {onQuit && (
        <button type="button" className="quit" onClick={onQuit} aria-label="Quit" title="Quit Meeting Copilot">
          ×
        </button>
      )}
    </div>
  )
}
