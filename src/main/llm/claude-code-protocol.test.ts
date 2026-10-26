import { describe, expect, it } from 'vitest'
import type { TranscriptEntry } from '@shared/state'
import { buildClaudeCodeArgs, childEnvironment, parseStreamLine, renderPrompt, renderUserMessage } from './claude-code-protocol'

const entry = (id: string, role: 'me' | 'them', text: string, relativeMs = 0): TranscriptEntry => ({
  id,
  role,
  createdAt: new Date(Date.parse('2026-10-19T10:00:00.000Z') + relativeMs).toISOString(),
  relativeMs,
  status: 'done',
  text,
})

describe('buildClaudeCodeArgs', () => {
  it('requests a streamed, isolated, long-lived session fed by stream-json input', () => {
    const args = buildClaudeCodeArgs({ model: 'sonnet', system: 'Be brief.' })
    expect(args.slice(0, 3)).toEqual(['-p', '--output-format', 'stream-json'])
    expect(args.slice(args.indexOf('--input-format'), args.indexOf('--input-format') + 2)).toEqual(['--input-format', 'stream-json'])
    expect(args).toContain('--include-partial-messages')
    expect(args).toContain('--no-session-persistence')
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'sonnet'])
    expect(args.slice(args.indexOf('--system-prompt'), args.indexOf('--system-prompt') + 2)).toEqual(['--system-prompt', 'Be brief.'])
    // No tools, no MCP servers and no user settings may leak into the answer.
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', ''])
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('--disable-slash-commands')
    expect(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2)).toEqual(['--setting-sources', ''])
  })
})

describe('childEnvironment', () => {
  it('drops the markers of an enclosing Claude Code session but keeps the config dir, login tokens and everything else', () => {
    const env = childEnvironment({
      PATH: 'x',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 's',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SSE_PORT: '1',
      CLAUDE_CODE_OAUTH_TOKEN: 'tok',
      CLAUDE_CONFIG_DIR: 'C:\\cfg',
      HOME: 'h',
    })
    expect(env).toEqual({ PATH: 'x', CLAUDE_CODE_OAUTH_TOKEN: 'tok', CLAUDE_CONFIG_DIR: 'C:\\cfg', HOME: 'h' })
  })

  it('never hands the app\'s own API keys or base urls to the CLI', () => {
    const env = childEnvironment({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', LLM_API_KEY: 'k2', LLM_BASE_URL: 'u2', PATH: 'x' })
    expect(env).toEqual({ PATH: 'x' })
  })
})

describe('parseStreamLine init', () => {
  it('reports which tools and MCP servers the CLI started with', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init', tools: ['Bash'], mcp_servers: [{ name: 'x' }] }))).toEqual({
      type: 'init',
      tools: ['Bash'],
      mcpServers: 1,
    })
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init', tools: [], mcp_servers: [] }))).toEqual({ type: 'init', tools: [], mcpServers: 0 })
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'status' }))).toBeNull()
  })
})

describe('renderPrompt', () => {
  const transcript = [entry('a', 'them', 'Why this role?', 5000), entry('b', 'me', 'Because growth.', 9000), entry('c', 'them', 'Tell me more.', 14000)]

  it('renders the whole transcript and the question on the first turn', () => {
    const prompt = renderPrompt({ question: 'What should I say?', transcript })
    expect(prompt).toContain('[00:05] Interviewer: Why this role?')
    expect(prompt).toContain('[00:14] Interviewer: Tell me more.')
    expect(prompt).toContain('What should I say?')
  })

  it('renders only the lines after the last sent entry on later turns', () => {
    const prompt = renderPrompt({ question: 'q', transcript }, { afterId: 'a' })
    expect(prompt).not.toContain('Why this role?')
    expect(prompt).toContain('Because growth.')
    expect(prompt).toContain('Tell me more.')
    expect(prompt).toMatch(/since/i)
  })

  it('falls back to the full transcript when the remembered entry is gone', () => {
    expect(renderPrompt({ question: 'q', transcript }, { afterId: 'missing' })).toContain('Why this role?')
  })

  it('uses the default question when the user typed nothing', () => {
    expect(renderPrompt({ question: '  ', transcript: [] })).toContain('What should I say next?')
  })
})

describe('renderUserMessage', () => {
  it('wraps the prompt as a stream-json user message', () => {
    const line = renderUserMessage({ text: 'hello' })
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } })
  })
  it('adds the screenshot as an inline image block', () => {
    const parsed = JSON.parse(renderUserMessage({ text: 'look', screenshot: { dataBase64: 'QUJD', contentType: 'image/png' } }))
    expect(parsed.message.content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } })
  })
})

describe('parseStreamLine', () => {
  it('extracts text deltas from partial message events', () => {
    const line = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } })
    expect(parseStreamLine(line)).toEqual({ type: 'text', text: 'Hi' })
  })
  it('ignores bookkeeping, other deltas, blank and malformed lines', () => {
    expect(parseStreamLine('')).toBeNull()
    expect(parseStreamLine('not json')).toBeNull()
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'hook' }))).toBeNull()
    expect(parseStreamLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta' } } }))).toBeNull()
    expect(parseStreamLine(JSON.stringify({ type: 'assistant', message: {} }))).toBeNull()
  })
  it('reports the terminal result as done or error', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }))).toEqual({ type: 'done' })
    expect(parseStreamLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'quota exceeded' }))).toEqual({
      type: 'error',
      message: expect.stringContaining('quota exceeded'),
    })
  })
})
