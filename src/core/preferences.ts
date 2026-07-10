/**
 * Installation-wide, non-sensitive user preferences.
 *
 * This deliberately lives outside data/config/: preferences are conveniences
 * learned from interaction, not operator-authored runtime configuration. The
 * file must remain safe to inspect and copy — store opaque identifiers only,
 * never credential values, tokens, endpoints, or other secrets.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import { dataPath } from './paths.js'

const quickChatPreferencesSchema = z.object({
  lastCredentialByAgent: z.record(z.string(), z.string()).default({}),
})

const preferencesSchema = z.object({
  version: z.literal(1).default(1),
  quickChat: quickChatPreferencesSchema.default({ lastCredentialByAgent: {} }),
})

export type QuickChatPreferences = z.infer<typeof quickChatPreferencesSchema>
export type Preferences = z.infer<typeof preferencesSchema>

function emptyPreferences(): Preferences {
  return preferencesSchema.parse({})
}

export function preferencesPath(): string {
  return dataPath('preferences.json')
}

/** Missing or malformed preferences are equivalent to no preference. */
export async function readPreferences(path = preferencesPath()): Promise<Preferences> {
  try {
    return preferencesSchema.parse(JSON.parse(await readFile(path, 'utf-8')))
  } catch {
    return emptyPreferences()
  }
}

export async function readQuickChatPreferences(path = preferencesPath()): Promise<QuickChatPreferences> {
  const preferences = await readPreferences(path)
  return {
    lastCredentialByAgent: { ...preferences.quickChat.lastCredentialByAgent },
  }
}

// Alice is single-writer at the process level, but two UI requests can still
// arrive together. Serialize the read-modify-write cycle so neither update is
// lost, then use temp+rename so a crash cannot leave truncated JSON behind.
let mutationQueue: Promise<unknown> = Promise.resolve()

export async function rememberQuickChatCredential(
  agentId: string,
  credentialSlug: string | null,
  path = preferencesPath(),
): Promise<QuickChatPreferences> {
  const operation = mutationQueue.catch(() => undefined).then(async () => {
    const preferences = await readPreferences(path)
    const next = { ...preferences.quickChat.lastCredentialByAgent }
    if (credentialSlug === null) delete next[agentId]
    else next[agentId] = credentialSlug

    const updated = preferencesSchema.parse({
      ...preferences,
      quickChat: { lastCredentialByAgent: next },
    })
    await mkdir(dirname(path), { recursive: true })
    const tempPath = `${path}.${process.pid}.tmp`
    try {
      await writeFile(tempPath, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 })
      await rename(tempPath, path)
    } catch (error) {
      await unlink(tempPath).catch(() => undefined)
      throw error
    }
    return { lastCredentialByAgent: { ...next } }
  })
  mutationQueue = operation
  return operation
}
