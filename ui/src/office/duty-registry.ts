import type {
  IssueAutomationHealthState,
  IssueListItem,
  IssuePriority,
  IssueSnapshot,
} from '../api/issues'
import type { ScheduleWhen } from '../api/schedule'
import type {
  OfficeActivityKind,
  OfficeActivityLandmark,
  OfficeActivitySessionSubject,
  OfficeProductActivityState,
} from './useOfficeProductActivity'

export type OfficeDutySourceStatus = 'loading' | 'ready' | 'error'
export type OfficeDutyKind = OfficeActivityKind | 'cadence'
export type OfficeEmployeeDutyTargetId = `employee:${string}:${string}`
export type OfficeDutyTargetId =
  | 'operations'
  | 'inbox-service'
  | 'news-service'
  | OfficeEmployeeDutyTargetId

export interface OfficeCadenceDutyEvidence {
  readonly workspaceId: string
  readonly workspaceTag: string
  readonly issueId: string
  readonly title: string
  readonly priority: IssuePriority
  readonly assignee: string
  readonly when: ScheduleWhen
  readonly health: {
    readonly state: Extract<IssueAutomationHealthState, 'blocked' | 'failed' | 'interrupted'>
    readonly message: string
    readonly latestTaskId?: string
  }
  readonly lastFiredAtMs?: number | null
  readonly nextDueAtMs?: number | null
}

interface OfficeDutyCandidateBase {
  readonly id: string
  readonly registrationId: string
  readonly count: number
}

type OfficeEventDutyCandidate = {
  [K in OfficeActivityKind]: OfficeDutyCandidateBase & {
    readonly kind: K
    readonly landmark: OfficeActivityLandmark
    readonly destination: {
      readonly kind: 'journal'
      readonly channel: K
      readonly targetId: K extends 'inbox'
        ? 'inbox-service'
        : K extends 'news' ? 'news-service' : 'operations'
      readonly subject?: K extends 'agent' ? OfficeActivitySessionSubject : never
    }
    readonly receipt: {
      readonly kind: 'event-watermark'
      readonly family: K
      readonly throughSeq: number
    }
  }
}[OfficeActivityKind]

export type OfficeCadenceDutyCandidate = OfficeDutyCandidateBase & {
  readonly kind: 'cadence'
  readonly destination: {
    readonly kind: 'issue'
    readonly workspaceId: string
    readonly issueId: string
    readonly targetId: 'operations'
  }
  readonly receipt: {
    readonly kind: 'evidence'
    readonly subjectKey: string
    readonly fingerprint: string
    readonly scope: 'session'
  }
  readonly cadence: OfficeCadenceDutyEvidence
}

export type OfficeDutyCandidate = OfficeEventDutyCandidate | OfficeCadenceDutyCandidate

/** Normalized registration boundary consumed by the Office queue resolver. */
export interface OfficeDutyRegistration {
  readonly id: string
  readonly order: number
  readonly status: OfficeDutySourceStatus
  readonly candidates: readonly OfficeDutyCandidate[]
}

export type OfficeResolvedDuty = OfficeDutyCandidate & {
  readonly targetId: OfficeDutyTargetId
  readonly fallbackTargetId?: 'operations'
}

const EXCEPTION_HEALTH_ORDER = {
  blocked: 0,
  failed: 1,
  interrupted: 2,
} as const

const PRIORITY_ORDER: Record<IssuePriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
}

const BLOCKED_REASON_BY_MESSAGE = new Map<string, string>([
  ['Assigned Session does not exist. Choose an active Session or @new-each-run.', 'owner-missing'],
  ['Assigned Session is retired. Reassign the Issue before its next run.', 'owner-retired'],
  ['Assigned Session is deleted. Reassign the Issue before its next run.', 'owner-deleted'],
  ['Assigned Session has no resumable runtime conversation yet.', 'owner-unbound'],
  ['Schedule has no future fire. Check its expression and timestamp.', 'no-future-fire'],
])

function stableTextHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

type ScheduledIssueEvidence = Pick<
  IssueListItem,
  'id' | 'assignee' | 'automationHealth' | 'lastFiredAtMs' | 'nextDueAtMs'
> & { readonly when: ScheduleWhen }

function blockedReason(issue: Pick<IssueListItem, 'automationHealth'>): string {
  const message = issue.automationHealth?.message ?? ''
  return BLOCKED_REASON_BY_MESSAGE.get(message) ?? `unknown-${stableTextHash(message)}`
}

