/**
 * 0012_recent_chat_workspace_preference — stop date-sharding Quick Chat.
 *
 * Older installs may have many `chat-<month><day>` workspaces and no stable
 * routing preference. Seed `quickChat.recentChatWorkspaceId` from the Chat
 * workspace with the latest session activity, falling back to creation time.
 * The runtime resolver repeats this validation so deleting the preferred
 * workspace remains safe after migration.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { Migration } from '../types.js'

interface WorkspaceRow {
  id?: unknown
  template?: unknown
  createdAt?: unknown
}

function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return null
  }
}

async function lastActivityMs(launcherRoot: string, row: WorkspaceRow): Promise<number> {
  const created = typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : 0
  if (typeof row.id !== 'string') return Number.isFinite(created) ? created : 0
  const sessionFile = await readJson(join(launcherRoot, 'state', 'sessions', `${row.id}.json`))
  if (!isRecord(sessionFile) || !Array.isArray(sessionFile['records'])) {
    return Number.isFinite(created) ? created : 0
  }
  const activity = sessionFile['records']
    .map((record) => isRecord(record) && typeof record['lastActiveAt'] === 'string'
      ? Date.parse(record['lastActiveAt'])
      : Number.NaN)
    .filter(Number.isFinite)
  return activity.length > 0
    ? Math.max(...activity)
    : Number.isFinite(created) ? created : 0
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temp, path)
}

export async function migrateRecentChatWorkspacePreference(
  preferencesPath: string,
  launcherRoot: string = defaultLauncherRoot(),
): Promise<{ updated: boolean; workspaceId: string | null }> {
  const registry = await readJson(join(launcherRoot, 'workspaces.json'))
  if (!isRecord(registry) || !Array.isArray(registry['workspaces'])) {
    return { updated: false, workspaceId: null }
  }
  const chats = registry['workspaces'].filter((row): row is WorkspaceRow => (
    isRecord(row) && typeof row['id'] === 'string' && row['template'] === 'chat'
  ))
  if (chats.length === 0) return { updated: false, workspaceId: null }

  const rawPreferences = await readJson(preferencesPath)
  if (rawPreferences === null || (rawPreferences !== undefined && !isRecord(rawPreferences))) {
    return { updated: false, workspaceId: null }
  }
  const preferences = rawPreferences ?? {}
  const quickChat = isRecord(preferences['quickChat']) ? preferences['quickChat'] : {}
  const current = quickChat['recentChatWorkspaceId']
  if (typeof current === 'string' && chats.some((row) => row.id === current)) {
    return { updated: false, workspaceId: current }
  }

  const ranked = await Promise.all(chats.map(async (row) => ({
    row,
    activity: await lastActivityMs(launcherRoot, row),
  })))
  ranked.sort((a, b) => b.activity - a.activity)
  const workspaceId = ranked[0]?.row.id
  if (typeof workspaceId !== 'string') return { updated: false, workspaceId: null }

  const next = {
    ...preferences,
    version: 1,
    quickChat: {
      ...quickChat,
      lastCredentialByAgent: isRecord(quickChat['lastCredentialByAgent'])
        ? quickChat['lastCredentialByAgent']
        : {},
      recentChatWorkspaceId: workspaceId,
    },
  }
  await writeAtomic(preferencesPath, next)
  return { updated: true, workspaceId }
}

export const migration: Migration = {
  id: '0012_recent_chat_workspace_preference',
  appVersion: '0.73.0-beta',
  introducedAt: '2026-07-11',
  affects: ['data/preferences.json', 'workspaces/workspaces.json', 'workspaces/state/sessions/*.json'],
  summary:
    'Route Quick Chat to the most recently active durable Chat workspace instead of creating a new daily workspace.',
  rationale:
    'Chat workspaces accumulate files, issues, git history, and agent context. Date-sharding the global entrypoint stranded that context in yesterday\'s workspace.',
  up: async (ctx) => {
    await migrateRecentChatWorkspacePreference(
      join(ctx.configDir(), '..', 'preferences.json'),
    )
  },
}
