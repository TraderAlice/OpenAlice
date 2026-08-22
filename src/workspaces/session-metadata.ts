/**
 * Product-Session metadata bag.
 *
 * First field is immutable birth provenance (`createdBy`): who/what allocated
 * this `resumeId`. Stamped only on first ResumeRegistry create; never rewritten.
 * Execution-level sources (issue trigger, inquiry subject) stay on headless
 * task records — birth answers "how was this coworker hired".
 */
import type { HeadlessInquirySubject } from './headless-task-registry.js'

export type SessionInteractiveSurface = 'spawn' | 'quick-chat' | 'auto-quant' | 'prediction' | 'manager'

export type SessionIssueBirthPolicy = 'new-each-run' | 'new-then-resume'

export type SessionIssueFire = 'schedule' | 'retry'

export type SessionConversationCaller =
  | { readonly kind: 'agent'; readonly resumeId: string; readonly workspaceId?: string }
  | { readonly kind: 'human' }

export type SessionConversationBirthReason =
  | 'explicit-workspace'
  | 'harness-chat'
  | 'harness-autoquant'
  | 'harness-prediction'
  | 'missing-origin'
  | 'non-session-origin'
  | 'unavailable-reconstruction'
  | 'prior-reconstruction'
  | 'issue-comment'

export type SessionCreatedBy =
  | {
      readonly kind: 'interactive'
      readonly surface: SessionInteractiveSurface
    }
  | {
      readonly kind: 'issue'
      readonly workspaceId: string
      readonly issueId: string
      readonly policy: SessionIssueBirthPolicy
      readonly fire: SessionIssueFire
    }
  | {
      readonly kind: 'headless'
      readonly surface: 'api'
    }
  | {
      readonly kind: 'conversation'
      readonly caller: SessionConversationCaller
      readonly reason: SessionConversationBirthReason
      readonly subject?: HeadlessInquirySubject
    }

/** Immutable product-Session bag. Birth is first-write-wins. */
export interface SessionMetadata {
  readonly createdBy: SessionCreatedBy
}

export function sessionMetadata(createdBy: SessionCreatedBy): SessionMetadata {
  return { createdBy }
}

/** Loose parse for resume-identities.json. Invalid shapes return null. */
export function parseSessionMetadata(value: unknown): SessionMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const createdBy = parseSessionCreatedBy((value as Record<string, unknown>)['createdBy'])
  return createdBy ? { createdBy } : null
}

export function parseSessionCreatedBy(value: unknown): SessionCreatedBy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const kind = record['kind']
  if (kind === 'interactive') {
    const surface = record['surface']
    if (
      surface === 'spawn'
      || surface === 'quick-chat'
      || surface === 'auto-quant'
      || surface === 'prediction'
      || surface === 'manager'
    ) {
      return { kind: 'interactive', surface }
    }
    return null
  }
  if (kind === 'issue') {
    const workspaceId = record['workspaceId']
    const issueId = record['issueId']
    const policy = record['policy']
    const fire = record['fire']
    if (
      typeof workspaceId === 'string'
      && workspaceId.length > 0
      && typeof issueId === 'string'
      && issueId.length > 0
      && (policy === 'new-each-run' || policy === 'new-then-resume')
      && (fire === 'schedule' || fire === 'retry')
    ) {
      return { kind: 'issue', workspaceId, issueId, policy, fire }
    }
    return null
  }
  if (kind === 'headless') {
    if (record['surface'] === 'api') return { kind: 'headless', surface: 'api' }
    return null
  }
  if (kind === 'conversation') {
    const caller = parseConversationCaller(record['caller'])
    const reason = parseConversationReason(record['reason'])
    if (!caller || !reason) return null
    const subject = parseInquirySubject(record['subject'])
    return {
      kind: 'conversation',
      caller,
      reason,
      ...(subject ? { subject } : {}),
    }
  }
  return null
}

function parseConversationCaller(value: unknown): SessionConversationCaller | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record['kind'] === 'human') return { kind: 'human' }
  if (record['kind'] === 'agent') {
    const resumeId = record['resumeId']
    if (typeof resumeId !== 'string' || resumeId.length === 0) return null
    const workspaceId = record['workspaceId']
    return {
      kind: 'agent',
      resumeId,
      ...(typeof workspaceId === 'string' && workspaceId.length > 0 ? { workspaceId } : {}),
    }
  }
  return null
}

function parseConversationReason(value: unknown): SessionConversationBirthReason | null {
  switch (value) {
    case 'explicit-workspace':
    case 'harness-chat':
    case 'harness-autoquant':
    case 'harness-prediction':
    case 'missing-origin':
    case 'non-session-origin':
    case 'unavailable-reconstruction':
    case 'prior-reconstruction':
    case 'issue-comment':
      return value
    default:
      return null
  }
}

function parseInquirySubject(value: unknown): HeadlessInquirySubject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record['kind'] === 'inbox') {
    const entryId = record['entryId']
    return typeof entryId === 'string' && entryId.length > 0
      ? { kind: 'inbox', entryId }
      : null
  }
  if (record['kind'] === 'issue') {
    const workspaceId = record['workspaceId']
    const issueId = record['issueId']
    const relation = record['relation']
    if (
      typeof workspaceId !== 'string'
      || workspaceId.length === 0
      || typeof issueId !== 'string'
      || issueId.length === 0
      || (relation !== 'creator' && relation !== 'owner' && relation !== 'run')
    ) {
      return null
    }
    const runId = record['runId']
    const commentId = record['commentId']
    return {
      kind: 'issue',
      workspaceId,
      issueId,
      relation,
      ...(typeof runId === 'string' && runId.length > 0 ? { runId } : {}),
      ...(typeof commentId === 'string' && commentId.length > 0 ? { commentId } : {}),
    }
  }
  return null
}
