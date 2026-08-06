/**
 * 0035_quick_chat_access_mode — make Quick Start AI access explicit.
 *
 * A null credential slug historically meant "resolve normally", which can use
 * Workspace configuration. It must not be reinterpreted as an explicit request
 * to bypass the Workspace and use the runtime's own account.
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

export async function migrateQuickChatAccessMode(
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
  const quickChat = parsed['quickChat']
  if (!isRecord(quickChat)) return { updated: false }
  const recentLaunch = quickChat['recentLaunch']
  if (!isRecord(recentLaunch) || 'accessMode' in recentLaunch) return { updated: false }

  const accessMode = typeof recentLaunch['credentialSlug'] === 'string' &&
    recentLaunch['credentialSlug'].length > 0
    ? 'vault'
    : 'auto'
  await writeAtomic(preferencesPath, {
    ...parsed,
    quickChat: {
      ...quickChat,
      recentLaunch: {
        ...recentLaunch,
        accessMode,
      },
    },
  })
  return { updated: true }
}

export const migration: Migration = {
  id: '0035_quick_chat_access_mode',
  appVersion: '0.89.3-beta',
  introducedAt: '2026-08-06',
  affects: ['data/preferences.json'],
  summary: 'Distinguish Workspace AI, saved credentials, and native runtime accounts in Quick Start.',
  rationale:
    'A missing credential slug previously overloaded Workspace resolution and native runtime auth, so an upgraded preference could silently change launch behavior.',
  up: async (ctx) => {
    await migrateQuickChatAccessMode(join(ctx.configDir(), '..', 'preferences.json'))
  },
}
