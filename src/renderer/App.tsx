import { useEffect, useRef } from 'react'
import { IPC } from '@shared/ipc'
import type { AppState, RendererPatch } from '@shared/state'
import { useAppState } from './state/useAppState'
import { useAnswer } from './answer/useAnswer'
import { useAudioPipeline } from './audio/useAudioPipeline'
import { disposeSharedWhisperProvider } from './stt/whisper-provider'
import { ControlBar } from './components/ControlBar'
import { ChatPanel } from './components/ChatPanel'
import './styles.css'

type Patch = (patch: RendererPatch) => Promise<void>

const currentRoute = (): string => window.location.hash.replace(/^#/, '') || '/control'

function ControlScreen({ state, patch }: { state: AppState; patch: Patch }) {
  // The main process owns session start/stop so the transcript and timers reset consistently.
  const toggleListening = () => window.ipc.send(IPC.toggleSession, undefined)
  return (
    <div className="control-root" onDoubleClick={() => window.ipc.send(IPC.controlResetPosition, undefined)}>
      <ControlBar
        state={state}
        onToggleListening={toggleListening}
        onToggleChat={() => window.ipc.send(IPC.toggleChat, undefined)}
        onToggleInvisible={() => void patch({ isInvisible: !state.isInvisible })}
        onToggleScreenUse={() => void patch({ screenUse: state.screenUse === 'required' ? 'off' : 'required' })}
        onQuit={() => window.ipc.send(IPC.quit, undefined)}
      />
    </div>
  )
}

function ChatScreen({ state, patch }: { state: AppState; patch: Patch }) {
  const { answer, status, error, screenshotAttached, ask, clear } = useAnswer()
  const { error: audioError, modelStatus } = useAudioPipeline(state, patch)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Release the speech model's GPU/WASM memory when the window goes away.
    const release = () => void disposeSharedWhisperProvider()
    window.addEventListener('beforeunload', release)
    return () => window.removeEventListener('beforeunload', release)
  }, [])

  useEffect(() => {
    const unsubscribers = [
      window.ipc.on(IPC.chatSubmit, () => void ask('')),
      window.ipc.on(IPC.chatClear, () => clear()),
      window.ipc.on(IPC.chatScroll, ({ deltaY }) => {
        root.current?.querySelector('.transcript')?.scrollBy({ top: deltaY, behavior: 'smooth' })
      }),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [ask, clear])

  return (
    <div className="chat-root" ref={root}>
      {audioError && (
        <p role="alert" className="audio-error">
          {audioError}
        </p>
      )}
      <ChatPanel
        transcript={state.transcript}
        answer={answer}
        status={status}
        error={error}
        screenshotAttached={screenshotAttached}
        modelStatus={modelStatus}
        onAsk={ask}
        onClear={clear}
      />
    </div>
  )
}

export function App() {
  const { state, patch } = useAppState()
  if (!state) return null
  return currentRoute() === '/chat' ? <ChatScreen state={state} patch={patch} /> : <ControlScreen state={state} patch={patch} />
}
