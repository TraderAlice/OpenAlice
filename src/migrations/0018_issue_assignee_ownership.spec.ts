import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readWorkspaceIssues } from '@/workspaces/issues/declaration.js'

import { migrateIssueAssigneeOwnership } from './0018_issue_assignee_ownership/index.js'
import { migrateIssueSessionSignatures } from './0019_issue_session_signatures/index.js'

let root: string
let wsDir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mig0018-'))
  wsDir = join(root, 'workspaces', 'research')
  await mkdir(join(wsDir, '.alice', 'issues'), { recursive: true })
  await writeFile(join(root, 'workspaces.json'), JSON.stringify({
    version: 1,
    workspaces: [{ id: 'research', tag: 'research', dir: wsDir, agents: [] }],
  }), 'utf8')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('0018 Issue assignee ownership', () => {
  it('folds resume/fresh execution into assignee and removes the parallel field', async () => {
    await writeFile(join(wsDir, '.alice', 'issues', 'owned.md'), `---
title: Owned
assignee: ws:research
when: { kind: every, every: 1h }
agent: codex
execution: { mode: resume, resumeId: resume-calm-cedar-a1b2c3 }
---

Do the work.
`, 'utf8')
    await writeFile(join(wsDir, '.alice', 'issues', 'fresh.md'), `---
title: Fresh
assignee: human
when: { kind: cron, cron: "0 9 * * 1-5" }
execution: { mode: fresh }
---

Do fresh work.
`, 'utf8')

    expect(await migrateIssueAssigneeOwnership(root)).toEqual({ updated: 2, workspaces: 1 })

    const owned = await readFile(join(wsDir, '.alice', 'issues', 'owned.md'), 'utf8')
    expect(owned).toContain('assignee: session:resume-calm-cedar-a1b2c3')
    expect(owned).not.toMatch(/^execution:/m)
    expect(owned).not.toMatch(/^agent:/m)

    const fresh = await readFile(join(wsDir, '.alice', 'issues', 'fresh.md'), 'utf8')
    expect(fresh).toContain('assignee: workspace')
    expect(fresh).not.toMatch(/^execution:/m)

    expect(await migrateIssueAssigneeOwnership(root)).toEqual({ updated: 0, workspaces: 0 })
    await migrateIssueSessionSignatures(root)

    const issues = await readWorkspaceIssues(wsDir)
    expect(issues.ok).toBe(true)
    if (!issues.ok) return
    expect(issues.issues.map((issue) => [issue.id, issue.assignee])).toEqual([
      ['fresh', '@workspace'],
      ['owned', '@resume-calm-cedar-a1b2c3'],
    ])
  })

  it('normalizes old workspace labels while preserving unscheduled human ownership', async () => {
    await writeFile(join(wsDir, '.alice', 'issues', 'workspace.md'), `---
title: Workspace
assignee: ws:research
---

Workspace-owned.
`, 'utf8')
    await writeFile(join(wsDir, '.alice', 'issues', 'human.md'), `---
title: Human
assignee: human
---

Human-owned.
`, 'utf8')

    await migrateIssueAssigneeOwnership(root)
    await migrateIssueSessionSignatures(root)
    const issues = await readWorkspaceIssues(wsDir)
    expect(issues.ok).toBe(true)
    if (!issues.ok) return
    expect(issues.issues.map((issue) => [issue.id, issue.assignee])).toEqual([
      ['human', '@human'],
      ['workspace', '@workspace'],
    ])
  })
})
