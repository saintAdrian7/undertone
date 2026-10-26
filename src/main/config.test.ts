import { describe, expect, it } from 'vitest'
import { parseEnv, resolveConfig, DEFAULT_CLAUDE_MODEL } from './config'

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
  it('uses defaults when only the key is set', () => {
    const config = resolveConfig({ ANTHROPIC_API_KEY: 'sk-test' })
    expect(config).toEqual({ anthropicApiKey: 'sk-test', claudeModel: DEFAULT_CLAUDE_MODEL })
  })

  it('treats a missing or blank key as absent', () => {
    expect(resolveConfig({}).anthropicApiKey).toBeNull()
    expect(resolveConfig({ ANTHROPIC_API_KEY: '  ' }).anthropicApiKey).toBeNull()
  })

  it('honours the model override', () => {
    expect(resolveConfig({ ANTHROPIC_MODEL: 'claude-custom' }).claudeModel).toBe('claude-custom')
  })
})
