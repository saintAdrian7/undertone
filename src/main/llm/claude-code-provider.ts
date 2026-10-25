import { spawn as nodeSpawn } from 'node:child_process'
import type { AnswerProvider, AnswerRequest } from '@shared/providers'
import { systemPromptFor } from './prompt'
import {
  buildClaudeCodeArgs,
  childEnvironment,
  parseStreamLine,
  renderPrompt,
  renderUserMessage,
  type StreamLine,
} from './claude-code-protocol'

/** The slice of a child process this provider uses, so tests can supply a fake. */
export interface ChildLike {
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
  stdin: { write(text: string): unknown; end(): unknown }
  on(event: 'close', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  kill(): unknown
}

export type SpawnLike = (command: string, args: string[]) => ChildLike

export interface ClaudeCodeOptions {
  /** Executable name or path; `claude` is resolved on PATH. */
  command?: string
  model: string
  spawn?: SpawnLike
}

type QueueEvent = StreamLine | { type: 'closed'; code: number | null }

interface Session {
  child: ChildLike
  /** The profile the process was started with; a change needs a new system prompt, so a new process. */
  profile: string | null
  /** Last transcript entry the model has already seen, so later turns send only what is new. */
  lastSentId: string | null
  events: QueueEvent[]
  wake: (() => void) | null
  stderr: string
  closed: boolean
}

const ERROR_SNIPPET_CHARS = 300
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const defaultSpawn: SpawnLike = (command, args) => {
  const child = nodeSpawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: childEnvironment(process.env) })
  // A write after the CLI died must not take the main process down with it; the close handler reports it.
  child.stdin.on('error', () => undefined)
  return child
}

/**
 * Streams answers through the Claude Code CLI, so the user's Claude login is used instead of an API key.
 * One `claude -p` process is kept alive for the whole session and fed each question as a stream-json
 * user message, which saves the multi-second start-up per answer and lets later turns send only the
 * transcript lines the model has not seen yet.
 */
export class ClaudeCodeProvider implements AnswerProvider {
  private session: Session | null = null

  constructor(private readonly options: ClaudeCodeOptions) {}

  async *stream(request: AnswerRequest, signal?: AbortSignal): AsyncIterable<string> {
    const session = this.ensureSession(request.profile ?? null)
    // Anything left from an earlier turn (a late result after an error) must not be read as this answer.
    session.events.length = 0

    const text = renderPrompt(request, { afterId: session.lastSentId })
    session.lastSentId = lastFinishedId(request) ?? session.lastSentId
    const onAbort = () => this.dropSession(session)
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      session.child.stdin.write(renderUserMessage({ text, screenshot: request.screenshot }))
      while (true) {
        while (session.events.length === 0) await new Promise<void>((resolve) => (session.wake = resolve))
        const event = session.events.shift()!
        if (event.type === 'text') yield event.text
        else if (event.type === 'done') return
        else if (event.type === 'error') throw new Error(`Claude Code failed: ${event.message}`)
        else {
          if (signal?.aborted) return
          if (event.code !== 0) {
            throw new Error(`Claude Code exited with exit code ${event.code}: ${session.stderr.trim().slice(0, ERROR_SNIPPET_CHARS)}`)
          }
          throw new Error('Claude Code exited before answering')
        }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /** Ends the CLI process; the next ask starts a fresh one. */
  async dispose(): Promise<void> {
    if (this.session) this.dropSession(this.session)
  }

  private ensureSession(profile: string | null): Session {
    const current = this.session
    if (current && !current.closed && current.profile === profile) return current
    if (current) this.dropSession(current)
    return this.spawnSession(profile)
  }

  private spawnSession(profile: string | null): Session {
    const spawnImpl = this.options.spawn ?? defaultSpawn
    const child = spawnImpl(
      this.options.command ?? 'claude',
      buildClaudeCodeArgs({ model: this.options.model, system: systemPromptFor(profile) }),
    )
    const session: Session = { child, profile, lastSentId: null, events: [], wake: null, stderr: '', closed: false }
    const push = (event: QueueEvent) => {
      session.events.push(event)
      session.wake?.()
      session.wake = null
    }
    let partial = ''
    child.stdout.on('data', (chunk: Buffer | string) => {
      partial += chunk.toString()
      let newline = partial.indexOf('\n')
      while (newline >= 0) {
        const parsed = parseStreamLine(partial.slice(0, newline))
        partial = partial.slice(newline + 1)
        newline = partial.indexOf('\n')
        if (parsed) push(parsed)
      }
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      session.stderr += chunk.toString()
    })
    child.on('close', (code) => {
      session.closed = true
      if (this.session === session) this.session = null
      const tail = partial ? parseStreamLine(partial) : null
      if (tail) push(tail)
      push({ type: 'closed', code })
    })
    child.on('error', (error) => {
      session.closed = true
      if (this.session === session) this.session = null
      push({ type: 'error', message: describe(error) })
    })
    this.session = session
    return session
  }

  private dropSession(session: Session): void {
    if (this.session === session) this.session = null
    if (!session.closed) {
      session.closed = true
      session.child.kill()
    }
  }
}

const lastFinishedId = (request: AnswerRequest): string | null => {
  for (let i = request.transcript.length - 1; i >= 0; i--) {
    const entry = request.transcript[i]!
    if (entry.status === 'done' && entry.text.trim()) return entry.id
  }
  return null
}
