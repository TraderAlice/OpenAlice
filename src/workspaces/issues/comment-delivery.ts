import type { WorkspaceConversationControl } from '../../core/workspace-tool-center.js'
import type { IProvenanceStore } from '../../core/provenance-store.js'
import type { HeadlessTaskRecord, HeadlessTaskStatus } from '../headless-task-registry.js'
import { sessionSignature } from '../session-signature.js'
import {
  appendIssueComment,
  updateIssueCommentDelivery,
  type IssueComment,
  type IssueCommentDelivery,
} from './comments.js'
import { issueAssigneeResumeId, type IssueRecord } from './declaration.js'

const COMMENT_REPLY_TIMEOUT_MS = 300_000

export type IssueCommentDispatchResult =
  | { status: 'not_requested'; reason: 'no_fixed_owner' | 'owner_commented' }
  | { status: 'scheduled'; delivery: Extract<IssueCommentDelivery, { state: 'pending' }> }
  | { status: 'failed'; delivery: Extract<IssueCommentDelivery, { state: 'failed' }> }

export function issueCommentReplyPrompt(input: {
  issueWorkspaceId: string
  issue: IssueRecord
  comment: IssueComment
}): string {
  return [
    `A new comment was left on Issue ${input.issueWorkspaceId}/${input.issue.id} (${input.issue.title}) by ${input.comment.author}.`,
    '',
    input.comment.markdown,
    '',
    'Reply directly to this comment. Your final assistant response will be recorded automatically in the Issue Activity timeline.',
    'Do not call `alice-workspace issue comment` for this reply; that would create a second notification loop.',
  ].join('\n')
}

/**
 * A fixed Issue owner is a real colleague: comments from somebody else are
 * delivered to that exact product Session. Workspace-owned Issues deliberately
 * stay notes-only because recruiting an arbitrary worker for every comment
 * would invent an owner and blur the Issue's scheduling contract.
 */
export async function dispatchIssueCommentReply(input: {
  conversation?: WorkspaceConversationControl
  issueWorkspaceId: string
  issue: IssueRecord
  comment: IssueComment
  authorResumeId?: string
}): Promise<IssueCommentDispatchResult> {
  const targetResumeId = issueAssigneeResumeId(input.issue.assignee)
  if (!targetResumeId) return { status: 'not_requested', reason: 'no_fixed_owner' }
  if (targetResumeId === input.authorResumeId) {
    return { status: 'not_requested', reason: 'owner_commented' }
  }
  if (!input.conversation) {
    return {
      status: 'failed',
      delivery: {
        state: 'failed',
        targetResumeId,
        error: 'Issue conversation delivery is unavailable in this runtime.',
      },
    }
  }

  try {
    const result = await input.conversation.ask({
      prompt: issueCommentReplyPrompt(input),
      target: { kind: 'resume', resumeId: targetResumeId },
      timeoutMs: COMMENT_REPLY_TIMEOUT_MS,
      subject: {
        kind: 'issue',
        workspaceId: input.issueWorkspaceId,
        issueId: input.issue.id,
        relation: 'owner',
        commentId: input.comment.id,
      },
    })
    if (result.status === 'unavailable') {
      return {
        status: 'failed',
        delivery: {
          state: 'failed',
          targetResumeId,
          error: `Could not reach the Issue owner: ${result.resolution.reason}.`,
        },
      }
    }
    return {
      status: 'scheduled',
      delivery: {
        state: 'pending',
        targetResumeId,
        taskId: result.taskId,
      },
    }
  } catch (err) {
    return {
      status: 'failed',
      delivery: {
        state: 'failed',
        targetResumeId,
        error: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

/**
 * Finish the other half of comment delivery after the owner run exits. The
 * reply comment id is derived from the task id, so replaying completion after a
 * process or persistence retry cannot append the same answer twice.
 */
export async function recordIssueCommentReply(input: {
  issueWorkspaceId: string
  issueWorkspaceDir: string
  issueId: string
  sourceCommentId: string
  task: HeadlessTaskRecord
  status: HeadlessTaskStatus
  assistantText?: string | null
  error?: string
  provenanceStore: IProvenanceStore
}): Promise<'replied' | 'failed'> {
  const reply = input.assistantText?.trim()
  if (input.status === 'done' && reply) {
    const replyCommentId = `comment-reply-${input.task.taskId}`
    const appended = await appendIssueComment(
      input.issueWorkspaceDir,
      input.issueId,
      sessionSignature(input.task.resumeId),
      reply,
      { id: replyCommentId, replyTo: input.sourceCommentId },
    )
    if (!appended.ok) {
      throw new Error(
        appended.reason === 'invalid' ? appended.error : 'Issue disappeared before its reply was recorded.',
      )
    }
    await input.provenanceStore.append({
      artifact: { kind: 'issue', workspaceId: input.issueWorkspaceId, issueId: input.issueId },
      action: 'commented',
      origin: {
        kind: 'session',
        workspaceId: input.task.wsId,
        resumeId: input.task.resumeId,
        agent: input.task.agent,
        execution: { kind: 'headless', taskId: input.task.taskId },
      },
      at: input.task.finishedAt ?? Date.now(),
      fingerprint: `issue-comment-reply:${input.task.taskId}`,
    })
    const updated = await updateIssueCommentDelivery(
      input.issueWorkspaceDir,
      input.issueId,
      input.sourceCommentId,
      {
        state: 'replied',
        targetResumeId: input.task.resumeId,
        taskId: input.task.taskId,
        replyCommentId,
      },
    )
    if (!updated.ok) throw new Error(updated.error)
    return 'replied'
  }

  const updated = await updateIssueCommentDelivery(
    input.issueWorkspaceDir,
    input.issueId,
    input.sourceCommentId,
    {
      state: 'failed',
      targetResumeId: input.task.resumeId,
      taskId: input.task.taskId,
      error: input.error
        ?? (input.status === 'done'
          ? 'The Issue owner finished without a final reply.'
          : `The Issue owner run ended as ${input.status}.`),
    },
  )
  if (!updated.ok) throw new Error(updated.error)
  return 'failed'
}
