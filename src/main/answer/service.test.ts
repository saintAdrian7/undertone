import { describe, expect, it, vi } from 'vitest'
import { defaultState, type AppState } from '@shared/state'
import { IPC } from '@shared/ipc'
import type { AnswerProvider } from '@shared/providers'
import { createAnswerService, type AnswerServiceDeps } from './service'

async function* chunks(parts: string[], signal?: AbortSignal) {
  for (const part of parts) {
    if (signal?.aborted) return
    await Promise.resolve()
    yield part
  }
}

function setup(overrides: Partial<AnswerServiceDeps> & { state?: Partial<AppState>; parts?: string[] } = {}) {
  const sent: Array<[string, unknown]> = []
  const state = { ...defaultState(), ...overrides.state }
  const provider: AnswerProvider = {
    stream: vi.fn((_request, signal) => chunks(overrides.parts ?? ['Hel', 'lo'], signal)),
  }
  const deps: AnswerServiceDeps = {
    provider,
    getState: () => state,
    capture: vi.fn(async () => ({ dataBase64: 'QUJD', contentType: 'image/png' as const })),
    log: { warn: vi.fn() },
    ...overrides,
  }
  const service = createAnswerService(deps)
  const send = (channel: string, payload: unknown) => sent.push([channel, payload])
  return { service, deps, sent, send, provider }
}

describe('createAnswerService', () => {
  it('streams chunks then done, attaching a screenshot when screen use is required', async () => {
    const { service, sent, send, deps, provider } = setup()
    await service.ask({ requestId: 'r1', question: 'hi' }, send)
    expect(deps.capture).toHaveBeenCalledTimes(1)
    expect(sent).toEqual([
      [IPC.answerStarted, { requestId: 'r1', screenshotAttached: true }],
      [IPC.answerChunk, { requestId: 'r1', text: 'Hel' }],
      [IPC.answerChunk, { requestId: 'r1', text: 'lo' }],
      [IPC.answerDone, { requestId: 'r1' }],
    ])
    const request = (provider.stream as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(request.screenshot).toEqual({ dataBase64: 'QUJD', contentType: 'image/png' })
  })

  it('skips the screenshot when screen use is off', async () => {
    const { service, sent, send, deps } = setup({ state: { screenUse: 'off' } })
    await service.ask({ requestId: 'r1', question: 'hi' }, send)
    expect(deps.capture).not.toHaveBeenCalled()
    expect(sent[0]).toEqual([IPC.answerStarted, { requestId: 'r1', screenshotAttached: false }])
  })

  it('answers without a screenshot when capture fails', async () => {
    const { service, sent, send, deps } = setup({
      capture: vi.fn(async () => {
        throw new Error('no display')
      }),
    })
    await service.ask({ requestId: 'r1', question: 'hi' }, send)
    expect(deps.log.warn).toHaveBeenCalled()
    expect(sent.at(-1)).toEqual([IPC.answerDone, { requestId: 'r1' }])
  })

  it('reports an error when no provider is configured', async () => {
    const { service, sent, send } = setup({ provider: null })
    await service.ask({ requestId: 'r1', question: 'hi' }, send)
    expect(sent).toEqual([[IPC.answerError, { requestId: 'r1', message: expect.stringContaining('ANTHROPIC_API_KEY') }]])
  })

  it('forwards provider failures as an error event', async () => {
    const provider: AnswerProvider = {
      stream: () => {
        throw new Error('Claude request failed: 401')
      },
    }
    const { service, sent, send } = setup({ provider, state: { screenUse: 'off' } })
    await service.ask({ requestId: 'r1', question: 'hi' }, send)
    expect(sent.at(-1)).toEqual([IPC.answerError, { requestId: 'r1', message: 'Claude request failed: 401' }])
  })

  it('aborts the previous request when a new one starts and never sends its done event', async () => {
    const { service, sent, send } = setup({ state: { screenUse: 'off' }, parts: ['a', 'b', 'c'] })
    const first = service.ask({ requestId: 'r1', question: 'one' }, send)
    const second = service.ask({ requestId: 'r2', question: 'two' }, send)
    await Promise.all([first, second])
    const doneFor = (id: string) =>
      sent.some(([channel, payload]) => channel === IPC.answerDone && (payload as { requestId: string }).requestId === id)
    expect(doneFor('r1')).toBe(false)
    expect(sent.at(-1)).toEqual([IPC.answerDone, { requestId: 'r2' }])
  })

  it('cancel stops the in-flight request', async () => {
    const { service, sent, send } = setup({ state: { screenUse: 'off' }, parts: ['a', 'b', 'c', 'd'] })
    const asking = service.ask({ requestId: 'r1', question: 'one' }, send)
    service.cancel('r1')
    await asking
    expect(sent.filter(([channel]) => channel === IPC.answerDone)).toEqual([])
    expect(service.inFlightId()).toBeNull()
  })
})
