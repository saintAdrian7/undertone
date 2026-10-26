import { spawn as nodeSpawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { unlink, writeFile as fsWriteFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnswerProvider, AnswerRequest } from '@shared/providers'
import { SYSTEM_PROMPT } from './prompt'
import { buildClaudeCodeArgs, parseStreamLine, renderPrompt, type StreamLine } from './claude-code-protocol'

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
  tempDir?: string
  writeFile?: (path: string, data: Uint8Array) => Promise<void>
  removeFile?: (path: string) => Promise<void>
}

type QueueEvent = StreamLine | { type: 'closed'; code: number | null }

const ERROR_SNIPPET_CHARS = 300
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const defaultSpawn: SpawnLike = (command, args) => nodeSpawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

/**
 * Streams answers through the Claude Code CLI, so the user's Claude login is used instead of an API key.
 * Each ask is one `claude -p` process fed the prompt on stdin.
 */
export class ClaudeCodeProvider implements AnswerProvider {
  constructor(private readonly options: ClaudeCodeOptions) {}

  async *stream(request: AnswerRequest, signal?: AbortSignal): AsyncIterable<string> {
    const { options } = this
    const writeFile = options.writeFile ?? ((path, data) => fsWriteFile(path, data))
    let screenshotPath: string | undefined
    if (request.screenshot) {
      const extension = request.screenshot.contentType === 'image/jpeg' ? 'jpg' : 'png'
      screenshotPath = join(options.tempDir ?? tmpdir(), `copilot-${randomUUID()}.${extension}`)
      await writeFile(screenshotPath, Buffer.from(request.screenshot.dataBase64, 'base64'))
    }

    const spawnImpl = options.spawn ?? defaultSpawn
    const child = spawnImpl(
      options.command ?? 'claude',
      buildClaudeCodeArgs({ model: options.model, system: SYSTEM_PROMPT, allowRead: screenshotPath !== undefined }),
    )

    const events: QueueEvent[] = []
    let wake: (() => void) | null = null
    const push = (event: QueueEvent) => {
      events.push(event)
      wake?.()
      wake = null
    }
    let partial = ''
    let stderr = ''
    let closed = false
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
      stderr += chunk.toString()
    })
    child.on('close', (code) => {
      closed = true
      const tail = partial ? parseStreamLine(partial) : null
      if (tail) push(tail)
      push({ type: 'closed', code })
    })
    child.on('error', (error) => push({ type: 'error', message: describe(error) }))
    const onAbort = () => child.kill()
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdin.write(renderPrompt(request, screenshotPath))
    child.stdin.end()

    try {
      while (true) {
        while (events.length === 0) await new Promise<void>((resolve) => (wake = resolve))
        const event = events.shift()!
        if (event.type === 'text') yield event.text
        else if (event.type === 'done') return
        else if (event.type === 'error') throw new Error(`Claude Code failed: ${event.message}`)
        else {
          if (signal?.aborted) return
          if (event.code !== 0) {
            throw new Error(`Claude Code exited with exit code ${event.code}: ${stderr.trim().slice(0, ERROR_SNIPPET_CHARS)}`)
          }
          return
        }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      if (!closed) child.kill()
      if (screenshotPath) await (this.options.removeFile ?? unlink)(screenshotPath).catch(() => undefined)
    }
  }
}
