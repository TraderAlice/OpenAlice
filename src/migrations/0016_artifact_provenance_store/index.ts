/** 0016_artifact_provenance_store — create the durable Session -> artifact trail. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type { Migration } from '../types.js'

function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

export async function ensureArtifactProvenanceStore(
  launcherRoot: string = defaultLauncherRoot(),
): Promise<{ created: boolean }> {
  const path = join(launcherRoot, 'state', 'artifact-provenance.json')
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown; records?: unknown }
    if (parsed.version === 1 && Array.isArray(parsed.records)) return { created: false }
    // Preserve an unexpected/corrupt file for operator inspection. Runtime load
    // treats it as empty; the migration must not destroy unknown user state.
    return { created: false }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return { created: false }
  }

  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify({ version: 1, records: [] }, null, 2) + '\n', { mode: 0o600 })
  await rename(tmp, path)
  return { created: true }
}

export const migration: Migration = {
  id: '0016_artifact_provenance_store',
  appVersion: '0.75.0-beta',
  introducedAt: '2026-07-11',
  affects: ['workspaces/state/artifact-provenance.json'],
  summary: 'Create the durable product Session to artifact provenance store.',
  rationale: 'Reports, Inbox messages, Issues, and trade decisions need one safe resumeId-based attribution index before cross-Session collaboration.',
  up: async () => { await ensureArtifactProvenanceStore() },
}
