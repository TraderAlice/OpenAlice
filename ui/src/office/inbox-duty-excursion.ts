import type { OfficeInboxDutyCandidate } from './duty-registry'

const INBOX_DUTY_EXCURSION_KEY = 'openalice:office-inbox-duty-excursion:v3'

export type OfficeInboxDutyExcursionPhase = 'away' | 'presented' | 'returned'

export interface OfficeInboxDutyExcursion {
  readonly duty: OfficeInboxDutyCandidate
  readonly purpose: 'review'
  readonly phase: OfficeInboxDutyExcursionPhase
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

const ISSUE_PRIORITIES = new Set(['urgent', 'high', 'medium', 'low', 'none'])

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isSafeDeclaredIssue(
  value: unknown,
  origin: Record<string, unknown> | undefined,
): boolean {
  if (!value || typeof value !== 'object') return false
  const declaredIssue = value as Record<string, unknown>
  return isNonEmptyString(declaredIssue.workspaceId)
    && isNonEmptyString(declaredIssue.issueId)
    && isNonEmptyString(declaredIssue.title)
    && typeof declaredIssue.priority === 'string'
    && ISSUE_PRIORITIES.has(declaredIssue.priority)
    && (declaredIssue.nextDueAtMs === null || Number.isFinite(declaredIssue.nextDueAtMs))
    && isNonNegativeSafeInteger(declaredIssue.unreadSiblingCount)
    && isNonNegativeSafeInteger(declaredIssue.olderUnreadCount)
    && origin?.issueWorkspaceId === declaredIssue.workspaceId
    && origin.issueId === declaredIssue.issueId
}

function isInboxDuty(value: unknown): value is OfficeInboxDutyCandidate {
  if (!value || typeof value !== 'object') return false
  const duty = value as Record<string, unknown>
  const destination = duty.destination as Record<string, unknown> | undefined
  const receipt = duty.receipt as Record<string, unknown> | undefined
  const delivery = duty.delivery as Record<string, unknown> | undefined
  const entry = delivery?.entry as Record<string, unknown> | undefined
  const origin = entry?.origin as Record<string, unknown> | undefined
  const docs = entry?.docs
  const docsValid = docs === undefined || (Array.isArray(docs) && docs.every((document) => {
    if (!document || typeof document !== 'object') return false
    const candidate = document as Record<string, unknown>
    return isNonEmptyString(candidate.path)
      && (candidate.revision === undefined || typeof candidate.revision === 'string')
  }))
  const declaredIssue = delivery?.declaredIssue
  const declaredIssueValid = declaredIssue === undefined
    || isSafeDeclaredIssue(declaredIssue, origin)
  return duty.kind === 'inbox'
    && isNonEmptyString(duty.id)
    && duty.registrationId === 'inbox-unread'
    && Number.isSafeInteger(duty.count)
    && (duty.count as number) > 0
    && destination?.kind === 'inbox-entry'
    && destination.targetId === 'inbox-service'
    && isNonEmptyString(destination.workspaceId)
    && isNonEmptyString(destination.inboxEntryId)
    && receipt?.kind === 'inbox-read'
    && receipt.workspaceId === destination.workspaceId
    && receipt.inboxEntryId === destination.inboxEntryId
    && isNonEmptyString(receipt.fingerprint)
    && isNonEmptyString(delivery?.title)
    && (delivery?.excerpt === undefined || typeof delivery.excerpt === 'string')
    && entry?.id === destination.inboxEntryId
    && entry.workspaceId === destination.workspaceId
    && Number.isFinite(entry.ts)
    && (entry.workspaceLabel === undefined || typeof entry.workspaceLabel === 'string')
    && (entry.comments === undefined || typeof entry.comments === 'string')
    && docsValid
    && declaredIssueValid
}

function isOfficeInboxDutyExcursion(value: unknown): value is OfficeInboxDutyExcursion {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (!isInboxDuty(candidate.duty)) return false
  return candidate.purpose === 'review'
    && (candidate.phase === 'away'
      || candidate.phase === 'presented'
      || candidate.phase === 'returned')
}

export function readOfficeInboxDutyExcursion(): OfficeInboxDutyExcursion | null {
  if (typeof window === 'undefined') return null
  try {
    const parsed: unknown = JSON.parse(
      window.sessionStorage.getItem(INBOX_DUTY_EXCURSION_KEY) ?? 'null',
    )
    return isOfficeInboxDutyExcursion(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function rememberOfficeInboxDutyExcursion(excursion: OfficeInboxDutyExcursion): void {
  try {
    window.sessionStorage.setItem(INBOX_DUTY_EXCURSION_KEY, JSON.stringify(excursion))
  } catch {
    // The unread duty remains available when same-tab storage is blocked.
  }
}

export function clearOfficeInboxDutyExcursion(): void {
  try {
    window.sessionStorage.removeItem(INBOX_DUTY_EXCURSION_KEY)
  } catch {
    // No-op: this state is only a same-tab return checkpoint.
  }
}

/**
 * Office keeps the captured delivery unread while its review excursion exists.
 * The checkpoint itself owns that lifetime across away, presented, and returned;
 * Inbox selection must not turn presentation into the review's durable receipt.
 */
export function isActiveOfficeInboxDutyReviewTarget(input: {
  readonly workspaceId: string
  readonly inboxEntryId: string
}): boolean {
  const excursion = readOfficeInboxDutyExcursion()
  return excursion?.purpose === 'review'
    && excursion.duty.destination.workspaceId === input.workspaceId
    && excursion.duty.destination.inboxEntryId === input.inboxEntryId
}

/**
 * Inbox owns only this presentation handshake: after the exact captured entry
 * renders in the visible reading surface, Office may expose its return receipt.
 */
export function markOfficeInboxDutyPresented(input: {
  readonly workspaceId: string
  readonly inboxEntryId: string
}): boolean {
  const excursion = readOfficeInboxDutyExcursion()
  if (!excursion
    || excursion.purpose !== 'review'
    || excursion.phase !== 'away'
    || excursion.duty.destination.workspaceId !== input.workspaceId
    || excursion.duty.destination.inboxEntryId !== input.inboxEntryId) {
    return false
  }
  rememberOfficeInboxDutyExcursion({ ...excursion, phase: 'presented' })
  return true
}
