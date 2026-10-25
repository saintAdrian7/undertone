import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import log from 'electron-log/main'
import Anthropic from '@anthropic-ai/sdk'
import { AskRequestSchema, CancelRequestSchema, ControlDragSchema, IPC, TranscriptOpSchema, type EventMap } from '@shared/ipc'
import { APP_NAME } from '@shared/brand'
import type { AnswerProvider, Screenshot } from '@shared/providers'
import { RendererPatchSchema, type AppState, type ShortcutKey } from '@shared/state'
import { applyTranscriptOp } from '@shared/transcript'
import { createStore } from './state/store'
import { createOverlayManager, type OverlayWindow } from './overlay/manager'
import type { OverlayKind, OverlayWindowOptions } from './overlay/window-options'
import { createShortcutSyncer } from './shortcuts/syncer'
import { createAnswerService } from './answer/service'
import { createAutoAnswerScheduler, newlyFinishedInterviewerLines } from './answer/auto-answer'
import { extractProfileText, loadProfile, saveProfile, PROFILE_EXTENSIONS, type Profile } from './profile/store'
import { renderTrayIconPng } from './tray/icon'
import { trayMenuTemplate } from './tray/menu'
import { selectLoopbackSource } from './capture/sources'
import { captureScreenshot } from './capture/screenshot'
import { ClaudeAnswerProvider, type MessageStreamClient } from './llm/claude-provider'
import { DEFAULT_OPENAI_BASE_URL, parseEnv, resolveConfig, type AppConfig, type LlmConfig } from './config'
import { OpenAICompatibleProvider } from './llm/openai-compatible-provider'
import { ClaudeCodeProvider } from './llm/claude-code-provider'

log.initialize()

const MOVE_STEP_PX = 80
const SCROLL_STEP_PX = 240
const MAX_PROFILE_FILE_BYTES = 20 * 1024 * 1024
const ALLOWED_PERMISSIONS = new Set(['media', 'display-capture'])

const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL
const RENDERER_INDEX = join(__dirname, '../renderer/index.html')

/** Only our own renderer may use IPC, media permissions or loopback capture. */
function isTrustedUrl(url: string | undefined): boolean {
  if (!url) return false
  if (DEV_RENDERER_URL) return url.startsWith(new URL(DEV_RENDERER_URL).origin)
  return url.startsWith(pathToFileURL(RENDERER_INDEX).href)
}

const isTrustedSender = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => isTrustedUrl(event.senderFrame?.url)

/** In development `.env` sits next to the sources; a packaged app reads only from its user-data folder. */
function loadDotEnv(): Record<string, string> {
  const candidates = app.isPackaged
    ? [join(app.getPath('userData'), '.env')]
    : [join(process.cwd(), '.env'), join(app.getAppPath(), '.env')]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return parseEnv(readFileSync(candidate, 'utf8'))
  }
  return {}
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** pdf-parse is loaded on first use; it pulls in pdf.js, which has no business in start-up time. */
async function parsePdf(data: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data })
  try {
    return (await parser.getText()).text
  } finally {
    await parser.destroy()
  }
}

function createProvider(llm: LlmConfig | null): AnswerProvider | null {
  if (!llm) return null
  if (llm.provider === 'anthropic') {
    return new ClaudeAnswerProvider({
      // The SDK's stream params are a superset of the shape this provider builds.
      client: new Anthropic({ apiKey: llm.apiKey ?? undefined }) as unknown as MessageStreamClient,
      model: llm.model,
    })
  }
  if (llm.provider === 'claude-code') {
    return new ClaudeCodeProvider({ command: process.env.CLAUDE_CODE_COMMAND?.trim() || 'claude', model: llm.model })
  }
  return new OpenAICompatibleProvider({ baseUrl: llm.baseUrl ?? DEFAULT_OPENAI_BASE_URL, apiKey: llm.apiKey, model: llm.model })
}

