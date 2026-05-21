/**
 * Git state persistence — load/save Trading-as-Git commit history.
 *
 * Extracted from main.ts. Pure functions + file IO, no instance dependencies.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import type { GitExportState } from './git/types.js'
import { dataPath } from '@/core/paths.js'

// ==================== Paths ====================

function gitFilePath(accountId: string): string {
  return dataPath('trading', accountId, 'commit.json')
}

/** Legacy paths for backward compat. TODO: remove before v1.0 */
const LEGACY_GIT_PATHS: Record<string, string> = {
  'bybit-main': dataPath('crypto-trading', 'commit.json'),
  'alpaca-paper': dataPath('securities-trading', 'commit.json'),
  'alpaca-live': dataPath('securities-trading', 'commit.json'),
}

// ==================== Public API ====================

/** Read saved git state from disk, trying primary path then legacy fallback. */
export async function loadGitState(accountId: string): Promise<GitExportState | undefined> {
  const primary = gitFilePath(accountId)
  try {
    return JSON.parse(await readFile(primary, 'utf-8')) as GitExportState
  } catch { /* try legacy */ }
  const legacy = LEGACY_GIT_PATHS[accountId]
  if (legacy) {
    try {
      return JSON.parse(await readFile(legacy, 'utf-8')) as GitExportState
    } catch { /* no saved state */ }
  }
  return undefined
}

/** Create a callback that persists git state to disk on each commit. */
export function createGitPersister(accountId: string): (state: GitExportState) => Promise<void> {
  const filePath = gitFilePath(accountId)
  return async (state: GitExportState) => {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(state, null, 2))
  }
}
