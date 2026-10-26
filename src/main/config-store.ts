import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { LlmSettingsRequest, PublicLlmSettings } from '@shared/ipc'
import { validateBaseUrl } from '@shared/base-url'
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

/** On disk the key is encrypted when the platform can do it (Electron's safeStorage); older files hold it plain. */
const StoredSchema = LlmSettingsSchema.omit({ apiKey: true }).extend({
  apiKey: z.string().max(500).nullable().optional(),
  apiKeyEnc: z.string().max(4000).nullable().optional(),
})

/** The slice of Electron's `safeStorage` the store uses, injected so tests need no Electron. */
export interface KeyCipher {
  available(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

export async function loadLlmSettings(dir: string, cipher?: KeyCipher): Promise<LlmSettings | null> {
  let stored: z.infer<typeof StoredSchema>
  try {
    stored = StoredSchema.parse(JSON.parse(await readFile(join(dir, LLM_SETTINGS_FILE), 'utf8')))
  } catch {
    return null
  }
  let apiKey: string | null = stored.apiKey ?? null
  if (stored.apiKeyEnc) {
    if (!cipher?.available()) return null
    try {
      apiKey = cipher.decrypt(Buffer.from(stored.apiKeyEnc, 'base64'))
    } catch {
      return null
    }
  }
  const settings: LlmSettings = { provider: stored.provider, model: stored.model, baseUrl: stored.baseUrl, apiKey }
  // A plain-text key written by an older version is re-saved encrypted as soon as that is possible.
  if (stored.apiKey && cipher?.available()) await saveLlmSettings(dir, settings, cipher)
  return settings
}

export async function saveLlmSettings(dir: string, settings: LlmSettings | null, cipher?: KeyCipher): Promise<void> {
  const path = join(dir, LLM_SETTINGS_FILE)
  if (!settings) {
    await unlink(path).catch(() => undefined)
    return
  }
  const parsed = LlmSettingsSchema.parse(settings)
  const encrypt = parsed.apiKey && cipher?.available()
  const stored = {
    provider: parsed.provider,
    model: parsed.model,
    baseUrl: parsed.baseUrl,
    ...(encrypt ? { apiKeyEnc: cipher!.encrypt(parsed.apiKey!).toString('base64') } : { apiKey: parsed.apiKey }),
  }
  // Written to a temporary file first, so a crash mid-write never leaves a half file behind.
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
  await rename(temp, path)
}

/** What the renderer may see: everything but the key itself. */
export function publicLlmSettings(settings: LlmSettings | null, source: 'settings' | 'env'): PublicLlmSettings | null {
  if (!settings) return null
  return { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl, hasApiKey: settings.apiKey !== null && settings.apiKey !== '', source }
}

const normaliseUrl = (value: string | null | undefined): string | null => (value ? value.trim().replace(/\/+$/, '') || null : null)

/**
 * The key to store for a settings request: the one the request carries, or the stored one only when
 * provider and base URL are unchanged. Otherwise a renderer could point a stored key at any server.
 */
export function mergeApiKey(saved: LlmSettings | null, request: LlmSettingsRequest): string | null {
  if (request.apiKey !== undefined) return request.apiKey || null
  if (!saved || saved.provider !== request.provider) return null
  return normaliseUrl(saved.baseUrl) === normaliseUrl(request.baseUrl) ? saved.apiKey : null
}

/** Saved settings win; without them the environment decides as before. */
export function resolveConfigWith(env: Record<string, string | undefined>, saved: LlmSettings | null): AppConfig {
  if (!saved) return resolveConfig(env)
  const baseUrl = saved.provider === 'openai' ? validateBaseUrl(saved.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL) : null
  return { llm: { provider: saved.provider, apiKey: saved.apiKey?.trim() || null, model: saved.model.trim(), baseUrl } }
}