function main(): void {
  let config: AppConfig = { llm: null }
  try {
    config = resolveConfig({ ...loadDotEnv(), ...process.env })
  } catch (error) {
    log.error(describe(error))
  }
  const store = createStore()
  const windowsByKind = new Map<OverlayKind, BrowserWindow>()
  const loaded = new Set<OverlayKind>()

  const provider = createProvider(config.llm)
  if (provider) log.info(`Answer model: ${config.llm?.provider} ${config.llm?.model}`)
  else log.warn('No model configured; set ANTHROPIC_API_KEY, or LLM_PROVIDER and LLM_MODEL, in .env')

  function loadRoute(win: BrowserWindow, route: string): void {
    if (DEV_RENDERER_URL) void win.loadURL(`${DEV_RENDERER_URL}#${route}`)
    else void win.loadFile(RENDERER_INDEX, { hash: route })
  }

  function adapt(win: BrowserWindow, route: string): OverlayWindow {
    return {
      setContentProtection: (enabled) => win.setContentProtection(enabled),
      setFocusable: (enabled) => win.setFocusable(enabled),
      isFocusable: () => win.isFocusable(),
      setSkipTaskbar: (skip) => win.setSkipTaskbar(skip),
      show: () => win.showInactive(),
      hide: () => win.hide(),
      isVisible: () => win.isVisible(),
      getBounds: () => win.getBounds(),
      setPosition: (x, y) => win.setPosition(x, y),
      setSize: (width, height) => {
        win.setResizable(true)
        win.setMinimumSize(0, 0)
        win.setSize(width, height)
        win.setResizable(false)
      },
      setOpacity: (value) => win.setOpacity(value),
      isDestroyed: () => win.isDestroyed(),
      destroy: () => win.destroy(),
      loadRoute: () => loadRoute(win, route),
    }
  }

  function preloadPath(): string {
    // electron-vite names the CommonJS preload differently depending on the package module type.
    const candidates = ['index.cjs', 'index.js', 'index.mjs'].map((name) => join(__dirname, '../preload', name))
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
  }

  function createWindow(kind: OverlayKind, options: OverlayWindowOptions): OverlayWindow {
    const win = new BrowserWindow({
      ...options,
      acceptFirstMouse: true,
      hiddenInMissionControl: true,
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        // The chat window runs the audio pipeline and may be hidden while listening.
        backgroundThrottling: false,
      },
    })
    windowsByKind.set(kind, win)
    win.webContents.on('did-finish-load', () => {
      loaded.add(kind)
      if (loaded.size === 2) store.patch({ windowsLoaded: true })
    })
    win.webContents.on('did-fail-load', (_event, code, description) => {
      log.error(`Window ${kind} failed to load: ${code} ${description}`)
    })
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.on('will-attach-webview', (event) => event.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    if (kind === 'control') {
      // Dragging via `-webkit-app-region: drag` moves the bar natively; keep it clamped and re-anchor the chat.
      win.on('moved', () => manager.setControlPosition(win.getBounds()))
    }
    return adapt(win, kind === 'control' ? '/control' : '/chat')
  }

  const manager = createOverlayManager({
    createWindow,
    primaryDisplay: () => screen.getPrimaryDisplay(),
    displayMatching: (rect) => screen.getDisplayMatching(rect),
    platform: process.platform,
    schedule: (fn, ms) => setTimeout(fn, ms),
  })

  function broadcast<C extends keyof EventMap>(channel: C, payload: EventMap[C]): void {
    for (const win of windowsByKind.values()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  let captures = 0
  async function capture(): Promise<Screenshot> {
    const chat = manager.getWindow('chat')
    const display = chat ? screen.getDisplayMatching(chat.getBounds()) : screen.getPrimaryDisplay()
    return captureScreenshot({
      display,
      getSources: (options) => desktopCapturer.getSources(options),
      // Reference-counted so overlapping captures never re-expose the overlay early.
      setCapturing: (flag) => {
        captures += flag ? 1 : -1
        store.patch({ isCapturingScreenshot: captures > 0 })
      },
    })
  }

  let profile: Profile | null = null
  const profileDir = app.getPath('userData')
  void loadProfile(profileDir).then((loaded) => {
    profile = loaded
    store.patch({ profileName: loaded?.name ?? null })
    warmProvider()
  })

  /** The model's start-up cost is paid now rather than on the first question. */
  function warmProvider(): void {
    try {
      provider?.warm?.(profile?.text ?? null)
    } catch (error) {
      log.warn(`Warming the model failed: ${describe(error)}`)
    }
  }

  const answers = createAnswerService({
    provider,
    getState: () => store.get(),
    capture,
    getProfile: () => profile?.text ?? null,
    log: { warn: (m) => log.warn(m) },
  })

  /** Returns an error message for the renderer, or null when the profile changed or the user cancelled. */
  async function pickProfile(): Promise<string | null> {
    const chat = windowsByKind.get('chat')
    const options = {
      title: 'Choose your resume or notes',
      properties: ['openFile' as const],
      filters: [{ name: 'Resume', extensions: [...PROFILE_EXTENSIONS] }],
    }
    const result = chat && !chat.isDestroyed() ? await dialog.showOpenDialog(chat, options) : await dialog.showOpenDialog(options)
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    try {
      if ((await stat(path)).size > MAX_PROFILE_FILE_BYTES) return 'That file is larger than 20 MB'
      const text = await extractProfileText(path, await readFile(path), { parsePdf })
      if (!text) return 'No text could be read from that file'
      profile = { name: basename(path), text }
      await saveProfile(profileDir, profile)
      store.patch({ profileName: profile.name })
      warmProvider()
      return null
    } catch (error) {
      log.warn(`Resume import failed: ${describe(error)}`)
      return describe(error)
    }
  }

  async function clearProfile(): Promise<void> {
    profile = null
    await saveProfile(profileDir, null)
    store.patch({ profileName: null })
    warmProvider()
  }

  // Answers come on their own once the interviewer asks something and stops talking.
  const autoAnswer = createAutoAnswerScheduler({
    trigger: () => {
      const state = store.get()
      if (!state.autoAnswer || !state.isListening) return
      if (!state.showChat) store.patch({ showChat: true })
      broadcast(IPC.chatSubmit, undefined)
    },
  })

  function toggleListening(): void {
    const state = store.get()
    const starting = !state.isListening
    if (starting) warmProvider()
    store.patch({
      isListening: starting,
      transcript: starting ? [] : state.transcript,
      showChat: starting ? true : state.showChat,
      sessionStartedAt: starting ? new Date().toISOString() : state.sessionStartedAt,
      meHasVoiceActivity: false,
      themHasVoiceActivity: false,
    })
  }

  const shortcutActions: Record<ShortcutKey, () => void> = {
    toggleVisibility: () => store.patch({ isInvisible: !store.get().isInvisible }),
    ask: () => {
      if (!store.get().showChat) store.patch({ showChat: true })
      broadcast(IPC.chatSubmit, undefined)
    },
    clear: () => broadcast(IPC.chatClear, undefined),
    toggleSession: toggleListening,
    moveUp: () => manager.moveControlBy({ deltaY: -MOVE_STEP_PX }),
    moveDown: () => manager.moveControlBy({ deltaY: MOVE_STEP_PX }),
    moveLeft: () => manager.moveControlBy({ deltaX: -MOVE_STEP_PX }),
    moveRight: () => manager.moveControlBy({ deltaX: MOVE_STEP_PX }),
    scrollUp: () => broadcast(IPC.chatScroll, { deltaY: -SCROLL_STEP_PX }),
    scrollDown: () => broadcast(IPC.chatScroll, { deltaY: SCROLL_STEP_PX }),
  }

  const shortcuts = createShortcutSyncer({
    register: (accelerator, handler) => globalShortcut.register(accelerator, handler),
    unregister: (accelerator) => globalShortcut.unregister(accelerator),
    actions: shortcutActions,
    log: { error: (m) => log.error(m) },
  })

  function hardenSession(): void {
    const ses = session.defaultSession
    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(ALLOWED_PERMISSIONS.has(permission) && isTrustedUrl(details.requestingUrl || contents.getURL()))
    })
    ses.setPermissionCheckHandler((contents, permission, origin) => {
      return ALLOWED_PERMISSIONS.has(permission) && isTrustedUrl(origin || contents?.getURL())
    })
    if (process.platform !== 'darwin') {
      ses.setDisplayMediaRequestHandler(
        (request, callback) => {
          if (!isTrustedUrl(request.frame?.url)) {
            callback({})
            return
          }
          desktopCapturer
            .getSources({ types: ['screen'] })
            .then((sources) => callback(selectLoopbackSource(sources)))
            .catch((error: unknown) => {
              log.error('Selecting loopback source failed:', describe(error))
              callback({})
            })
        },
        { useSystemPicker: false },
      )
    }
  }

  function registerIpc(): void {
    const guard = (event: IpcMainInvokeEvent | IpcMainEvent) => {
      if (!isTrustedSender(event)) throw new Error('IPC request from an untrusted frame')
    }
    ipcMain.handle(IPC.getState, (event) => {
      guard(event)
      return store.get()
    })
    ipcMain.handle(IPC.patchState, (event, patch: unknown) => {
      guard(event)
      return store.patch(RendererPatchSchema.parse(patch))
    })
    ipcMain.handle(IPC.transcriptApply, (event, op: unknown) => {
      guard(event)
      return store.patch({ transcript: applyTranscriptOp(store.get().transcript, TranscriptOpSchema.parse(op)) })
    })
    ipcMain.handle(IPC.ask, (event, request: unknown) => {
      guard(event)
      const sender = event.sender
      void answers.ask(AskRequestSchema.parse(request), (channel, payload) => {
        // The pill shimmers its Ask label while an answer streams.
        if (channel === IPC.answerStarted) store.patch({ isAnswering: true })
        else if (channel === IPC.answerDone || channel === IPC.answerError) store.patch({ isAnswering: false })
        if (!sender.isDestroyed()) sender.send(channel, payload)
      })
    })
    ipcMain.handle(IPC.cancelAsk, (event, request: unknown) => {
      guard(event)
      answers.cancel(CancelRequestSchema.parse(request).requestId)
    })
    ipcMain.handle(IPC.profilePick, (event) => {
      guard(event)
      return pickProfile()
    })
    ipcMain.handle(IPC.profileClear, (event) => {
      guard(event)
      return clearProfile()
    })
    ipcMain.on(IPC.controlResetPosition, (event) => {
      guard(event)
      manager.resetControlPosition()
    })
    // The pill is dragged by hand (no native drag region) so a plain click can open settings.
    ipcMain.on(IPC.controlDrag, (event, position: unknown) => {
      guard(event)
      const { x, y } = ControlDragSchema.parse(position)
      const control = windowsByKind.get('control')
      if (control && !control.isDestroyed()) control.setPosition(x, y)
    })
    ipcMain.on(IPC.controlDragEnd, (event) => {
      guard(event)
      const control = windowsByKind.get('control')
      if (control && !control.isDestroyed()) manager.setControlPosition(control.getBounds())
    })
    ipcMain.on(IPC.openSettings, (event) => {
      guard(event)
      // The settings window arrives in the next step; until then a pill click shows the panel.
      store.patch({ showChat: true })
    })
    ipcMain.on(IPC.toggleSession, (event) => {
      guard(event)
      toggleListening()
    })
    ipcMain.on(IPC.toggleChat, (event) => {
      guard(event)
      store.patch({ showChat: !store.get().showChat })
    })
    ipcMain.on(IPC.quit, (event) => {
      guard(event)
      quitApp()
    })
  }

  /** The overlay windows are `closable: false`, so a plain `app.quit()` stalls; tear them down first. */
  function quitApp(): void {
    shortcuts.dispose()
    autoAnswer.cancel()
    void provider?.dispose?.()
    tray?.destroy()
    tray = null
    manager.dispose()
    app.quit()
    // Belt and braces: if anything keeps the process alive, leave anyway.
    setTimeout(() => app.exit(0), 1500).unref()
  }

  let tray: Tray | null = null
  function syncTray(state: AppState): void {
    const icon = nativeImage.createFromBuffer(Buffer.from(renderTrayIconPng({ listening: state.isListening })))
    if (!tray) {
      tray = new Tray(icon)
      tray.setToolTip(APP_NAME)
      tray.on('click', () => store.patch({ showChat: !store.get().showChat }))
    } else {
      tray.setImage(icon)
    }
    tray.setContextMenu(
      Menu.buildFromTemplate(
        trayMenuTemplate(state, {
          toggleChat: () => store.patch({ showChat: !store.get().showChat }),
          toggleInvisible: () => store.patch({ isInvisible: !store.get().isInvisible }),
          toggleListening,
          quit: quitApp,
        }),
      ),
    )
  }

  let previous = store.get()
  store.subscribe((state) => {
    manager.update(state)
    shortcuts.sync(state)
    syncTray(state)
    broadcast(IPC.stateUpdated, state)
    watchForQuestions(previous, state)
    previous = state
  })

  function watchForQuestions(before: AppState, after: AppState): void {
    if (!after.isListening || !after.autoAnswer) {
      if (before.isListening !== after.isListening || before.autoAnswer !== after.autoAnswer) autoAnswer.cancel()
      return
    }
    for (const line of newlyFinishedInterviewerLines(before.transcript, after.transcript)) autoAnswer.onInterviewerLine(line.text)
    if (before.themHasVoiceActivity !== after.themHasVoiceActivity) autoAnswer.onInterviewerActivity(after.themHasVoiceActivity)
    if (before.meHasVoiceActivity !== after.meHasVoiceActivity) autoAnswer.onUserActivity(after.meHasVoiceActivity)
  }

  hardenSession()
  registerIpc()
  manager.update(store.get())
  shortcuts.sync(store.get())
  syncTray(store.get())
  app.on('will-quit', () => {
    shortcuts.dispose()
    tray?.destroy()
  })
  app.on('second-instance', () => store.patch({ showChat: true }))
  log.info('Meeting Copilot ready')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(main)
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => app.quit())
}
