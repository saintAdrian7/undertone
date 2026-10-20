export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5'

export interface AppConfig {
  anthropicApiKey: string | null
  claudeModel: string
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

export function resolveConfig(env: Record<string, string | undefined>): AppConfig {
  const key = env.ANTHROPIC_API_KEY?.trim()
  return {
    anthropicApiKey: key ? key : null,
    claudeModel: env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL,
  }
}
