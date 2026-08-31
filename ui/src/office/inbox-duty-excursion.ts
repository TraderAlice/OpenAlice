import type { OfficeInboxDutyCandidate } from './duty-registry'

const INBOX_DUTY_EXCURSION_KEY = 'openalice:office-inbox-duty-excursion:v2'

export type OfficeInboxDutyExcursionPhase = 'away' | 'presented' | 'returned'

export interface OfficeInboxDutyExcursion {
  readonly duty: OfficeInboxDutyCandidate
  readonly phase: OfficeInboxDutyExcursionPhase
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isInboxDuty(value: unknown): value is OfficeInboxDutyCandidate {
  if (!value || typeof value !== 'object') return false
  const duty = value as Record<string, unknown>
  const destination = duty.destination as Record<string, unknown> | undefined
  const receipt = duty.receipt as Record<string, unknown> | undefined
  const delivery = duty.delivery as Record<string, unknown> | undefined
  const entry = delivery?.entry as Record<string, unknown> | undefined
  const docs = entry?.docs
  const docsValid = docs === undefined || (Array.isArray(docs) && docs.every((document) => {
    if (!document || typeof document !== 'object') return false
    const candidate = document as Record<string, unknown>
    return isNonEmptyString(candidate.path)
      && (candidate.revision === undefined || typeof candidate.revision === 'string')
  }))
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
    && entry?.id === destination.inboxEntryId
    && entry.workspaceId === destination.workspaceId
    && Number.isFinite(entry.ts)
    && docsValid
}

function isOfficeInboxDutyExcursion(value: unknown): value is OfficeInboxDutyExcursion {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return isInboxDuty(candidate.duty)
    && (
      candidate.phase === 'away'
      || candidate.phase === 'presented'
      || candidate.phase === 'returned'
    )
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
 * Inbox owns only this presentation handshake: after the exact captured entry
 * renders in the visible reading surface, Office may expose its return receipt.
 */
export function markOfficeInboxDutyPresented(input: {
  readonly workspaceId: string
  readonly inboxEntryId: string
}): boolean {
  const excursion = readOfficeInboxDutyExcursion()
  if (!excursion
    || excursion.phase !== 'away'
    || excursion.duty.destination.workspaceId !== input.workspaceId
    || excursion.duty.destination.inboxEntryId !== input.inboxEntryId) {
    return false
  }
  rememberOfficeInboxDutyExcursion({ ...excursion, phase: 'presented' })
  return true
}
