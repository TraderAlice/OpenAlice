import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { migrateHeadlessIssueTrigger } from './0020_headless_issue_trigger/index.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mig0020-')); await mkdir(join(root, 'state')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('0020 headless Issue trigger', () => {
  it('converts the implicit same-Workspace link to a composite trigger', async () => {
    const path = join(root, 'state', 'headless-tasks.json')
    await writeFile(path, JSON.stringify({ version: 2, tasks: [
      { taskId: 'run-1', wsId: 'ws-home', issueId: 'daily-scan' },
      { taskId: 'run-2', wsId: 'ws-manual' },
    ] }))
    expect(await migrateHeadlessIssueTrigger(root)).toEqual({ updated: 1 })
    const saved = JSON.parse(await readFile(path, 'utf8'))
    expect(saved.version).toBe(3)
    expect(saved.tasks[0]).not.toHaveProperty('issueId')
    expect(saved.tasks[0].trigger).toEqual({ kind: 'issue', workspaceId: 'ws-home', issueId: 'daily-scan' })
  })
})

