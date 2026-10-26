import { z } from 'zod'

export const MAX_TRANSCRIPT_ENTRIES = 200
export const MAX_TRANSCRIPT_TEXT_CHARS = 4000
export const MAX_CHAT_HEIGHT = 1200
export const MIN_CONTROL_WIDTH = 200
export const MAX_CONTROL_WIDTH = 800
export const DEFAULT_CONTROL_WIDTH = 320

export const ShortcutsSchema = z.object({
  toggleVisibility: z.string().default('CommandOrControl+\\'),
  ask: z.string().default('CommandOrControl+Enter'),
  clear: z.string().default('CommandOrControl+R'),
  toggleSession: z.string().default('CommandOrControl+Shift+\\'),
  moveUp: z.string().default('CommandOrControl+Up'),
  moveDown: z.string().default('CommandOrControl+Down'),
  moveLeft: z.string().default('CommandOrControl+Left'),
  moveRight: z.string().default('CommandOrControl+Right'),
  scrollUp: z.string().default('CommandOrControl+Shift+Up'),
  scrollDown: z.string().default('CommandOrControl+Shift+Down'),
})

export type Shortcuts = z.infer<typeof ShortcutsSchema>
export type ShortcutKey = keyof Shortcuts

export const SpeakerRoleSchema = z.enum(['me', 'them'])
export type SpeakerRole = z.infer<typeof SpeakerRoleSchema>

export const TranscriptEntrySchema = z.object({
  id: z.string().min(1).max(64),
  role: SpeakerRoleSchema,
  createdAt: z.string(),
  relativeMs: z.number(),
  status: z.enum(['transcribing', 'done']),
  text: z.string().max(MAX_TRANSCRIPT_TEXT_CHARS).default(''),
})

export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>

const ScreenUseSchema = z.enum(['off', 'required'])
const ThemeSchema = z.enum(['system', 'light', 'dark'])

export const AppStateSchema = z.object({
  windowsLoaded: z.boolean().default(false),
  isListening: z.boolean().default(false),
  sessionStartedAt: z.string().nullable().default(null),
  showChat: z.boolean().default(false),
  isInvisible: z.boolean().default(false),
  noFocusWhenInvisible: z.boolean().default(false),
  isCapturingScreenshot: z.boolean().default(false),
  isRecordingShortcut: z.boolean().default(false),
  chatWindowIsExpanded: z.boolean().default(false),
  chatExpandedHeight: z.number().int().positive().max(MAX_CHAT_HEIGHT).default(500),
  controlWidth: z.number().int().min(MIN_CONTROL_WIDTH).max(MAX_CONTROL_WIDTH).default(DEFAULT_CONTROL_WIDTH),
  screenUse: ScreenUseSchema.default('required'),
  theme: ThemeSchema.default('system'),
  shortcuts: ShortcutsSchema.prefault({}),
  transcript: z.array(TranscriptEntrySchema).max(MAX_TRANSCRIPT_ENTRIES).default([]),
  meHasVoiceActivity: z.boolean().default(false),
  themHasVoiceActivity: z.boolean().default(false),
  /** Generate an answer on its own when the interviewer asks something and goes quiet. */
  autoAnswer: z.boolean().default(true),
  /** File name of the uploaded resume or notes, kept by the main process. */
  profileName: z.string().nullable().default(null),
  /** True while an answer is streaming; the pill's Ask label shimmers. Main-owned. */
  isAnswering: z.boolean().default(false),
})

export type AppState = z.infer<typeof AppStateSchema>
export type AppStatePatch = Partial<AppState>

/**
 * The subset of state a renderer is allowed to change. Everything else (shortcuts, load and
 * capture flags) is owned by the main process, so a compromised renderer cannot touch it.
 */
export const RendererPatchSchema = z.strictObject({
  isListening: z.boolean().optional(),
  sessionStartedAt: z.string().nullable().optional(),
  showChat: z.boolean().optional(),
  isInvisible: z.boolean().optional(),
  noFocusWhenInvisible: z.boolean().optional(),
  chatWindowIsExpanded: z.boolean().optional(),
  chatExpandedHeight: z.number().int().positive().max(MAX_CHAT_HEIGHT).optional(),
  controlWidth: z.number().int().min(MIN_CONTROL_WIDTH).max(MAX_CONTROL_WIDTH).optional(),
  screenUse: ScreenUseSchema.optional(),
  theme: ThemeSchema.optional(),
  meHasVoiceActivity: z.boolean().optional(),
  themHasVoiceActivity: z.boolean().optional(),
  autoAnswer: z.boolean().optional(),
})

export type RendererPatch = z.infer<typeof RendererPatchSchema>

export function defaultState(): AppState {
  return AppStateSchema.parse({})
}

const withoutUndefined = (patch: AppStatePatch): AppStatePatch =>
  Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as AppStatePatch

/** Returns a new validated state; throws on an invalid patch. Never mutates `state`. */
export function applyPatch(state: AppState, patch: AppStatePatch): AppState {
  return AppStateSchema.parse({ ...state, ...withoutUndefined(patch) })
}
