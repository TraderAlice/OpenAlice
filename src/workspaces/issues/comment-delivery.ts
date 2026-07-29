import type {
  WorkspaceConversationCaller,
  WorkspaceConversationControl,
} from '../../core/workspace-tool-center.js'
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
  | { status: 'not_requested'; reason: 'non_human_note' | 'owner_commented' }
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
 * delivered to that exact product Session. Human comments on Issues without a
 * fixed owner use the same provenance-aware fallback as Inbox: continue the
 * creator when attributable, otherwise recruit a reconstruction worker in the
 * Issue Workspace. That answering Session is a collaborator, not a new owner;
 * the Issue assignee and scheduling contract stay unchanged.
 *
 * Agent-authored comments on Issues without a fixed owner remain notes. This
 * avoids turning progress logging into an unsolicited worker fan-out.
 */
export async function dispatchIssueCommentReply(input: {
  conversation?: WorkspaceConversationControl
  issueWorkspaceId: string
  issue: IssueRecord
  comment: IssueComment
  authorResumeId?: string
  source?: WorkspaceConversationCaller
}): Promise<IssueCommentDispatchResult> {
  const targetResumeId = issueAssigneeResumeId(input.issue.assignee)
  if (targetResumeId === input.authorResumeId) {
    return { status: 'not_requested', reason: 'owner_commented' }
  }
  if (!targetResumeId && input.source?.kind !== 'human') {
    return { status: 'not_requested', reason: 'non_human_note' }
  }
  if (!input.conversation) {
    return {
      status: 'failed',
      delivery: {
        state: 'failed',
        ...(targetResumeId ? { targetResumeId } : {}),
        error: 'Issue conversation delivery is unavailable in this runtime.',
      },
    }
  }

  try {
    const target = targetResumeId
      ? { kind: 'resume' as const, resumeId: targetResumeId }
      : {
          kind: 'issue' as const,
          workspaceId: input.issueWorkspaceId,
          issueId: input.issue.id,
          action: 'created' as const,
        }
    const result = await input.conversation.ask({
      prompt: issueCommentReplyPrompt(input),
      target,
      timeoutMs: COMMENT_REPLY_TIMEOUT_MS,
      ...(!targetResumeId ? { reconstruct: true } : {}),
      ...(input.source ? { source: input.source } : {}),
      subject: {
        kind: 'issue',
        workspaceId: input.issueWorkspaceId,
        issueId: input.issue.id,
        relation: targetResumeId ? 'owner' : 'creator',
        commentId: input.comment.id,
      },
    })
    if (result.status === 'unavailable') {
      const unavailableTargetResumeId = targetResumeId
        ?? result.resolution.attributedOrigin?.resumeId
      return {
        status: 'failed',
        delivery: {
          state: 'failed',
          ...(unavailableTargetResumeId ? { targetResumeId: unavailableTargetResumeId } : {}),
          error: `Could not reach an Agent for this Issue: ${result.resolution.reason}.`,
        },
      }
    }
    return {
      status: 'scheduled',
      delivery: {
        state: 'pending',
        targetResumeId: result.resumeId,
        taskId: result.taskId,
      },
    }
  } catch (err) {
    return {
      status: 'failed',
      delivery: {
        state: 'failed',
        ...(targetResumeId ? { targetResumeId } : {}),
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
          ? 'The Issue reply Agent finished without a final reply.'
          : `The Issue reply run ended as ${input.status}.`),
    },
  )
  if (!updated.ok) throw new Error(updated.error)
  return 'failed'
}
