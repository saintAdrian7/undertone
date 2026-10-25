export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5'
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1'

export type LlmProviderKind = 'anthropic' | 'openai' | 'claude-code'
export const DEFAULT_CLAUDE_CODE_MODEL = 'sonnet'

export interface LlmConfig {
  provider: LlmProviderKind
  apiKey: string | null
  model: string
  /** Only for OpenAI-compatible endpoints; without a trailing slash. */
  baseUrl: string | null
}

export interface AppConfig {
  llm: LlmConfig | null
}

const stripQuotes = (value: string): string => {
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
  return quoted && value.length >= 2 ? value.slice(1, -1) : value
}

/** Minimal `.env` parser: `KEY=VALUE` per line, `#` comments, optional single or double quotes. */
export function parseEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = stripQuotes(line.slice(separator + 1).trim())
    result[key] = value
  }
  return result
}

const trimmed = (value: string | undefined): string | null => {
  const text = value?.trim()
  return text ? text : null
}

/**
 * Picks the answer model from the environment.
 * - `ANTHROPIC_API_KEY` alone selects Claude (`ANTHROPIC_MODEL` optional).
 * - `LLM_PROVIDER=openai|ollama` selects any OpenAI-compatible endpoint via `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.
 * - `LLM_PROVIDER=anthropic` selects Claude using the generic `LLM_*` variables as fallbacks.
 */
export function resolveConfig(env: Record<string, string | undefined>): AppConfig {
  const selected = trimmed(env.LLM_PROVIDER)?.toLowerCase() ?? null

  if (selected === null || selected === 'anthropic') {
    const apiKey = trimmed(env.ANTHROPIC_API_KEY) ?? (selected ? trimmed(env.LLM_API_KEY) : null)
    if (!apiKey) return { llm: null }
    const model = trimmed(env.ANTHROPIC_MODEL) ?? trimmed(env.LLM_MODEL) ?? DEFAULT_CLAUDE_MODEL
    return { llm: { provider: 'anthropic', apiKey, model, baseUrl: null } }
  }

  if (selected === 'openai' || selected === 'ollama') {
    const model = trimmed(env.LLM_MODEL)
    if (!model) return { llm: null }
    const fallbackBase = selected === 'ollama' ? DEFAULT_OLLAMA_BASE_URL : DEFAULT_OPENAI_BASE_URL
    const baseUrl = (trimmed(env.LLM_BASE_URL) ?? fallbackBase).replace(/\/+$/, '')
    return { llm: { provider: 'openai', apiKey: trimmed(env.LLM_API_KEY), model, baseUrl } }
  }

  if (selected === 'claude-code') {
    // The Claude Code CLI authenticates with the user's own Claude login, so no key is needed.
    return { llm: { provider: 'claude-code', apiKey: null, model: trimmed(env.LLM_MODEL) ?? DEFAULT_CLAUDE_CODE_MODEL, baseUrl: null } }
  }

  throw new Error(`Unknown LLM_PROVIDER "${selected}"; use anthropic, openai, ollama or claude-code`)
}
