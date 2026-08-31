import type {
  IssueAutomationHealthState,
  IssueListItem,
  IssuePriority,
  IssueSnapshot,
} from '../api/issues'
import type { InboxEntry } from '../api/inbox'
import type { ScheduleWhen } from '../api/schedule'
import type {
  OfficeActivityKind,
  OfficeActivityLandmark,
  OfficeActivitySessionSubject,
} from './useOfficeProductActivity'

export type OfficeDutySourceStatus = 'loading' | 'ready' | 'error'
export type OfficeDutyAcknowledgementResult = 'acknowledged' | 'already-resolved'
export type OfficeDutyKind = 'agent' | 'inbox' | 'cadence'
export type OfficeEmployeeDutyTargetId = `employee:${string}:${string}`
export type OfficeDutyTargetId =
  | 'operations'
  | 'inbox-service'
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

export interface OfficeInboxDutyEvidence {
  readonly title: string
  readonly excerpt?: string
  /** Metadata declared by the exact Scheduled Issue that produced this delivery. */
  readonly declaredIssue?: {
    readonly workspaceId: string
    readonly issueId: string
    readonly title: string
    readonly priority: IssuePriority
    readonly nextDueAtMs: number | null
    /** Other unread deliveries joined to this exact Workspace + Scheduled Issue. */
    readonly unreadSiblingCount: number
    /** Unread versions strictly earlier by the stable timestamp/id chronology. */
    readonly olderUnreadCount: number
  }
  /** Captured server row used only to make an exact older Inbox entry addressable. */
  readonly entry: InboxEntry
}

interface OfficeDutyCandidateBase {
  readonly id: string
  readonly registrationId: string
  readonly count: number
}

type OfficeJournalDutyKind = Extract<OfficeActivityKind, 'agent'>

type OfficeEventDutyCandidate = {
  [K in OfficeJournalDutyKind]: OfficeDutyCandidateBase & {
    readonly kind: K
    readonly landmark: OfficeActivityLandmark
    readonly destination: {
      readonly kind: 'journal'
      readonly channel: K
      readonly targetId: 'operations'
      readonly subject?: K extends 'agent'
        ? OfficeActivitySessionSubject
        : never
    }
    readonly receipt: {
      readonly kind: 'event-watermark'
      readonly family: K
      readonly throughSeq: number
    }
  }
}[OfficeJournalDutyKind]

export type OfficeInboxDutyCandidate = OfficeDutyCandidateBase & {
  readonly kind: 'inbox'
  readonly destination: {
    readonly kind: 'inbox-entry'
    readonly workspaceId: string
    readonly inboxEntryId: string
    readonly targetId: 'inbox-service'
  }
  readonly receipt: {
    readonly kind: 'inbox-read'
    readonly workspaceId: string
    readonly inboxEntryId: string
    readonly fingerprint: string
  }
  readonly delivery: OfficeInboxDutyEvidence
}

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

export type OfficeDutyCandidate =
  | OfficeEventDutyCandidate
  | OfficeInboxDutyCandidate
  | OfficeCadenceDutyCandidate

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

