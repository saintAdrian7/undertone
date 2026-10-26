import { describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider, type FetchLike } from './openai-compatible-provider'

const sse = (lines: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(new TextEncoder().encode(line))
      controller.close()
    },
  })

const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

const collect = async (iter: AsyncIterable<string>) => {
  const out: string[] = []
  for await (const part of iter) out.push(part)
  return out
}

function setup(body: ReadableStream<Uint8Array> | null = sse([chunk('Hel'), chunk('lo'), 'data: [DONE]\n\n']), status = 200) {
  const fetch = vi.fn<FetchLike>(async () => new Response(body, { status, headers: { 'content-type': 'text/event-stream' } }))
  const provider = new OpenAICompatibleProvider({ fetch, baseUrl: 'https://example.test/v1', apiKey: 'key-1', model: 'free-model' })
  return { fetch, provider }
}

describe('OpenAICompatibleProvider', () => {
  it('yields streamed content deltas and stops at [DONE]', async () => {
    const { provider } = setup()
    expect(await collect(provider.stream({ question: 'hi', transcript: [] }))).toEqual(['Hel', 'lo'])
  })

  it('handles chunks split across reads', async () => {
    const full = chunk('Split')
    const { provider } = setup(sse([full.slice(0, 10), full.slice(10), chunk('!'), 'data: [DONE]\n\n']))
    expect(await collect(provider.stream({ question: 'hi', transcript: [] }))).toEqual(['Split', '!'])
  })

  it('posts a chat completion with the system prompt, an image part and streaming enabled', async () => {
    const { provider, fetch } = setup()
    const controller = new AbortController()
    await collect(
      provider.stream(
        { question: 'what is on screen?', transcript: [], screenshot: { dataBase64: 'QUJD', contentType: 'image/png' } },
        controller.signal,
      ),
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://example.test/v1/chat/completions')
    expect(init?.method).toBe('POST')
    expect(init?.signal).toBe(controller.signal)
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer key-1')
    const body = JSON.parse(String(init?.body)) as { model: string; stream: boolean; messages: Array<{ role: string; content: unknown }> }
    expect(body.model).toBe('free-model')
    expect(body.stream).toBe(true)
    expect(body.messages[0]?.role).toBe('system')
    const user = body.messages[1]?.content as Array<{ type: string; image_url?: { url: string }; text?: string }>
    expect(user.some((part) => part.type === 'image_url' && part.image_url?.url === 'data:image/png;base64,QUJD')).toBe(true)
    expect(user.some((part) => part.type === 'text' && part.text?.includes('what is on screen?'))).toBe(true)
  })

  it('uses a fixed system prompt when one is configured', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(sse(['data: [DONE]\n\n']), { status: 200 }))
    const provider = new OpenAICompatibleProvider({ fetch, baseUrl: 'https://example.test/v1', apiKey: null, model: 'm', system: 'JUDGE RULES' })
    await collect(provider.stream({ question: 'hi', transcript: [], profile: 'CV text' }))
    const body = JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'JUDGE RULES' })
  })

  it('omits the Authorization header when there is no key', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(sse(['data: [DONE]\n\n']), { status: 200 }))
    const provider = new OpenAICompatibleProvider({ fetch, baseUrl: 'http://localhost:11434/v1', apiKey: null, model: 'llama3.2' })
    await collect(provider.stream({ question: 'hi', transcript: [] }))
    expect((fetch.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('reports HTTP failures with the status and the server message', async () => {
    const errorBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":"model not found"}'))
        controller.close()
      },
    })
    const { provider } = setup(errorBody, 404)
    await expect(collect(provider.stream({ question: 'hi', transcript: [] }))).rejects.toThrow(/404.*model not found/)
  })
})
