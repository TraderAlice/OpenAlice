import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { migrateSemanticIssueAssignees } from './0033_semantic_issue_assignees/index.js'

let root: string
let workspace: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'semantic-issue-assignees-'))
  workspace = join(root, 'workspace')
  await mkdir(join(workspace, '.alice', 'issues'), { recursive: true })
  await writeFile(join(root, 'workspaces.json'), JSON.stringify({
    workspaces: [{ id: 'ws-1', dir: workspace }],
  }))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function issue(name: string, frontmatter: string, body = 'Keep **this**.\n'): Promise<void> {
  await writeFile(
    join(workspace, '.alice', 'issues', `${name}.md`),
    `---\n${frontmatter}\n---\n\n${body}`,
  )
}

describe('0033 semantic Issue assignees', () => {
  it('migrates both scheduled policies and the old unscheduled default with backups', async () => {
    await issue('each', 'title: Each\nassignee: "@workspace"\nwhen: { kind: every, every: 1h }')
    await issue('sticky', 'title: Sticky\nassignee: "@new"\nwhen: { kind: every, every: 1h }')
    await issue('plain', 'title: Plain\nassignee: "@workspace"')
    await issue('owned', 'title: Owned\nassignee: "@resume-kind-owl-a1b2c3"')
    const backup = join(root, 'backup')

    await expect(migrateSemanticIssueAssignees(root, { backupRoot: backup }))
      .resolves.toEqual({ updated: 3, workspaces: 1 })
    expect(await readFile(join(workspace, '.alice', 'issues', 'each.md'), 'utf8'))
      .toContain('assignee: "@new-each-run"')
    expect(await readFile(join(workspace, '.alice', 'issues', 'sticky.md'), 'utf8'))
      .toContain('assignee: "@new-then-resume"')
    expect(await readFile(join(workspace, '.alice', 'issues', 'plain.md'), 'utf8'))
      .toContain('assignee: "@unassigned"')
    expect(await readFile(join(workspace, '.alice', 'issues', 'owned.md'), 'utf8'))
      .toContain('@resume-kind-owl-a1b2c3')
    expect(await readFile(join(backup, 'ws-1', 'each.md'), 'utf8'))
      .toContain('assignee: "@workspace"')
    expect(await readFile(join(workspace, '.alice', 'issues', 'each.md'), 'utf8'))
      .toContain('Keep **this**.')

    await expect(migrateSemanticIssueAssignees(root, { backupRoot: backup }))
      .resolves.toEqual({ updated: 0, workspaces: 0 })
  })

  it('leaves malformed and already canonical files untouched', async () => {
    await issue('canonical', 'title: Canonical\nassignee: "@new-then-resume"\nwhen: { kind: every, every: 1h }')
    await writeFile(join(workspace, '.alice', 'issues', 'broken.md'), '---\n{broken\n---\nbody')

    await expect(migrateSemanticIssueAssignees(root))
      .resolves.toEqual({ updated: 0, workspaces: 0 })
    expect(await readFile(join(workspace, '.alice', 'issues', 'broken.md'), 'utf8'))
      .toBe('---\n{broken\n---\nbody')
  })
})
