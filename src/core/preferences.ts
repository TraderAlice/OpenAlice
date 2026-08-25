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

const autoPredictionPreferencesSchema = z.object({
  /** The durable desk behind the Auto Prediction Harness. */
  defaultWorkspaceId: z.string().nullable().default(null),
})

const harnessPreferencesSchema = z.object({
  /**
   * Ask Alice and Auto Quant share one roster. Headless-born Sessions that
   * have never opened a TUI/WebPi stay off that roster unless this is true.
   */
  showHeadlessBornSessions: z.boolean().default(false),
  /** Keep Sessions currently owned or occupied by an Issue off shared Harness rosters. */
  showIssueAttachedSessions: z.boolean().default(false),
  /** Also discover stable upstream tags outside OpenAlice's verified catalog. */
  showUnverifiedHarnessReleases: z.boolean().default(false),
})

/** Installation-level launcher pins. Persist ids only — never install state. */
export const AGENT_RUNTIME_QUICK_ACCESS_LIMIT = 4

export function normalizeAgentRuntimeQuickAccessIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string') continue
    const trimmed = id.trim()
    if (!trimmed || trimmed.length > 128 || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= AGENT_RUNTIME_QUICK_ACCESS_LIMIT) break
  }
  return result
}

const agentRuntimesPreferencesSchema = z.object({
  quickAccessIds: z.unknown().default([]).transform(normalizeAgentRuntimeQuickAccessIds),
  /** Successful Session launches, newest first. This is presentation history, not runtime config. */
  recentAgentIds: z.unknown().default([]).transform(normalizeAgentRuntimeQuickAccessIds),
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
  autoPrediction: autoPredictionPreferencesSchema.default({
    defaultWorkspaceId: null,
  }),
  harness: harnessPreferencesSchema.default({
    showHeadlessBornSessions: false,
    showIssueAttachedSessions: false,
    showUnverifiedHarnessReleases: false,
  }),
  agentRuntimes: agentRuntimesPreferencesSchema.default({
    quickAccessIds: [],
    recentAgentIds: [],
  }),
})

type ParsedQuickChatPreferences = z.infer<typeof quickChatPreferencesSchema>
export type QuickChatPreferences = Omit<ParsedQuickChatPreferences, 'recentLaunch'> & {
  /** Optional on the wire while older test doubles and rolling upgrades coexist. */
  recentLaunch?: ParsedQuickChatPreferences['recentLaunch']
}
export type AutoQuantPreferences = z.infer<typeof autoQuantPreferencesSchema>
export type AutoPredictionPreferences = z.infer<typeof autoPredictionPreferencesSchema>
export type HarnessPreferences = z.infer<typeof harnessPreferencesSchema>
export type AgentRuntimesPreferences = {
  readonly quickAccessIds: readonly string[]
  readonly recentAgentIds: readonly string[]
}
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

export async function readAutoPredictionPreferences(
  path = preferencesPath(),
): Promise<AutoPredictionPreferences> {
  const preferences = await readPreferences(path)
  return { defaultWorkspaceId: preferences.autoPrediction.defaultWorkspaceId }
}

export async function readHarnessPreferences(path = preferencesPath()): Promise<HarnessPreferences> {
  const preferences = await readPreferences(path)
  return {
    showHeadlessBornSessions: preferences.harness.showHeadlessBornSessions,
    showIssueAttachedSessions: preferences.harness.showIssueAttachedSessions,
    showUnverifiedHarnessReleases: preferences.harness.showUnverifiedHarnessReleases,
  }
}

export async function readAgentRuntimesPreferences(
  path = preferencesPath(),
): Promise<AgentRuntimesPreferences> {
  const preferences = await readPreferences(path)
  return {
    quickAccessIds: [...preferences.agentRuntimes.quickAccessIds],
    recentAgentIds: [...preferences.agentRuntimes.recentAgentIds],
  }
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

export async function rememberAutoPredictionDefaultWorkspace(
  workspaceId: string | null,
  path = preferencesPath(),
): Promise<AutoPredictionPreferences> {
  const operation = mutationQueue.catch(() => undefined).then(async () => {
    const preferences = await readPreferences(path)
    const updated = preferencesSchema.parse({
      ...preferences,
      autoPrediction: {
        ...preferences.autoPrediction,
        defaultWorkspaceId: workspaceId,
      },
    })
    await writePreferences(updated, path)
    return { defaultWorkspaceId: updated.autoPrediction.defaultWorkspaceId }
  })
  mutationQueue = operation
  return operation
}

export async function saveHarnessPreferences(
  next: HarnessPreferences,
  path = preferencesPath(),
): Promise<HarnessPreferences> {
  const operation = mutationQueue.catch(() => undefined).then(async () => {
    const preferences = await readPreferences(path)
    const updated = preferencesSchema.parse({
      ...preferences,
      harness: next,
    })
    await writePreferences(updated, path)
    return {
      showHeadlessBornSessions: updated.harness.showHeadlessBornSessions,
      showIssueAttachedSessions: updated.harness.showIssueAttachedSessions,
      showUnverifiedHarnessReleases: updated.harness.showUnverifiedHarnessReleases,
    }
  })
  mutationQueue = operation
  return operation
}

export async function saveAgentRuntimesPreferences(
  next: Pick<AgentRuntimesPreferences, 'quickAccessIds'>,
  path = preferencesPath(),
): Promise<AgentRuntimesPreferences> {
  const operation = mutationQueue.catch(() => undefined).then(async () => {
    const preferences = await readPreferences(path)
    const updated = preferencesSchema.parse({
      ...preferences,
      agentRuntimes: {
        ...preferences.agentRuntimes,
        quickAccessIds: normalizeAgentRuntimeQuickAccessIds(next.quickAccessIds),
      },
    })
    await writePreferences(updated, path)
    return {
      quickAccessIds: [...updated.agentRuntimes.quickAccessIds],
      recentAgentIds: [...updated.agentRuntimes.recentAgentIds],
    }
  })
  mutationQueue = operation
  return operation
}

/** Promote a runtime only after a Session was created successfully. */
export async function rememberAgentRuntimeUse(
  agentId: string,
  path = preferencesPath(),
): Promise<AgentRuntimesPreferences> {
  const operation = mutationQueue.catch(() => undefined).then(async () => {
    const preferences = await readPreferences(path)
    const recentAgentIds = normalizeAgentRuntimeQuickAccessIds([
      agentId,
      ...preferences.agentRuntimes.recentAgentIds.filter((id) => id !== agentId),
    ])
    const updated = preferencesSchema.parse({
      ...preferences,
      agentRuntimes: {
        ...preferences.agentRuntimes,
        recentAgentIds,
      },
    })
    await writePreferences(updated, path)
    return {
      quickAccessIds: [...updated.agentRuntimes.quickAccessIds],
      recentAgentIds: [...updated.agentRuntimes.recentAgentIds],
    }
  })
  mutationQueue = operation
  return operation
}
