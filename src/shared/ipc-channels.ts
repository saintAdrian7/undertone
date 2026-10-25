/**
 * Channel names only. This module must stay free of dependencies: the sandboxed preload imports it,
 * and a sandboxed preload cannot load anything from node_modules.
 * Renderer → main use `invoke` (request/response) or `send` (fire and forget); main → renderer are events.
 */
export const IPC = {
  // renderer → main (invoke)
  getState: 'state:get',
  patchState: 'state:patch',
  transcriptApply: 'transcript:apply',
  ask: 'answer:ask',
  cancelAsk: 'answer:cancel',
  profilePick: 'profile:pick',
  profileClear: 'profile:clear',
  profileGet: 'profile:get',
  appInfo: 'app:info',
  llmGet: 'llm:get',
  llmSet: 'llm:set',
  shortcutsSet: 'shortcuts:set',
  // renderer → main (send)
  toggleSession: 'session:toggle',
  controlResetPosition: 'control:reset-position',
  controlDrag: 'control:drag',
  controlDragEnd: 'control:drag-end',
  openSettings: 'settings:open',
  toggleChat: 'chat:toggle',
  quit: 'app:quit',
  // main → renderer (events)
  stateUpdated: 'state:updated',
  chatSubmit: 'chat:submit',
  chatClear: 'chat:clear',
  chatScroll: 'chat:scroll',
  answerStarted: 'answer:started',
  answerChunk: 'answer:chunk',
  answerDone: 'answer:done',
  answerError: 'answer:error',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
