import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArtifactProvenanceStore } from '../../core/provenance-store.js'
import type { Logger } from '../logger.js'
import type { IssueRecord } from './declaration.js'
import {
  IssueChangeTracker,
  issueMutationFingerprint,
} from './change-tracker.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const logger = { warn: vi.fn() } as unknown as Logger
const human = { kind: 'human' as const }

function issue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: 'market-scan',
    title: 'Market scan',
    status: 'todo',
    priority: 'none',
    assignee: '@workspace',
    what: 'Read the market.',
    ...overrides,
  }
}

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), 'issue-change-tracker-'))
  dirs.push(dir)
  const provenance = await ArtifactProvenanceStore.load(join(dir, 'provenance.json'), logger)
  const path = join(dir, 'issue-audit-snapshots.json')
  return {
    path,
    provenance,
    tracker: await IssueChangeTracker.load(path, provenance, logger),
  }
}

describe('IssueChangeTracker', () => {
  it('persists a baseline and detects direct file changes after restart', async () => {
    const { path, provenance, tracker } = await harness()
    await tracker.observeWorkspace({ workspaceId: 'ws-1', issues: [issue()], origin: human, now: 10 })
    expect(provenance.list()).toHaveLength(0)

    const restarted = await IssueChangeTracker.load(path, provenance, logger)
    await restarted.observeWorkspace({
      workspaceId: 'ws-1',
      issues: [issue({ status: 'in_progress', priority: 'high', what: 'Scan breadth and tape.' })],
      origin: { kind: 'unknown', reason: 'direct-file-edit' },
      now: 20,
    })

    expect(provenance.list()).toEqual([
      expect.objectContaining({
        action: 'updated',
        origin: { kind: 'unknown', reason: 'direct-file-edit' },
        mutation: {
          fields: [
            { field: 'status', before: 'todo', after: 'in_progress' },
            { field: 'priority', before: 'none', after: 'high' },
            { field: 'what' },
          ],
        },
      }),
    ])
  })

  it('deduplicates a known UI or CLI mutation by final-state fingerprint', async () => {
    const { provenance, tracker } = await harness()
    const before = issue()
    const after = issue({ assignee: '@new' })
    await tracker.observeWorkspace({ workspaceId: 'ws-1', issues: [before], origin: human, now: 10 })
    await provenance.append({
      artifact: { kind: 'issue', workspaceId: 'ws-1', issueId: after.id },
      action: 'updated',
      origin: human,
      at: 20,
      mutation: { fields: [{ field: 'assignee', before: '@workspace', after: '@new' }] },
      fingerprint: issueMutationFingerprint('ws-1', after.id, after),
    })

    await tracker.observeWorkspace({ workspaceId: 'ws-1', issues: [after], origin: human, now: 21 })

    expect(provenance.list()).toHaveLength(1)
  })
})