function scheduleEvidenceKey(when: ScheduleWhen): readonly unknown[] {
  switch (when.kind) {
    case 'at':
      return ['at', when.at]
    case 'every':
      return ['every', when.every]
    case 'cron':
      return ['cron', when.cron, when.timezone ?? 'local', when.catchUp === false ? 'calendar' : 'catch-up']
  }
}

function nextDueEvidenceKey(now: number, nextDueAtMs: number | null | undefined): string {
  if (nextDueAtMs == null) return 'none'
  if (nextDueAtMs <= now) return 'due'
  return `future:${nextDueAtMs}`
}

/**
 * Session receipt identity for a Scheduled Issue exception. Overdue snapshots
 * deliberately collapse to `due`: the backend clamps an overdue next fire to
 * each scanner read's `now`, so storing that raw value would resurrect the same
 * reviewed exception on every poll.
 */
export function officeScheduledIssueFingerprint(
  now: number,
  workspaceId: string,
  issue: ScheduledIssueEvidence,
): string {
  const health = issue.automationHealth
  const reason = health?.state === 'blocked' ? blockedReason(issue) : 'run-exception'
  return JSON.stringify([
    'scheduled-issue-v1',
    workspaceId,
    issue.id,
    health?.state ?? 'unknown',
    health?.latestTaskId ?? 'no-task',
    issue.assignee,
    reason,
    issue.lastFiredAtMs ?? 'never',
    scheduleEvidenceKey(issue.when),
    nextDueEvidenceKey(now, issue.nextDueAtMs),
  ])
}

function eventDutyDescriptor(
  id: string,
  order: number,
  family: OfficeActivityKind,
  activity: OfficeProductActivityState,
  status: OfficeDutySourceStatus,
): OfficeDutyRegistration {
  let candidate: OfficeDutyCandidate | null = null
  if (family === 'inbox' && activity.attention.inbox && activity.inbox) {
    candidate = {
      id: `${id}:${activity.inbox.seq}`,
      registrationId: id,
      kind: 'inbox',
      landmark: activity.inbox,
      count: activity.pending.inbox,
      destination: { kind: 'journal', channel: 'inbox', targetId: 'inbox-service' },
      receipt: { kind: 'event-watermark', family: 'inbox', throughSeq: activity.inbox.seq },
    }
  } else if (family === 'agent' && activity.attention.agent && activity.agent) {
    candidate = {
      id: `${id}:${activity.agent.seq}`,
      registrationId: id,
      kind: 'agent',
      landmark: activity.agent,
      count: activity.pending.agent,
      destination: {
        kind: 'journal',
        channel: 'agent',
        targetId: 'operations',
        ...(activity.agent.subject ? { subject: activity.agent.subject } : {}),
      },
      receipt: { kind: 'event-watermark', family: 'agent', throughSeq: activity.agent.seq },
    }
  } else if (family === 'news' && activity.attention.news && activity.news) {
    candidate = {
      id: `${id}:${activity.news.seq}`,
      registrationId: id,
      kind: 'news',
      landmark: activity.news,
      count: activity.pending.news,
      destination: { kind: 'journal', channel: 'news', targetId: 'news-service' },
      receipt: { kind: 'event-watermark', family: 'news', throughSeq: activity.news.seq },
    }
  }
  const candidates = candidate ? [candidate] : []
  return { id, order, status, candidates }
}

