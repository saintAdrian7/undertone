import {
  app,
  BrowserWindow,
  desktopCapturer,
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
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import log from 'electron-log/main'
import Anthropic from '@anthropic-ai/sdk'
import { AskRequestSchema, CancelRequestSchema, IPC, TranscriptOpSchema, type EventMap } from '@shared/ipc'
import type { AnswerProvider, Screenshot } from '@shared/providers'
import { RendererPatchSchema, type AppState, type ShortcutKey } from '@shared/state'
import { applyTranscriptOp } from '@shared/transcript'
import { createStore } from './state/store'
import { createOverlayManager, type OverlayWindow } from './overlay/manager'
import type { OverlayKind, OverlayWindowOptions } from './overlay/window-options'
import { createShortcutSyncer } from './shortcuts/syncer'
import { createAnswerService } from './answer/service'
import { renderTrayIconPng } from './tray/icon'
import { trayMenuTemplate } from './tray/menu'
import { selectLoopbackSource } from './capture/sources'
import { captureScreenshot } from './capture/screenshot'
import { ClaudeAnswerProvider, type MessageStreamClient } from './llm/claude-provider'
import { DEFAULT_OPENAI_BASE_URL, parseEnv, resolveConfig, type AppConfig, type LlmConfig } from './config'
import { OpenAICompatibleProvider } from './llm/openai-compatible-provider'

log.initialize()

const MOVE_STEP_PX = 80
const SCROLL_STEP_PX = 240
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

function createProvider(llm: LlmConfig | null): AnswerProvider | null {
  if (!llm) return null
  if (llm.provider === 'anthropic') {
    return new ClaudeAnswerProvider({
      // The SDK's stream params are a superset of the shape this provider builds.
      client: new Anthropic({ apiKey: llm.apiKey ?? undefined }) as unknown as MessageStreamClient,
      model: llm.model,
    })
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

  const answers = createAnswerService({ provider, getState: () => store.get(), capture, log: { warn: (m) => log.warn(m) } })

  function toggleListening(): void {
    const state = store.get()
    const starting = !state.isListening
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
        if (!sender.isDestroyed()) sender.send(channel, payload)
      })
    })
    ipcMain.handle(IPC.cancelAsk, (event, request: unknown) => {
      guard(event)
      answers.cancel(CancelRequestSchema.parse(request).requestId)
    })
    ipcMain.on(IPC.controlResetPosition, (event) => {
      guard(event)
      manager.resetControlPosition()
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
      tray.setToolTip('Meeting Copilot')
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

  store.subscribe((state) => {
    manager.update(state)
    shortcuts.sync(state)
    syncTray(state)
    broadcast(IPC.stateUpdated, state)
  })

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
