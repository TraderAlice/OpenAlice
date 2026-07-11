import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readWorkspaceIssues } from './declaration.js'
import { appendIssueComment, createIssue, updateIssueFields } from './mutate.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'issues-mutate-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Read one issue back through the real reader (the round-trip oracle). */
async function readBack(id: string) {
  const r = await readWorkspaceIssues(dir)
  if (!r.ok) throw new Error(`readWorkspaceIssues not ok: ${JSON.stringify(r)}`)
  const issue = r.issues.find((i) => i.id === id)
  return { issue, invalid: r.invalid }
}

describe('createIssue', () => {
  it('derives a kebab slug from the title and writes a readable issue', async () => {
    const res = await createIssue(dir, { title: 'Fix the Login Bug!' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.issue.id).toBe('fix-the-login-bug')
      expect(res.issue.title).toBe('Fix the Login Bug!')
      // Defaults applied on read-back.
      expect(res.issue.status).toBe('todo')
      expect(res.issue.priority).toBe('none')
      expect(res.issue.assignee).toBe('unassigned')
    }
    const { issue } = await readBack('fix-the-login-bug')
    expect(issue?.title).toBe('Fix the Login Bug!')
  })

  it('honors an explicit id, frontmatter fields, and a body', async () => {
    const res = await createIssue(dir, {
      id: 'morning-sweep',
      title: 'Morning research sweep',
      status: 'in_progress',
      priority: 'high',
      assignee: 'ws:auto-quant',
      when: { kind: 'every', every: '30m' },
      what: 'run the research routine',
      agent: 'codex',
      execution: { mode: 'resume', resumeId: 'resume-kind-owl-abc123' },
      body: 'Scan overnight movers.',
    })
    expect(res.ok).toBe(true)
    const { issue } = await readBack('morning-sweep')
    expect(issue).toMatchObject({
      id: 'morning-sweep',
      title: 'Morning research sweep',
      status: 'in_progress',
      priority: 'high',
      assignee: 'ws:auto-quant',
      what: 'run the research routine',
      agent: 'codex',
      execution: { mode: 'resume', resumeId: 'resume-kind-owl-abc123' },
    })
    expect(issue?.when).toEqual({ kind: 'every', every: '30m' })
    expect(issue?.body).toBe('Scan overnight movers.')
  })

  it('refuses to overwrite an existing issue (conflict)', async () => {
    await createIssue(dir, { id: 'dup', title: 'first' })
    const res = await createIssue(dir, { id: 'dup', title: 'second' })
    expect(res).toEqual({ ok: false, reason: 'conflict', id: 'dup' })
    // The original survives untouched.
    const { issue } = await readBack('dup')
    expect(issue?.title).toBe('first')
  })

  it('returns invalid on an empty title / underivable id', async () => {
    expect((await createIssue(dir, { title: '   ' })).ok).toBe(false)
    const r = await createIssue(dir, { title: '!!!' }) // slug → '' → invalid
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid')
  })

  it('returns invalid for a bad enum field', async () => {
    const r = await createIssue(dir, { title: 'x', status: 'nope' as never })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid')
  })
})

