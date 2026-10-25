import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { ClaudeCodeProvider, type ChildLike, type SpawnLike } from './claude-code-provider'

const delta = (text: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } }) + '\n'
const done = JSON.stringify({ type: 'result', subtype: 'success', is_error: false }) + '\n'

class FakeChild extends EventEmitter implements ChildLike {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdinText = ''
  stdin = {
    write: (text: string) => {
      this.stdinText += text
    },
    end: () => undefined,
  }
  kill = vi.fn(() => {
    this.emit('close', null)
    return true
  })
}

function setup(script: (child: FakeChild) => void) {
  const children: FakeChild[] = []
  const spawn = vi.fn<SpawnLike>((_command, _args) => {
    const child = new FakeChild()
    children.push(child)
    setTimeout(() => script(child), 0)
    return child
  })
  const files: Record<string, Uint8Array> = {}
  const provider = new ClaudeCodeProvider({
    command: 'claude',
    model: 'sonnet',
    spawn,
    tempDir: 'C:\\tmp',
    writeFile: vi.fn(async (path: string, data: Uint8Array) => {
      files[path] = data
    }),
    removeFile: vi.fn(async (path: string) => {
      delete files[path]
    }),
  })
  return { provider, spawn, children, files }
}

const collect = async (iter: AsyncIterable<string>) => {
  const out: string[] = []
  for await (const part of iter) out.push(part)
  return out
}

describe('ClaudeCodeProvider', () => {
  it('spawns the CLI, pipes the prompt on stdin and yields streamed text', async () => {
    const { provider, spawn, children } = setup((child) => {
      child.stdout.write(delta('Hel'))
      child.stdout.write(delta('lo'))
      child.stdout.write(done)
      child.stdout.end()
      child.emit('close', 0)
    })
    const parts = await collect(provider.stream({ question: 'What next?', transcript: [] }))
    expect(parts).toEqual(['Hel', 'lo'])
    expect(spawn).toHaveBeenCalledWith('claude', expect.arrayContaining(['-p', '--model', 'sonnet']))
    expect(children[0]?.stdinText).toContain('What next?')
  })

  it('saves the screenshot to a temp file, allows Read, mentions the path and cleans up', async () => {
    const { provider, spawn, children, files } = setup((child) => {
      child.stdout.write(done)
      child.stdout.end()
      child.emit('close', 0)
    })
    const removed: string[] = []
    const prov = provider as unknown as { options: { removeFile: (p: string) => Promise<void> } }
    const original = prov.options.removeFile
    prov.options.removeFile = async (p) => {
      removed.push(p)
      await original(p)
    }
    await collect(provider.stream({ question: 'q', transcript: [], screenshot: { dataBase64: 'QUJD', contentType: 'image/png' } }))
    const args = spawn.mock.calls[0]?.[1] ?? []
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', 'Read'])
    expect(removed).toHaveLength(1)
    expect(removed[0]).toMatch(/^C:\\tmp\\.*\.png$/)
    expect(children[0]?.stdinText).toContain(removed[0])
    expect(Object.keys(files)).toHaveLength(0)
  })

  it('surfaces an error result from the CLI', async () => {
    const { provider } = setup((child) => {
      child.stdout.write(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'not logged in' }) + '\n')
      child.stdout.end()
      child.emit('close', 1)
    })
    await expect(collect(provider.stream({ question: 'q', transcript: [] }))).rejects.toThrow(/not logged in/)
  })

  it('reports a crash with the stderr output when no result arrives', async () => {
    const { provider } = setup((child) => {
      child.stderr.write('claude: command failed badly')
      child.stdout.end()
      child.emit('close', 2)
    })
    await expect(collect(provider.stream({ question: 'q', transcript: [] }))).rejects.toThrow(/exit code 2.*command failed badly/)
  })

  it('kills the CLI when the request is aborted', async () => {
    const controller = new AbortController()
    const { provider, children } = setup((child) => {
      child.stdout.write(delta('a'))
      setTimeout(() => controller.abort(), 0)
    })
    const parts = await collect(provider.stream({ question: 'q', transcript: [] }, controller.signal))
    expect(parts).toEqual(['a'])
    expect(children[0]?.kill).toHaveBeenCalled()
  })
})
