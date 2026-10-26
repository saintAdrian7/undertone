import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractProfileText, loadProfile, saveProfile, MAX_PROFILE_CHARS } from './store'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'copilot-profile-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('profile store', () => {
  it('returns null when nothing was saved', async () => {
    expect(await loadProfile(dir)).toBeNull()
  })

  it('round-trips a saved profile', async () => {
    await saveProfile(dir, { name: 'resume.pdf', text: 'Jane Doe, engineer.' })
    expect(await loadProfile(dir)).toEqual({ name: 'resume.pdf', text: 'Jane Doe, engineer.' })
    expect(JSON.parse(await readFile(join(dir, 'profile.json'), 'utf8')).name).toBe('resume.pdf')
  })

  it('clears the profile', async () => {
    await saveProfile(dir, { name: 'r.txt', text: 'x' })
    await saveProfile(dir, null)
    expect(await loadProfile(dir)).toBeNull()
  })
})

describe('extractProfileText', () => {
  it('reads plain text and markdown as UTF-8 and trims it', async () => {
    expect(await extractProfileText('cv.md', Buffer.from('  # Jane\nEngineer  '))).toBe('# Jane\nEngineer')
    expect(await extractProfileText('cv.TXT', Buffer.from('plain'))).toBe('plain')
  })

  it('uses the injected PDF parser for .pdf files', async () => {
    const parsePdf = vi.fn(async () => 'from pdf')
    expect(await extractProfileText('cv.pdf', Buffer.from('%PDF'), { parsePdf })).toBe('from pdf')
    expect(parsePdf).toHaveBeenCalledTimes(1)
  })

  it('rejects other formats and caps the length', async () => {
    await expect(extractProfileText('cv.docx', Buffer.from(''))).rejects.toThrow(/\.txt, \.md or \.pdf/)
    const long = await extractProfileText('cv.txt', Buffer.from('x'.repeat(MAX_PROFILE_CHARS + 100)))
    expect(long).toHaveLength(MAX_PROFILE_CHARS)
  })
})
