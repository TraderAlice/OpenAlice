import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { migrateResumeIdentityRegistry } from './0015_resume_identity_registry/index.js'

let root: string
let launcherRoot: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'resume-identity-migration-'))
  launcherRoot = join(root, 'workspaces')
  await mkdir(join(launcherRoot, 'state', 'sessions'), { recursive: true })
})
afterEach(async () => rm(root, { recursive: true, force: true }))

describe('0015_resume_identity_registry', () => {
  it('joins a materialized Session to its headless resume identity', async () => {
    await writeFile(join(launcherRoot, 'state', 'headless-tasks.json'), JSON.stringify({
      version: 2,
      tasks: [{
        taskId: 'task-1', resumeId: 'resume-1', wsId: 'ws-1', agent: 'claude',
        agentSessionId: 'native-1', startedAt: 10,
      }],
    }))
    await writeFile(join(launcherRoot, 'state', 'sessions', 'ws-1.json'), JSON.stringify({
      version: 2,
      records: [{
        id: 'alice-session', wsId: 'ws-1', agent: 'claude', sourceRunId: 'task-1',
        createdAt: '2026-07-11T00:00:00.000Z',
      }],
    }))

    expect(await migrateResumeIdentityRegistry(launcherRoot)).toEqual({ identities: 1, sessionsUpdated: 1 })
    const sessions = JSON.parse(await readFile(join(launcherRoot, 'state', 'sessions', 'ws-1.json'), 'utf8'))
    expect(sessions.records[0].resumeId).toBe('resume-1')
    const registry = JSON.parse(await readFile(join(launcherRoot, 'state', 'resume-identities.json'), 'utf8'))
    expect(registry.records[0]).toMatchObject({
      resumeId: 'resume-1', wsId: 'ws-1', agent: 'claude',
      agentSessionId: 'native-1', latestTaskId: 'task-1',
    })
    const first = await readFile(join(launcherRoot, 'state', 'resume-identities.json'), 'utf8')
    expect(await migrateResumeIdentityRegistry(launcherRoot)).toEqual({ identities: 1, sessionsUpdated: 0 })
    expect(await readFile(join(launcherRoot, 'state', 'resume-identities.json'), 'utf8')).toBe(first)
  })
})
