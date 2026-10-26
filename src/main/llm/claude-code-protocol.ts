import type { AnswerRequest, Screenshot } from '@shared/providers'
import { MAX_QUESTION_CHARS } from '@shared/ipc'
import { formatTranscript } from './prompt'

/**
 * Translation to and from the Claude Code CLI (`claude -p --output-format stream-json --input-format stream-json`).
 * Flags and event shapes follow the CLI's `--help` and a live probe of version 2.1.x: with stream-json input the
 * process stays alive and answers each user message line in turn, so one process serves a whole session.
 */

export interface ClaudeCodeArgs {
  model: string
  system: string
}

const DEFAULT_QUESTION = 'What should I say next?'

export function buildClaudeCodeArgs({ model, system }: ClaudeCodeArgs): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--no-session-persistence',
    '--model',
    model,
    '--system-prompt',
    system,
    // Claude Code's own tools, MCP servers, skills and user settings must not leak into the answer.
    '--tools',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--setting-sources',
    '',
  ]
}

export interface PromptCursor {
  /** Id of the last transcript entry the session has already seen; only later lines are sent. */
  afterId: string | null
}

/** The text of one user turn: the transcript (or just the lines since the last turn) and the question. */
export function renderPrompt(request: AnswerRequest, cursor?: PromptCursor): string {
  const question = request.question.trim().slice(0, MAX_QUESTION_CHARS) || DEFAULT_QUESTION
  const seen = cursor?.afterId ? request.transcript.findIndex((entry) => entry.id === cursor.afterId) : -1
  const entries = seen >= 0 ? request.transcript.slice(seen + 1) : request.transcript
  const transcript = formatTranscript(entries)
  const heading = seen >= 0 ? 'Transcript since your last answer (most recent last)' : 'Live transcript (most recent last)'
  const body = transcript || (seen >= 0 ? '(nothing new was said)' : '(no transcript yet)')
  return `${heading}:\n${body}\n\nQuestion: ${question}`
}

/** One stream-json user message line, with the screenshot inlined as an image block. */
export function renderUserMessage({ text, screenshot }: { text: string; screenshot?: Screenshot }): string {
  const content: unknown[] = [{ type: 'text', text }]
  if (screenshot) {
    content.push({ type: 'image', source: { type: 'base64', media_type: screenshot.contentType, data: screenshot.dataBase64 } })
  }
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n'
}

/**
 * Variables the child must not inherit: the markers of an enclosing Claude Code session (the CLI
 * refuses to start inside one, and the copilot may well be launched from one), and the app's own API
 * keys and endpoints, which would make the CLI bill a key instead of the user's login. Login tokens
 * such as CLAUDE_CODE_OAUTH_TOKEN and the config directory are kept.
 */
const DROPPED_ENV = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_SESSION_ID',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'LLM_API_KEY',
  'LLM_BASE_URL',
])

export function childEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !DROPPED_ENV.has(key)))
}

export type StreamLine =
  | { type: 'init'; tools: string[]; mcpServers: number }
  | { type: 'text'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

/** One line of stream-json output, or null when it is session bookkeeping. */
export function parseStreamLine(line: string): StreamLine | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let payload: unknown
  try {
    payload = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as { type?: unknown; event?: unknown; is_error?: unknown; subtype?: unknown; result?: unknown; tools?: unknown; mcp_servers?: unknown }
  if (record.type === 'system' && record.subtype === 'init') {
    // The provider refuses a session that started with any tool or MCP server, whatever the flags said.
    const tools = Array.isArray(record.tools) ? record.tools.filter((tool): tool is string => typeof tool === 'string') : []
    const mcpServers = Array.isArray(record.mcp_servers) ? record.mcp_servers.length : 0
    return { type: 'init', tools, mcpServers }
  }
  if (record.type === 'stream_event') {
    const event = record.event as { type?: unknown; delta?: { type?: unknown; text?: unknown } } | undefined
    if (event?.type !== 'content_block_delta' || event.delta?.type !== 'text_delta') return null
    return typeof event.delta.text === 'string' && event.delta.text ? { type: 'text', text: event.delta.text } : null
  }
  if (record.type === 'result') {
    if (record.is_error || record.subtype !== 'success') {
      const detail = typeof record.result === 'string' ? record.result : String(record.subtype ?? 'unknown error')
      return { type: 'error', message: `Claude Code CLI failed: ${detail}` }
    }
    return { type: 'done' }
  }
  return null
}
