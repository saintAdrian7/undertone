import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { TranscriptEntry } from '@shared/state'
import { ClaudeCodeProvider, type ChildLike, type SpawnLike } from './claude-code-provider'

const delta = (text: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } }) + '\n'
const done = JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n'
const entry = (id: string, role: 'me' | 'them', text: string): TranscriptEntry => ({
  id,
  role,
  createdAt: '2026-10-19T10:00:00.000Z',
  relativeMs: 0,
  status: 'done',
  text,
})

class FakeChild extends EventEmitter implements ChildLike {
  stdout = new PassThrough()
  stderr = new PassThrough()
  lines: string[] = []
  stdin = {
    write: (text: string) => {
      this.lines.push(text)
      this.onLine?.(text)
    },
    end: () => undefined,
  }
  onLine: ((line: string) => void) | null = null
  kill = vi.fn(() => {
    this.emit('close', null)
    return true
  })
}

/** Each spawned child answers every user line with the given script. */
function setup(answer: (child: FakeChild, line: string) => void) {
  const children: FakeChild[] = []
  const spawn = vi.fn<SpawnLike>(() => {
    const child = new FakeChild()
    child.onLine = (line) => setTimeout(() => answer(child, line), 0)
    children.push(child)
    return child
  })
  const provider = new ClaudeCodeProvider({ command: 'claude', model: 'sonnet', spawn })
  return { provider, spawn, children }
}

const collect = async (iter: AsyncIterable<string>) => {
  const out: string[] = []
  for await (const part of iter) out.push(part)
  return out
}

const reply = (text: string) => (child: FakeChild) => {
  child.stdout.write(delta(text))
  child.stdout.write(done)
}

describe('ClaudeCodeProvider', () => {
  it('keeps one CLI process across asks and sends each question as a stream-json user line', async () => {
    const { provider, spawn, children } = setup(reply('ok'))
    expect(await collect(provider.stream({ question: 'first', transcript: [] }))).toEqual(['ok'])
    expect(await collect(provider.stream({ question: 'second', transcript: [] }))).toEqual(['ok'])
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith('claude', expect.arrayContaining(['-p', '--input-format', 'stream-json', '--model', 'sonnet']))
    const lines = children[0]!.lines.map((l) => JSON.parse(l))
    expect(lines).toHaveLength(2)
    expect(lines[0].message.content[0].text).toContain('first')
    expect(lines[1].message.content[0].text).toContain('second')
  })

  it('sends only transcript lines the session has not seen yet', async () => {
    const { provider, children } = setup(reply('ok'))
    await collect(provider.stream({ question: 'q1', transcript: [entry('a', 'them', 'Why this role?')] }))
    await collect(provider.stream({ question: 'q2', transcript: [entry('a', 'them', 'Why this role?'), entry('b', 'them', 'Tell me more.')] }))
    const second = JSON.parse(children[0]!.lines[1]!).message.content[0].text as string
    expect(second).toContain('Tell me more.')
    expect(second).not.toContain('Why this role?')
  })

  it('inlines the screenshot as an image block', async () => {
    const { provider, children } = setup(reply('ok'))
    await collect(provider.stream({ question: 'q', transcript: [], screenshot: { dataBase64: 'QUJD', contentType: 'image/png' } }))
    const content = JSON.parse(children[0]!.lines[0]!).message.content
    expect(content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } })
  })

  it('surfaces an error result and keeps the session for the next ask', async () => {
    let calls = 0
    const { provider, spawn } = setup((child) => {
      calls++
      if (calls === 1) child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'not logged in' }) + '\n')
      else reply('fine')(child)
    })
    await expect(collect(provider.stream({ question: 'q', transcript: [] }))).rejects.toThrow(/not logged in/)
    expect(await collect(provider.stream({ question: 'q', transcript: [] }))).toEqual(['fine'])
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('reports a crash with stderr and respawns on the next ask with the full transcript', async () => {
    let calls = 0
    const { provider, spawn, children } = setup((child) => {
      calls++
      if (calls === 1) {
        child.stderr.write('boom')
        child.emit('close', 2)
      } else reply('back')(child)
    })
    await expect(collect(provider.stream({ question: 'q', transcript: [entry('a', 'them', 'Hi')] }))).rejects.toThrow(/exit code 2.*boom/)
    expect(await collect(provider.stream({ question: 'q', transcript: [entry('a', 'them', 'Hi')] }))).toEqual(['back'])
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(JSON.parse(children[1]!.lines[0]!).message.content[0].text).toContain('Hi')
  })

  it('kills the process when aborted and respawns later', async () => {
    const controller = new AbortController()
    const { provider, spawn, children } = setup((child, line) => {
      if (JSON.parse(line).message.content[0].text.includes('slow')) {
        child.stdout.write(delta('a'))
        setTimeout(() => controller.abort(), 0)
      } else reply('ok')(child)
    })
    expect(await collect(provider.stream({ question: 'slow', transcript: [] }, controller.signal))).toEqual(['a'])
    expect(children[0]!.kill).toHaveBeenCalled()
    expect(await collect(provider.stream({ question: 'next', transcript: [] }))).toEqual(['ok'])
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('warm starts the process early so the first ask reuses it, and restarts it when the profile changes', async () => {
    const { provider, spawn, children } = setup(reply('ok'))
    provider.warm('CV text')
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0]![1].join(' ')).toContain('CV text')
    expect(await collect(provider.stream({ question: 'q', transcript: [], profile: 'CV text' }))).toEqual(['ok'])
    expect(spawn).toHaveBeenCalledTimes(1)
    provider.warm('New CV')
    expect(children[0]!.kill).toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledTimes(2)
    provider.warm('New CV')
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('starts the CLI in the given working directory', async () => {
    const children: FakeChild[] = []
    const spawn = vi.fn<SpawnLike>(() => {
      const child = new FakeChild()
      child.onLine = () => setTimeout(() => reply('ok')(child), 0)
      children.push(child)
      return child
    })
    const provider = new ClaudeCodeProvider({ command: 'claude', model: 'sonnet', spawn, cwd: 'C:\\cwd' })
    await collect(provider.stream({ question: 'q', transcript: [] }))
    expect(spawn).toHaveBeenCalledWith('claude', expect.any(Array), { cwd: 'C:\\cwd' })
  })

  it('fails closed when the CLI reports tools or MCP servers at start-up', async () => {
    const { provider, children } = setup((child) => {
      child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', tools: ['Bash'], mcp_servers: [] }) + '\n')
    })
    await expect(collect(provider.stream({ question: 'q', transcript: [] }))).rejects.toThrow(/tools/i)
    expect(children[0]!.kill).toHaveBeenCalled()
  })

  it('gives up on a line that never ends instead of buffering it forever', async () => {
    const { provider, children } = setup((child) => {
      child.stdout.write('x'.repeat(1_100_000))
    })
    await expect(collect(provider.stream({ question: 'q', transcript: [] }))).rejects.toThrow(/too long/i)
    expect(children[0]!.kill).toHaveBeenCalled()
  })

  it('dispose kills a live process', async () => {
    const { provider, children } = setup(reply('ok'))
    await collect(provider.stream({ question: 'q', transcript: [] }))
    await provider.dispose()
    expect(children[0]!.kill).toHaveBeenCalled()
  })
})
