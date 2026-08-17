import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateUnifiedSessionRecords } from './0040_unified_session_records/index.js'

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'unified-session-records-'))
  await mkdir(join(root, 'state', 'sessions'), { recursive: true })
  return root
}

function identity(overrides: Record<string, unknown> = {}) {
  return {
    resumeId: 'resume-headless',
    wsId: 'ws-1',
    agent: 'codex',
    createdAt: 100,
    updatedAt: 200,
    lifecycle: 'active',
    agentSessionId: 'native-headless',
    latestTaskId: 'task-headless',
    ...overrides,
  }
}

function existingSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pi-existing-session',
    resumeId: 'resume-interactive',
    wsId: 'ws-1',
    agent: 'pi',
    name: 'p1',
    createdAt: '2026-08-01T00:00:00.000Z',
    lastActiveAt: '2026-08-01T01:00:00.000Z',
    state: 'paused',
    surface: 'terminal',
    title: 'Existing conversation',
    ...overrides,
  }
}

describe('0040 unified Session records migration', () => {
  it('adds one durable row for a headless-born identity without replacing existing rows', async () => {
    const root = await fixture()
    await writeFile(join(root, 'state', 'resume-identities.json'), JSON.stringify({
      version: 1,
      records: [
        identity(),
        identity({
          resumeId: 'resume-interactive',
          agent: 'pi',
          createdAt: 50,
          updatedAt: 60,
          agentSessionId: 'native-interactive',
          latestTaskId: undefined,
        }),
      ],
    }))
    await writeFile(join(root, 'state', 'headless-tasks.json'), JSON.stringify({
      version: 3,
      tasks: [{
        taskId: 'task-headless',
        resumeId: 'resume-headless',
        wsId: 'ws-1',
        agent: 'codex',
        prompt: 'Produce the daily close report',
        status: 'done',
        startedAt: 300,
        finishedAt: 400,
        agentSessionId: 'native-from-task',
      }],
    }))
    await writeFile(join(root, 'state', 'sessions', 'ws-1.json'), JSON.stringify({
      version: 3,
      records: [existingSession()],
    }))

    expect(await migrateUnifiedSessionRecords(root)).toEqual({
      migrated: true,
      created: 1,
      files: 1,
    })
    const file = JSON.parse(await readFile(join(root, 'state', 'sessions', 'ws-1.json'), 'utf8'))
    expect(file.version).toBe(4)
    expect(file.records).toHaveLength(2)
    expect(file.records[0]).toMatchObject(existingSession())
    expect(file.records[1]).toMatchObject({
      resumeId: 'resume-headless',
      wsId: 'ws-1',
      agent: 'codex',
      name: 'x1',
      createdAt: new Date(100).toISOString(),
      lastActiveAt: new Date(400).toISOString(),
      state: 'paused',
      surface: 'headless',
      fallbackTitle: 'Produce the daily close report',
      sourceRunId: 'task-headless',
      resumeHint: { kind: 'agent-session-id', value: 'native-headless' },
    })
    expect(file.records[1].id).toMatch(/^x-migrated-[a-f0-9]{16}$/u)

    expect(await migrateUnifiedSessionRecords(root)).toEqual({
      migrated: false,
      created: 0,
      files: 0,
    })
  })

  it('preserves the durable roster for retired and deleted identities', async () => {
    const root = await fixture()
    await writeFile(join(root, 'state', 'resume-identities.json'), JSON.stringify({
      version: 1,
      records: [
        identity({ resumeId: 'resume-retired', lifecycle: 'retired' }),
        identity({ resumeId: 'resume-deleted', presence: 'deleted' }),
      ],
    }))

    expect(await migrateUnifiedSessionRecords(root)).toEqual({
      migrated: true,
      created: 2,
      files: 1,
    })
    const file = JSON.parse(await readFile(join(root, 'state', 'sessions', 'ws-1.json'), 'utf8'))
    expect(file.records.map((row: { resumeId: string }) => row.resumeId)).toEqual([
      'resume-deleted',
      'resume-retired',
    ])
  })

  it('does not recreate roster rows after a Workspace was purged', async () => {
    const root = await fixture()
    await writeFile(join(root, 'state', 'resume-identities.json'), JSON.stringify({
      version: 1,
      records: [identity({ lifecycle: 'retired' })],
    }))
    await writeFile(join(root, 'state', 'workspace-catalog.json'), JSON.stringify({
      version: 1,
      workspaces: [{ id: 'ws-1', lifecycle: 'purged' }],
    }))

    expect(await migrateUnifiedSessionRecords(root)).toEqual({
      migrated: false,
      created: 0,
      files: 0,
    })
  })

  it('refuses a split-brain roster row whose ownership conflicts with its identity', async () => {
    const root = await fixture()
    await writeFile(join(root, 'state', 'resume-identities.json'), JSON.stringify({
      version: 1,
      records: [identity({ resumeId: 'resume-interactive', agent: 'codex' })],
    }))
    await writeFile(join(root, 'state', 'sessions', 'ws-1.json'), JSON.stringify({
      version: 4,
      records: [existingSession()],
    }))

    await expect(migrateUnifiedSessionRecords(root)).rejects.toThrow(
      'ownership conflicts with resume identity resume-interactive',
    )
  })

  it('backs up an existing roster file before adding the missing row', async () => {
    const root = await fixture()
    const backupRoot = join(root, 'backup')
    await writeFile(join(root, 'state', 'resume-identities.json'), JSON.stringify({
      version: 1,
      records: [identity()],
    }))
    await writeFile(join(root, 'state', 'sessions', 'ws-1.json'), JSON.stringify({
      version: 4,
      records: [],
    }))

    await migrateUnifiedSessionRecords(root, { backupRoot })

    expect(JSON.parse(await readFile(
      join(backupRoot, 'state', 'sessions', 'ws-1.json'),
      'utf8',
    ))).toEqual({ version: 4, records: [] })
  })
})
