import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { UseIssues } from '../hooks/useIssues'
import {
  coreOfficeDutyRegistrations,
  projectOfficeDutyQueue,
  type OfficeCadenceDutyCandidate,
  type OfficeDutyAcknowledgementResult,
  type OfficeDutyCandidate,
  type OfficeDutySourceEpochs,
  type OfficeDutySourceStatus,
  type OfficeInboxDutyEvidence,
} from './duty-registry'
import type { OfficeProductActivity } from './useOfficeProductActivity'
import type { OfficeDayController } from './useOfficeDay'
import { useOfficeInboxDuties } from './useOfficeInboxDuties'

const EMPTY_INBOX_EVIDENCE = new Map<string, OfficeInboxDutyEvidence>()
const EMPTY_EVIDENCE_RECEIPTS: readonly { subjectKey: string; fingerprint: string }[] = []
const NO_EVIDENCE_RECEIPT = () => false

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
  /** Successful authoritative refresh counters used to validate negative snapshots. */
  readonly sourceEpochs: OfficeDutySourceEpochs
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
  officeDay: Pick<
    OfficeDayController,
    'evidenceReceipts' | 'hasEvidenceReceipt' | 'reviewEvidence' | 'forgetEvidence'
  > | null = null,
): OfficeDutyQueue {
  const evidenceReceipts = officeDay?.evidenceReceipts ?? EMPTY_EVIDENCE_RECEIPTS
  const hasEvidenceReceipt = officeDay?.hasEvidenceReceipt ?? NO_EVIDENCE_RECEIPT
  const reviewEvidence = officeDay?.reviewEvidence
  const forgetEvidence = officeDay?.forgetEvidence
  const forgettingEvidenceSubjectsRef = useRef(new Set<string>())
  const evidenceReceiptIssueEpochsRef = useRef(new Map<string, number>())
  const inboxDuties = useOfficeInboxDuties(activity.inbox?.seq)
  const inboxStatus = inboxDuties.status
  const inboxDeliveries = inboxDuties.deliveries
  const inboxEvidenceByEntryId = inboxDuties.evidenceByEntryId ?? EMPTY_INBOX_EVIDENCE
  const markInboxReadConfirmed = inboxDuties.markReadConfirmed
  const issueSnapshotAuthoritative = issues.successEpoch > 0
  const cadenceStatus = issues.error
    ? 'error' as const
    : issues.loading || !issueSnapshotAuthoritative ? 'loading' as const
      : issues.data ? 'ready' as const : 'loading' as const
  const issueStatus = issues.error || issues.data?.workspaces.some((workspace) => workspace.status === 'invalid')
    ? 'error' as const
    : issues.loading || !issueSnapshotAuthoritative ? 'loading' as const
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
      || !hasEvidenceReceipt(duty.receipt.subjectKey, duty.receipt.fingerprint)
  )), [hasEvidenceReceipt, registrations])
  const reviewedCadenceFollowUps = useMemo(() => unresolvedProjection.candidates.filter(
    (duty): duty is OfficeCadenceDutyCandidate => duty.kind === 'cadence'
      && hasEvidenceReceipt(duty.receipt.subjectKey, duty.receipt.fingerprint),
  ), [hasEvidenceReceipt, unresolvedProjection.candidates])
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
    if (!issueSnapshotAuthoritative || issues.loading || issues.error || !issues.data) return null
    return new Set(issues.data.workspaces.flatMap((workspace) => (
      workspace.status === 'ok' ? [workspace.wsId] : []
    )))
  }, [issueSnapshotAuthoritative, issues.data, issues.error, issues.loading])
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
    const scheduledReceipts = evidenceReceipts.filter((receipt) => (
      receipt.subjectKey.startsWith('["scheduled-issue",')
    ))
    const exactReceiptKeys = new Set(scheduledReceipts.map((receipt) => (
      JSON.stringify([receipt.subjectKey, receipt.fingerprint])
    )))
    for (const exactReceiptKey of exactReceiptKeys) {
      if (!evidenceReceiptIssueEpochsRef.current.has(exactReceiptKey)) {
        evidenceReceiptIssueEpochsRef.current.set(exactReceiptKey, issues.requestEpoch)
      }
    }
    for (const exactReceiptKey of evidenceReceiptIssueEpochsRef.current.keys()) {
      if (!exactReceiptKeys.has(exactReceiptKey)) {
        evidenceReceiptIssueEpochsRef.current.delete(exactReceiptKey)
      }
    }
    if (!forgetEvidence || !reconcilableIssueWorkspaces) return
    for (const subjectKey of new Set(scheduledReceipts.map((receipt) => receipt.subjectKey))) {
      const hasPostReceiptIssueRefresh = scheduledReceipts
        .filter((receipt) => receipt.subjectKey === subjectKey)
        .every((receipt) => {
          const exactReceiptKey = JSON.stringify([receipt.subjectKey, receipt.fingerprint])
          const firstSeenEpoch = evidenceReceiptIssueEpochsRef.current.get(exactReceiptKey)
          return firstSeenEpoch != null && issues.successEpoch > firstSeenEpoch
        })
      if (!subjectKey.startsWith('["scheduled-issue",')
        || !reconcilableIssueWorkspaces.has(scheduledIssueWorkspaceId(subjectKey) ?? '')
        || currentExceptionReceipts.has(subjectKey)
        || !hasPostReceiptIssueRefresh
        || forgettingEvidenceSubjectsRef.current.has(subjectKey)) continue
      forgettingEvidenceSubjectsRef.current.add(subjectKey)
      void forgetEvidence(subjectKey)
        .catch(() => undefined)
        .finally(() => forgettingEvidenceSubjectsRef.current.delete(subjectKey))
    }
  }, [
    currentExceptionReceipts,
    evidenceReceipts,
    forgetEvidence,
    issues.requestEpoch,
    issues.successEpoch,
    reconcilableIssueWorkspaces,
  ])

  const acknowledge = useCallback(async (duty: OfficeDutyCandidate) => {
    const receipt = duty.receipt
    if (receipt.kind === 'inbox-read') {
      return markInboxReadConfirmed(receipt.inboxEntryId)
    }
    if (receipt.kind === 'event-watermark') {
      activity.acknowledgeThrough(receipt.family, receipt.throughSeq)
      return 'acknowledged'
    }
    if (!reviewEvidence || duty.kind !== 'cadence') {
      throw new Error('Office Day is unavailable.')
    }
    return reviewEvidence(duty)
  }, [activity, markInboxReadConfirmed, reviewEvidence])

  return {
    candidates,
    reviewedCadenceFollowUps,
    status: projection.status,
    inboxStatus,
    cadenceStatus,
    issueStatus,
    sourceEpochs: {
      inbox: {
        requested: inboxDuties.requestEpoch,
        successful: inboxDuties.successEpoch,
      },
      issues: {
        requested: issues.requestEpoch,
        successful: issues.successEpoch,
      },
    },
    unresolvedCount: unresolvedProjection.candidates.length,
    inboxCount: inboxDeliveries.length,
    evidenceBySubject,
    inboxEvidenceByEntryId,
    inboxByEntryId,
    acknowledge,
  }
}
