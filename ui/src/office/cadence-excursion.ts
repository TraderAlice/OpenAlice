import type { OfficeCadenceDutyCandidate } from './duty-registry'

const CADENCE_EXCURSION_KEY = 'openalice:office-cadence-excursion:v2'

export interface OfficeCadenceExcursion {
  readonly duty: OfficeCadenceDutyCandidate
}

function isScheduleWhen(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const when = value as Record<string, unknown>
  return (when.kind === 'at' && typeof when.at === 'string')
    || (when.kind === 'every' && typeof when.every === 'string')
    || (when.kind === 'cron'
      && typeof when.cron === 'string'
      && (when.timezone === undefined || typeof when.timezone === 'string')
      && (when.catchUp === undefined || typeof when.catchUp === 'boolean'))
}

function isCadenceDuty(value: unknown): value is OfficeCadenceDutyCandidate {
  if (!value || typeof value !== 'object') return false
  const duty = value as Record<string, unknown>
  if (duty.kind !== 'cadence'
    || typeof duty.id !== 'string'
    || typeof duty.registrationId !== 'string'
    || typeof duty.count !== 'number') return false
  const destination = duty.destination as Record<string, unknown> | undefined
  const receipt = duty.receipt as Record<string, unknown> | undefined
  const cadence = duty.cadence as Record<string, unknown> | undefined
  const health = cadence?.health as Record<string, unknown> | undefined
  return destination?.kind === 'issue'
    && typeof destination.workspaceId === 'string'
    && typeof destination.issueId === 'string'
    && destination.targetId === 'operations'
    && receipt?.kind === 'evidence'
    && typeof receipt.subjectKey === 'string'
    && typeof receipt.fingerprint === 'string'
    && receipt.scope === 'session'
    && typeof cadence?.workspaceId === 'string'
    && typeof cadence.workspaceTag === 'string'
    && typeof cadence.issueId === 'string'
    && typeof cadence?.title === 'string'
    && typeof cadence.assignee === 'string'
    && isScheduleWhen(cadence.when)
    && (health?.state === 'blocked' || health?.state === 'failed' || health?.state === 'interrupted')
    && typeof health.message === 'string'
}

export function readOfficeCadenceExcursion(): OfficeCadenceExcursion | null {
  if (typeof window === 'undefined') return null
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(CADENCE_EXCURSION_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return null
    const value = parsed as Record<string, unknown>
    return isCadenceDuty(value.duty) ? { duty: value.duty } : null
  } catch {
    return null
  }
}

export function rememberOfficeCadenceExcursion(excursion: OfficeCadenceExcursion): void {
  try {
    window.sessionStorage.setItem(CADENCE_EXCURSION_KEY, JSON.stringify(excursion))
  } catch {
    // Returning through the HUD remains available when session storage is blocked.
  }
}

export function clearOfficeCadenceExcursion(): void {
  try {
    window.sessionStorage.removeItem(CADENCE_EXCURSION_KEY)
  } catch {
    // No-op: this state is only a same-session navigation convenience.
  }
}
