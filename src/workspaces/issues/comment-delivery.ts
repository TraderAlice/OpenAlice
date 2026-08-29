import type {
  WorkspaceConversationCaller,
  WorkspaceConversationControl,
} from '../../core/workspace-tool-center.js'
import type { ArtifactOrigin, IProvenanceStore } from '../../core/provenance-store.js'
import type { HeadlessTaskRecord, HeadlessTaskStatus } from '../headless-task-registry.js'
import { logger as launcherLogger } from '../logger.js'
import { sessionSignature } from '../session-signature.js'
import { claimIssueFirstSession, issueRuntimeSelection } from './claim-session.js'
import {
  appendIssueComment,
  updateIssueCommentDelivery,
  type IssueComment,
  type IssueCommentDelivery,
} from './comments.js'
import { renderIssueCommentPrompt } from './comment-prompt.js'
import {
  issueAssigneeClaimsFirstSession,
  issueAssigneeResumeId,
  type IssueRecord,
} from './declaration.js'
import {
  projectDeskComment,
  projectWorkspaceDeskFailure,
} from './telegram-desk-project.js'

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
  return renderIssueCommentPrompt(input.issue.commentPrompt, {
    comment: input.comment.markdown,
    title: input.issue.title,
    id: input.issue.id,
    workspaceId: input.issueWorkspaceId,
    author: input.comment.author,
    what: input.issue.what,
  })
}

/**
 * Current `assignee` is the only comment-dispatch contract.
 *
 * - Exact `@resumeId`: continue that Session.
 * - `@new-then-resume`: recruit a fresh Session in the Issue Workspace and
 *   claim it as owner. Creator / prior-reconstruction provenance must not win
 *   after an operator rebinds to this pending-owner policy.
 * - `@new-each-run`, `@unassigned`, `@human`: human comments use the Inbox
 *   fallback (creator, else reconstruct). That answering Session is a
 *   collaborator; assignee stays unchanged.
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
  issueWorkspaceDir?: string
  provenanceStore?: IProvenanceStore
  observeIssues?: (
    workspace: { id: string; dir: string },
    issues: readonly IssueRecord[],
    origin: ArtifactOrigin,
  ) => Promise<void>
}): Promise<IssueCommentDispatchResult> {
  const targetResumeId = issueAssigneeResumeId(input.issue.assignee)
  const claimsFirstSession = issueAssigneeClaimsFirstSession(input.issue.assignee)
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
    const selection = claimsFirstSession ? issueRuntimeSelection(input.issue) : undefined
    const target = targetResumeId
      ? { kind: 'resume' as const, resumeId: targetResumeId }
      : claimsFirstSession
        ? { kind: 'workspace' as const, workspaceId: input.issueWorkspaceId }
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
      ...(!targetResumeId && !claimsFirstSession ? { reconstruct: true } : {}),
      ...(claimsFirstSession && input.issue.agent ? { agent: input.issue.agent } : {}),
      ...(selection ? { selection } : {}),
      ...(input.source ? { source: input.source } : {}),
      subject: {
        kind: 'issue',
        workspaceId: input.issueWorkspaceId,
        issueId: input.issue.id,
        relation: targetResumeId || claimsFirstSession ? 'owner' : 'creator',
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
    if (claimsFirstSession && input.issueWorkspaceDir && input.provenanceStore) {
      try {
        await claimIssueFirstSession({
          issueWorkspace: { id: input.issueWorkspaceId, dir: input.issueWorkspaceDir },
          issueId: input.issue.id,
          taskId: result.taskId,
          resumeId: result.resumeId,
          agent: result.agent,
          provenanceStore: input.provenanceStore,
          ...(input.observeIssues ? { observeIssues: input.observeIssues } : {}),
        })
      } catch (err) {
        launcherLogger.warn('issue.comment_first_session_claim_failed', {
          wsId: input.issueWorkspaceId,
          issueId: input.issue.id,
          taskId: result.taskId,
          resumeId: result.resumeId,
          err,
        })
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
    await projectDeskComment(appended.issue, appended.comment).catch(() => undefined)
    return 'replied'
  }

  const failureText = input.error
    ?? (input.status === 'done'
      ? 'The Issue reply Agent finished without a final reply.'
      : `The Issue reply run ended as ${input.status}.`)
  const updated = await updateIssueCommentDelivery(
    input.issueWorkspaceDir,
    input.issueId,
    input.sourceCommentId,
    {
      state: 'failed',
      targetResumeId: input.task.resumeId,
      taskId: input.task.taskId,
      error: failureText,
    },
  )
  if (!updated.ok) throw new Error(updated.error)
  await projectWorkspaceDeskFailure({
    wsDir: input.issueWorkspaceDir,
    issueId: input.issueId,
    conversationId: input.sourceCommentId,
    text: `The Agent could not complete this reply: ${failureText}`,
  }).catch(() => undefined)
  return 'failed'
}
