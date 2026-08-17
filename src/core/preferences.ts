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

const modelReasoningEffortSchema = z.enum([
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
])

const quickChatLaunchSchema = z.object({
  agent: z.string().min(1),
  /** How Quick Start resolves authentication before optional model/effort overrides. */
  accessMode: z.enum(['auto', 'native', 'vault']).optional(),
  credentialSlug: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  reasoningEffort: modelReasoningEffortSchema.nullable(),
}).transform((value) => ({
  ...value,
  accessMode: value.accessMode ?? (value.credentialSlug === null ? 'auto' as const : 'vault' as const),
})).refine(
  (value) => value.accessMode === 'vault' ? value.credentialSlug !== null : value.credentialSlug === null,
  { message: 'access mode and credential must agree' },
)

const quickChatPreferencesSchema = z.object({
  lastCredentialByAgent: z.record(z.string(), z.string()).default({}),
  /** Stable workspace id used by the global Ask Alice composer. */
  recentChatWorkspaceId: z.string().nullable().default(null),
  /** The most recently chosen Session launch tuple. It is never a Workspace default. */
  recentLaunch: quickChatLaunchSchema.nullable().default(null),
})

const autoQuantPreferencesSchema = z.object({
  /**
   * The durable desk behind the AutoQuant Harness. AutoQuant is considered
   * initialized only while this points at an active `auto-quant-v2` Workspace.
   */
  defaultWorkspaceId: z.string().nullable().default(null),
})

const preferencesSchema = z.object({
  version: z.literal(1).default(1),
  quickChat: quickChatPreferencesSchema.default({
    lastCredentialByAgent: {},
    recentChatWorkspaceId: null,
    recentLaunch: null,
  }),
  autoQuant: autoQuantPreferencesSchema.default({
    defaultWorkspaceId: null,
  }),
})

type ParsedQuickChatPreferences = z.infer<typeof quickChatPreferencesSchema>
export type QuickChatPreferences = Omit<ParsedQuickChatPreferences, 'recentLaunch'> & {
  /** Optional on the wire while older test doubles and rolling upgrades coexist. */
  recentLaunch?: ParsedQuickChatPreferences['recentLaunch']
}
export type AutoQuantPreferences = z.infer<typeof autoQuantPreferencesSchema>
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
    ...(preferences.quickChat.recentLaunch
      ? { recentLaunch: { ...preferences.quickChat.recentLaunch } }
      : {}),
  }
}

export async function readAutoQuantPreferences(path = preferencesPath()): Promise<AutoQuantPreferences> {
  const preferences = await readPreferences(path)
  return { defaultWorkspaceId: preferences.autoQuant.defaultWorkspaceId }
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
    ...(preferences.recentLaunch ? { recentLaunch: { ...preferences.recentLaunch } } : {}),
  }
}

export async function rememberQuickChatLaunch(
  launch: NonNullable<ParsedQuickChatPreferences['recentLaunch']>,
  path = preferencesPath(),
): Promise<QuickChatPreferences> {
  const operation = mutationQueue.catch(() => undefined).then(async () => {
    const preferences = await readPreferences(path)
    const lastCredentialByAgent = { ...preferences.quickChat.lastCredentialByAgent }
    if (launch.credentialSlug === null) delete lastCredentialByAgent[launch.agent]
    else lastCredentialByAgent[launch.agent] = launch.credentialSlug
    const updated = preferencesSchema.parse({
      ...preferences,
      quickChat: {
        ...preferences.quickChat,
        lastCredentialByAgent,
        recentLaunch: launch,
      },
    })
    await writePreferences(updated, path)
    return copyQuickChatPreferences(updated.quickChat)
  })
  mutationQueue = operation
  return operation
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

export async function rememberAutoQuantDefaultWorkspace(
  workspaceId: string | null,
  path = preferencesPath(),
): Promise<AutoQuantPreferences> {
  const operation = mutationQueue.catch(() => undefined).then(async () => {
    const preferences = await readPreferences(path)
    const updated = preferencesSchema.parse({
      ...preferences,
      autoQuant: {
        ...preferences.autoQuant,
        defaultWorkspaceId: workspaceId,
      },
    })
    await writePreferences(updated, path)
    return { defaultWorkspaceId: updated.autoQuant.defaultWorkspaceId }
  })
  mutationQueue = operation
  return operation
}
