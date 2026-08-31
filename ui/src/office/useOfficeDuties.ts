import { useCallback, useEffect, useMemo, useState } from 'react'

import type { UseIssues } from '../hooks/useIssues'
import {
  coreOfficeDutyRegistrations,
  projectOfficeDutyQueue,
  type OfficeCadenceDutyCandidate,
  type OfficeDutyAcknowledgementResult,
  type OfficeDutyCandidate,
  type OfficeDutySourceStatus,
  type OfficeInboxDutyEvidence,
} from './duty-registry'
import type { OfficeProductActivity } from './useOfficeProductActivity'
import { useOfficeInboxDuties } from './useOfficeInboxDuties'

const EVIDENCE_RECEIPTS_KEY = 'openalice:office-duty:evidence-receipts:v2'
const MAX_SESSION_RECEIPTS = 256
const EMPTY_INBOX_EVIDENCE = new Map<string, OfficeInboxDutyEvidence>()

function readEvidenceReceipts(): Map<string, string> {
  if (typeof window === 'undefined') return new Map()
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(EVIDENCE_RECEIPTS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return new Map()
    return new Map(parsed.filter((value): value is [string, string] => (
      Array.isArray(value)
      && value.length === 2
      && typeof value[0] === 'string'
      && typeof value[1] === 'string'
    )))
  } catch {
    return new Map()
  }
}

function writeEvidenceReceipts(receipts: ReadonlyMap<string, string>) {
  try {
    const bounded = [...receipts.entries()].slice(-MAX_SESSION_RECEIPTS)
    window.sessionStorage.setItem(EVIDENCE_RECEIPTS_KEY, JSON.stringify(bounded))
  } catch {
    // A blocked session store must not make the Office guidance loop unusable.
  }
}

function scheduledIssueWorkspaceId(subjectKey: string): string | null {
  try {
    const parsed: unknown = JSON.parse(subjectKey)
    return Array.isArray(parsed)
      && parsed[0] === 'scheduled-issue'
      && typeof parsed[1] === 'string'
      ? parsed[1]
      : null
  } catch {
    return null
  }
}

export interface OfficeDutyQueue {
  /** Every currently actionable duty, before the Office freezes a finite shift. */
  readonly candidates: readonly OfficeDutyCandidate[]
  /** Reviewed cadence exceptions whose exact evidence is still unresolved. */
  readonly reviewedCadenceFollowUps: readonly OfficeCadenceDutyCandidate[]
  readonly status: OfficeDutySourceStatus
  readonly inboxStatus: OfficeDutySourceStatus
  readonly cadenceStatus: OfficeDutySourceStatus
  /** Readiness of the Scheduled-Issue registry used for exact routine joins. */
  readonly issueStatus: OfficeDutySourceStatus
  /** Domain facts that still block an honest clear, including reviewed cadence exceptions. */
  readonly unresolvedCount: number
  readonly inboxCount: number
  readonly evidenceBySubject: ReadonlyMap<string, OfficeDutyCandidate>
  /** Exact Inbox presentation for every row in the current full history. */
  readonly inboxEvidenceByEntryId: ReadonlyMap<string, OfficeInboxDutyEvidence>
  /** Actionable unread Inbox candidates only. */
  readonly inboxByEntryId: ReadonlyMap<string, OfficeDutyCandidate>
  acknowledge(duty: OfficeDutyCandidate): Promise<OfficeDutyAcknowledgementResult>
}

