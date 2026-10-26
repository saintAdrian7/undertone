import { describe, expect, it } from 'vitest'
import { buildClaudeCodeArgs, parseStreamLine, renderPrompt } from './claude-code-protocol'

describe('buildClaudeCodeArgs', () => {
  it('requests a streamed, isolated, non-interactive completion', () => {
    const args = buildClaudeCodeArgs({ model: 'sonnet', system: 'Be brief.' })
    expect(args.slice(0, 3)).toEqual(['-p', '--output-format', 'stream-json'])
    expect(args).toContain('--include-partial-messages')
    expect(args).toContain('--no-session-persistence')
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'sonnet'])
    expect(args.slice(args.indexOf('--system-prompt'), args.indexOf('--system-prompt') + 2)).toEqual(['--system-prompt', 'Be brief.'])
    // No tools, no MCP servers and no user settings may leak into the answer.
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', ''])
    expect(args).toContain('--strict-mcp-config')
    expect(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2)).toEqual(['--setting-sources', ''])
  })

  it('allows only the Read tool when a screenshot file must be opened', () => {
    const args = buildClaudeCodeArgs({ model: 'sonnet', system: 's', allowRead: true })
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', 'Read'])
  })
})

describe('renderPrompt', () => {
  const transcript = [
    { id: 'a', role: 'them' as const, createdAt: '2026-10-19T10:00:00.000Z', relativeMs: 5000, status: 'done' as const, text: 'Why this role?' },
  ]
  it('includes the transcript lines and the question', () => {
    const prompt = renderPrompt({ question: 'What should I say?', transcript })
    expect(prompt).toContain('[00:05] Interviewer: Why this role?')
    expect(prompt).toContain('What should I say?')
  })
  it('uses the default question when the user typed nothing', () => {
    expect(renderPrompt({ question: '  ', transcript: [] })).toContain('What should I say next?')
  })
  it('points at the screenshot file when one was saved', () => {
    const prompt = renderPrompt({ question: 'q', transcript: [] }, 'C:\\temp\\shot.png')
    expect(prompt).toContain('C:\\temp\\shot.png')
    expect(renderPrompt({ question: 'q', transcript: [] })).not.toMatch(/screenshot/i)
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
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init' }))).toBeNull()
    expect(parseStreamLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta' } } }))).toBeNull()
    expect(parseStreamLine(JSON.stringify({ type: 'assistant', message: {} }))).toBeNull()
  })
  it('reports the terminal result as done or error', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }))).toEqual({ type: 'done' })
    expect(parseStreamLine(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'quota exceeded' }))).toEqual({
      type: 'error',
      message: expect.stringContaining('quota exceeded'),
    })
  })
})
