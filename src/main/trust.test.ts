import { describe, expect, it } from 'vitest'
import { createTrustedUrlCheck } from './trust'

describe('createTrustedUrlCheck', () => {
  it('in development accepts only the exact dev origin', () => {
    const trusted = createTrustedUrlCheck({ devRendererUrl: 'http://localhost:5173/', rendererIndexHref: 'file:///C:/app/out/renderer/index.html' })
    expect(trusted('http://localhost:5173/#/chat')).toBe(true)
    expect(trusted('http://localhost:51730/')).toBe(false)
    expect(trusted('http://localhost:5173.evil.example/')).toBe(false)
    expect(trusted('file:///C:/app/out/renderer/index.html')).toBe(false)
    expect(trusted(undefined)).toBe(false)
  })

  it('in production accepts only the packaged renderer file', () => {
    const trusted = createTrustedUrlCheck({ devRendererUrl: undefined, rendererIndexHref: 'file:///C:/app/out/renderer/index.html' })
    expect(trusted('file:///C:/app/out/renderer/index.html#/control')).toBe(true)
    expect(trusted('file:///C:/app/out/renderer/index.html.evil')).toBe(false)
    expect(trusted('file:///C:/other/index.html')).toBe(false)
    expect(trusted('http://localhost:5173/')).toBe(false)
    expect(trusted('garbage')).toBe(false)
  })
})
