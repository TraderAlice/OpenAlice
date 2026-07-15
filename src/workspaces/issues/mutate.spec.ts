import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readWorkspaceIssues } from './declaration.js'
import { readIssueComments, updateIssueCommentDelivery } from './comments.js'
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
      expect(res.issue.assignee).toBe('@workspace')
    }
    const { issue } = await readBack('fix-the-login-bug')
    expect(issue?.title).toBe('Fix the Login Bug!')
  })

  it('honors an explicit id, frontmatter fields, and canonical What', async () => {
    const res = await createIssue(dir, {
      id: 'morning-sweep',
      title: 'Morning research sweep',
      status: 'in_progress',
      priority: 'high',
      assignee: '@resume-kind-owl-abc123',
      when: { kind: 'every', every: '30m' },
      what: 'run the research routine',
    })
    expect(res.ok).toBe(true)
    const { issue } = await readBack('morning-sweep')
    expect(issue).toMatchObject({
      id: 'morning-sweep',
      title: 'Morning research sweep',
      status: 'in_progress',
      priority: 'high',
      assignee: '@resume-kind-owl-abc123',
      what: 'run the research routine',
    })
    expect(issue?.when).toEqual({ kind: 'every', every: '30m' })
    expect(issue?.what).toBe('run the research routine')
  })

  it('accepts @new only for scheduled work that will choose its first owner', async () => {
    const scheduled = await createIssue(dir, {
      id: 'choose-owner',
      title: 'Choose one owner',
      assignee: '@new',
      when: { kind: 'every', every: '30m' },
      agent: 'pi',
    })
    expect(scheduled.ok && scheduled.issue.assignee).toBe('@new')

    const unscheduled = await createIssue(dir, {
      id: 'no-trigger',
      title: 'No trigger',
      assignee: '@new',
    })
    expect(unscheduled.ok).toBe(false)
    if (!unscheduled.ok) {
      expect(unscheduled.reason).toBe('invalid')
      if (unscheduled.reason === 'invalid') expect(unscheduled.error).toContain('@new needs a schedule')
    }
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
  it('patches properties and preserves canonical What + scheduling frontmatter', async () => {
    await createIssue(dir, {
      id: 'task-1',
      title: 'Do the thing',
      when: { kind: 'every', every: '15m' },
      what: 'keep the fire prompt',
      agent: 'claude',
    })
    const res = await updateIssueFields(dir, 'task-1', {
      status: 'in_progress',
      priority: 'urgent',
      assignee: '@workspace',
      agent: 'pi',
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.issue.status).toBe('in_progress')
      expect(res.issue.priority).toBe('urgent')
      expect(res.issue.assignee).toBe('@workspace')
      expect(res.issue.agent).toBe('pi')
    }
    const { issue } = await readBack('task-1')
    expect(issue).toMatchObject({
      status: 'in_progress',
      priority: 'urgent',
      assignee: '@workspace',
      what: 'keep the fire prompt',
      agent: 'pi',
    })
    expect(issue?.when).toEqual({ kind: 'every', every: '15m' })
    expect(issue?.what).toBe('keep the fire prompt')
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
      assignee: '@workspace',
      agent: 'codex',
    })
    const res = await updateIssueFields(dir, 'owned', {
      assignee: '@resume-kind-owl-abc123',
    })
    expect(res.ok).toBe(true)
    const { issue } = await readBack('owned')
    expect(issue?.assignee).toBe('@resume-kind-owl-abc123')
    expect(issue?.agent).toBeUndefined()
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

  it('records reply edges and updates durable delivery state idempotently', async () => {
    await createIssue(dir, { id: 'threaded', title: 'Threaded' })
    const source = await appendIssueComment(dir, 'threaded', 'human', 'why?', {
      id: 'comment-source',
      delivery: { state: 'pending', targetResumeId: 'resume-owner', taskId: 'run-1' },
    })
    expect(source.ok).toBe(true)
    const reply = await appendIssueComment(dir, 'threaded', '@resume-owner', 'because', {
      id: 'comment-reply-run-1',
      replyTo: 'comment-source',
    })
    expect(reply.ok).toBe(true)
    const duplicate = await appendIssueComment(dir, 'threaded', '@resume-owner', 'because', {
      id: 'comment-reply-run-1',
      replyTo: 'comment-source',
    })
    expect(duplicate.ok && duplicate.comment.id).toBe('comment-reply-run-1')
    await updateIssueCommentDelivery(dir, 'threaded', 'comment-source', {
      state: 'replied',
      targetResumeId: 'resume-owner',
      taskId: 'run-1',
      replyCommentId: 'comment-reply-run-1',
    })
    const comments = await readIssueComments(dir, 'threaded')
    expect(comments.ok && comments.comments).toEqual([
      expect.objectContaining({
        id: 'comment-source',
        delivery: expect.objectContaining({ state: 'replied', replyCommentId: 'comment-reply-run-1' }),
      }),
      expect.objectContaining({ id: 'comment-reply-run-1', replyTo: 'comment-source' }),
    ])
  })
})

describe('appendIssueComment', () => {
  it('writes a structured sidecar without changing What', async () => {
    await createIssue(dir, { id: 'c1', title: 'Talk', what: 'Original description.' })
    const res = await appendIssueComment(dir, 'c1', 'human', 'first comment')
    expect(res.ok).toBe(true)
    const { issue } = await readBack('c1')
    expect(issue?.what).toBe('Original description.')
    const comments = await readIssueComments(dir, 'c1')
    expect(comments.ok && comments.comments).toEqual([
      expect.objectContaining({ author: 'human', markdown: 'first comment' }),
    ])
  })

  it('appends comments in order to one per-Issue sidecar', async () => {
    await createIssue(dir, { id: 'c2', title: 'Talk' })
    await appendIssueComment(dir, 'c2', 'human', 'one')
    await appendIssueComment(dir, 'c2', 'ws:auto-quant', 'two')
    const comments = await readIssueComments(dir, 'c2')
    expect(comments.ok && comments.comments.map((comment) => [comment.author, comment.markdown])).toEqual([
      ['human', 'one'],
      ['ws:auto-quant', 'two'],
    ])
  })

  it('returns not_found for a missing issue', async () => {
    expect(await appendIssueComment(dir, 'ghost', 'human', 'hi')).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })
})

describe('round-trip: create → update → comment → read back', () => {
  it('keeps work definition and comments independently readable', async () => {
    await createIssue(dir, { id: 'rt', title: 'Round trip', what: 'desc' })
    await updateIssueFields(dir, 'rt', { status: 'in_progress', assignee: '@human' })
    await appendIssueComment(dir, 'rt', 'human', 'looks good')
    const { issue, invalid } = await readBack('rt')
    expect(invalid).toHaveLength(0)
    expect(issue).toMatchObject({
      id: 'rt',
      title: 'Round trip',
      status: 'in_progress',
      assignee: '@human',
    })
    expect(issue?.what).toBe('desc')
    const comments = await readIssueComments(dir, 'rt')
    expect(comments.ok && comments.comments[0]).toMatchObject({ author: 'human', markdown: 'looks good' })
  })
})
