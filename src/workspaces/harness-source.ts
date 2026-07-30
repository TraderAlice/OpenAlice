import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface HarnessSourceReceipt {
  readonly schemaVersion: 1
  readonly template: string
  readonly repository: string
  readonly version: string
  readonly commit: string
}

/** Read the tracked external-Harness lineage written during bootstrap. */
export async function readHarnessSource(
  workspaceDir: string,
): Promise<HarnessSourceReceipt | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(workspaceDir, '.alice', 'harness-source.json'), 'utf8'),
    ) as Record<string, unknown>
    if (
      parsed['schemaVersion'] !== 1
      || typeof parsed['template'] !== 'string'
      || typeof parsed['repository'] !== 'string'
      || typeof parsed['version'] !== 'string'
      || typeof parsed['commit'] !== 'string'
      || !/^[0-9a-f]{40}$/.test(parsed['commit'])
    ) {
      return null
    }
    return {
      schemaVersion: 1,
      template: parsed['template'],
      repository: parsed['repository'],
      version: parsed['version'],
      commit: parsed['commit'],
    }
  } catch {
    return null
  }
}
