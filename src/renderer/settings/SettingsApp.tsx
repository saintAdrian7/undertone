import { useEffect, useState, type KeyboardEvent } from 'react'
import { IPC, type AppInfo, type ProfileInfo, type PublicLlmSettings } from '@shared/ipc'
import { AccentSchema, type Accent, type AppState, type RendererPatch, type ShortcutKey } from '@shared/state'
import { acceleratorFromKey, formatAccelerator } from '@shared/accelerator'
import { useAppState } from '../state/useAppState'
import { Logo } from '../components/Logo'

type Page = 'general' | 'model' | 'profile' | 'audio' | 'shortcuts' | 'about'
type Patch = (patch: RendererPatch) => Promise<void>

const PAGES: Array<{ id: Page; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'model', label: 'Model' },
  { id: 'profile', label: 'Profile' },
  { id: 'audio', label: 'Audio' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'about', label: 'About' },
]

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(next: boolean): void }) {
  return (
    <div className="row">
      <div>
        <div>{label}</div>
        {hint && <small>{hint}</small>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : 'off'}`} onClick={() => onChange(!checked)}>
        <span className="knob" />
      </button>
    </div>
  )
}

function GeneralPage({ state, patch }: { state: AppState; patch: Patch }) {
  return (
    <>
      <h2>General</h2>
      <label className="field">
        <span>Appearance</span>
        <select aria-label="Appearance" value={state.theme} onChange={(event) => void patch({ theme: event.target.value as AppState['theme'] })}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <Toggle
        label="Automatic answers"
        hint="Answer on its own when the interviewer asks something and goes quiet."
        checked={state.autoAnswer}
        onChange={(autoAnswer) => void patch({ autoAnswer })}
      />
      <Toggle
        label="Send a screenshot with each question"
        hint="The overlay is hidden from the capture, so the model never sees this panel."
        checked={state.screenUse === 'required'}
        onChange={(on) => void patch({ screenUse: on ? 'required' : 'off' })}
      />
      <Toggle
        label="Hidden from screen share"
        hint="Uses the operating system's content-protection flag."
        checked={state.isInvisible}
        onChange={(isInvisible) => void patch({ isInvisible })}
      />
      <Toggle
        label="Keep keyboard focus in my current app"
        hint="While hidden, the overlay never takes focus."
        checked={state.noFocusWhenInvisible}
        onChange={(noFocusWhenInvisible) => void patch({ noFocusWhenInvisible })}
      />
      <Toggle label="Open when I log in" checked={state.openAtLogin} onChange={(openAtLogin) => void patch({ openAtLogin })} />
      <div className="row">
        <div>Accent colour</div>
        <div className="accents" role="radiogroup" aria-label="Accent colour">
          {AccentSchema.options.map((accent: Accent) => (
            <label key={accent} className={`accent-choice ${accent}`}>
              <input type="radio" name="accent" value={accent} checked={state.accent === accent} onChange={() => void patch({ accent })} />
              {accent[0]!.toUpperCase() + accent.slice(1)}
            </label>
          ))}
        </div>
      </div>
    </>
  )
}

type ProviderChoice = 'claude-code' | 'anthropic' | 'openai' | 'ollama'
const OLLAMA_BASE_URL = 'http://localhost:11434/v1'

function ModelPage() {
  const [current, setCurrent] = useState<PublicLlmSettings | null | undefined>(undefined)
  const [provider, setProvider] = useState<ProviderChoice>('claude-code')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    window.ipc.invoke(IPC.llmGet, undefined).then((settings) => {
      setCurrent(settings)
      if (!settings) return
      setProvider(settings.provider === 'openai' && settings.baseUrl === OLLAMA_BASE_URL ? 'ollama' : settings.provider)
      setModel(settings.model)
      setBaseUrl(settings.baseUrl ?? '')
    })
  }, [])

  const save = async () => {
    const effectiveProvider = provider === 'ollama' ? 'openai' : provider
    const effectiveBase = provider === 'ollama' ? baseUrl.trim() || OLLAMA_BASE_URL : provider === 'openai' ? baseUrl.trim() || null : null
    try {
      const error = await window.ipc.invoke(IPC.llmSet, {
        provider: effectiveProvider,
        model: model.trim(),
        baseUrl: effectiveBase,
        ...(apiKey ? { apiKey } : {}),
      })
      setMessage(error ?? 'Saved. The next answer uses this model.')
      if (!error) {
        setApiKey('')
        setCurrent(await window.ipc.invoke(IPC.llmGet, undefined))
      }
    } catch (error) {
      setMessage(describe(error))
    }
  }

  const needsKey = provider === 'anthropic' || provider === 'openai'
  return (
    <>
      <h2>Model</h2>
      {current === null && <p className="hint">No model is configured yet. Pick one below.</p>}
      {current?.source === 'env' && <p className="hint">Currently configured from .env. Saving here overrides it.</p>}
      <label className="field">
        <span>Provider</span>
        <select aria-label="Provider" value={provider} onChange={(event) => setProvider(event.target.value as ProviderChoice)}>
          <option value="claude-code">Claude Code CLI (your Claude login)</option>
          <option value="anthropic">Anthropic API key</option>
          <option value="openai">OpenAI-compatible server</option>
          <option value="ollama">Ollama (local)</option>
        </select>
      </label>
      <label className="field">
        <span>Model</span>
        <input
          type="text"
          aria-label="Model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={provider === 'claude-code' ? 'sonnet, haiku or opus' : 'model name'}
        />
      </label>
      {(provider === 'openai' || provider === 'ollama') && (
        <label className="field">
          <span>Base URL</span>
          <input
            type="text"
            aria-label="Base URL"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={provider === 'ollama' ? OLLAMA_BASE_URL : 'https://api.openai.com/v1'}
          />
        </label>
      )}
      {(needsKey || provider === 'ollama') && (
        <label className="field">
          <span>API key{current?.hasApiKey ? ' (one is stored; leave blank to keep it)' : provider === 'ollama' ? ' (optional)' : ''}</span>
          <input type="password" aria-label="API key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" />
        </label>
      )}
      <div className="actions">
        <button type="button" className="btn accent" onClick={() => void save()}>
          Save
        </button>
        {message && <span className="hint">{message}</span>}
      </div>
    </>
  )
}

function ProfilePage() {
  const [profile, setProfile] = useState<ProfileInfo | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const reload = () => window.ipc.invoke(IPC.profileGet, undefined).then(setProfile)
  useEffect(() => void reload(), [])
  const pick = async () => {
    setError(await window.ipc.invoke(IPC.profilePick, undefined))
    await reload()
  }
  const remove = async () => {
    await window.ipc.invoke(IPC.profileClear, undefined)
    await reload()
  }
  return (
    <>
      <h2>Profile</h2>
      <p className="hint">Your resume or notes are sent with every question so answers draw on your real experience. Kept only on this machine.</p>
      {profile ? (
        <>
          <div className="row">
            <div>
              <div>{profile.name}</div>
              <small>{profile.text.length.toLocaleString()} characters</small>
            </div>
            <div className="actions">
              <button type="button" className="btn grey" onClick={() => void pick()}>
                Replace
              </button>
              <button type="button" className="btn grey" onClick={() => void remove()}>
                Remove
              </button>
            </div>
          </div>
          <pre className="preview">{profile.text}</pre>
        </>
      ) : (
        <div className="actions">
          <button type="button" className="btn accent" onClick={() => void pick()}>
            Upload resume (.txt, .md or .pdf)
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </>
  )
}

function AudioPage({ state, patch }: { state: AppState; patch: Patch }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((list) => setDevices(list.filter((device) => device.kind === 'audioinput')))
      .catch(() => setDevices([]))
  }, [])
  return (
    <>
      <h2>Audio</h2>
      <label className="field">
        <span>Microphone</span>
        <select aria-label="Microphone" value={state.micDeviceId ?? ''} onChange={(event) => void patch({ micDeviceId: event.target.value || null })}>
          <option value="">System default</option>
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Microphone ${device.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">Takes effect the next time you press Start. The other side of the call is captured from system audio automatically.</p>
      <div className="row">
        <div>
          <div>Speech model</div>
          <small>{import.meta.env.VITE_WHISPER_MODEL || 'onnx-community/whisper-base'} (runs on this machine)</small>
        </div>
      </div>
    </>
  )
}

const SHORTCUT_LABELS: Record<ShortcutKey, string> = {
  toggleVisibility: 'Hide or show the overlay',
  ask: 'Ask for an answer',
  clear: 'Clear the answer',
  toggleSession: 'Start or stop listening',
  moveUp: 'Move the overlay up',
  moveDown: 'Move the overlay down',
  moveLeft: 'Move the overlay left',
  moveRight: 'Move the overlay right',
  scrollUp: 'Scroll the answer up',
  scrollDown: 'Scroll the answer down',
}

function ShortcutsPage({ state }: { state: AppState }) {
  const [recording, setRecording] = useState<ShortcutKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const update = async (key: ShortcutKey, accelerator: string | null) => {
    setError(null)
    try {
      await window.ipc.invoke(IPC.shortcutsSet, { key, accelerator })
    } catch (cause) {
      setError(describe(cause))
    }
  }
  const onKeyDown = (key: ShortcutKey) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (recording !== key) return
    event.preventDefault()
    if (event.key === 'Escape') {
      setRecording(null)
      return
    }
    const accelerator = acceleratorFromKey(event)
    if (!accelerator) return
    setRecording(null)
    void update(key, accelerator)
  }
  return (
    <>
      <h2>Shortcuts</h2>
      <p className="hint">Click a shortcut and press the new keys. Double-click to reset it. Shortcuts another app already owns stay with that app.</p>
      <ul className="shortcuts">
        {(Object.keys(SHORTCUT_LABELS) as ShortcutKey[]).map((key) => (
          <li key={key}>
            <span>{SHORTCUT_LABELS[key]}</span>
            <button
              type="button"
              className={`keycap ${recording === key ? 'recording' : ''}`}
              onClick={() => setRecording(key)}
              onDoubleClick={() => {
                setRecording(null)
                void update(key, null)
              }}
              onKeyDown={onKeyDown(key)}
              onBlur={() => setRecording((current) => (current === key ? null : current))}
            >
              {recording === key ? 'Press keys…' : formatAccelerator(state.shortcuts[key], window.platform)}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </>
  )
}

function AboutPage() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    window.ipc.invoke(IPC.appInfo, undefined).then(setInfo)
  }, [])
  return (
    <>
      <h2>About</h2>
      <div className="about">
        <Logo className="about-logo" />
        <div>
          <div className="about-name">{info?.name ?? ''}</div>
          <small>Version {info?.version ?? ''}</small>
        </div>
      </div>
      <p className="hint">
        Open source under the MIT licence. Audio capture, voice detection and transcription run on this machine; only the questions you send reach
        the model you configured.
      </p>
      {info && (
        <p>
          <a href={info.repository} target="_blank" rel="noreferrer">
            GitHub repository
          </a>
        </p>
      )}
    </>
  )
}

export function SettingsApp() {
  const { state, patch } = useAppState()
  const [page, setPage] = useState<Page>('general')
  if (!state) return null
  return (
    <div className="settings-root">
      <nav className="side" aria-label="Settings sections">
        {PAGES.map((item) => (
          <a
            key={item.id}
            href={`#/settings/${item.id}`}
            className={page === item.id ? 'on' : ''}
            aria-current={page === item.id ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault()
              setPage(item.id)
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <main className="content">
        <div className="card">
          {page === 'general' && <GeneralPage state={state} patch={patch} />}
          {page === 'model' && <ModelPage />}
          {page === 'profile' && <ProfilePage />}
          {page === 'audio' && <AudioPage state={state} patch={patch} />}
          {page === 'shortcuts' && <ShortcutsPage state={state} />}
          {page === 'about' && <AboutPage />}
        </div>
      </main>
    </div>
  )
}
