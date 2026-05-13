/**
 * 0006_retire_brain — clean up leftover frontal-lobe artifacts from
 * `data/brain/` after the Brain subsystem was retired.
 *
 * The Brain class (git-like commit log of frontal-lobe updates) and its
 * tools / route / dashboard were removed in a preceding commit. Persona
 * and heartbeat override files stay in `data/brain/` — only the two
 * brain-state files are now orphaned:
 *
 *   - `data/brain/commit.json`     (BrainExportState — commit history)
 *   - `data/brain/frontal-lobe.md` (latest frontal-lobe content snapshot)
 *
 * Both are deleted unconditionally if present. Idempotent: re-running on
 * a clean tree is a no-op via ENOENT-tolerance.
 *
 * Files outside `data/config/` aren't managed by the `ctx` helpers, so
 * this migration uses raw `fs/promises` — same pattern as 0004.
 */

import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Migration } from '../types.js'

const COMMIT_FILE = resolve('data/brain/commit.json')
const FRONTAL_LOBE_FILE = resolve('data/brain/frontal-lobe.md')

/**
 * Delete the two brain-state files. Exported so the spec can drive
 * against temp paths without `chdir`.
 */
export async function pruneBrainArtifacts(
  commitPath: string = COMMIT_FILE,
  frontalLobePath: string = FRONTAL_LOBE_FILE,
): Promise<{ removed: string[] }> {
  const removed: string[] = []

  for (const path of [commitPath, frontalLobePath]) {
    try {
      await rm(path, { force: false })
      removed.push(path)
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }
  }

  for (const path of removed) {
    console.log(`[migration 0006] removed ${path}`)
  }

  return { removed }
}

export const migration: Migration = {
  id: '0006_retire_brain',
  appVersion: '0.10.0-beta.5',
  introducedAt: '2026-05-13',
  affects: ['brain/commit.json', 'brain/frontal-lobe.md'],
  summary:
    'Delete orphan data/brain/{commit.json,frontal-lobe.md} after Brain retirement (persona.md / heartbeat.md retained)',
  rationale:
    'Brain subsystem removed; commit history + frontal-lobe snapshot files are dead artifacts. Persona + heartbeat overrides stay at their existing data/brain/ paths.',
  up: async () => {
    await pruneBrainArtifacts()
  },
}
