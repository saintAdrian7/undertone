import type { AnswerProvider, AnswerRequest } from '@shared/providers'
import { buildMessages, type UserMessage } from './prompt'

export interface MessageStreamParams {
  model: string
  max_tokens: number
  system: string
  messages: UserMessage[]
}

/** The slice of the Anthropic SDK client this provider uses, so tests can inject a fake. */
export interface MessageStreamClient {
  messages: {
    stream(params: MessageStreamParams, options?: { signal?: AbortSignal }): AsyncIterable<unknown>
  }
}

export interface ClaudeProviderOptions {
  client: MessageStreamClient
  model: string
  maxTokens?: number
  /** A fixed system prompt (for the judge); otherwise the coaching prompt with the user's profile. */
  system?: string
}

const DEFAULT_MAX_TOKENS = 1024

interface TextDeltaEvent {
  type: 'content_block_delta'
  delta: { type: 'text_delta'; text: string }
}

function isTextDelta(event: unknown): event is TextDeltaEvent {
  if (typeof event !== 'object' || event === null) return false
  const e = event as { type?: unknown; delta?: { type?: unknown; text?: unknown } }
  return e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && typeof e.delta.text === 'string'
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class ClaudeAnswerProvider implements AnswerProvider {
  constructor(private readonly options: ClaudeProviderOptions) {}

  async *stream(request: AnswerRequest, signal?: AbortSignal): AsyncIterable<string> {
    const built = buildMessages(request)
    const { messages } = built
    const system = this.options.system ?? built.system
    let events: AsyncIterable<unknown>
    try {
      events = this.options.client.messages.stream(
        { model: this.options.model, max_tokens: this.options.maxTokens ?? DEFAULT_MAX_TOKENS, system, messages },
        { signal },
      )
    } catch (error) {
      throw new Error(`Claude request failed: ${describe(error)}`)
    }
    try {
      for await (const event of events) {
        if (isTextDelta(event)) yield event.delta.text
      }
    } catch (error) {
      throw new Error(`Claude request failed: ${describe(error)}`)
    }
  }
}
