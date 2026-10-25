import type { AppState } from '@shared/state'
import { APP_NAME } from '@shared/brand'

export interface TrayActions {
  toggleChat(): void
  toggleInvisible(): void
  toggleListening(): void
  openSettings(): void
  quit(): void
}

/** Plain menu items, compatible with Electron's `Menu.buildFromTemplate`, kept Electron-free for tests. */
export interface TrayMenuItem {
  label?: string
  type?: 'separator'
  click?: () => void
}

/** The tray is the always-available exit path, even if the bar has been moved out of reach. */
export function trayMenuTemplate(state: AppState, actions: TrayActions): TrayMenuItem[] {
  return [
    { label: state.isListening ? 'Stop listening' : 'Start listening', click: actions.toggleListening },
    { label: state.showChat ? 'Hide panel' : 'Show panel', click: actions.toggleChat },
    { label: state.isInvisible ? 'Disable invisibility' : 'Enable invisibility', click: actions.toggleInvisible },
    { label: 'Settings…', click: actions.openSettings },
    { type: 'separator' },
    { label: `Quit ${APP_NAME}`, click: actions.quit },
  ]
}
