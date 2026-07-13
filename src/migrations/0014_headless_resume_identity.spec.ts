import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { migrateHeadlessResumeIdentity } from './0014_headless_resume_identity/index.js'

let root: string
let launcherRoot: string
let path: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'headless-resume-migration-'))
  launcherRoot = join(root, 'workspaces')
  path = join(launcherRoot, 'state', 'headless-tasks.json')
  await mkdir(join(launcherRoot, 'state'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('0014_headless_resume_identity', () => {
  it('assigns one stable resumeId per historical fresh run and upgrades to v2', async () => {
    await writeFile(path, JSON.stringify({
      version: 1,
      tasks: [
        { taskId: 'task-a', wsId: 'ws', agent: 'claude', prompt: 'a', status: 'done', startedAt: 1 },
        { taskId: 'task-b', wsId: 'ws', agent: 'pi', prompt: 'b', status: 'done', startedAt: 2 },
      ],
    }))

    expect(await migrateHeadlessResumeIdentity(launcherRoot)).toEqual({ updated: true, assigned: 2 })
    const first = JSON.parse(await readFile(path, 'utf-8')) as {
      version: number
      tasks: Array<{ resumeId: string }>
    }
    expect(first.version).toBe(2)
    expect(first.tasks[0]?.resumeId).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.tasks[1]?.resumeId).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.tasks[0]?.resumeId).not.toBe(first.tasks[1]?.resumeId)

    expect(await migrateHeadlessResumeIdentity(launcherRoot)).toEqual({ updated: false, assigned: 0 })
    const second = JSON.parse(await readFile(path, 'utf-8')) as { tasks: Array<{ resumeId: string }> }
    expect(second.tasks.map((task) => task.resumeId)).toEqual(first.tasks.map((task) => task.resumeId))
  })

  it('preserves an existing resume chain while filling only missing identities', async () => {
    await writeFile(path, JSON.stringify({
      version: 1,
      tasks: [
        { taskId: 'task-a', resumeId: 'resume-shared', wsId: 'ws', agent: 'claude' },
        { taskId: 'task-b', resumeId: 'resume-shared', parentTaskId: 'task-a', wsId: 'ws', agent: 'claude' },
        { taskId: 'task-c', wsId: 'ws', agent: 'pi' },
      ],
    }))

    expect(await migrateHeadlessResumeIdentity(launcherRoot)).toEqual({ updated: true, assigned: 1 })
    const migrated = JSON.parse(await readFile(path, 'utf-8')) as {
      version: number
      tasks: Array<{ resumeId: string; parentTaskId?: string }>
    }
    expect(migrated.version).toBe(2)
    expect(migrated.tasks[0]?.resumeId).toBe('resume-shared')
    expect(migrated.tasks[1]).toMatchObject({ resumeId: 'resume-shared', parentTaskId: 'task-a' })
    expect(migrated.tasks[2]?.resumeId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
