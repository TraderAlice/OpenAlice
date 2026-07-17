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
  /** Stable workspace id used by the global Ask Alice composer. */
  recentChatWorkspaceId: z.string().nullable().default(null),
})

export const appearancePreferencesSchema = z.object({
  activeFamilyId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/).default('builtin-openalice'),
  mode: z.enum(['system', 'light', 'dark']).default('system'),
  terminal: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('follow') }).strict(),
    z.object({
      mode: z.literal('override'),
      familyId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
      variant: z.enum(['light', 'dark']),
    }).strict(),
  ]).default({ mode: 'follow' }),
  marketColors: z.enum(['protected', 'theme']).default('protected'),
  marketDirection: z.enum(['green-up-red-down', 'red-up-green-down']).default('green-up-red-down'),
  statusColors: z.enum(['protected', 'theme']).default('protected'),
}).strict()

const preferencesSchema = z.object({
  version: z.literal(1).default(1),
  quickChat: quickChatPreferencesSchema.default({
    lastCredentialByAgent: {},
    recentChatWorkspaceId: null,
  }),
  appearance: appearancePreferencesSchema.default({
    activeFamilyId: 'builtin-openalice',
    mode: 'system',
    terminal: { mode: 'follow' },
    marketColors: 'protected',
    marketDirection: 'green-up-red-down',
    statusColors: 'protected',
  }),
})

export type QuickChatPreferences = z.infer<typeof quickChatPreferencesSchema>
export type AppearancePreferences = z.infer<typeof appearancePreferencesSchema>
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
    recentChatWorkspaceId: preferences.quickChat.recentChatWorkspaceId,
  }
}

export async function readAppearancePreferences(path = preferencesPath()): Promise<AppearancePreferences> {
  const preferences = await readPreferences(path)
  return structuredClone(preferences.appearance)
}

// Alice is single-writer at the process level, but two UI requests can still
// arrive together. Serialize the read-modify-write cycle so neither update is
// lost, then use temp+rename so a crash cannot leave truncated JSON behind.
let mutationQueue: Promise<unknown> = Promise.resolve()

async function writePreferences(preferences: Preferences, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.tmp`
  try {
    await writeFile(tempPath, JSON.stringify(preferences, null, 2) + '\n', { mode: 0o600 })
    await rename(tempPath, path)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

function copyQuickChatPreferences(preferences: QuickChatPreferences): QuickChatPreferences {
  return {
    lastCredentialByAgent: { ...preferences.lastCredentialByAgent },
    recentChatWorkspaceId: preferences.recentChatWorkspaceId,
  }
}

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
      quickChat: {
        ...preferences.quickChat,
        lastCredentialByAgent: next,
      },
    })
    await writePreferences(updated, path)
    return copyQuickChatPreferences(updated.quickChat)
  })
  mutationQueue = operation
  return operation
}

export async function rememberRecentChatWorkspace(
  workspaceId: string | null,
  path = preferencesPath(),
): Promise<QuickChatPreferences> {
  const operation = mutationQueue.catch(() => undefined).then(async () => {
    const preferences = await readPreferences(path)
    const updated = preferencesSchema.parse({
      ...preferences,
      quickChat: {
        ...preferences.quickChat,
        recentChatWorkspaceId: workspaceId,
      },
    })
    await writePreferences(updated, path)
    return copyQuickChatPreferences(updated.quickChat)
  })
  mutationQueue = operation
  return operation
}

export async function saveAppearancePreferences(
  input: AppearancePreferences,
  path = preferencesPath(),
): Promise<AppearancePreferences> {
  const appearance = appearancePreferencesSchema.parse(input)
  const operation = mutationQueue.catch(() => undefined).then(async () => {
    const preferences = await readPreferences(path)
    const updated = preferencesSchema.parse({ ...preferences, appearance })
    await writePreferences(updated, path)
    return structuredClone(updated.appearance)
  })
  mutationQueue = operation
  return operation
}
