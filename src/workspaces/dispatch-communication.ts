import { z } from 'zod'
import { sessionOriginSchema } from '../core/provenance-store.js'
import type { WorkspaceConversationCaller } from '../core/workspace-tool-center.js'
import type { AgentConversationDispatch } from './agent-conversation-log.js'
import type { HeadlessTaskInquiry, HeadlessTaskTrigger } from './headless-task-registry.js'

export interface IssueCommentRequest {
  workspaceId: string
  issueId: string
  prompt: string
  commentId: string
  source?: WorkspaceConversationCaller
}

export type IssueAddress = { readonly workspaceId: string; readonly issueId: string }
export type DispatchReply =
  | { readonly kind: 'caller' }
  | ({ readonly kind: 'issue-comment'; readonly commentId: string } & IssueAddress)
  | ({ readonly kind: 'issue-run' } & IssueAddress)
  | { readonly kind: 'none' }

/** Immutable, server-owned routing decision. Subject is never delivery authority. */
export interface DispatchCommunication {
  readonly version: 1
  readonly origin: WorkspaceConversationCaller | ({ readonly kind: 'issue-run' } & IssueAddress) | { readonly kind: 'unknown' }
  readonly target: { readonly workspaceId: string; readonly resumeId: string; readonly agent: string }
  readonly subject?: HeadlessTaskInquiry['subject']
  readonly reply: DispatchReply
  /** A snapshot at admission, not a lookup of the Session's current desk. */
  readonly delivery?: {
    readonly connectorId: string
    readonly source: 'conversation' | 'automation'
    readonly contentWorkspaceId: string
  }
}

export function dispatchReply(input: { inquiry?: HeadlessTaskInquiry; trigger?: HeadlessTaskTrigger; conversation?: AgentConversationDispatch }): DispatchReply {
  const subject = input.inquiry?.subject
  if (subject?.kind === 'issue' && subject.commentId) return {
    kind: 'issue-comment', workspaceId: subject.workspaceId, issueId: subject.issueId, commentId: subject.commentId,
  }
  if (input.trigger) return { kind: 'issue-run', workspaceId: input.trigger.workspaceId, issueId: input.trigger.issueId }
  return { kind: input.conversation || input.inquiry ? 'caller' : 'none' }
}

export function buildDispatchCommunication(input: {
  target: DispatchCommunication['target']
  inquiry?: HeadlessTaskInquiry
  trigger?: HeadlessTaskTrigger
  conversation?: AgentConversationDispatch
  /** Read by Alice from the addressed Issue at admission, never from model output. */
  desk?: { connectorId: string; inboundConnectorId?: string }
}): DispatchCommunication {
  const reply = dispatchReply(input)
  const origin = input.conversation?.source
    ?? (input.trigger ? { kind: 'issue-run' as const, workspaceId: input.trigger.workspaceId, issueId: input.trigger.issueId }
      : { kind: 'unknown' as const })
  const connectorId = input.desk?.inboundConnectorId ?? input.desk?.connectorId
  // A binding mismatch is not permission to deliver to either destination.
  const matchingDesk = !input.desk?.inboundConnectorId || input.desk.inboundConnectorId === input.desk.connectorId
  return dispatchCommunicationSchema.parse({
    version: 1, origin, target: input.target,
    ...(input.inquiry ? { subject: input.inquiry.subject } : {}), reply,
    ...(connectorId && matchingDesk && (reply.kind === 'issue-comment' || reply.kind === 'issue-run') ? {
      delivery: { connectorId, source: reply.kind === 'issue-run' ? 'automation' as const : 'conversation' as const,
        contentWorkspaceId: input.target.workspaceId },
    } : {}),
  })
}

const addressShape = { workspaceId: z.string().min(1), issueId: z.string().min(1) }
/** Used at construction and persistence boundaries; consumers receive one checked contract. */
export const dispatchCommunicationSchema: z.ZodType<DispatchCommunication> = z.object({
  version: z.literal(1),
  origin: z.union([sessionOriginSchema, z.object({ kind: z.literal('human') }),
    z.object({ kind: z.literal('workspace'), workspaceId: z.string().min(1) }),
    z.object({ kind: z.literal('issue-run'), ...addressShape }), z.object({ kind: z.literal('unknown') })]),
  target: z.object({ workspaceId: z.string().min(1), resumeId: z.string().min(1), agent: z.string().min(1) }),
  subject: z.union([
    z.object({ kind: z.literal('inbox'), entryId: z.string().min(1) }),
    z.object({ kind: z.literal('issue'), ...addressShape, relation: z.enum(['creator', 'owner', 'run']),
      runId: z.string().min(1).optional(), commentId: z.string().min(1).optional() }),
  ]).optional(),
  reply: z.discriminatedUnion('kind', [z.object({ kind: z.literal('caller') }), z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('issue-comment'), ...addressShape, commentId: z.string().min(1) }),
    z.object({ kind: z.literal('issue-run'), ...addressShape })]),
  delivery: z.object({ connectorId: z.string().min(1), source: z.enum(['conversation', 'automation']), contentWorkspaceId: z.string().min(1) }).optional(),
}).superRefine((value, ctx) => {
  if (!value.delivery) return
  if ((value.reply.kind !== 'issue-comment' && value.reply.kind !== 'issue-run')
    || value.delivery.contentWorkspaceId !== value.target.workspaceId
    || value.delivery.source !== (value.reply.kind === 'issue-run' ? 'automation' : 'conversation')) {
    ctx.addIssue({ code: 'custom', message: 'Delivery must match explicit reply ownership and execution workspace' })
  }
})
