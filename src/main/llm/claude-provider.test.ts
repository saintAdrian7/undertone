import { describe, expect, it, vi } from 'vitest'
import { ClaudeAnswerProvider, type MessageStreamClient } from './claude-provider'

async function* fakeStream(events: unknown[]) {
  for (const e of events) yield e
}

const collect = async (iter: AsyncIterable<string>) => {
  const out: string[] = []
  for await (const chunk of iter) out.push(chunk)
  return out
}

describe('ClaudeAnswerProvider', () => {
  it('yields only text deltas from the message stream', async () => {
    const stream = vi.fn(() =>
      fakeStream([
        { type: 'message_start' },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } },
        { type: 'message_stop' },
      ]),
    )
    const client: MessageStreamClient = { messages: { stream } }
    const provider = new ClaudeAnswerProvider({ client, model: 'claude-test' })
    expect(await collect(provider.stream({ question: 'hi', transcript: [] }))).toEqual(['Hel', 'lo'])
  })

  it('passes the model, system prompt and messages to the client', async () => {
    const stream = vi.fn<MessageStreamClient['messages']['stream']>(() => fakeStream([]))
    const provider = new ClaudeAnswerProvider({ client: { messages: { stream } }, model: 'claude-test', maxTokens: 123 })
    await collect(provider.stream({ question: 'hi', transcript: [] }))
    expect(stream).toHaveBeenCalledTimes(1)
    const params = stream.mock.calls[0]?.[0]
    expect(params).toMatchObject({ model: 'claude-test', max_tokens: 123 })
    expect(typeof params?.system).toBe('string')
    expect(params?.messages).toHaveLength(1)
  })

  it('passes an abort signal through to the SDK', async () => {
    const stream = vi.fn<MessageStreamClient['messages']['stream']>(() => fakeStream([]))
    const provider = new ClaudeAnswerProvider({ client: { messages: { stream } }, model: 'claude-test' })
    const controller = new AbortController()
    await collect(provider.stream({ question: 'hi', transcript: [] }, controller.signal))
    expect(stream.mock.calls[0]?.[1]).toEqual({ signal: controller.signal })
  })

  it('wraps client failures in a readable error', async () => {
    const stream = vi.fn(() => {
      throw new Error('401 invalid x-api-key')
    })
    const provider = new ClaudeAnswerProvider({ client: { messages: { stream } }, model: 'claude-test' })
    await expect(collect(provider.stream({ question: 'hi', transcript: [] }))).rejects.toThrow(/Claude request failed: 401/)
  })
})
