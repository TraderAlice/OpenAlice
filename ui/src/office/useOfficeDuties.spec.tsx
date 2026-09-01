// @vitest-environment jsdom

import { useCallback, useMemo, useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueListItem, IssueSnapshot } from '../api/issues'
import type { OfficeDayEvidenceReceipt } from '../api/office'
import type { UseIssues } from '../hooks/useIssues'
import type { OfficeDayController } from './useOfficeDay'
import { useOfficeDuties } from './useOfficeDuties'
import type { OfficeProductActivity } from './useOfficeProductActivity'

const { inboxDutiesMock, markReadConfirmedMock } = vi.hoisted(() => ({
  inboxDutiesMock: vi.fn(),
  markReadConfirmedMock: vi.fn(),
}))

vi.mock('./useOfficeInboxDuties', () => ({
  useOfficeInboxDuties: inboxDutiesMock,
}))

const NOW = Date.UTC(2026, 7, 31, 12)

function exception(latestTaskId = 'run-a'): IssueListItem {
  return {
    id: 'weekly-review',
    title: 'Review the weekly report cadence',
    status: 'todo',
    priority: 'high',
    assignee: '@new-each-run',
    when: { kind: 'every', every: '1w' },
    lastFiredAtMs: NOW - 1_000,
    nextDueAtMs: NOW + 60_000,
    automationHealth: {
      state: 'failed',
      message: 'Latest scheduled run failed.',
      latestTaskId,
    },
  }
}

function issues(
  issue: IssueListItem | null,
  error: string | null = null,
  requestEpoch = 1,
  successEpoch = requestEpoch,
): UseIssues {
  const data: IssueSnapshot = {
    workspaces: [{ wsId: 'ws-a', tag: 'weekly', status: 'ok', issues: issue ? [issue] : [] }],
  }
  return { data, error, loading: false, requestEpoch, successEpoch }
}

function activity(): OfficeProductActivity {
  return {
    agent: null,
    inbox: null,
    news: null,
    attention: { agent: false, inbox: false, news: false },
    pending: { agent: 0, inbox: 0, news: 0 },
    freshKind: null,
    agentSourceStatus: 'ready',
    sourceStatus: 'ready',
    acknowledgeThrough: vi.fn(),
  }
}

