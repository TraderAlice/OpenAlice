/**
 * 0034_quick_chat_recent_launch — remember the complete Quick Start tuple.
 *
 * Older preferences remembered only one credential per runtime. Seed the new
 * Session-only launch preference from the most recently inserted legacy entry
 * so upgrading does not make an existing Quick Start silently fall back to a
 * different Workspace provider.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Migration } from '../types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(tempPath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(tempPath, path)
}

export async function migrateQuickChatRecentLaunch(
  preferencesPath: string,
): Promise<{ updated: boolean }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(preferencesPath, 'utf-8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { updated: false }
    return { updated: false }
  }
  if (!isRecord(parsed)) return { updated: false }
  const quickChat = isRecord(parsed['quickChat']) ? parsed['quickChat'] : {}
  if ('recentLaunch' in quickChat) return { updated: false }
  const credentials = isRecord(quickChat['lastCredentialByAgent'])
    ? quickChat['lastCredentialByAgent']
    : {}
  const recentCredential = Object.entries(credentials)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
    .at(-1)
  const recentLaunch = recentCredential
    ? {
        agent: recentCredential[0],
        credentialSlug: recentCredential[1],
        model: null,
        reasoningEffort: null,
      }
    : null
  await writeAtomic(preferencesPath, {
    ...parsed,
    quickChat: {
      ...quickChat,
      recentLaunch,
    },
  })
  return { updated: true }
}

export const migration: Migration = {
  id: '0034_quick_chat_recent_launch',
  appVersion: '0.89.3-beta',
  introducedAt: '2026-08-06',
  affects: ['data/preferences.json'],
  summary: 'Remember Quick Start runtime, credential, model, and effort as one Session-only launch tuple.',
  rationale:
    'Quick Start previously rediscovered Workspace defaults after reload, so a recently selected provider could visibly revert to an unrelated model.',
  up: async (ctx) => {
    await migrateQuickChatRecentLaunch(join(ctx.configDir(), '..', 'preferences.json'))
  },
}
