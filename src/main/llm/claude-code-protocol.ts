import type { AnswerRequest } from '@shared/providers'
import { MAX_QUESTION_CHARS } from '@shared/ipc'
import { formatTranscript } from './prompt'

/**
 * Translation to and from the Claude Code CLI (`claude -p --output-format stream-json`).
 * Flags and event shapes follow the CLI's `--help` and a live probe of version 2.1.x.
 */

export interface ClaudeCodeArgs {
  model: string
  system: string
  /** Allow only the Read tool, so the model can open a saved screenshot. */
  allowRead?: boolean
}

const DEFAULT_QUESTION = 'What should I say next?'

export function buildClaudeCodeArgs({ model, system, allowRead = false }: ClaudeCodeArgs): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--no-session-persistence',
    '--model',
    model,
    '--system-prompt',
    system,
    // Claude Code's own tools, MCP servers and user settings must not leak into the answer.
    '--tools',
    allowRead ? 'Read' : '',
    '--strict-mcp-config',
    '--setting-sources',
    '',
  ]
}

/** The single prompt the CLI receives on stdin: transcript, optional screenshot pointer, question. */
export function renderPrompt(request: AnswerRequest, screenshotPath?: string): string {
  const question = request.question.trim().slice(0, MAX_QUESTION_CHARS) || DEFAULT_QUESTION
  const transcript = formatTranscript(request.transcript) || '(no transcript yet)'
  const parts = [`Live transcript (most recent last):\n${transcript}`]
  if (screenshotPath) parts.push(`A screenshot of my screen is saved at ${screenshotPath}. Read that file before answering.`)
  parts.push(`Question: ${question}`)
  return parts.join('\n\n')
}

/**
 * The CLI refuses to start inside another Claude Code session, which it detects through environment
 * markers. The copilot may well be launched from one, so those markers are removed for the child.
 */
export function childEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key === 'CLAUDE_CONFIG_DIR' || (key !== 'CLAUDECODE' && !key.startsWith('CLAUDE_CODE_'))),
  )
}

export type StreamLine ={ type: 'text'; text: string } | { type: 'done' } | { type: 'error'; message: string }

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
  const record = payload as { type?: unknown; event?: unknown; is_error?: unknown; subtype?: unknown; result?: unknown }
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
