import { useCallback, useEffect, useRef, useState } from 'react'
import { IPC } from '@shared/ipc'
import { MAX_CHAT_HEIGHT, MAX_CONTROL_WIDTH, MIN_CONTROL_WIDTH, type AppState, type RendererPatch } from '@shared/state'
import { useAppState } from './state/useAppState'
import { useAnswer } from './answer/useAnswer'
import { useAudioPipeline } from './audio/useAudioPipeline'
import { disposeSharedWhisperProvider } from './stt/whisper-provider'
import { useContentSize } from './layout/useContentSize'
import { ControlBar } from './components/ControlBar'
import { ChatPanel } from './components/ChatPanel'
import { SettingsApp } from './settings/SettingsApp'
import './styles.css'

type Patch = (patch: RendererPatch) => Promise<void>

const CHAT_MIN_HEIGHT = 140
const WINDOW_PADDING_PX = 4

const currentRoute = (): string => window.location.hash.replace(/^#/, '') || '/control'
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

function ControlScreen({ state, patch }: { state: AppState; patch: Patch }) {
  const bar = useRef<HTMLDivElement>(null)
  // The pill's content decides the window width; the main process resizes the window to match.
  useContentSize(bar, ({ width }) => {
    void patch({ controlWidth: clamp(width + WINDOW_PADDING_PX, MIN_CONTROL_WIDTH, MAX_CONTROL_WIDTH) })
  })
  return (
    <div className="control-root">
      <div ref={bar} className="control-measure">
        <ControlBar
          state={state}
          // The main process owns session start/stop so the transcript and timers reset consistently.
          onToggleListening={() => window.ipc.send(IPC.toggleSession, undefined)}
          onToggleChat={() => window.ipc.send(IPC.toggleChat, undefined)}
          onToggleAutoAnswer={() => void patch({ autoAnswer: !state.autoAnswer })}
          onOpenSettings={() => window.ipc.send(IPC.openSettings, undefined)}
          onDrag={(position) => window.ipc.send(IPC.controlDrag, position)}
          onDragEnd={() => window.ipc.send(IPC.controlDragEnd, undefined)}
          onResetPosition={() => window.ipc.send(IPC.controlResetPosition, undefined)}
        />
      </div>
    </div>
  )
}

function ChatScreen({ state, patch }: { state: AppState; patch: Patch }) {
  const { answer, status, error, screenshotAttached, ask, clear } = useAnswer()
  const { error: audioError, modelStatus, modelProgress, notice } = useAudioPipeline(state, patch)
  const root = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [lastQuestion, setLastQuestion] = useState('')
  // The panel's content decides the window height, within the configured cap.
  useContentSize(content, ({ height }) => {
    void patch({ chatWindowIsExpanded: true, chatExpandedHeight: clamp(height + WINDOW_PADDING_PX, CHAT_MIN_HEIGHT, MAX_CHAT_HEIGHT) })
  })

  const askAndRemember = useCallback(
    (question: string) => {
      setLastQuestion(question)
      void ask(question)
    },
    [ask],
  )
  const pickProfile = useCallback(() => {
    window.ipc
      .invoke(IPC.profilePick, undefined)
      .then((message) => setProfileError(message))
      .catch((cause: unknown) => setProfileError(cause instanceof Error ? cause.message : String(cause)))
  }, [])
  const clearProfile = useCallback(() => {
    setProfileError(null)
    void window.ipc.invoke(IPC.profileClear, undefined)
  }, [])

  useEffect(() => {
    // Release the speech model's GPU/WASM memory when the window goes away.
    const release = () => void disposeSharedWhisperProvider()
    window.addEventListener('beforeunload', release)
    return () => window.removeEventListener('beforeunload', release)
  }, [])

  useEffect(() => {
    const unsubscribers = [
      window.ipc.on(IPC.chatSubmit, () => askAndRemember('')),
      window.ipc.on(IPC.chatClear, () => clear()),
      window.ipc.on(IPC.chatScroll, ({ deltaY }) => {
        root.current?.querySelector('.messages')?.scrollBy({ top: deltaY, behavior: 'smooth' })
      }),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [askAndRemember, clear])

  return (
    <div className="chat-root" ref={root}>
      <div ref={content} className="chat-measure">
        <ChatPanel
          transcript={state.transcript}
          answer={answer}
          status={status}
          error={audioError ?? error}
          isListening={state.isListening}
          screenshotAttached={screenshotAttached}
          modelStatus={modelStatus}
          modelProgress={modelProgress}
          notice={notice}
          lastQuestion={lastQuestion}
          profileName={state.profileName}
          profileError={audioError ?? profileError}
          autoAnswer={state.autoAnswer}
          isInvisible={state.isInvisible}
          screenUse={state.screenUse}
          onAsk={askAndRemember}
          onClear={clear}
          onRetry={() => askAndRemember(lastQuestion)}
          onHide={() => window.ipc.send(IPC.toggleChat, undefined)}
          onToggleListening={() => window.ipc.send(IPC.toggleSession, undefined)}
          onToggleAutoAnswer={() => void patch({ autoAnswer: !state.autoAnswer })}
          onToggleInvisible={() => void patch({ isInvisible: !state.isInvisible })}
          onToggleScreenUse={() => void patch({ screenUse: state.screenUse === 'required' ? 'off' : 'required' })}
          onPickProfile={pickProfile}
          onClearProfile={clearProfile}
          onDismissProfileError={() => setProfileError(null)}
          onQuit={() => window.ipc.send(IPC.quit, undefined)}
        />
      </div>
    </div>
  )
}

export function App() {
  const { state, patch } = useAppState()
  const accent = state?.accent
  useEffect(() => {
    if (accent) document.documentElement.dataset.accent = accent
  }, [accent])
  if (!state) return null
  const route = currentRoute()
  if (route.startsWith('/settings')) return <SettingsApp />
  return route === '/chat' ? <ChatScreen state={state} patch={patch} /> : <ControlScreen state={state} patch={patch} />
}