export function inboxUnreadDutyRegistration(
  deliveries: readonly OfficeInboxDutyEvidence[],
  status: OfficeDutySourceStatus,
  issues: IssueSnapshot | null = null,
): OfficeDutyRegistration {
  const exactIssues = new Map<string, {
    readonly workspaceId: string
    readonly issueId: string
    readonly title: string
    readonly priority: IssuePriority
    readonly nextDueAtMs: number | null
  }>()
  for (const workspace of issues?.workspaces ?? []) {
    if (workspace.status !== 'ok') continue
    for (const issue of workspace.issues) {
      if (!issue.when) continue
      const declaredIssue = {
        workspaceId: workspace.wsId,
        issueId: issue.id,
        title: issue.title,
        priority: issue.priority,
        nextDueAtMs: issue.nextDueAtMs ?? null,
      }
      exactIssues.set(`${workspace.wsId}\u0000${issue.id}`, declaredIssue)
    }
  }
  const joined = deliveries.map((delivery) => {
    const issueId = delivery.entry.origin?.issueId
    const issueWorkspaceId = delivery.entry.origin?.issueWorkspaceId
    if (!issueId || !issueWorkspaceId) return delivery
    const declaredIssue = exactIssues.get(`${issueWorkspaceId}\u0000${issueId}`)
    return declaredIssue ? {
      ...delivery,
      declaredIssue: {
        ...declaredIssue,
        unreadSiblingCount: 0,
        olderUnreadCount: 0,
      },
    } : delivery
  })

  const routineKey = (delivery: OfficeInboxDutyEvidence): string | null => {
    const issue = delivery.declaredIssue
    return issue ? `${issue.workspaceId}\u0000${issue.issueId}` : null
  }
  const compareChronology = (left: OfficeInboxDutyEvidence, right: OfficeInboxDutyEvidence): number => {
    const occurredAt = left.entry.ts - right.entry.ts
    return occurredAt !== 0 ? occurredAt : left.entry.id.localeCompare(right.entry.id)
  }
  const routineGroups = new Map<string, OfficeInboxDutyEvidence[]>()
  for (const delivery of joined) {
    const key = routineKey(delivery)
    if (!key) continue
    const group = routineGroups.get(key)
    if (group) group.push(delivery)
    else routineGroups.set(key, [delivery])
  }
  const routineCounts = new Map<OfficeInboxDutyEvidence, {
    readonly unreadSiblingCount: number
    readonly olderUnreadCount: number
  }>()
  for (const group of routineGroups.values()) {
    const chronological = [...group].sort(compareChronology)
    let strictlyEarlier = 0
    chronological.forEach((delivery, index) => {
      if (index > 0 && compareChronology(chronological[index - 1]!, delivery) < 0) {
        strictlyEarlier = index
      }
      routineCounts.set(delivery, {
        unreadSiblingCount: Math.max(0, chronological.length - 1),
        olderUnreadCount: strictlyEarlier,
      })
    })
  }
  const enriched = joined.map((delivery): OfficeInboxDutyEvidence => {
    const key = routineKey(delivery)
    if (!key || !delivery.declaredIssue) return delivery
    const counts = routineCounts.get(delivery)
    if (!counts) return delivery
    return {
      ...delivery,
      declaredIssue: {
        ...delivery.declaredIssue,
        ...counts,
      },
    }
  })

  // Preserve the established documented-before-comments and oldest-first
  // ordering for ordinary Inbox work. Exact Scheduled-Issue routines reuse
  // those same layer positions but put their newest version first within each
  // layer, so a finite shift sees current evidence without hiding older rows.
  const baseline = [...enriched].sort((left, right) => {
    const documented = Number((right.entry.docs?.length ?? 0) > 0)
      - Number((left.entry.docs?.length ?? 0) > 0)
    if (documented !== 0) return documented
    return compareChronology(left, right)
  })
  const newestRoutineGroups = new Map<string, OfficeInboxDutyEvidence[]>()
  for (const delivery of enriched) {
    const key = routineKey(delivery)
    if (!key) continue
    const group = newestRoutineGroups.get(key)
    if (group) group.push(delivery)
    else newestRoutineGroups.set(key, [delivery])
  }
  for (const [key, group] of newestRoutineGroups) {
    newestRoutineGroups.set(key, [...group].sort((left, right) => {
      const documented = Number((right.entry.docs?.length ?? 0) > 0)
        - Number((left.entry.docs?.length ?? 0) > 0)
      return documented !== 0 ? documented : compareChronology(right, left)
    }))
  }
  const routineOffsets = new Map<string, number>()
  const ordered = baseline.map((delivery) => {
    const key = routineKey(delivery)
    if (!key) return delivery
    const offset = routineOffsets.get(key) ?? 0
    routineOffsets.set(key, offset + 1)
    return newestRoutineGroups.get(key)?.[offset] ?? delivery
  })
  const count = ordered.length
  const candidates: OfficeInboxDutyCandidate[] = ordered.map((delivery) => ({
    id: `inbox-unread:${delivery.entry.id}`,
    registrationId: 'inbox-unread',
    kind: 'inbox',
    count,
    destination: {
      kind: 'inbox-entry',
      workspaceId: delivery.entry.workspaceId,
      inboxEntryId: delivery.entry.id,
      targetId: 'inbox-service',
    },
    receipt: {
      kind: 'inbox-read',
      workspaceId: delivery.entry.workspaceId,
      inboxEntryId: delivery.entry.id,
      fingerprint: JSON.stringify([
        'inbox-read-v1',
        delivery.entry.workspaceId,
        delivery.entry.id,
        delivery.entry.ts,
        (delivery.entry.docs ?? []).map((document) => [document.path, document.revision ?? null]),
      ]),
    },
    delivery,
  }))
  return { id: 'inbox-unread', order: 200, status, candidates }
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
  return { id: 'scheduled-issue-health', order: 100, status, candidates }
}

