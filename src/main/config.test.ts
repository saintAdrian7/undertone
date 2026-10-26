import { describe, expect, it } from 'vitest'
import { parseEnv, resolveConfig, DEFAULT_CLAUDE_MODEL, DEFAULT_OPENAI_BASE_URL, DEFAULT_OLLAMA_BASE_URL } from './config'

describe('parseEnv', () => {
  it('parses KEY=VALUE lines and ignores comments, blanks and malformed lines', () => {
    const text = ['# comment', '', 'A=1', 'B="two words"', "C='x'", 'D = spaced ', 'INVALID', 'E=has=equals'].join('\n')
    expect(parseEnv(text)).toEqual({ A: '1', B: 'two words', C: 'x', D: 'spaced', E: 'has=equals' })
  })

  it('handles Windows line endings', () => {
    expect(parseEnv('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' })
  })
})

describe('resolveConfig', () => {
  it('selects Claude when only an Anthropic key is set', () => {
    expect(resolveConfig({ ANTHROPIC_API_KEY: 'sk-test' }).llm).toEqual({
      provider: 'anthropic',
      apiKey: 'sk-test',
      model: DEFAULT_CLAUDE_MODEL,
      baseUrl: null,
    })
  })

  it('honours the Anthropic model override', () => {
    expect(resolveConfig({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-custom' }).llm?.model).toBe('claude-custom')
  })

  it('has no provider when nothing is configured or the key is blank', () => {
    expect(resolveConfig({}).llm).toBeNull()
    expect(resolveConfig({ ANTHROPIC_API_KEY: '  ' }).llm).toBeNull()
  })

  it('selects an OpenAI-compatible endpoint with its own key, model and base URL', () => {
    expect(
      resolveConfig({
        LLM_PROVIDER: 'openai',
        LLM_API_KEY: 'or-key',
        LLM_MODEL: 'meta-llama/llama-3.3-70b-instruct:free',
        LLM_BASE_URL: 'https://openrouter.ai/api/v1/',
      }).llm,
    ).toEqual({
      provider: 'openai',
      apiKey: 'or-key',
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      baseUrl: 'https://openrouter.ai/api/v1',
    })
  })

  it('defaults the OpenAI base URL and requires a model', () => {
    expect(resolveConfig({ LLM_PROVIDER: 'openai', LLM_API_KEY: 'k', LLM_MODEL: 'gpt-4o-mini' }).llm?.baseUrl).toBe(DEFAULT_OPENAI_BASE_URL)
    expect(resolveConfig({ LLM_PROVIDER: 'openai', LLM_API_KEY: 'k' }).llm).toBeNull()
  })

  it('treats ollama as a local OpenAI-compatible endpoint that needs no key', () => {
    expect(resolveConfig({ LLM_PROVIDER: 'ollama', LLM_MODEL: 'llama3.2' }).llm).toEqual({
      provider: 'openai',
      apiKey: null,
      model: 'llama3.2',
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
    })
  })

  it('lets LLM_PROVIDER=anthropic use the generic key and model variables', () => {
    expect(resolveConfig({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k2', LLM_MODEL: 'claude-x' }).llm).toEqual({
      provider: 'anthropic',
      apiKey: 'k2',
      model: 'claude-x',
      baseUrl: null,
    })
  })

  it('rejects an unknown provider', () => {
    expect(() => resolveConfig({ LLM_PROVIDER: 'bard', LLM_MODEL: 'x' })).toThrow(/LLM_PROVIDER/)
  })
})
