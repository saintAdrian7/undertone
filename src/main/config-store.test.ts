import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { loadLlmSettings, mergeApiKey, publicLlmSettings, resolveConfigWith, saveLlmSettings, type KeyCipher } from './config-store'

/** A stand-in for Electron's safeStorage: reversible, and obviously not the plain text. */
const cipher: KeyCipher = {
  available: () => true,
  encrypt: (text) => Buffer.from(text, 'utf8').reverse(),
  decrypt: (data) => Buffer.from(data).reverse().toString('utf8'),
}

describe('encrypted key storage', () => {
  it('writes the key encrypted and reads it back', async () => {
    await saveLlmSettings(dir, { provider: 'anthropic', model: 'm', baseUrl: null, apiKey: 'sk-secret' }, cipher)
    const raw = await readFile(join(dir, 'llm.json'), 'utf8')
    expect(raw).not.toContain('sk-secret')
    expect(JSON.parse(raw).apiKeyEnc).toBeTruthy()
    expect((await loadLlmSettings(dir, cipher))?.apiKey).toBe('sk-secret')
  })

  it('migrates a plain-text key written by an older version', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'llm.json'), JSON.stringify({ provider: 'anthropic', model: 'm', baseUrl: null, apiKey: 'plain' }), 'utf8')
    expect((await loadLlmSettings(dir, cipher))?.apiKey).toBe('plain')
  })

  it('falls back to plain text only when no cipher is available', async () => {
    const none: KeyCipher = { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => '' }
    await saveLlmSettings(dir, { provider: 'anthropic', model: 'm', baseUrl: null, apiKey: 'k' }, none)
    expect(JSON.parse(await readFile(join(dir, 'llm.json'), 'utf8')).apiKey).toBe('k')
  })
})

describe('a second settings file for the background model', () => {
  it('lives beside the main one without touching it', async () => {
    await saveLlmSettings(dir, { provider: 'claude-code', model: 'sonnet', baseUrl: null, apiKey: null })
    await saveLlmSettings(dir, { provider: 'claude-code', model: 'haiku', baseUrl: null, apiKey: null }, undefined, 'llm-background.json')
    expect((await loadLlmSettings(dir))?.model).toBe('sonnet')
    expect((await loadLlmSettings(dir, undefined, 'llm-background.json'))?.model).toBe('haiku')
    await saveLlmSettings(dir, null, undefined, 'llm-background.json')
    expect(await loadLlmSettings(dir, undefined, 'llm-background.json')).toBeNull()
    expect((await loadLlmSettings(dir))?.model).toBe('sonnet')
  })
})

describe('mergeApiKey', () => {
  const saved = { provider: 'openai' as const, model: 'm', baseUrl: 'https://api.openai.com/v1', apiKey: 'stored' }
  it('reuses the stored key only for the same provider and base url', () => {
    expect(mergeApiKey(saved, { provider: 'openai', model: 'x', baseUrl: 'https://api.openai.com/v1/' })).toBe('stored')
    expect(mergeApiKey(saved, { provider: 'openai', model: 'x', baseUrl: 'https://attacker.example/v1' })).toBeNull()
    expect(mergeApiKey(saved, { provider: 'anthropic', model: 'x', baseUrl: null })).toBeNull()
    expect(mergeApiKey(saved, { provider: 'openai', model: 'x', baseUrl: 'https://api.openai.com/v1', apiKey: 'new' })).toBe('new')
    expect(mergeApiKey(null, { provider: 'openai', model: 'x', baseUrl: 'https://api.openai.com/v1' })).toBeNull()
  })
})

describe('resolveConfigWith validation', () => {
  it('rejects a plaintext remote base url from saved settings', () => {
    expect(() => resolveConfigWith({}, { provider: 'openai', model: 'm', baseUrl: 'http://proxy.example/v1', apiKey: 'k' })).toThrow(/https/i)
  })
})

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
