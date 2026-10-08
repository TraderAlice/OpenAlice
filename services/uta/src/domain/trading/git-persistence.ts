/**
 * Git state persistence — load/save Trading-as-Git commit history.
 *
 * Extracted from main.ts. Pure functions + file IO, no instance dependencies.
 */

import { readFile } from 'node:fs/promises'
import { mkdirSync, writeFileSync, renameSync, rmSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { dirname } from 'path'
import type { GitExportState, GitPendingState } from './git/types.js'
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const legacy = LEGACY_GIT_PATHS[accountId]
  if (legacy) {
    try {
      return JSON.parse(await readFile(legacy, 'utf-8')) as GitExportState
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return undefined
}

/** Keep file replacement atomic, including the ledger used to retire pending
 * checkpoints. Synchronous writes preserve the order of wallet callbacks. */
function save(filePath: string, state: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp`
  writeFileSync(temporary, JSON.stringify(state, null, 2), { flush: true })
  renameSync(temporary, filePath)
  // POSIX also needs the directory entry durable before a broker call. Windows
  // does not support opening directories with this API; native power-loss
  // acceptance remains a platform-specific gate there.
  if (process.platform !== 'win32') {
    const directory = openSync(dirname(filePath), 'r')
    try { fsyncSync(directory) } finally { closeSync(directory) }
  }
}

export function createGitPersister(accountId: string): (state: GitExportState) => void {
  return (state) => save(gitFilePath(accountId), state)
}

/** New staging file; old commit.json contents and schema remain unchanged. */
export async function loadPendingState(accountId: string): Promise<GitPendingState | undefined> {
  try {
    return JSON.parse(await readFile(dataPath('trading', accountId, 'pending.json'), 'utf8')) as GitPendingState
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export function createPendingPersister(accountId: string): (state: GitPendingState | null) => void {
  const filePath = dataPath('trading', accountId, 'pending.json')
  return (state) => {
    if (state === null) rmSync(filePath, { force: true })
    else save(filePath, state)
  }
}
