const INBOX_DUTY_EXCURSION_KEY = 'openalice:office-inbox-duty-excursion:v1'

export type OfficeInboxDutyExcursionPhase = 'away' | 'presented' | 'returned'

export interface OfficeInboxDutyExcursion {
  readonly throughSeq: number
  readonly count: 1
  readonly workspaceId: string
  readonly inboxEntryId: string
  readonly documentCount: number
  readonly phase: OfficeInboxDutyExcursionPhase
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isOfficeInboxDutyExcursion(value: unknown): value is OfficeInboxDutyExcursion {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return Number.isSafeInteger(candidate.throughSeq)
    && (candidate.throughSeq as number) > 0
    && candidate.count === 1
    && isNonEmptyString(candidate.workspaceId)
    && isNonEmptyString(candidate.inboxEntryId)
    && Number.isSafeInteger(candidate.documentCount)
    && (candidate.documentCount as number) > 0
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
    // The generic Inbox journal remains usable when same-tab storage is blocked.
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
 * Inbox owns only this presentation handshake: after the exact entry has
 * rendered in the visible reading surface, Office may treat a later return as
 * step two. A navigation intent, missing entry, or background tab is not enough.
 */
export function markOfficeInboxDutyPresented(input: {
  readonly workspaceId: string
  readonly inboxEntryId: string
}): boolean {
  const excursion = readOfficeInboxDutyExcursion()
  if (!excursion
    || excursion.phase !== 'away'
    || excursion.workspaceId !== input.workspaceId
    || excursion.inboxEntryId !== input.inboxEntryId) {
    return false
  }
  rememberOfficeInboxDutyExcursion({ ...excursion, phase: 'presented' })
  return true
}
