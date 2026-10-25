import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadLlmSettings, publicLlmSettings, resolveConfigWith, saveLlmSettings } from './config-store'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'copilot-config-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('llm settings store', () => {
  it('round-trips saved settings and clears them', async () => {
    expect(await loadLlmSettings(dir)).toBeNull()
    await saveLlmSettings(dir, { provider: 'openai', model: 'llama3', baseUrl: 'http://localhost:11434/v1', apiKey: 'k' })
    expect(await loadLlmSettings(dir)).toEqual({ provider: 'openai', model: 'llama3', baseUrl: 'http://localhost:11434/v1', apiKey: 'k' })
    await saveLlmSettings(dir, null)
    expect(await loadLlmSettings(dir)).toBeNull()
  })

  it('never exposes the key to the renderer, only whether one is set', () => {
    expect(publicLlmSettings({ provider: 'anthropic', model: 'm', baseUrl: null, apiKey: 'secret' }, 'settings')).toEqual({
      provider: 'anthropic',
      model: 'm',
      baseUrl: null,
      hasApiKey: true,
      source: 'settings',
    })
    expect(publicLlmSettings(null, 'env')).toBeNull()
  })

  it('lets saved settings override the environment, and falls back to the environment otherwise', () => {
    const env = { LLM_PROVIDER: 'claude-code', LLM_MODEL: 'sonnet' }
    expect(resolveConfigWith(env, null).llm).toEqual({ provider: 'claude-code', apiKey: null, model: 'sonnet', baseUrl: null })
    const saved = { provider: 'openai' as const, model: 'gpt', baseUrl: 'https://api.openai.com/v1', apiKey: 'k' }
    expect(resolveConfigWith(env, saved).llm).toEqual({ provider: 'openai', apiKey: 'k', model: 'gpt', baseUrl: 'https://api.openai.com/v1' })
    expect(resolveConfigWith({}, { provider: 'claude-code', model: 'haiku', baseUrl: null, apiKey: null }).llm?.model).toBe('haiku')
  })
})
