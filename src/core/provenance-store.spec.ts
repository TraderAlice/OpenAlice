import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArtifactProvenanceStore, sessionOriginFromInboxOrigin } from './provenance-store.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'provenance-store-'))
  dirs.push(dir)
  const path = join(dir, 'artifact-provenance.json')
  const logger = { warn: vi.fn() }
  return { path, logger, value: await ArtifactProvenanceStore.load(path, logger) }
}

describe('ArtifactProvenanceStore', () => {
  it('persists immutable occurrences and queries a report across revisions', async () => {
    const { path, logger, value } = await store()
    const origin = {
      kind: 'session' as const,
      workspaceId: 'ws-1',
      resumeId: 'resume-1',
      agent: 'pi',
      execution: { kind: 'headless' as const, taskId: 'task-1' },
    }
    await value.append({
      artifact: { kind: 'report', workspaceId: 'ws-1', path: 'research/a.md', revision: 'abc' },
      action: 'updated',
      origin,
      at: 10,
    })
    await value.append({
      artifact: { kind: 'report', workspaceId: 'ws-1', path: 'research/a.md', revision: 'def' },
      action: 'sent',
      origin,
      at: 20,
    })

    expect(value.list({ artifact: { kind: 'report', workspaceId: 'ws-1', path: 'research/a.md' } }))
      .toHaveLength(2)
    expect(value.latest({ resumeId: origin.resumeId })?.action).toBe('sent')

    const reloaded = await ArtifactProvenanceStore.load(path, logger)
    expect(reloaded.list({ resumeId: origin.resumeId }).map((record) => record.action))
      .toEqual(['sent', 'updated'])
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1 })
  })

  it('deduplicates a stable occurrence fingerprint', async () => {
    const { value } = await store()
    const input = {
      artifact: { kind: 'inbox' as const, inboxEntryId: 'entry-1' },
      action: 'sent' as const,
      origin: { kind: 'human' as const },
      at: 1,
      fingerprint: 'inbox:entry-1:sent',
    }
    const first = await value.append(input)
    const second = await value.append({ ...input, at: 2 })
    expect(second.id).toBe(first.id)
    expect(value.list()).toHaveLength(1)
  })

  it('derives a safe Session origin without exposing native ids', () => {
    expect(sessionOriginFromInboxOrigin('ws-1', {
      kind: 'headless',
      runId: 'task-1',
      resumeId: 'resume-1',
      agent: 'pi',
    })).toEqual({
      kind: 'session',
      workspaceId: 'ws-1',
      resumeId: 'resume-1',
      agent: 'pi',
      execution: { kind: 'headless', taskId: 'task-1' },
    })
    expect(sessionOriginFromInboxOrigin('ws-1', {
      kind: 'headless', runId: 'task-1', agent: 'pi',
    })).toBeNull()
  })
})
