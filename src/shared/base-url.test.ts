import { describe, expect, it } from 'vitest'
import { validateBaseUrl } from './base-url'

describe('validateBaseUrl', () => {
  it('accepts https anywhere and http only on loopback, and strips trailing slashes', () => {
    expect(validateBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
    expect(validateBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
    expect(validateBaseUrl('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1')
    expect(validateBaseUrl('http://[::1]:8080/v1')).toBe('http://[::1]:8080/v1')
  })

  it('rejects plaintext http to remote hosts, other schemes, credentials, queries and fragments', () => {
    expect(() => validateBaseUrl('http://my-proxy.example/v1')).toThrow(/https/i)
    expect(() => validateBaseUrl('ftp://localhost/v1')).toThrow()
    expect(() => validateBaseUrl('https://user:pw@api.example/v1')).toThrow(/credentials/i)
    expect(() => validateBaseUrl('https://api.example/v1?x=1')).toThrow()
    expect(() => validateBaseUrl('https://api.example/v1#frag')).toThrow()
    expect(() => validateBaseUrl('not a url')).toThrow()
  })
})
