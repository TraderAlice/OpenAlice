import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { HeadlessTurnProgress } from '../headless-progress.js'
import {
  appendIssueComment,
  readIssueComments,
  updateIssueCommentDelivery,
  updateIssueCommentProgress,
} from './comments.js'
import { createIssue } from './mutate.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'issue-comment-progress-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const progress: HeadlessTurnProgress = {
  updatedAt: 10,
  assistantText: null,
  blocks: [{ type: 'tool', id: 't1', name: 'Read', status: 'running' }],
  metrics: { textBlocks: 0, toolCalls: 1, toolFailures: 0 },
}

describe('updateIssueCommentProgress', () => {
  it('attaches compact progress to a pending comment and skips identical snapshots', async () => {
    await createIssue(dir, { id: 'desk', title: 'Desk' })
    await appendIssueComment(dir, 'desk', 'human', 'hello', {
      id: 'comment-1',
      delivery: { state: 'pending', targetResumeId: 'resume-owner', taskId: 'run-1' },
    })
    const first = await updateIssueCommentProgress(dir, 'desk', 'comment-1', progress)
    expect(first.ok && first.changed).toBe(true)
    const repeat = await updateIssueCommentProgress(dir, 'desk', 'comment-1', {
      ...progress,
      updatedAt: 99,
    })
    expect(repeat.ok && repeat.changed).toBe(false)
    const comments = await readIssueComments(dir, 'desk')
    expect(comments.ok && comments.comments[0]?.delivery).toEqual({
      state: 'pending',
      targetResumeId: 'resume-owner',
      taskId: 'run-1',
      progress,
    })
  })

  it('serializes concurrent sidecar mutations without losing comments', async () => {
    await createIssue(dir, { id: 'desk', title: 'Desk' })
    const writes = Array.from({ length: 20 }, (_, index) => appendIssueComment(
      dir,
      'desk',
      'human',
      `comment ${index}`,
      { id: `comment-${index}` },
    ))
    const results = await Promise.all(writes)
    expect(results.every((result) => result.ok)).toBe(true)
    const comments = await readIssueComments(dir, 'desk')
    expect(comments.ok && comments.comments.map((comment) => comment.id).sort()).toEqual(
      Array.from({ length: 20 }, (_, index) => `comment-${index}`).sort(),
    )
  })

  it('refuses progress once the comment is no longer pending', async () => {
    await createIssue(dir, { id: 'desk', title: 'Desk' })
    await appendIssueComment(dir, 'desk', 'human', 'hello', {
      id: 'comment-1',
      delivery: { state: 'pending', targetResumeId: 'resume-owner', taskId: 'run-1' },
    })
    await updateIssueCommentDelivery(dir, 'desk', 'comment-1', {
      state: 'replied',
      targetResumeId: 'resume-owner',
      taskId: 'run-1',
      replyCommentId: 'comment-reply-run-1',
    })
    const updated = await updateIssueCommentProgress(dir, 'desk', 'comment-1', progress)
    expect(updated.ok).toBe(false)
  })
})