/** Current providers normalize their domain hooks before entering the queue. */
export function coreOfficeDutyRegistrations(input: {
  readonly now: number
  /** Ambient journal inputs are accepted for callers but never create mandatory duties. */
  readonly activity?: unknown
  readonly activityStatus?: OfficeDutySourceStatus
  readonly inboxDeliveries: readonly OfficeInboxDutyEvidence[]
  readonly inboxStatus: OfficeDutySourceStatus
  readonly issues: IssueSnapshot | null
  readonly issueStatus: OfficeDutySourceStatus
}): readonly OfficeDutyRegistration[] {
  return [
    inboxUnreadDutyRegistration(input.inboxDeliveries, input.inboxStatus, input.issues),
    scheduledIssueHealthDutyRegistration(input.now, input.issues, input.issueStatus),
  ]
}

export interface OfficeDutyProjection {
  readonly candidates: readonly OfficeDutyCandidate[]
  readonly status: OfficeDutySourceStatus
}

/**
 * Collect every known mandatory provider. Unknown providers prevent an honest
 * clear state, but they do not hide a concrete duty from another provider.
 */
export function projectOfficeDutyQueue(
  registrations: readonly OfficeDutyRegistration[],
  includeCandidate: (candidate: OfficeDutyCandidate) => boolean = () => true,
): OfficeDutyProjection {
  const ordered = registrations
    .map((registration, index) => ({ registration, index }))
    .sort((left, right) => left.registration.order - right.registration.order || left.index - right.index)
  const seen = new Set<string>()
  const candidates: OfficeDutyCandidate[] = []
  let status: OfficeDutySourceStatus = 'ready'
  for (const { registration } of ordered) {
    if (registration.status === 'error') status = 'error'
    else if (registration.status === 'loading' && status === 'ready') status = 'loading'
    for (const candidate of registration.candidates) {
      if (!includeCandidate(candidate) || seen.has(candidate.id)) continue
      seen.add(candidate.id)
      candidates.push(candidate)
    }
  }
  candidates.sort((left, right) => {
    const tier = officeDutyTier(left) - officeDutyTier(right)
    if (tier !== 0) return tier
    const leftRegistration = ordered.findIndex(({ registration }) => registration.id === left.registrationId)
    const rightRegistration = ordered.findIndex(({ registration }) => registration.id === right.registrationId)
    return leftRegistration - rightRegistration
  })
  return { candidates, status }
}

/** Product-policy tier. It uses only exact user-declared Issue priority. */
export function officeDutyTier(duty: OfficeDutyCandidate): number {
  if (duty.kind === 'cadence') {
    return duty.cadence.priority === 'urgent' || duty.cadence.priority === 'high' ? 0 : 2
  }
  if (duty.kind === 'inbox') {
    const priority = duty.delivery.declaredIssue?.priority
    return priority === 'urgent' || priority === 'high' ? 1 : 3
  }
  return 4
}

export function officeDutyEstimateMinutes(duty: OfficeDutyCandidate): number {
  if (duty.kind === 'cadence') return 3
  if (duty.kind === 'inbox') {
    const documents = duty.delivery.entry.docs?.length ?? 0
    return documents > 0 ? Math.min(8, 2 + documents) : 1
  }
  return 2
}

export function resolveOfficeDutyTarget(
  duty: OfficeDutyCandidate,
  targetAvailable: (targetId: string) => boolean = () => false,
): OfficeResolvedDuty {
  if (duty.destination.kind === 'journal'
    && duty.destination.channel === 'agent'
    && duty.destination.subject?.kind === 'session') {
    const { workspaceId, resumeId } = duty.destination.subject
    const employeeTargetId = `employee:${workspaceId}:${resumeId}` as const
    if (targetAvailable(employeeTargetId)) {
      return { ...duty, targetId: employeeTargetId, fallbackTargetId: 'operations' }
    }
  }
  return { ...duty, targetId: duty.destination.targetId }
}