function inboxDelivery(id = 'inbox-a') {
  const docs = [{ path: 'reports/risk-review.md', revision: 'rev-a' }]
  return {
    entryId: id,
    workspaceId: 'research-desk',
    workspaceLabel: 'Research desk',
    occurredAt: NOW - 5_000,
    title: 'Review the risk report',
    excerpt: 'The report is ready for exact review.',
    documents: docs,
    entry: {
      id,
      ts: NOW - 5_000,
      workspaceId: 'research-desk',
      workspaceLabel: 'Research desk',
      docs,
      comments: '# Review the risk report\n\nThe report is ready for exact review.',
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function useTestOfficeDay(
  initialReceipts: readonly OfficeDayEvidenceReceipt[] = [],
): Pick<
  OfficeDayController,
  'evidenceReceipts' | 'hasEvidenceReceipt' | 'reviewEvidence' | 'forgetEvidence'
> {
  const [evidenceReceipts, setEvidenceReceipts] = useState<readonly OfficeDayEvidenceReceipt[]>(
    initialReceipts,
  )
  const hasEvidenceReceipt = useCallback((subjectKey: string, fingerprint: string) => (
    evidenceReceipts.some((receipt) => (
      receipt.subjectKey === subjectKey && receipt.fingerprint === fingerprint
    ))
  ), [evidenceReceipts])
  const reviewEvidence = useCallback<OfficeDayController['reviewEvidence']>(async (duty) => {
    const { subjectKey, fingerprint } = duty.receipt
    if (hasEvidenceReceipt(subjectKey, fingerprint)) return 'already-resolved'
    setEvidenceReceipts((current) => [...current, { subjectKey, fingerprint, reviewedAt: NOW }])
    return 'acknowledged'
  }, [hasEvidenceReceipt])
  const forgetEvidence = useCallback<OfficeDayController['forgetEvidence']>(async (subjectKey) => {
    setEvidenceReceipts((current) => current.filter((receipt) => receipt.subjectKey !== subjectKey))
  }, [])
  return useMemo(() => ({
    evidenceReceipts,
    hasEvidenceReceipt,
    reviewEvidence,
    forgetEvidence,
  }), [evidenceReceipts, forgetEvidence, hasEvidenceReceipt, reviewEvidence])
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  markReadConfirmedMock.mockReset()
  markReadConfirmedMock.mockResolvedValue('acknowledged')
  inboxDutiesMock.mockReset()
  inboxDutiesMock.mockReturnValue({
    status: 'ready',
    requestEpoch: 1,
    successEpoch: 1,
    deliveries: [],
    markReadConfirmed: markReadConfirmedMock,
  })
})

afterEach(() => vi.restoreAllMocks())

describe('useOfficeDuties', () => {
  it('restores an exact cadence receipt from the Project Office Day after remount', async () => {
    const productActivity = activity()
    const first = renderHook(() => {
      const officeDay = useTestOfficeDay()
      return useOfficeDuties(productActivity, issues(exception()), officeDay)
    })
    const duty = first.result.current.candidates[0]!
    expect(duty.kind).toBe('cadence')
    expect(first.result.current.unresolvedCount).toBe(1)
    await act(async () => {
      await first.result.current.acknowledge(duty)
    })
    expect(first.result.current.candidates).toEqual([])
    expect(first.result.current.reviewedCadenceFollowUps).toEqual([duty])
    expect(first.result.current.unresolvedCount).toBe(1)
    first.unmount()

    const second = renderHook(() => {
      const officeDay = useTestOfficeDay([{
        subjectKey: duty.receipt.kind === 'evidence' ? duty.receipt.subjectKey : 'unexpected',
        fingerprint: duty.receipt.kind === 'evidence' ? duty.receipt.fingerprint : 'unexpected',
        reviewedAt: NOW,
      }])
      return useOfficeDuties(productActivity, issues(exception()), officeDay)
    })
    expect(second.result.current.candidates).toEqual([])
    expect(second.result.current.reviewedCadenceFollowUps).toMatchObject([
      { id: duty.id, receipt: duty.receipt },
    ])
    expect(second.result.current.status).toBe('ready')
    expect(second.result.current.issueStatus).toBe('ready')
    expect(second.result.current.unresolvedCount).toBe(1)
  })

  it('keeps new evidence pending when an older captured dossier is stamped', async () => {
    const productActivity = activity()
    const { result, rerender } = renderHook(
      ({ issue }) => {
        const officeDay = useTestOfficeDay()
        return useOfficeDuties(productActivity, issues(issue), officeDay)
      },
      { initialProps: { issue: exception('run-a') } },
    )
    const captured = result.current.candidates[0]!
    rerender({ issue: exception('run-b') })
    expect(result.current.candidates[0]?.id).toBe(captured.id)
    expect(result.current.candidates[0]?.receipt).not.toEqual(captured.receipt)

    await act(async () => {
      await result.current.acknowledge(captured)
    })
    expect(result.current.candidates).toHaveLength(1)
    expect(result.current.candidates[0]?.receipt).not.toEqual(captured.receipt)
    expect(result.current.reviewedCadenceFollowUps).toEqual([])
  })

  it('returns changed evidence to the actionable queue instead of treating it as reviewed', async () => {
    const productActivity = activity()
    const { result, rerender } = renderHook(
      ({ issue }) => {
        const officeDay = useTestOfficeDay()
        return useOfficeDuties(productActivity, issues(issue), officeDay)
      },
      { initialProps: { issue: exception('run-a') } },
    )
    const reviewed = result.current.candidates[0]!
    await act(async () => {
      await result.current.acknowledge(reviewed)
    })
    expect(result.current.reviewedCadenceFollowUps).toEqual([reviewed])

    rerender({ issue: exception('run-b') })

    expect(result.current.reviewedCadenceFollowUps).toEqual([])
    expect(result.current.candidates).toMatchObject([
      { id: reviewed.id, kind: 'cadence' },
    ])
    expect(result.current.candidates[0]?.receipt).not.toEqual(reviewed.receipt)
  })

  it('clears a recovered subject receipt so the same exception can recur later', async () => {
    const productActivity = activity()
    const { result, rerender } = renderHook(
      ({ issue, epoch }) => {
        const officeDay = useTestOfficeDay()
        return useOfficeDuties(productActivity, issues(issue, null, epoch), officeDay)
      },
      { initialProps: { issue: exception() as IssueListItem | null, epoch: 1 } },
    )
    const first = result.current.candidates[0]!
    await act(async () => {
      await result.current.acknowledge(first)
    })
    expect(result.current.candidates).toEqual([])
    expect(result.current.reviewedCadenceFollowUps).toEqual([first])

    rerender({
      issue: { ...exception(), automationHealth: { state: 'healthy', message: 'Recovered.' } },
      epoch: 2,
    })
    await waitFor(() => {
      expect(result.current.candidates).toEqual([])
      expect(result.current.reviewedCadenceFollowUps).toEqual([])
    })
    rerender({ issue: exception(), epoch: 2 })
    await waitFor(() => {
      expect(result.current.candidates[0]?.kind).toBe('cadence')
      expect(result.current.reviewedCadenceFollowUps).toEqual([])
    })
  })

  it('keeps a stale exception actionable but refuses to call the shift clear after stamping', async () => {
    const productActivity = activity()
    const hook = renderHook(() => {
      const officeDay = useTestOfficeDay()
      return useOfficeDuties(
        productActivity,
        issues(exception(), 'scanner unavailable'),
        officeDay,
      )
    })
    const duty = hook.result.current.candidates[0]!
    expect(hook.result.current.status).toBe('error')
    await act(async () => {
      await hook.result.current.acknowledge(duty)
    })
    expect(hook.result.current.candidates).toEqual([])
    expect(hook.result.current.reviewedCadenceFollowUps).toEqual([duty])
    expect(hook.result.current.status).toBe('error')
    expect(hook.result.current.unresolvedCount).toBe(1)
  })

  it('treats an invalid Issue workspace as degraded even without a candidate', () => {
    const invalid: UseIssues = {
      data: { workspaces: [{ wsId: 'ws-b', tag: 'broken', status: 'invalid', error: 'bad data', issues: [] }] },
      error: null,
      loading: false,
      requestEpoch: 1,
      successEpoch: 1,
    }
    const hook = renderHook(() => useOfficeDuties(activity(), invalid))
    expect(hook.result.current.candidates).toEqual([])
    expect(hook.result.current.status).toBe('error')
  })

  it('reconciles a healthy workspace receipt while preserving another invalid workspace boundary', async () => {
    const mixed = (issue: IssueListItem, epoch: number): UseIssues => ({
      data: {
        workspaces: [
          { wsId: 'ws-a', tag: 'weekly', status: 'ok', issues: [issue] },
          { wsId: 'ws-b', tag: 'broken', status: 'invalid', error: 'bad data', issues: [] },
        ],
      },
      error: null,
      loading: false,
      requestEpoch: epoch,
      successEpoch: epoch,
    })
    const hook = renderHook(
      ({ issue, epoch }) => {
        const officeDay = useTestOfficeDay()
        return useOfficeDuties(activity(), mixed(issue, epoch), officeDay)
      },
      { initialProps: { issue: exception(), epoch: 1 } },
    )
    expect(hook.result.current.candidates[0]?.kind).toBe('cadence')
    expect(hook.result.current.cadenceStatus).toBe('ready')
    expect(hook.result.current.issueStatus).toBe('error')
    expect(hook.result.current.status).toBe('error')
    await act(async () => {
      await hook.result.current.acknowledge(hook.result.current.candidates[0]!)
    })
    expect(hook.result.current.candidates).toEqual([])
    expect(hook.result.current.reviewedCadenceFollowUps).toHaveLength(1)
    expect(hook.result.current.status).toBe('error')

    hook.rerender({
      issue: { ...exception(), automationHealth: { state: 'healthy', message: 'Recovered.' } },
      epoch: 2,
    })
    await waitFor(() => expect(hook.result.current.reviewedCadenceFollowUps).toEqual([]))

    hook.rerender({ issue: exception(), epoch: 2 })
    await waitFor(() => expect(hook.result.current.candidates[0]?.kind).toBe('cadence'))
  })

  it('does not call a cached empty snapshot shift-clear while Issue refresh is loading', () => {
    const refreshing: UseIssues = {
      data: { workspaces: [{ wsId: 'ws-a', tag: 'weekly', status: 'ok', issues: [] }] },
      error: null,
      loading: true,
      requestEpoch: 1,
      successEpoch: 1,
    }
    const productActivity: OfficeProductActivity = {
      ...activity(),
      agent: { seq: 2, occurredAt: NOW },
      attention: { agent: true, inbox: false, news: false },
      pending: { agent: 1, inbox: 0, news: 0 },
    }
    const hook = renderHook(() => useOfficeDuties(productActivity, refreshing))
    expect(hook.result.current.candidates).toEqual([])
    expect(hook.result.current.status).toBe('loading')
  })

  it.each(['loading', 'error'] as const)(
    'keeps a known cadence duty visible while the durable Inbox source is %s',
    (status) => {
      inboxDutiesMock.mockReturnValue({
        status,
        requestEpoch: 1,
        successEpoch: 1,
        deliveries: [],
        markReadConfirmed: markReadConfirmedMock,
      })
      const productActivity: OfficeProductActivity = {
        ...activity(),
        agent: { seq: 2, occurredAt: NOW },
        attention: { agent: true, inbox: false, news: false },
        pending: { agent: 1, inbox: 0, news: 0 },
      }

      const hook = renderHook(() => useOfficeDuties(productActivity, issues(exception())))

      expect(hook.result.current.candidates).toMatchObject([
        { kind: 'cadence', destination: { issueId: 'weekly-review' } },
      ])
      expect(hook.result.current.inboxStatus).toBe(status)
      expect(hook.result.current.status).toBe(status)
      expect(hook.result.current.unresolvedCount).toBe(1)
    },
  )

  it.each([
    {
      status: 'loading' as const,
      issueSource: {
        data: null,
        error: null,
        loading: true,
        requestEpoch: 0,
        successEpoch: 0,
      } satisfies UseIssues,
    },
    {
      status: 'error' as const,
      issueSource: {
        data: null,
        error: 'scanner unavailable',
        loading: false,
        requestEpoch: 0,
        successEpoch: 0,
      } satisfies UseIssues,
    },
  ])('keeps a known Inbox duty visible while cadence is $status', ({ status, issueSource }) => {
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      requestEpoch: 1,
      successEpoch: 1,
      deliveries: [inboxDelivery('known-inbox')],
      markReadConfirmed: markReadConfirmedMock,
    })

    const hook = renderHook(() => useOfficeDuties(activity(), issueSource))

    expect(hook.result.current.candidates).toMatchObject([
      { kind: 'inbox', destination: { inboxEntryId: 'known-inbox' } },
    ])
    expect(hook.result.current.status).toBe(status)
    expect(hook.result.current.unresolvedCount).toBe(1)
  })

  it('keeps raw News journal activity visible without creating a mandatory duty', () => {
    const productActivity: OfficeProductActivity = {
      ...activity(),
      news: { seq: 7, occurredAt: NOW, detail: 'NVDA closes at a record high', source: 'Wire' },
      attention: { agent: false, inbox: false, news: true },
      pending: { agent: 0, inbox: 0, news: 1 },
      freshKind: 'news',
    }

    const hook = renderHook(() => useOfficeDuties(productActivity, issues(null)))

    expect(productActivity.news).toMatchObject({
      seq: 7,
      detail: 'NVDA closes at a record high',
      source: 'Wire',
    })
    expect(hook.result.current.candidates).toEqual([])
    expect(hook.result.current.status).toBe('ready')
    expect(productActivity.acknowledgeThrough).not.toHaveBeenCalled()
  })

  it.each(['loading', 'error'] as const)(
    'keeps Agent activity ambient while the aggregate journal is %s',
    (sourceStatus) => {
      const productActivity: OfficeProductActivity = {
        ...activity(),
        agent: { seq: 8, occurredAt: NOW, eventType: 'runtime.stopped', status: 'done' },
        attention: { agent: true, inbox: false, news: false },
        pending: { agent: 1, inbox: 0, news: 0 },
        agentSourceStatus: 'ready',
        sourceStatus,
      }

      const hook = renderHook(() => useOfficeDuties(productActivity, issues(null)))

      expect(hook.result.current.candidates).toEqual([])
      expect(hook.result.current.status).toBe('ready')
      expect(hook.result.current.unresolvedCount).toBe(0)
      expect(productActivity.acknowledgeThrough).not.toHaveBeenCalled()
    },
  )

  it('orders cross-source duties by declared priority without letting ordinary Inbox block cadence', () => {
    const highInboxIssue: IssueListItem = {
      ...exception('run-report'),
      id: 'priority-report',
      title: 'Review priority report',
      priority: 'high',
      automationHealth: { state: 'healthy', message: 'Latest scheduled run completed.', latestTaskId: 'run-report' },
    }
    const issueSource: UseIssues = {
      data: {
        workspaces: [{
          wsId: 'ws-a',
          tag: 'weekly',
          status: 'ok',
          issues: [
            { ...exception('run-urgent'), id: 'urgent-cadence', priority: 'urgent' },
            highInboxIssue,
            { ...exception('run-other'), id: 'other-cadence', priority: 'medium' },
          ],
        }],
      },
      error: null,
      loading: false,
      requestEpoch: 1,
      successEpoch: 1,
    }
    const priorityInbox = inboxDelivery('priority-inbox')
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      requestEpoch: 1,
      successEpoch: 1,
      deliveries: [
        inboxDelivery('ordinary-inbox'),
        {
          ...priorityInbox,
          entry: {
            ...priorityInbox.entry,
            workspaceId: 'execution-ws',
            origin: {
              kind: 'headless',
              runId: 'run-report',
              issueId: 'priority-report',
              issueWorkspaceId: 'ws-a',
            },
          },
        },
      ],
      markReadConfirmed: markReadConfirmedMock,
    })

    const hook = renderHook(() => useOfficeDuties(activity(), issueSource))

    expect(hook.result.current.candidates.map((candidate) => candidate.id)).toEqual([
      'scheduled-issue-health:ws-a:urgent-cadence',
      'inbox-unread:priority-inbox',
      'scheduled-issue-health:ws-a:other-cadence',
      'inbox-unread:ordinary-inbox',
    ])
    expect(hook.result.current.unresolvedCount).toBe(4)
    expect(hook.result.current.inboxCount).toBe(2)
  })

  it('awaits the exact Inbox server receipt without acknowledging a journal watermark', async () => {
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      requestEpoch: 1,
      successEpoch: 1,
      deliveries: [inboxDelivery()],
      markReadConfirmed: markReadConfirmedMock,
    })
    let confirmServerRead!: (value: 'acknowledged') => void
    markReadConfirmedMock.mockImplementationOnce(() => new Promise<'acknowledged'>((resolve) => {
      confirmServerRead = resolve
    }))
    const productActivity = activity()
    const hook = renderHook(() => useOfficeDuties(productActivity, issues(null)))
    const duty = hook.result.current.candidates[0]!

    expect(duty).toMatchObject({
      kind: 'inbox',
      destination: {
        kind: 'inbox-entry',
        workspaceId: 'research-desk',
        inboxEntryId: 'inbox-a',
      },
      receipt: { kind: 'inbox-read', inboxEntryId: 'inbox-a' },
    })
    expect(hook.result.current.inboxByEntryId.get('inbox-a')).toBe(duty)

    let settled = false
    const acknowledgement = hook.result.current.acknowledge(duty).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(markReadConfirmedMock).toHaveBeenCalledOnce()
    expect(markReadConfirmedMock).toHaveBeenCalledWith('inbox-a')
    expect(productActivity.acknowledgeThrough).not.toHaveBeenCalled()
    expect(settled).toBe(false)

    confirmServerRead('acknowledged')
    await act(async () => {
      await acknowledgement
    })
    expect(settled).toBe(true)
  })

  it('exposes exact presentation evidence after a report leaves the unread patrol', () => {
    const readReport = inboxDelivery('read-report')
    inboxDutiesMock.mockReturnValue({
      status: 'ready',
      requestEpoch: 1,
      successEpoch: 1,
      deliveries: [],
      evidenceByEntryId: new Map([['read-report', readReport]]),
      markReadConfirmed: markReadConfirmedMock,
    })

    const hook = renderHook(() => useOfficeDuties(activity(), issues(null)))

    expect(hook.result.current.candidates).toEqual([])
    expect(hook.result.current.inboxByEntryId.has('read-report')).toBe(false)
    expect(hook.result.current.inboxEvidenceByEntryId.get('read-report')).toBe(readReport)
  })

  it('treats a process-warm Issue snapshot as loading until this hook accepts a fresh response', () => {
    const hook = renderHook(
      ({ successEpoch }) => useOfficeDuties(
        activity(),
        issues(exception(), null, 1, successEpoch),
      ),
      { initialProps: { successEpoch: 0 } },
    )

    expect(hook.result.current.candidates).toHaveLength(1)
    expect(hook.result.current.cadenceStatus).toBe('loading')
    expect(hook.result.current.issueStatus).toBe('loading')
    expect(hook.result.current.status).toBe('loading')

    hook.rerender({ successEpoch: 1 })
    expect(hook.result.current.cadenceStatus).toBe('ready')
    expect(hook.result.current.issueStatus).toBe('ready')
    expect(hook.result.current.status).toBe('ready')
  })

  it('waits for a post-receipt Issue request and deduplicates delayed forgets by subject', async () => {
    const subjectA = JSON.stringify(['scheduled-issue', 'ws-a', 'recovered-a'])
    const subjectB = JSON.stringify(['scheduled-issue', 'ws-a', 'recovered-b'])
    const receipts: readonly OfficeDayEvidenceReceipt[] = [
      { subjectKey: subjectA, fingerprint: 'fingerprint-a', reviewedAt: NOW },
      { subjectKey: subjectB, fingerprint: 'fingerprint-b', reviewedAt: NOW },
    ]
    const attempts = new Map<string, ReturnType<typeof deferred<void>>[]>()
    const forgetEvidence = vi.fn((subjectKey: string) => {
      const attempt = deferred<void>()
      const current = attempts.get(subjectKey) ?? []
      current.push(attempt)
      attempts.set(subjectKey, current)
      return attempt.promise
    })
    const controller = (evidenceReceipts: readonly OfficeDayEvidenceReceipt[]) => ({
      evidenceReceipts,
      hasEvidenceReceipt: (subjectKey: string, fingerprint: string) => evidenceReceipts.some(
        (receipt) => receipt.subjectKey === subjectKey && receipt.fingerprint === fingerprint,
      ),
      reviewEvidence: vi.fn(async () => 'acknowledged' as const),
      forgetEvidence,
    })
    const hook = renderHook(
      ({ evidenceReceipts, requested, successful }) => useOfficeDuties(
        activity(),
        issues(null, null, requested, successful),
        controller(evidenceReceipts),
      ),
      {
        initialProps: {
          evidenceReceipts: receipts,
          requested: 5,
          successful: 4,
        },
      },
    )

    hook.rerender({ evidenceReceipts: receipts, requested: 5, successful: 5 })
    expect(forgetEvidence).not.toHaveBeenCalled()
    hook.rerender({ evidenceReceipts: receipts, requested: 6, successful: 5 })
    expect(forgetEvidence).not.toHaveBeenCalled()
    hook.rerender({ evidenceReceipts: receipts, requested: 6, successful: 6 })
    await waitFor(() => expect(forgetEvidence).toHaveBeenCalledTimes(2))
    expect(forgetEvidence).toHaveBeenCalledWith(subjectA)
    expect(forgetEvidence).toHaveBeenCalledWith(subjectB)

    await act(async () => {
      attempts.get(subjectA)![0]!.reject(new Error('temporary failure'))
      await attempts.get(subjectA)![0]!.promise.catch(() => undefined)
    })
    hook.rerender({ evidenceReceipts: receipts, requested: 7, successful: 7 })
    await waitFor(() => expect(forgetEvidence.mock.calls.filter(
      ([subjectKey]) => subjectKey === subjectA,
    )).toHaveLength(2))
    expect(forgetEvidence.mock.calls.filter(([subjectKey]) => subjectKey === subjectB)).toHaveLength(1)

    await act(async () => {
      attempts.get(subjectA)![1]!.resolve()
      await attempts.get(subjectA)![1]!.promise
    })
    hook.rerender({
      evidenceReceipts: receipts.filter((receipt) => receipt.subjectKey === subjectB),
      requested: 7,
      successful: 7,
    })
    expect(forgetEvidence.mock.calls.filter(([subjectKey]) => subjectKey === subjectB)).toHaveLength(1)
    await act(async () => {
      attempts.get(subjectB)![0]!.resolve()
      await attempts.get(subjectB)![0]!.promise
    })
  })
})
