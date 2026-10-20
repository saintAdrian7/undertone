export interface Limiter {
  <T>(task: () => Promise<T>): Promise<T>
  /** Number of tasks waiting for a slot. */
  pending(): number
}

/** Runs at most `max` tasks at once; further tasks wait in FIFO order. */
export function createLimiter(max: number): Limiter {
  let active = 0
  const queue: Array<() => void> = []

  const release = () => {
    active--
    const next = queue.shift()
    if (next) next()
  }

  const limit = <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++
        let result: Promise<T>
        try {
          result = Promise.resolve(task())
        } catch (error) {
          result = Promise.reject(error)
        }
        result.then(
          (value) => {
            release()
            resolve(value)
          },
          (error: unknown) => {
            release()
            reject(error)
          },
        )
      }
      if (active < max) run()
      else queue.push(run)
    })

  limit.pending = () => queue.length
  return limit
}
