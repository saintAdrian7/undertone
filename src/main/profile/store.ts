import { readFile, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { z } from 'zod'

/** Keeps the system prompt (which carries the profile) well under the Windows command-line limit. */
export const MAX_PROFILE_CHARS = 12000
export const PROFILE_FILE = 'profile.json'
export const PROFILE_EXTENSIONS = ['txt', 'md', 'pdf'] as const

const ProfileSchema = z.object({ name: z.string().min(1).max(260), text: z.string().max(MAX_PROFILE_CHARS) })
export type Profile = z.infer<typeof ProfileSchema>

export async function loadProfile(dir: string): Promise<Profile | null> {
  try {
    return ProfileSchema.parse(JSON.parse(await readFile(join(dir, PROFILE_FILE), 'utf8')))
  } catch {
    return null
  }
}

export async function saveProfile(dir: string, profile: Profile | null): Promise<void> {
  const path = join(dir, PROFILE_FILE)
  if (profile) await writeFile(path, JSON.stringify(ProfileSchema.parse(profile)), 'utf8')
  else await unlink(path).catch(() => undefined)
}

export interface ExtractDeps {
  parsePdf?: (data: Buffer) => Promise<string>
}

/** The text of an uploaded resume: UTF-8 for .txt and .md, the injected parser for .pdf. */
export async function extractProfileText(fileName: string, data: Buffer, deps: ExtractDeps = {}): Promise<string> {
  const extension = extname(fileName).slice(1).toLowerCase()
  let text: string
  if (extension === 'txt' || extension === 'md') text = data.toString('utf8')
  else if (extension === 'pdf') {
    if (!deps.parsePdf) throw new Error('PDF parsing is not available')
    text = await deps.parsePdf(data)
  } else throw new Error('Use a .txt, .md or .pdf file')
  return text.replace(/\r\n/g, '\n').trim().slice(0, MAX_PROFILE_CHARS)
}
