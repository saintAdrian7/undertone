import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { BrowserLocator, LOCATOR_SCRIPT, encodeCommand, powershellPathFor, type LocatorChild, type LocatorSpawn } from './browser-locator'

class FakeHelper extends EventEmitter implements LocatorChild {
  stdout = new PassThrough()
  stderr = new PassThrough()
  requests: string[] = []
  stdin = {
    write: (text: string) => {
      this.requests.push(text)
      return true
    },
  }
  kill = vi.fn(() => {
    this.emit('close', null)
    return true
  })
  reply(payload: unknown) {
    this.stdout.write(`${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n`)
  }
}

const display = { x: 0, y: 0, width: 1920, height: 1080 }

function setup(timeoutMs = 200) {
  const helpers: FakeHelper[] = []
  const spawn = vi.fn<LocatorSpawn>(() => {
    const helper = new FakeHelper()
    helpers.push(helper)
    return helper
  })
  const locator = new BrowserLocator({ command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ownPid: 4242, spawn, timeoutMs })
  return { locator, spawn, helpers }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('BrowserLocator', () => {
  it('starts one hidden PowerShell helper with the script passed as an encoded command, never through a shell', () => {
    const { locator, spawn } = setup()
    locator.start()
    locator.start()
    expect(spawn).toHaveBeenCalledTimes(1)
    const [command, args] = spawn.mock.calls[0]!
    expect(command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(args).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodeCommand(LOCATOR_SCRIPT)])
    expect(Buffer.from(args.at(-1)!, 'base64').toString('utf16le')).toBe(LOCATOR_SCRIPT)
  })

  it('asks for the page under the given display, skipping our own windows, and returns where it starts', async () => {
    const { locator, helpers } = setup()
    const top = locator.pageTop(display)
    await tick()
    expect(helpers[0]!.requests).toEqual(['1 4242 0 0 1920 1080\n'])
    helpers[0]!.reply({ id: 1, top: 182 })
    await expect(top).resolves.toBe(182)
  })

  it('returns null when the window in front is not a browser', async () => {
    const { locator, helpers } = setup()
    const top = locator.pageTop(display)
    await tick()
    helpers[0]!.reply({ id: 1, top: null })
    await expect(top).resolves.toBeNull()
  })

  it('keeps one helper for every lookup and asks one question at a time', async () => {
    const { locator, spawn, helpers } = setup()
    const first = locator.pageTop(display)
    const second = locator.pageTop({ x: 1920, y: 0, width: 2560, height: 1440 })
    await tick()
    expect(helpers[0]!.requests).toHaveLength(1)
    helpers[0]!.reply({ id: 1, top: 131 })
    await expect(first).resolves.toBe(131)
    await tick()
    expect(helpers[0]!.requests[1]).toBe('2 4242 1920 0 2560 1440\n')
    helpers[0]!.reply({ id: 2, top: 122 })
    await expect(second).resolves.toBe(122)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('gives up after its deadline, and a late answer never answers the next question', async () => {
    const { locator, helpers } = setup(20)
    await expect(locator.pageTop(display)).resolves.toBeNull()
    const next = locator.pageTop(display)
    await tick()
    helpers[0]!.reply({ id: 1, top: 999 })
    helpers[0]!.reply({ id: 2, top: 182 })
    await expect(next).resolves.toBe(182)
  })

  it('skips lines that are not answers', async () => {
    const { locator, helpers } = setup()
    const top = locator.pageTop(display)
    await tick()
    helpers[0]!.reply('Add-Type: warning')
    helpers[0]!.reply({ id: 1, top: 182 })
    await expect(top).resolves.toBe(182)
  })

  it('answers null when the helper exits, and starts a fresh one for the next lookup', async () => {
    const { locator, spawn, helpers } = setup()
    const top = locator.pageTop(display)
    await tick()
    helpers[0]!.emit('close', 1)
    await expect(top).resolves.toBeNull()
    const again = locator.pageTop(display)
    await tick()
    expect(spawn).toHaveBeenCalledTimes(2)
    helpers[1]!.reply({ id: 2, top: 182 })
    await expect(again).resolves.toBe(182)
  })

  it('answers null when the helper cannot be started at all', async () => {
    const locator = new BrowserLocator({
      command: 'powershell.exe',
      ownPid: 1,
      spawn: () => {
        throw new Error('ENOENT')
      },
    })
    await expect(locator.pageTop(display)).resolves.toBeNull()
  })

  it('stops the helper on dispose and answers null afterwards without starting another', async () => {
    const { locator, spawn, helpers } = setup()
    locator.start()
    locator.dispose()
    expect(helpers[0]!.kill).toHaveBeenCalledTimes(1)
    await expect(locator.pageTop(display)).resolves.toBeNull()
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})

describe('powershellPathFor', () => {
  it('uses Windows PowerShell from the system folder, not whatever is first on PATH', () => {
    expect(powershellPathFor({ SystemRoot: 'D:\\Win' })).toBe('D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(powershellPathFor({})).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  })
})
