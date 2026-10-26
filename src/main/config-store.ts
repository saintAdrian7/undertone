import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { PublicLlmSettings } from '@shared/ipc'
import { DEFAULT_OPENAI_BASE_URL, resolveConfig, type AppConfig } from './config'

export const LLM_SETTINGS_FILE = 'llm.json'

/** Model settings chosen in the Settings window; they override the `.env` file. */
export const LlmSettingsSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'claude-code']),
  model: z.string().min(1).max(200),
  baseUrl: z.string().max(500).nullable(),
  apiKey: z.string().max(500).nullable(),
})
export type LlmSettings = z.infer<typeof LlmSettingsSchema>

export async function loadLlmSettings(dir: string): Promise<LlmSettings | null> {
  try {
    return LlmSettingsSchema.parse(JSON.parse(await readFile(join(dir, LLM_SETTINGS_FILE), 'utf8')))
  } catch {
    return null
  }
}

export async function saveLlmSettings(dir: string, settings: LlmSettings | null): Promise<void> {
  const path = join(dir, LLM_SETTINGS_FILE)
  if (settings) await writeFile(path, JSON.stringify(LlmSettingsSchema.parse(settings)), 'utf8')
  else await unlink(path).catch(() => undefined)
}

/** What the renderer may see: everything but the key itself. */
export function publicLlmSettings(settings: LlmSettings | null, source: 'settings' | 'env'): PublicLlmSettings | null {
  if (!settings) return null
  return { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl, hasApiKey: settings.apiKey !== null && settings.apiKey !== '', source }
}

/** Saved settings win; without them the environment decides as before. */
export function resolveConfigWith(env: Record<string, string | undefined>, saved: LlmSettings | null): AppConfig {
  if (!saved) return resolveConfig(env)
  const baseUrl = saved.provider === 'openai' ? (saved.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '') : null
  return { llm: { provider: saved.provider, apiKey: saved.apiKey?.trim() || null, model: saved.model.trim(), baseUrl } }
}
