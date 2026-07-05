import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readWorkspaceIssues } from '@/workspaces/issues/declaration.js'
import { snapshotBoardIssue } from '@/workspaces/issues/board.js'

import { migrateWorkspaceIssueAssigneeDefaults } from './0011_workspace_issue_assignee_defaults/index.js'

let root: string
const wsDir: Record<string, string> = {}

async function makeLauncher(ids: string[]): Promise<void> {
  await mkdir(root, { recursive: true })
  const workspaces = ids.map((id) => {
    const dir = join(root, 'workspaces', id)
    wsDir[id] = dir
    return { id, tag: id, dir, createdAt: '2026-01-01T00:00:00Z', agents: [] }
  })
  await writeFile(join(root, 'workspaces.json'), JSON.stringify({ version: 1, workspaces }), 'utf-8')
  for (const w of workspaces) await mkdir(join(w.dir, '.alice', 'issues'), { recursive: true })
}

function issueMd(frontmatter: string, body = 'Body\n'): string {
  return `---\n${frontmatter}\n---\n\n${body}`
}

async function writeIssue(ws: string, id: string, frontmatter: string, body?: string): Promise<void> {
  await writeFile(join(wsDir[ws], '.alice', 'issues', `${id}.md`), issueMd(frontmatter, body), 'utf-8')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mig0011-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('0011 workspace issue assignee defaults', () => {
  it('removes legacy assignee: unassigned so the board defaults ownership to the workspace', async () => {
    await makeLauncher(['chat-jul3'])
    await writeIssue('chat-jul3', 'scan', 'title: Scan\nassignee: unassigned\nwhen: { kind: cron, cron: "30 16 * * 1-5" }')

    const res = await migrateWorkspaceIssueAssigneeDefaults(root)
    expect(res).toEqual({ updated: 1, workspaces: 1 })

    const raw = await readFile(join(wsDir['chat-jul3'], '.alice', 'issues', 'scan.md'), 'utf-8')
    expect(raw).not.toContain('assignee:')

    const read = await readWorkspaceIssues(wsDir['chat-jul3'])
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.issues[0].assigneeDefaulted).toBe(true)
    expect(snapshotBoardIssue(read.issues[0], null, 'chat-jul3').assignee).toBe('ws:chat-jul3')
  })

  it('leaves explicit non-default assignees untouched and is idempotent', async () => {
    await makeLauncher(['chat-jul4'])
    await writeIssue('chat-jul4', 'human', 'title: Human\nassignee: human')
    await writeIssue('chat-jul4', 'workspace', 'title: Workspace\nassignee: ws:chat-jul4')

    expect(await migrateWorkspaceIssueAssigneeDefaults(root)).toEqual({ updated: 0, workspaces: 0 })
    expect(await migrateWorkspaceIssueAssigneeDefaults(root)).toEqual({ updated: 0, workspaces: 0 })

    const read = await readWorkspaceIssues(wsDir['chat-jul4'])
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(Object.fromEntries(read.issues.map((issue) => [issue.id, issue.assignee]))).toEqual({
      human: 'human',
      workspace: 'ws:chat-jul4',
    })
  })

  it('skips malformed issue files without blocking other files', async () => {
    await makeLauncher(['chat-jul5'])
    await writeIssue('chat-jul5', 'good', 'title: Good\nassignee: unassigned')
    await writeFile(join(wsDir['chat-jul5'], '.alice', 'issues', 'bad.md'), '---\ntitle: : :\n---\n', 'utf-8')

    expect(await migrateWorkspaceIssueAssigneeDefaults(root)).toEqual({ updated: 1, workspaces: 1 })
    const raw = await readFile(join(wsDir['chat-jul5'], '.alice', 'issues', 'good.md'), 'utf-8')
    expect(raw).not.toContain('assignee:')
  })
})