/** Combines registered read-only product sources into the Office duty queue. */
export function useOfficeDuties(
  activity: OfficeProductActivity,
  issues: UseIssues,
): OfficeDutyQueue {
  const [evidenceReceipts, setEvidenceReceipts] = useState(readEvidenceReceipts)
  const inboxDuties = useOfficeInboxDuties(activity.inbox?.seq)
  const inboxStatus = inboxDuties.status
  const inboxDeliveries = inboxDuties.deliveries
  const inboxEvidenceByEntryId = inboxDuties.evidenceByEntryId ?? EMPTY_INBOX_EVIDENCE
  const markInboxReadConfirmed = inboxDuties.markReadConfirmed
  const cadenceStatus = issues.error
    ? 'error' as const
    : issues.loading ? 'loading' as const
      : issues.data ? 'ready' as const : 'loading' as const
  const issueStatus = issues.error || issues.data?.workspaces.some((workspace) => workspace.status === 'invalid')
    ? 'error' as const
    : issues.loading ? 'loading' as const
      : issues.data ? 'ready' as const : 'loading' as const
  const registrations = useMemo(() => coreOfficeDutyRegistrations({
    now: Date.now(),
    inboxDeliveries,
    inboxStatus,
    issues: issues.data,
    issueStatus,
  }), [inboxDeliveries, inboxStatus, issueStatus, issues.data])
  const unresolvedProjection = useMemo(
    () => projectOfficeDutyQueue(registrations),
    [registrations],
  )
  const projection = useMemo(() => projectOfficeDutyQueue(registrations, (duty) => (
    duty.receipt.kind !== 'evidence'
      || evidenceReceipts.get(duty.receipt.subjectKey) !== duty.receipt.fingerprint
  )), [evidenceReceipts, registrations])
  const reviewedCadenceFollowUps = useMemo(() => unresolvedProjection.candidates.filter(
    (duty): duty is OfficeCadenceDutyCandidate => duty.kind === 'cadence'
      && evidenceReceipts.get(duty.receipt.subjectKey) === duty.receipt.fingerprint,
  ), [evidenceReceipts, unresolvedProjection.candidates])
  const candidates = useMemo(() => {
    const pending = projection.candidates
    const evidenceCounts = new Map<string, number>()
    for (const duty of pending) {
      if (duty.receipt.kind !== 'evidence') continue
      evidenceCounts.set(duty.registrationId, (evidenceCounts.get(duty.registrationId) ?? 0) + 1)
    }
    return pending.map((duty) => duty.receipt.kind === 'evidence'
      ? { ...duty, count: evidenceCounts.get(duty.registrationId) ?? duty.count }
      : duty)
  }, [projection.candidates])

  const currentExceptionReceipts = useMemo(() => {
    const registration = registrations.find((item) => item.id === 'scheduled-issue-health')
    return new Set((registration?.candidates ?? []).flatMap((duty) => (
      duty.receipt.kind === 'evidence' ? [duty.receipt.subjectKey] : []
    )))
  }, [registrations])
  const reconcilableIssueWorkspaces = useMemo(() => {
    if (issues.loading || issues.error || !issues.data) return null
    return new Set(issues.data.workspaces.flatMap((workspace) => (
      workspace.status === 'ok' ? [workspace.wsId] : []
    )))
  }, [issues.data, issues.error, issues.loading])
  const evidenceBySubject = useMemo(() => new Map(registrations.flatMap((registration) => (
    registration.candidates.flatMap((duty) => duty.receipt.kind === 'evidence'
      ? [[duty.receipt.subjectKey, duty] as const]
      : [])
  ))), [registrations])
  const inboxByEntryId = useMemo(() => new Map(registrations.flatMap((registration) => (
    registration.candidates.flatMap((duty) => duty.receipt.kind === 'inbox-read'
      ? [[duty.receipt.inboxEntryId, duty] as const]
      : [])
  ))), [registrations])
  useEffect(() => {
    if (!reconcilableIssueWorkspaces) return
    setEvidenceReceipts((current) => {
      const next = new Map([...current].filter(([subjectKey]) => (
        !subjectKey.startsWith('["scheduled-issue",')
        || !reconcilableIssueWorkspaces.has(scheduledIssueWorkspaceId(subjectKey) ?? '')
        || currentExceptionReceipts.has(subjectKey)
      )))
      if (next.size === current.size) return current
      writeEvidenceReceipts(next)
      return next
    })
  }, [currentExceptionReceipts, reconcilableIssueWorkspaces])

  const acknowledge = useCallback(async (duty: OfficeDutyCandidate) => {
    const receipt = duty.receipt
    if (receipt.kind === 'inbox-read') {
      return markInboxReadConfirmed(receipt.inboxEntryId)
    }
    if (receipt.kind === 'event-watermark') {
      activity.acknowledgeThrough(receipt.family, receipt.throughSeq)
      return 'acknowledged'
    }
    setEvidenceReceipts((current) => {
      if (current.get(receipt.subjectKey) === receipt.fingerprint) return current
      const next = new Map(current)
      next.delete(receipt.subjectKey)
      next.set(receipt.subjectKey, receipt.fingerprint)
      writeEvidenceReceipts(next)
      return next
    })
    return 'acknowledged'
  }, [activity, markInboxReadConfirmed])

  return {
    candidates,
    reviewedCadenceFollowUps,
    status: projection.status,
    inboxStatus,
    cadenceStatus,
    issueStatus,
    unresolvedCount: unresolvedProjection.candidates.length,
    inboxCount: inboxDeliveries.length,
    evidenceBySubject,
    inboxEvidenceByEntryId,
    inboxByEntryId,
    acknowledge,
  }
}
