import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { migrateIssueSessionSignatures } from './0019_issue_session_signatures/index.js'

let root: string
let wsDir: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mig0019-'))
  wsDir = join(root, 'ws')
  await mkdir(join(wsDir, '.alice', 'issues'), { recursive: true })
  await writeFile(join(root, 'workspaces.json'), JSON.stringify({ workspaces: [{ id: 'ws', tag: 'ws', dir: wsDir, agents: [] }] }))
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('0019 Issue Session signatures', () => {
  it('migrates legacy ownership once and preserves the markdown body', async () => {
    await writeFile(join(wsDir, '.alice', 'issues', 'owned.md'), `---\ntitle: Owned\nassignee: session:resume-kind-owl-abc123\n---\n\nKeep **this**.\n`)
    expect(await migrateIssueSessionSignatures(root)).toEqual({ updated: 1, workspaces: 1 })
    const raw = await readFile(join(wsDir, '.alice', 'issues', 'owned.md'), 'utf8')
    expect(raw).toContain('assignee: "@resume-kind-owl-abc123"')
    expect(raw).toContain('Keep **this**.')
    expect(await migrateIssueSessionSignatures(root)).toEqual({ updated: 0, workspaces: 0 })
  })
})

