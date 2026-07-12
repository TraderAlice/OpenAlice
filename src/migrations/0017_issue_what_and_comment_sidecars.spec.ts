import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readWorkspaceIssues } from '@/workspaces/issues/declaration.js'
import { readIssueComments } from '@/workspaces/issues/comments.js'

import { migrateIssueWhatAndCommentSidecars } from './0017_issue_what_and_comment_sidecars/index.js'

let root: string
let wsDir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mig0017-'))
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

describe('0017 issue What and comment sidecars', () => {
  it('moves YAML What into markdown and extracts legacy comments without prompt leakage', async () => {
    await writeFile(join(wsDir, '.alice', 'issues', 'daily.md'), `---
title: Daily scan
when: { kind: every, every: 1h }
what: Run the daily scan and publish it.
---

Use the latest market data.

## Comments

**human** · 2026-07-11T01:00:00.000Z

Please include breadth.

**ws:research** · 2026-07-11T02:00:00.000Z

Breadth was added.
`, 'utf8')

    expect(await migrateIssueWhatAndCommentSidecars(root)).toEqual({
      updated: 1,
      commentsMoved: 2,
      workspaces: 1,
    })

    const raw = await readFile(join(wsDir, '.alice', 'issues', 'daily.md'), 'utf8')
    expect(raw).not.toMatch(/^what:/m)
    expect(raw).not.toContain('## Comments')
    expect(raw).toContain('Run the daily scan and publish it.\n\n## Context\n\nUse the latest market data.')

    const issues = await readWorkspaceIssues(wsDir)
    expect(issues.ok).toBe(true)
    if (!issues.ok) return
    expect(issues.issues[0].what).toBe('Run the daily scan and publish it.\n\n## Context\n\nUse the latest market data.')

    const comments = await readIssueComments(wsDir, 'daily')
    expect(comments.ok).toBe(true)
    if (!comments.ok) return
    expect(comments.comments.map((comment) => [comment.author, comment.markdown])).toEqual([
      ['human', 'Please include breadth.'],
      ['ws:research', 'Breadth was added.'],
    ])

    expect(await migrateIssueWhatAndCommentSidecars(root)).toEqual({
      updated: 0,
      commentsMoved: 0,
      workspaces: 0,
    })
  })

  it('preserves an unparseable legacy comment section as one markdown record', async () => {
    await writeFile(join(wsDir, '.alice', 'issues', 'odd.md'), `---
title: Odd comments
---

Do the work.

## Comments

An agent rewrote this section into arbitrary markdown.

- keep every line
`, 'utf8')

    await migrateIssueWhatAndCommentSidecars(root)
    const comments = await readIssueComments(wsDir, 'odd')
    expect(comments.ok).toBe(true)
    if (!comments.ok) return
    expect(comments.comments).toEqual([
      expect.objectContaining({
        author: 'legacy',
        markdown: 'An agent rewrote this section into arbitrary markdown.\n\n- keep every line',
      }),
    ])
  })
})
