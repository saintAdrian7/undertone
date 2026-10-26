import type { AnswerProvider, AnswerRequest } from '@shared/providers'
import { buildMessages, type ContentBlock } from './prompt'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface OpenAICompatibleOptions {
  /** `/v1` base, e.g. `https://openrouter.ai/api/v1` or `http://localhost:11434/v1`. */
  baseUrl: string
  apiKey: string | null
  model: string
  maxTokens?: number
  fetch?: FetchLike
}

type OpenAIPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

const DEFAULT_MAX_TOKENS = 1024
const ERROR_SNIPPET_CHARS = 300
/** A single SSE line longer than this is not a chat completion chunk; stop reading a misbehaving server. */
const MAX_LINE_CHARS = 1_000_000

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const toParts = (blocks: ContentBlock[]): OpenAIPart[] =>
  blocks.map((block) =>
    block.type === 'text'
      ? { type: 'text', text: block.text }
      : { type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } },
  )

function extractDelta(data: string): string {
  try {
    const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> }
    const content = parsed.choices?.[0]?.delta?.content
    return typeof content === 'string' ? content : ''
  } catch {
    return ''
  }
}

/**
 * Streams chat completions from any OpenAI-compatible server (OpenAI, OpenRouter, Groq, Ollama, LM Studio, vLLM).
 * Uses plain fetch and server-sent events, so no vendor SDK is needed.
 */
export class OpenAICompatibleProvider implements AnswerProvider {
  constructor(private readonly options: OpenAICompatibleOptions) {}

  async *stream(request: AnswerRequest, signal?: AbortSignal): AsyncIterable<string> {
    const { system, messages } = buildMessages(request)
    const fetchImpl = this.options.fetch ?? globalThis.fetch
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.options.apiKey) headers.Authorization = `Bearer ${this.options.apiKey}`
    const body = JSON.stringify({
      model: this.options.model,
      stream: true,
      max_tokens: this.options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: toParts(m.content) }))],
    })

    let response: Response
    try {
      response = await fetchImpl(`${this.options.baseUrl}/chat/completions`, { method: 'POST', headers, body, signal })
    } catch (error) {
      throw new Error(`LLM request failed: ${describe(error)}`)
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, ERROR_SNIPPET_CHARS)
      throw new Error(`LLM request failed: HTTP ${response.status} ${detail}`.trim())
    }
    if (!response.body) throw new Error('LLM request failed: empty response body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        if (buffer.length > MAX_LINE_CHARS) throw new Error('LLM response line too long; stopped reading')
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') return
          const text = extractDelta(data)
          if (text) yield text
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}
