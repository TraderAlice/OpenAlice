import { createHash } from 'node:crypto'

import { ConnectorClient, OWNER_CHAT_TEXT_MAX } from '@traderalice/connector-protocol'

import { resolveConnectorUrl } from '../../services/connector-client/index.js'
import type {
  HeadlessTaskInquiry,
  HeadlessTaskTrigger,
  HeadlessTaskTriggerMetadata,
} from '../headless-task-registry.js'
import type { HeadlessTurnProgress } from '../headless-progress.js'
import type { IssueComment } from './comments.js'
import {
  isConnectorDeskIssue,
  type IssueRecord,
} from './declaration.js'

export function normalizeDeskText(text: string): string {
  return text.trim().slice(0, OWNER_CHAT_TEXT_MAX)
}

/**
 * Texts that are safe to ship before the turn finishes.
 *
 * A text block is sealed only when a tool or error follows it. Consecutive
 * text blocks are treated as one growing narration: only the last one before
 * the non-text block is sent, so streamed chunks do not each become a DM.
 * The trailing text stays with today's final comment / `assistantText`.
 */
export function sealedProgressTexts(
  progress: HeadlessTurnProgress,
  _metadata?: HeadlessTaskTriggerMetadata,
): string[] {
  const sealed: string[] = []
  const { blocks } = progress
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block?.type !== 'text') continue
    const next = blocks[i + 1]
    if (!next || next.type === 'text') continue
    const text = normalizeDeskText(block.text)
    if (!text) continue
    sealed.push(text)
  }
  return sealed
}

export function deskProgressMessageId(scopeId: string, text: string): string {
  const digest = createHash('sha256').update(text).digest('base64url').slice(0, 12)
  return `desk-progress-${scopeId}-${digest}`
}

export function deskProgressScope(task: {
  readonly taskId: string
  readonly communication?: import('../dispatch-communication.js').DispatchCommunication
  readonly inquiry?: Pick<HeadlessTaskInquiry, 'subject'>
  readonly trigger?: HeadlessTaskTrigger
}): { workspaceId: string; issueId: string; scopeId: string } | null {
  const communication = task.communication
  const reply = communication?.reply
  if (!communication?.delivery || !reply || (reply.kind !== 'issue-comment' && reply.kind !== 'issue-run')) return null
  return { workspaceId: reply.workspaceId, issueId: reply.issueId, scopeId: task.taskId }
}

export function shouldProjectDeskComment(
  issue: { connectorDesk?: string },
  comment: IssueComment,
  opts?: {
    /** Derived from the caller's server-owned Issue run, never tool arguments. */
    workspaceId?: string
    automated?: boolean
    phase?: 'progress' | 'final'
    progressScopeId?: string
    triggerMetadata?: HeadlessTaskTriggerMetadata
    delivery?: import('../dispatch-communication.js').DispatchCommunication['delivery']
  },
): boolean {
  if (!isConnectorDeskIssue(issue) || comment.via) return false
  return true
}

export async function projectDeskComment(
  issue: { connectorDesk?: string },
  comment: IssueComment,
  client: ConnectorClient = new ConnectorClient(resolveConnectorUrl()),
  opts?: {
    /** Derived from the caller's server-owned Issue run, never tool arguments. */
    workspaceId?: string
    automated?: boolean
    phase?: 'progress' | 'final'
    progressScopeId?: string
    triggerMetadata?: HeadlessTaskTriggerMetadata
    delivery?: import('../dispatch-communication.js').DispatchCommunication['delivery']
  },
): Promise<void> {
  const scope = opts?.progressScopeId ?? comment.replyTo
  if (!isConnectorDeskIssue(issue) || comment.via || !issue.connectorDesk) return
  const phase = opts?.phase ?? 'final'
  await client.sendOwnerMessage({
    id: `desk-${comment.id}`,
    adapterId: opts?.delivery?.connectorId ?? issue.connectorDesk,
    conversationId: scope ?? comment.id,
    phase,
    text: normalizeDeskText(comment.markdown) || undefined,
    workspaceId: opts?.delivery?.contentWorkspaceId ?? opts?.workspaceId,
    source: opts?.delivery?.source ?? (opts?.automated || opts?.triggerMetadata?.kind === 'connector-cron-issue' ? 'automation' : 'conversation'),
  }, AbortSignal.timeout(5_000))
}

export async function projectDeskLifecycle(input: {
  issue: Pick<IssueRecord, 'connectorDesk' | 'status'>
  conversationId: string
  phase: 'accepted' | 'failed'
  text?: string
  client?: ConnectorClient
}): Promise<void> {
  if (!isConnectorDeskIssue(input.issue) || input.issue.status === 'canceled') return
  const client = input.client ?? new ConnectorClient(resolveConnectorUrl())
  await client.sendOwnerMessage({
    id: `desk-${input.phase}-${input.conversationId}`,
    adapterId: input.issue.connectorDesk,
    conversationId: input.conversationId,
    phase: input.phase,
    ...(input.text ? { text: normalizeDeskText(input.text) } : {}),
  }, AbortSignal.timeout(5_000))
}
