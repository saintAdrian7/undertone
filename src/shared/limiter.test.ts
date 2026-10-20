import { describe, expect, it } from 'vitest'
import { createLimiter } from './limiter'

const deferred = <T>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('createLimiter', () => {
  it('runs up to the limit concurrently and queues the rest', async () => {
    const limit = createLimiter(2)
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()]
    let running = 0
    let peak = 0
    const task = (i: number) =>
      limit(async () => {
        running++
        peak = Math.max(peak, running)
        await gates[i]!.promise
        running--
        return i
      })
    const all = Promise.all([task(0), task(1), task(2)])
    await Promise.resolve()
    expect(running).toBe(2)
    gates[0]!.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(running).toBe(2)
    gates[1]!.resolve()
    gates[2]!.resolve()
    expect(await all).toEqual([0, 1, 2])
    expect(peak).toBe(2)
  })

  it('releases the slot when a task throws', async () => {
    const limit = createLimiter(1)
    await expect(limit(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await limit(async () => 'ok')).toBe('ok')
  })

  it('reports the number of pending tasks', async () => {
    const limit = createLimiter(1)
    const gate = deferred<void>()
    const first = limit(() => gate.promise)
    const second = limit(async () => 2)
    expect(limit.pending()).toBe(1)
    gate.resolve()
    await first
    await second
    expect(limit.pending()).toBe(0)
  })
})
