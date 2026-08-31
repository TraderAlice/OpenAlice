import { useCallback, useEffect, useMemo, useState } from 'react'

import type { UseIssues } from '../hooks/useIssues'
import {
  coreOfficeDutyRegistrations,
  projectOfficeDutyQueue,
  type OfficeDutyCandidate,
  type OfficeDutySourceStatus,
} from './duty-registry'
import type { OfficeProductActivity } from './useOfficeProductActivity'

const EVIDENCE_RECEIPTS_KEY = 'openalice:office-duty:evidence-receipts:v2'
const MAX_SESSION_RECEIPTS = 256

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

export interface OfficeDutyQueue {
  readonly candidates: readonly OfficeDutyCandidate[]
  readonly status: OfficeDutySourceStatus
  readonly cadenceStatus: OfficeDutySourceStatus
  readonly evidenceBySubject: ReadonlyMap<string, OfficeDutyCandidate>
  acknowledge(duty: OfficeDutyCandidate): void
}

/** Combines registered read-only product sources into the Office duty queue. */
export function useOfficeDuties(
  activity: OfficeProductActivity,
  issues: UseIssues,
): OfficeDutyQueue {
  const [evidenceReceipts, setEvidenceReceipts] = useState(readEvidenceReceipts)
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
    activity,
    activityStatus: activity.sourceStatus ?? 'ready',
    issues: issues.data,
    issueStatus,
  }), [activity, issueStatus, issues.data])
  const projection = useMemo(() => projectOfficeDutyQueue(registrations, (duty) => (
    duty.receipt.kind !== 'evidence'
      || evidenceReceipts.get(duty.receipt.subjectKey) !== duty.receipt.fingerprint
  )), [evidenceReceipts, registrations])
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
  const evidenceBySubject = useMemo(() => new Map(registrations.flatMap((registration) => (
    registration.candidates.flatMap((duty) => duty.receipt.kind === 'evidence'
      ? [[duty.receipt.subjectKey, duty] as const]
      : [])
  ))), [registrations])
  useEffect(() => {
    if (issueStatus !== 'ready') return
    setEvidenceReceipts((current) => {
      const next = new Map([...current].filter(([subjectKey]) => (
        !subjectKey.startsWith('["scheduled-issue",') || currentExceptionReceipts.has(subjectKey)
      )))
      if (next.size === current.size) return current
      writeEvidenceReceipts(next)
      return next
    })
  }, [currentExceptionReceipts, issueStatus])

  const acknowledge = useCallback((duty: OfficeDutyCandidate) => {
    const receipt = duty.receipt
    if (receipt.kind === 'event-watermark') {
      activity.acknowledgeThrough(receipt.family, receipt.throughSeq)
      return
    }
    setEvidenceReceipts((current) => {
      if (current.get(receipt.subjectKey) === receipt.fingerprint) return current
      const next = new Map(current)
      next.delete(receipt.subjectKey)
      next.set(receipt.subjectKey, receipt.fingerprint)
      writeEvidenceReceipts(next)
      return next
    })
  }, [activity])

  return {
    candidates,
    status: projection.status,
    cadenceStatus,
    evidenceBySubject,
    acknowledge,
  }
}