describe('updateIssueFields', () => {
  it('patches status/priority/assignee/agent and preserves body + other scheduling frontmatter', async () => {
    await createIssue(dir, {
      id: 'task-1',
      title: 'Do the thing',
      when: { kind: 'every', every: '15m' },
      what: 'keep the fire prompt',
      agent: 'claude',
      body: 'Body text to preserve.',
    })
    const res = await updateIssueFields(dir, 'task-1', {
      status: 'in_progress',
      priority: 'urgent',
      assignee: 'human',
      agent: 'pi',
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.issue.status).toBe('in_progress')
      expect(res.issue.priority).toBe('urgent')
      expect(res.issue.assignee).toBe('human')
      expect(res.issue.agent).toBe('pi')
    }
    const { issue } = await readBack('task-1')
    expect(issue).toMatchObject({
      status: 'in_progress',
      priority: 'urgent',
      assignee: 'human',
      what: 'keep the fire prompt',
      agent: 'pi',
    })
    expect(issue?.when).toEqual({ kind: 'every', every: '15m' })
    expect(issue?.body).toBe('Body text to preserve.')
  })

  it('clears an issue agent override with null', async () => {
    await createIssue(dir, { id: 'agent-clear', title: 'T', agent: 'claude' })
    const res = await updateIssueFields(dir, 'agent-clear', { agent: null })
    expect(res.ok).toBe(true)
    const { issue } = await readBack('agent-clear')
    expect(issue?.agent).toBeUndefined()
  })

  it('changes scheduled ownership without disturbing the schedule', async () => {
    await createIssue(dir, {
      id: 'owned',
      title: 'Owned',
      when: { kind: 'every', every: '15m' },
      execution: { mode: 'fresh' },
    })
    const res = await updateIssueFields(dir, 'owned', {
      execution: { mode: 'resume', resumeId: 'resume-kind-owl-abc123' },
    })
    expect(res.ok).toBe(true)
    const { issue } = await readBack('owned')
    expect(issue?.execution).toEqual({ mode: 'resume', resumeId: 'resume-kind-owl-abc123' })
    expect(issue?.when).toEqual({ kind: 'every', every: '15m' })
  })

  it('supports a partial patch (only status)', async () => {
    await createIssue(dir, { id: 'p', title: 'T', priority: 'low' })
    const res = await updateIssueFields(dir, 'p', { status: 'done' })
    expect(res.ok).toBe(true)
    const { issue } = await readBack('p')
    expect(issue?.status).toBe('done')
    expect(issue?.priority).toBe('low') // untouched
  })

  it('returns not_found for a missing issue', async () => {
    expect(await updateIssueFields(dir, 'ghost', { status: 'done' })).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })

  it('returns invalid for a bad enum value', async () => {
    await createIssue(dir, { id: 'q', title: 'T' })
    const r = await updateIssueFields(dir, 'q', { status: 'bogus' as never })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid')
  })

  it('returns invalid for an empty assignee', async () => {
    await createIssue(dir, { id: 'r', title: 'T' })
    const r = await updateIssueFields(dir, 'r', { assignee: '   ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid')
  })
})

describe('appendIssueComment', () => {
  it('creates a ## Comments section then appends a stamped block under it', async () => {
    await createIssue(dir, { id: 'c1', title: 'Talk', body: 'Original description.' })
    const res = await appendIssueComment(dir, 'c1', 'human', 'first comment')
    expect(res.ok).toBe(true)
    const { issue } = await readBack('c1')
    expect(issue?.body).toContain('Original description.')
    expect(issue?.body).toContain('## Comments')
    expect(issue?.body).toContain('**human**')
    expect(issue?.body).toContain('first comment')
  })

  it('appends a second comment under the same section (one heading only)', async () => {
    await createIssue(dir, { id: 'c2', title: 'Talk' })
    await appendIssueComment(dir, 'c2', 'human', 'one')
    await appendIssueComment(dir, 'c2', 'ws:auto-quant', 'two')
    const { issue } = await readBack('c2')
    const headingCount = (issue?.body.match(/^##\s+Comments\s*$/gm) ?? []).length
    expect(headingCount).toBe(1)
    expect(issue?.body).toContain('one')
    expect(issue?.body).toContain('two')
    expect(issue?.body).toContain('**ws:auto-quant**')
    // First comment precedes the second.
    expect(issue!.body.indexOf('one')).toBeLessThan(issue!.body.indexOf('two'))
  })

  it('returns not_found for a missing issue', async () => {
    expect(await appendIssueComment(dir, 'ghost', 'human', 'hi')).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })
})

describe('round-trip: create → update → comment → read back', () => {
  it('reflects every mutation through readWorkspaceIssues', async () => {
    await createIssue(dir, { id: 'rt', title: 'Round trip', body: 'desc' })
    await updateIssueFields(dir, 'rt', { status: 'in_progress', assignee: 'human' })
    await appendIssueComment(dir, 'rt', 'human', 'looks good')
    const { issue, invalid } = await readBack('rt')
    expect(invalid).toHaveLength(0)
    expect(issue).toMatchObject({
      id: 'rt',
      title: 'Round trip',
      status: 'in_progress',
      assignee: 'human',
    })
    expect(issue?.body).toContain('desc')
    expect(issue?.body).toContain('## Comments')
    expect(issue?.body).toContain('looks good')
  })
})
