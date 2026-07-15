import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceConversationControl } from '../../core/workspace-tool-center.js'
import { dispatchIssueCommentReply, recordIssueCommentReply } from './comment-delivery.js'
import { appendIssueComment, readIssueComments, type IssueComment } from './comments.js'
import type { IssueRecord } from './declaration.js'
import { createIssue } from './mutate.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'issue-comment-delivery-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const comment: IssueComment = {
  id: 'comment-1',
  author: 'human',
  at: new Date(0).toISOString(),
  markdown: 'What changed?',
}

function issue(assignee: string): IssueRecord {
  return {
    id: 'audit',
    title: 'Audit the close',
    what: 'Inspect the close.',
    status: 'todo',
    priority: 'none',
    assignee,
  }
}

function conversation(result: Awaited<ReturnType<WorkspaceConversationControl['ask']>>) {
  return {
    ask: vi.fn(async () => result),
    read: vi.fn(),
  } as unknown as WorkspaceConversationControl
}

describe('dispatchIssueCommentReply', () => {
  it('keeps workspace-owned Issues as notes without recruiting a worker', async () => {
    expect(await dispatchIssueCommentReply({
      issueWorkspaceId: 'ws-home',
      issue: issue('@workspace'),
      comment,
    })).toEqual({ status: 'not_requested', reason: 'no_fixed_owner' })
  })

  it('does not notify an owner about their own comment', async () => {
    expect(await dispatchIssueCommentReply({
      issueWorkspaceId: 'ws-home',
      issue: issue('@resume-owner'),
      comment,
      authorResumeId: 'resume-owner',
    })).toEqual({ status: 'not_requested', reason: 'owner_commented' })
  })

  it('continues the exact assigned Session and reverse-links the source comment', async () => {
    const control = conversation({
      status: 'dispatched',
      taskId: 'run-reply',
      resumeId: 'resume-owner',
      workspaceId: 'ws-owner',
      workspace: 'owner-desk',
      agent: 'pi',
      resolution: {
        mode: 'exact',
        origin: { kind: 'session', workspaceId: 'ws-owner', resumeId: 'resume-owner', agent: 'pi' },
      },
    })
    const result = await dispatchIssueCommentReply({
      conversation: control,
      issueWorkspaceId: 'ws-home',
      issue: issue('@resume-owner'),
      comment,
    })
    expect(result).toEqual({
      status: 'scheduled',
      delivery: { state: 'pending', targetResumeId: 'resume-owner', taskId: 'run-reply' },
    })
    expect(control.ask).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'resume', resumeId: 'resume-owner' },
      subject: {
        kind: 'issue', workspaceId: 'ws-home', issueId: 'audit', relation: 'owner', commentId: 'comment-1',
      },
    }))
  })

  it('preserves the comment while surfacing an unreachable owner', async () => {
    const control = conversation({
      status: 'unavailable',
      resolution: { mode: 'unavailable', reason: 'retired-session' },
    })
    expect(await dispatchIssueCommentReply({
      conversation: control,
      issueWorkspaceId: 'ws-home',
      issue: issue('@resume-owner'),
      comment,
    })).toEqual({
      status: 'failed',
      delivery: expect.objectContaining({
        state: 'failed', targetResumeId: 'resume-owner', error: expect.stringContaining('retired-session'),
      }),
    })
  })
})

describe('recordIssueCommentReply', () => {
  it('writes the owner answer once, links it to the source, and closes delivery', async () => {
    await createIssue(dir, { id: 'audit', title: 'Audit', assignee: '@resume-owner' })
    await appendIssueComment(dir, 'audit', 'human', 'why?', {
      id: 'comment-source',
      delivery: { state: 'pending', targetResumeId: 'resume-owner', taskId: 'run-reply' },
    })
    const appendProvenance = vi.fn(async (input) => ({ id: 'p-1', ...input }))
    const task = {
      taskId: 'run-reply',
      resumeId: 'resume-owner',
      wsId: 'ws-owner',
      agent: 'pi',
      prompt: 'reply',
      status: 'done' as const,
      startedAt: 1,
      finishedAt: 2,
      inquiry: {
        subject: { kind: 'issue' as const, workspaceId: 'ws-home', issueId: 'audit', relation: 'owner' as const, commentId: 'comment-source' },
        question: 'why?',
        resolution: { mode: 'exact' as const },
      },
    }
    const input = {
      issueWorkspaceId: 'ws-home',
      issueWorkspaceDir: dir,
      issueId: 'audit',
      sourceCommentId: 'comment-source',
      task,
      status: 'done' as const,
      assistantText: 'Here is the reason.',
      provenanceStore: { append: appendProvenance, list: vi.fn(), latest: vi.fn() },
    }
    expect(await recordIssueCommentReply(input)).toBe('replied')
    expect(await recordIssueCommentReply(input)).toBe('replied')
    const comments = await readIssueComments(dir, 'audit')
    expect(comments.ok && comments.comments).toEqual([
      expect.objectContaining({
        id: 'comment-source',
        delivery: expect.objectContaining({ state: 'replied', replyCommentId: 'comment-reply-run-reply' }),
      }),
      expect.objectContaining({
        id: 'comment-reply-run-reply',
        author: '@resume-owner',
        replyTo: 'comment-source',
        markdown: 'Here is the reason.',
      }),
    ])
    expect(appendProvenance).toHaveBeenCalledWith(expect.objectContaining({
      fingerprint: 'issue-comment-reply:run-reply',
      origin: expect.objectContaining({ resumeId: 'resume-owner' }),
    }))
  })

  it('marks delivery failed when the owner exits without a reply', async () => {
    await createIssue(dir, { id: 'audit', title: 'Audit', assignee: '@resume-owner' })
    await appendIssueComment(dir, 'audit', 'human', 'why?', {
      id: 'comment-source',
      delivery: { state: 'pending', targetResumeId: 'resume-owner', taskId: 'run-reply' },
    })
    await recordIssueCommentReply({
      issueWorkspaceId: 'ws-home',
      issueWorkspaceDir: dir,
      issueId: 'audit',
      sourceCommentId: 'comment-source',
      task: {
        taskId: 'run-reply', resumeId: 'resume-owner', wsId: 'ws-owner', agent: 'pi',
        prompt: 'reply', status: 'failed', startedAt: 1,
      },
      status: 'failed',
      error: 'runtime unavailable',
      provenanceStore: { append: vi.fn(), list: vi.fn(), latest: vi.fn() },
    })
    const comments = await readIssueComments(dir, 'audit')
    expect(comments.ok && comments.comments[0]?.delivery).toEqual({
      state: 'failed', targetResumeId: 'resume-owner', taskId: 'run-reply', error: 'runtime unavailable',
    })
  })
})