export function scheduledIssueHealthDutyRegistration(
  now: number,
  snapshot: IssueSnapshot | null,
  status: OfficeDutySourceStatus,
): OfficeDutyRegistration {
  const candidates: OfficeCadenceDutyCandidate[] = []
  for (const workspace of snapshot?.workspaces ?? []) {
    if (workspace.status !== 'ok') continue
    for (const issue of workspace.issues) {
      if (!issue.when || !issue.automationHealth) continue
      const state = issue.automationHealth.state
      if (state !== 'blocked' && state !== 'failed' && state !== 'interrupted') continue
      const cadence: OfficeCadenceDutyEvidence = {
        workspaceId: workspace.wsId,
        workspaceTag: workspace.tag,
        issueId: issue.id,
        title: issue.title,
        priority: issue.priority,
        assignee: issue.assignee,
        when: issue.when,
        health: {
          state,
          message: issue.automationHealth.message,
          ...(issue.automationHealth.latestTaskId
            ? { latestTaskId: issue.automationHealth.latestTaskId }
            : {}),
        },
        lastFiredAtMs: issue.lastFiredAtMs,
        nextDueAtMs: issue.nextDueAtMs,
      }
      const subjectKey = JSON.stringify(['scheduled-issue', workspace.wsId, issue.id])
      const fingerprint = officeScheduledIssueFingerprint(
        now,
        workspace.wsId,
        issue as IssueListItem & { when: ScheduleWhen },
      )
      candidates.push({
        id: `scheduled-issue-health:${workspace.wsId}:${issue.id}`,
        registrationId: 'scheduled-issue-health',
        kind: 'cadence',
        count: 1,
        destination: {
          kind: 'issue',
          workspaceId: workspace.wsId,
          issueId: issue.id,
          targetId: 'operations',
        },
        receipt: { kind: 'evidence', subjectKey, fingerprint, scope: 'session' },
        cadence,
      })
    }
  }
  candidates.sort((left, right) => {
    const leftCadence = left.cadence
    const rightCadence = right.cadence
    const health = EXCEPTION_HEALTH_ORDER[leftCadence.health.state]
      - EXCEPTION_HEALTH_ORDER[rightCadence.health.state]
    if (health !== 0) return health
    const priority = PRIORITY_ORDER[leftCadence.priority] - PRIORITY_ORDER[rightCadence.priority]
    if (priority !== 0) return priority
    const due = (leftCadence.nextDueAtMs ?? Number.POSITIVE_INFINITY)
      - (rightCadence.nextDueAtMs ?? Number.POSITIVE_INFINITY)
    if (due !== 0) return due
    const title = leftCadence.title.localeCompare(rightCadence.title)
    if (title !== 0) return title
    const workspace = leftCadence.workspaceId.localeCompare(rightCadence.workspaceId)
    return workspace !== 0 ? workspace : leftCadence.issueId.localeCompare(rightCadence.issueId)
  })
  return { id: 'scheduled-issue-health', order: 200, status, candidates }
}

/** Current providers normalize their domain hooks before entering the queue. */
export function coreOfficeDutyRegistrations(input: {
  readonly now: number
  readonly activity: OfficeProductActivityState
  readonly activityStatus: OfficeDutySourceStatus
  readonly issues: IssueSnapshot | null
  readonly issueStatus: OfficeDutySourceStatus
}): readonly OfficeDutyRegistration[] {
  return [
    eventDutyDescriptor('inbox-arrival', 100, 'inbox', input.activity, input.activityStatus),
    scheduledIssueHealthDutyRegistration(input.now, input.issues, input.issueStatus),
    eventDutyDescriptor('agent-review', 300, 'agent', input.activity, input.activityStatus),
    eventDutyDescriptor('news-arrival', 400, 'news', input.activity, input.activityStatus),
  ]
}

export interface OfficeDutyProjection {
  readonly candidates: readonly OfficeDutyCandidate[]
  readonly status: OfficeDutySourceStatus
}

/**
 * Scan descriptors in product order. An unready empty source is a hard fence:
 * lower-priority work cannot be called "next" while a higher-priority source
 * is still unknown. Known work from a degraded source remains actionable.
 */
export function projectOfficeDutyQueue(
  registrations: readonly OfficeDutyRegistration[],
  includeCandidate: (candidate: OfficeDutyCandidate) => boolean = () => true,
): OfficeDutyProjection {
  const ordered = registrations
    .map((registration, index) => ({ registration, index }))
    .sort((left, right) => left.registration.order - right.registration.order || left.index - right.index)
  for (const { registration } of ordered) {
    const seen = new Set<string>()
    const candidates = registration.candidates.filter((candidate) => {
      if (!includeCandidate(candidate) || seen.has(candidate.id)) return false
      seen.add(candidate.id)
      return true
    })
    if (candidates.length > 0) return { candidates, status: registration.status }
    if (registration.status !== 'ready') return { candidates: [], status: registration.status }
  }
  return { candidates: [], status: 'ready' }
}

export function resolveOfficeDutyTarget(
  duty: OfficeDutyCandidate,
  targetAvailable: (targetId: string) => boolean = () => false,
): OfficeResolvedDuty {
  if (duty.destination.kind === 'journal'
    && duty.destination.channel === 'agent'
    && duty.destination.subject) {
    const { workspaceId, resumeId } = duty.destination.subject
    const employeeTargetId = `employee:${workspaceId}:${resumeId}` as const
    if (targetAvailable(employeeTargetId)) {
      return { ...duty, targetId: employeeTargetId, fallbackTargetId: 'operations' }
    }
  }
  return { ...duty, targetId: duty.destination.targetId }
}
