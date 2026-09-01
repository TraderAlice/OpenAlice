// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { OfficeDayMutationResponse, OfficeDayRecord } from '../api/office'
import {
  officeDutyKey,
  type OfficeDutyCandidate,
  type OfficeDutySourceEpochs,
  type OfficeDutySourceStatus,
} from './duty-registry'
import type { OfficeDayController } from './useOfficeDay'
import {
  useOfficeShift,
  type OfficeShiftSettlementSource,
} from './useOfficeShift'

function inboxDuty(id: string): OfficeDutyCandidate {
  return {
    id: `inbox-unread:${id}`,
    registrationId: 'inbox-unread',
    kind: 'inbox',
    count: 1,
    destination: {
      kind: 'inbox-entry',
      workspaceId: 'research-desk',
      inboxEntryId: id,
      targetId: 'inbox-service',
    },
    receipt: {
      kind: 'inbox-read',
      workspaceId: 'research-desk',
      inboxEntryId: id,
      fingerprint: `fingerprint-${id}`,
    },
    delivery: {
      title: `Delivery ${id}`,
      entry: {
        id,
        ts: 1_000,
        workspaceId: 'research-desk',
      },
    },
  }
}

function cadenceDuty(id: string): OfficeDutyCandidate {
  return {
    id: `scheduled-issue-health:research-desk:${id}`,
    registrationId: 'scheduled-issue-health',
    kind: 'cadence',
    count: 1,
    destination: {
      kind: 'issue',
      workspaceId: 'research-desk',
      issueId: id,
      targetId: 'operations',
    },
    receipt: {
      kind: 'evidence',
      subjectKey: JSON.stringify(['scheduled-issue', 'research-desk', id]),
      fingerprint: `fingerprint-${id}`,
      scope: 'office-day',
    },
    cadence: {
      workspaceId: 'research-desk',
      workspaceTag: 'research',
      issueId: id,
      title: `Cadence ${id}`,
      priority: 'high',
      assignee: '@new-each-run',
      when: { kind: 'every', every: '1d' },
      health: { state: 'failed', message: 'Latest run failed.' },
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

function sourceEpochs(input: {
  readonly inboxRequested: number
  readonly inboxSuccessful: number
  readonly issuesRequested?: number
  readonly issuesSuccessful?: number
}): OfficeDutySourceEpochs {
  return {
    inbox: {
      requested: input.inboxRequested,
      successful: input.inboxSuccessful,
    },
    issues: {
      requested: input.issuesRequested ?? 1,
      successful: input.issuesSuccessful ?? 1,
    },
  }
}

interface HookProps {
  readonly candidates: readonly OfficeDutyCandidate[]
  readonly status: OfficeDutySourceStatus
  readonly settlementStatus?: OfficeDutySourceStatus
  readonly unresolvedCount: number
  readonly sourceEpochs?: OfficeDutySourceEpochs
  readonly settlementSource?: OfficeShiftSettlementSource | null
  readonly officeDay?: OfficeDayController | null
}

const DEFAULT_SOURCE_EPOCHS: OfficeDutySourceEpochs = {
  inbox: { requested: 1, successful: 1 },
  issues: { requested: 1, successful: 1 },
}

function renderShift(initialProps: HookProps) {
  return renderHook(
    (props: HookProps) => useOfficeShift({
      ...props,
      sourceEpochs: props.sourceEpochs ?? DEFAULT_SOURCE_EPOCHS,
    }),
    { initialProps },
  )
}

function dayController(
  duties: readonly OfficeDutyCandidate[],
  order = duties.map(officeDutyKey),
): OfficeDayController {
  const day: OfficeDayRecord = {
    dayKey: '2026-09-01',
    timeZone: 'Asia/Shanghai',
    openedAt: 1_000,
    updatedAt: 1_000,
    seenDutyIds: duties.map(officeDutyKey),
    shift: {
      id: 3,
      openedAt: 1_000,
      slots: duties.map(officeDutyKey),
      order,
      cleared: false,
    },
    evidenceReceipts: [],
  }
  const mutation = async (): Promise<OfficeDayMutationResponse> => ({
    serverNow: 1_000,
    dayKey: day.dayKey,
    timeZone: day.timeZone,
    nextRolloverAt: 10_000,
    revision: 3,
    day,
    applied: false,
    reason: 'no-change',
  })
  const deferDuty: OfficeDayController['deferDuty'] = async ({ dutyId }) => {
    const index = day.shift.order.indexOf(dutyId)
    if (index < 0) return { ...await mutation(), reason: 'duty-not-pending' }
    if (day.shift.order.length < 2 || index === day.shift.order.length - 1) {
      return mutation()
    }
    const nextOrder = [...day.shift.order]
    nextOrder.splice(index, 1)
    nextOrder.push(dutyId)
    return {
      ...await mutation(),
      revision: 4,
      day: { ...day, shift: { ...day.shift, order: nextOrder } },
      applied: true,
      reason: undefined,
    }
  }
  return {
    status: 'ready',
    dayKey: day.dayKey,
    timeZone: day.timeZone,
    nextRolloverAt: 10_000,
    revision: 3,
    day,
    evidenceReceipts: [],
    hasEvidenceReceipt: () => false,
    refresh: vi.fn(async () => undefined),
    open: vi.fn(mutation),
    reconcileShift: vi.fn(mutation),
    deferDuty: vi.fn(deferDuty),
    startNextShift: vi.fn(mutation),
    reviewEvidence: vi.fn(async () => 'acknowledged' as const),
    forgetEvidence: vi.fn(async () => undefined),
  }
}

describe('useOfficeShift', () => {
  it('starts a stable four-duty shift and keeps later arrivals out of its order', async () => {
    const initial = ['a', 'b', 'c', 'd', 'e'].map(inboxDuty)
    const hook = renderShift({ candidates: initial, status: 'ready', unresolvedCount: 5 })

    await waitFor(() => expect(hook.result.current.state).toBe('active'))
    expect(hook.result.current.candidates.map((duty) => duty.id)).toEqual(
      initial.slice(0, 4).map((duty) => duty.id),
    )
    expect(hook.result.current).toMatchObject({
      total: 4,
      completed: 0,
      position: 1,
      backlogCount: 1,
    })

    const arrival = inboxDuty('new')
    hook.rerender({
      candidates: [arrival, ...initial],
      status: 'ready',
      unresolvedCount: 6,
    })

    await waitFor(() => expect(hook.result.current.backlogCount).toBe(2))
    expect(hook.result.current.candidates.map((duty) => duty.id)).toEqual(
      initial.slice(0, 4).map((duty) => duty.id),
    )
  })

  it('rotates Later without advancing n/N or marking a duty complete', async () => {
    const duties = ['a', 'b', 'c'].map(inboxDuty)
    const hook = renderShift({ candidates: duties, status: 'ready', unresolvedCount: 3 })
    await waitFor(() => expect(hook.result.current.state).toBe('active'))

    await act(async () => hook.result.current.defer(duties[0]!))

    expect(hook.result.current.candidates.map((duty) => duty.id)).toEqual([
      duties[1]!.id,
      duties[2]!.id,
      duties[0]!.id,
    ])
    expect(hook.result.current).toMatchObject({ total: 3, completed: 0, position: 1 })
  })

  it('does not count a missing duty complete during loading or error, then advances when ready', async () => {
    const duties = ['a', 'b'].map(inboxDuty)
    const hook = renderShift({ candidates: duties, status: 'ready', unresolvedCount: 2 })
    await waitFor(() => expect(hook.result.current.total).toBe(2))

    hook.rerender({ candidates: [duties[1]!], status: 'loading', unresolvedCount: 2 })
    expect(hook.result.current).toMatchObject({ total: 2, completed: 0, position: 1 })

    hook.rerender({ candidates: [duties[1]!], status: 'error', unresolvedCount: 2 })
    expect(hook.result.current).toMatchObject({ total: 2, completed: 0, position: 1 })

    hook.rerender({ candidates: [duties[1]!], status: 'ready', unresolvedCount: 1 })
    await waitFor(() => expect(hook.result.current.completed).toBe(1))
    expect(hook.result.current).toMatchObject({ total: 2, position: 2, state: 'active' })
    expect(hook.result.current.candidates.map((duty) => duty.id)).toEqual([duties[1]!.id])
  })

  it('restores the Project-authoritative frozen rotation after remount', async () => {
    const duties = ['a', 'b', 'c'].map(inboxDuty)
    const officeDay = dayController(duties, [
      officeDutyKey(duties[1]!),
      officeDutyKey(duties[2]!),
      officeDutyKey(duties[0]!),
    ])
    const writeStorage = vi.spyOn(Storage.prototype, 'setItem')
    const first = renderShift({ candidates: duties, status: 'ready', unresolvedCount: 3, officeDay })
    first.unmount()

    const restored = renderShift({ candidates: duties, status: 'ready', unresolvedCount: 3, officeDay })
    expect(restored.result.current.candidates.map((duty) => duty.id)).toEqual([
      duties[1]!.id,
      duties[2]!.id,
      duties[0]!.id,
    ])
    expect(restored.result.current).toMatchObject({ total: 3, completed: 0, position: 1 })
    expect(writeStorage).not.toHaveBeenCalled()
    writeStorage.mockRestore()
  })

  it('filters a cross-tab stale positive from the next batch without hiding current or new exact duties', async () => {
    const stale = inboxDuty('already-reviewed')
    const fresh = inboxDuty('new-arrival')

    const activeController = dayController([stale])
    const active = renderShift({
      candidates: [stale],
      status: 'ready',
      unresolvedCount: 1,
      officeDay: activeController,
    })
    await waitFor(() => expect(active.result.current.state).toBe('active'))
    expect(active.result.current.candidates.map(officeDutyKey)).toEqual([officeDutyKey(stale)])
    active.unmount()

    const clearedBase = dayController([stale], [])
    const clearedDay: OfficeDayRecord = {
      ...clearedBase.day!,
      shift: { ...clearedBase.day!.shift, order: [], cleared: true },
    }
    const clearedResponse: OfficeDayMutationResponse = {
      serverNow: 2_000,
      dayKey: clearedDay.dayKey,
      timeZone: clearedDay.timeZone,
      nextRolloverAt: 10_000,
      revision: 4,
      day: clearedDay,
      applied: false,
      reason: 'no-change',
    }
    const clearedController: OfficeDayController = {
      ...clearedBase,
      revision: 4,
      day: clearedDay,
    }
    vi.mocked(clearedController.reconcileShift).mockResolvedValue(clearedResponse)

    const staleTab = renderShift({
      // Office Day has already converged across tabs, while this provider still
      // exposes its pre-receipt positive until the next authoritative poll.
      candidates: [stale],
      status: 'ready',
      unresolvedCount: 1,
      officeDay: clearedController,
    })
    await waitFor(() => expect(staleTab.result.current).toMatchObject({
      state: 'clear',
      backlogCount: 0,
      canStartNext: false,
    }))

    staleTab.rerender({
      candidates: [stale, fresh],
      status: 'ready',
      unresolvedCount: 2,
      officeDay: clearedController,
    })
    await waitFor(() => expect(staleTab.result.current).toMatchObject({
      state: 'complete',
      backlogCount: 1,
      canStartNext: true,
    }))

    vi.mocked(clearedController.startNextShift).mockResolvedValueOnce({
      ...clearedResponse,
      revision: 5,
      day: {
        ...clearedDay,
        shift: {
          id: 5,
          openedAt: 2_000,
          slots: [officeDutyKey(fresh)],
          order: [officeDutyKey(fresh)],
          cleared: false,
        },
        seenDutyIds: [...clearedDay.seenDutyIds, officeDutyKey(fresh)],
      },
      applied: true,
      reason: undefined,
    })
    await act(async () => staleTab.result.current.startNext())
    expect(clearedController.startNextShift).toHaveBeenCalledWith({
      dayKey: clearedDay.dayKey,
      shiftId: clearedDay.shift.id,
      slots: [officeDutyKey(fresh)],
    })
  })

  it('reconciles and defers with the exact frozen duty key', async () => {
    const duties = ['a', 'b'].map(inboxDuty)
    const officeDay = dayController(duties)
    const hook = renderShift({
      candidates: duties,
      status: 'ready',
      unresolvedCount: 2,
      officeDay,
    })

    await waitFor(() => expect(officeDay.reconcileShift).toHaveBeenCalledWith({
      dayKey: '2026-09-01',
      shiftId: 3,
      presentSlotIds: duties.map(officeDutyKey),
      proposedSlots: duties.map(officeDutyKey),
      unresolvedCount: 2,
    }))
    await act(async () => hook.result.current.defer(duties[0]!))

    expect(officeDay.deferDuty).toHaveBeenCalledWith({
      dayKey: '2026-09-01',
      shiftId: 3,
      dutyId: officeDutyKey(duties[0]!),
    })
  })

  it('counts only actionable duties in the next batch when a reviewed issue remains unresolved', async () => {
    const firstShift = ['a', 'b', 'c', 'd'].map(inboxDuty)
    const carryover = [inboxDuty('e'), inboxDuty('f')]
    const hook = renderShift({
      candidates: [...firstShift, ...carryover],
      status: 'ready',
      unresolvedCount: 6,
    })
    await waitFor(() => expect(hook.result.current.total).toBe(4))

    // The third unresolved fact is a reviewed cadence follow-up, not another shift duty.
    hook.rerender({ candidates: carryover, status: 'ready', unresolvedCount: 3 })
    await waitFor(() => expect(hook.result.current.state).toBe('complete'))
    expect(hook.result.current).toMatchObject({
      total: 4,
      completed: 4,
      position: null,
      backlogCount: 2,
      canStartNext: true,
    })

    await act(async () => hook.result.current.startNext())
    expect(hook.result.current.state).toBe('active')
    expect(hook.result.current.candidates.map((duty) => duty.id)).toEqual(
      carryover.map((duty) => duty.id),
    )
    expect(hook.result.current).toMatchObject({
      total: 2,
      completed: 0,
      position: 1,
      backlogCount: 0,
      canStartNext: false,
    })
  })

  it('reports clear only when the ready source has no unresolved backlog', async () => {
    const duties = ['a', 'b'].map(inboxDuty)
    const hook = renderShift({ candidates: duties, status: 'ready', unresolvedCount: 2 })
    await waitFor(() => expect(hook.result.current.state).toBe('active'))

    hook.rerender({ candidates: [], status: 'ready', unresolvedCount: 0 })

    await waitFor(() => expect(hook.result.current.state).toBe('clear'))
    expect(hook.result.current).toMatchObject({
      total: 2,
      completed: 2,
      position: null,
      backlogCount: 0,
      canStartNext: false,
    })
  })

  it('keeps a completed patrol unsettled until the broader decision source is authoritative', async () => {
    const current = inboxDuty('a')
    const hook = renderShift({
      candidates: [current],
      status: 'ready',
      settlementStatus: 'ready',
      unresolvedCount: 1,
    })
    await waitFor(() => expect(hook.result.current.state).toBe('active'))

    hook.rerender({
      candidates: [],
      status: 'ready',
      settlementStatus: 'loading',
      unresolvedCount: 0,
    })
    await waitFor(() => expect(hook.result.current.state).toBe('planning'))
    expect(hook.result.current.sourceStatus).toBe('loading')

    hook.rerender({
      candidates: [],
      status: 'ready',
      settlementStatus: 'error',
      unresolvedCount: 0,
    })
    await waitFor(() => expect(hook.result.current.state).toBe('degraded'))
    expect(hook.result.current.completed).toBe(1)

    hook.rerender({
      candidates: [],
      status: 'ready',
      settlementStatus: 'ready',
      unresolvedCount: 0,
    })
    await waitFor(() => expect(hook.result.current.state).toBe('clear'))
  })

  it('preserves automatic intake after a cleared shift while the broader source is unsettled', async () => {
    const first = inboxDuty('a')
    const next = inboxDuty('b')
    const hook = renderShift({
      candidates: [first],
      status: 'ready',
      settlementStatus: 'ready',
      unresolvedCount: 1,
    })
    await waitFor(() => expect(hook.result.current.state).toBe('active'))

    hook.rerender({
      candidates: [],
      status: 'ready',
      settlementStatus: 'ready',
      unresolvedCount: 0,
    })
    await waitFor(() => expect(hook.result.current.state).toBe('clear'))

    hook.rerender({
      candidates: [],
      status: 'ready',
      settlementStatus: 'loading',
      unresolvedCount: 0,
    })
    await waitFor(() => expect(hook.result.current.state).toBe('planning'))

    hook.rerender({
      candidates: [next],
      status: 'ready',
      settlementStatus: 'loading',
      unresolvedCount: 1,
    })
    await waitFor(() => expect(hook.result.current.state).toBe('active'))
    expect(hook.result.current.candidates.map((duty) => duty.id)).toEqual([next.id])
    expect(hook.result.current).toMatchObject({ total: 1, completed: 0, position: 1 })
  })

  it('keeps a missing persisted slot unsettled while reconciliation is pending, then degrades on rejection', async () => {
    const duty = inboxDuty('pending-reconcile')
    const officeDay = dayController([duty])
    const hook = renderShift({
      candidates: [duty],
      status: 'ready',
      unresolvedCount: 1,
      sourceEpochs: sourceEpochs({ inboxRequested: 1, inboxSuccessful: 1 }),
      officeDay,
    })
    await waitFor(() => expect(hook.result.current.state).toBe('active'))

    const pending = deferred<OfficeDayMutationResponse>()
    vi.mocked(officeDay.reconcileShift).mockImplementationOnce(() => pending.promise)
    hook.rerender({
      candidates: [],
      status: 'ready',
      unresolvedCount: 0,
      sourceEpochs: sourceEpochs({ inboxRequested: 2, inboxSuccessful: 2 }),
      officeDay,
    })

    await waitFor(() => expect(hook.result.current).toMatchObject({
      state: 'planning',
      sourceStatus: 'loading',
      completed: 0,
    }))
    await act(async () => {
      pending.reject(new Error('reconcile failed'))
      await pending.promise.catch(() => undefined)
    })
    await waitFor(() => expect(hook.result.current).toMatchObject({
      state: 'degraded',
      sourceStatus: 'error',
      completed: 0,
    }))
    expect(officeDay.refresh).toHaveBeenCalledOnce()
  })

  it('retries the same failed reconciliation after cooldown and clears degraded on success', async () => {
    vi.useFakeTimers()
    const duty = inboxDuty('transient-reconcile')
    const officeDay = dayController([duty])
    const hook = renderShift({
      candidates: [duty],
      status: 'ready',
      unresolvedCount: 1,
      sourceEpochs: sourceEpochs({ inboxRequested: 1, inboxSuccessful: 1 }),
      officeDay,
    })

    try {
      await act(async () => { await Promise.resolve() })
      const callsBeforeFailure = vi.mocked(officeDay.reconcileShift).mock.calls.length
      const reconciledDay: OfficeDayRecord = {
        ...officeDay.day!,
        updatedAt: 2_000,
        shift: {
          ...officeDay.day!.shift,
          order: [],
          cleared: true,
        },
      }
      vi.mocked(officeDay.reconcileShift)
        .mockRejectedValueOnce(new Error('temporary reconcile failure'))
        .mockResolvedValueOnce({
          serverNow: 2_000,
          dayKey: reconciledDay.dayKey,
          timeZone: reconciledDay.timeZone,
          nextRolloverAt: 10_000,
          revision: 4,
          day: reconciledDay,
          applied: true,
        })

      hook.rerender({
        candidates: [],
        status: 'ready',
        unresolvedCount: 0,
        sourceEpochs: sourceEpochs({ inboxRequested: 2, inboxSuccessful: 2 }),
        officeDay,
      })
      await act(async () => { await Promise.resolve() })

      expect(officeDay.reconcileShift).toHaveBeenCalledTimes(callsBeforeFailure + 1)
      expect(hook.result.current).toMatchObject({ state: 'degraded', sourceStatus: 'error' })

      await act(async () => { await vi.advanceTimersByTimeAsync(1_999) })
      expect(officeDay.reconcileShift).toHaveBeenCalledTimes(callsBeforeFailure + 1)
      expect(hook.result.current.state).toBe('degraded')

      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(officeDay.reconcileShift).toHaveBeenCalledTimes(callsBeforeFailure + 2)
      expect(hook.result.current).toMatchObject({ state: 'planning', sourceStatus: 'loading' })
    } finally {
      hook.unmount()
      vi.useRealTimers()
    }
  })

  it('backs off a persistent reconciliation failure instead of retrying in a tight loop', async () => {
    vi.useFakeTimers()
    const duty = inboxDuty('persistent-reconcile')
    const officeDay = dayController([duty])
    const hook = renderShift({
      candidates: [duty],
      status: 'ready',
      unresolvedCount: 1,
      sourceEpochs: sourceEpochs({ inboxRequested: 1, inboxSuccessful: 1 }),
      officeDay,
    })

    try {
      await act(async () => { await Promise.resolve() })
      const callsBeforeFailure = vi.mocked(officeDay.reconcileShift).mock.calls.length
      vi.mocked(officeDay.reconcileShift).mockRejectedValue(new Error('persistent failure'))

      hook.rerender({
        candidates: [],
        status: 'ready',
        unresolvedCount: 0,
        sourceEpochs: sourceEpochs({ inboxRequested: 2, inboxSuccessful: 2 }),
        officeDay,
      })
      await act(async () => { await Promise.resolve() })
      expect(officeDay.reconcileShift).toHaveBeenCalledTimes(callsBeforeFailure + 1)
      expect(hook.result.current.state).toBe('degraded')

      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      expect(officeDay.reconcileShift).toHaveBeenCalledTimes(callsBeforeFailure + 2)
      expect(hook.result.current.state).toBe('degraded')

      await act(async () => { await vi.advanceTimersByTimeAsync(3_999) })
      expect(officeDay.reconcileShift).toHaveBeenCalledTimes(callsBeforeFailure + 2)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(officeDay.reconcileShift).toHaveBeenCalledTimes(callsBeforeFailure + 3)
      expect(hook.result.current.state).toBe('degraded')
    } finally {
      hook.unmount()
      vi.useRealTimers()
    }
  })

  it('cancels a pending reconciliation retry when the hook unmounts', async () => {
    vi.useFakeTimers()
    const duty = inboxDuty('unmount-reconcile')
    const officeDay = dayController([duty])
    const hook = renderShift({
      candidates: [duty],
      status: 'ready',
      unresolvedCount: 1,
      sourceEpochs: sourceEpochs({ inboxRequested: 1, inboxSuccessful: 1 }),
      officeDay,
    })

    try {
      await act(async () => { await Promise.resolve() })
      const callsBeforeFailure = vi.mocked(officeDay.reconcileShift).mock.calls.length
      vi.mocked(officeDay.reconcileShift).mockRejectedValue(new Error('offline'))
      hook.rerender({
        candidates: [],
        status: 'ready',
        unresolvedCount: 0,
        sourceEpochs: sourceEpochs({ inboxRequested: 2, inboxSuccessful: 2 }),
        officeDay,
      })
      await act(async () => { await Promise.resolve() })
      expect(officeDay.reconcileShift).toHaveBeenCalledTimes(callsBeforeFailure + 1)
      expect(vi.getTimerCount()).toBe(1)

      hook.unmount()
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(officeDay.reconcileShift).toHaveBeenCalledTimes(callsBeforeFailure + 1)
    } finally {
      hook.unmount()
      vi.useRealTimers()
    }
  })

  it('rejects stale Later and next-shift responses instead of reporting local success', async () => {
    const duties = [inboxDuty('a'), inboxDuty('b')]
    const officeDay = dayController(duties)
    vi.mocked(officeDay.deferDuty).mockResolvedValueOnce({
      serverNow: 2_000,
      dayKey: '2026-09-01',
      timeZone: 'Asia/Shanghai',
      nextRolloverAt: 10_000,
      revision: 3,
      day: officeDay.day,
      applied: false,
      reason: 'stale-shift',
    })
    const hook = renderShift({
      candidates: duties,
      status: 'ready',
      unresolvedCount: 2,
      officeDay,
    })

    await expect(hook.result.current.defer(duties[0]!)).rejects.toThrow('stale-shift')
    expect(officeDay.refresh).toHaveBeenCalledOnce()
    expect(hook.result.current.candidates.map(officeDutyKey)).toEqual(duties.map(officeDutyKey))

    const next = inboxDuty('next')
    const completedDay = dayController([duties[0]!], [])
    vi.mocked(completedDay.startNextShift).mockResolvedValueOnce({
      serverNow: 2_000,
      dayKey: '2026-09-01',
      timeZone: 'Asia/Shanghai',
      nextRolloverAt: 10_000,
      revision: 3,
      day: completedDay.day,
      applied: false,
      reason: 'shift-not-complete',
    })
    const nextHook = renderShift({
      candidates: [next],
      status: 'ready',
      unresolvedCount: 1,
      officeDay: completedDay,
    })
    await waitFor(() => expect(nextHook.result.current.canStartNext).toBe(true))
    await expect(nextHook.result.current.startNext()).rejects.toThrow('shift-not-complete')
    expect(completedDay.refresh).toHaveBeenCalledOnce()
  })

  it('accepts a no-change Later response only when the server already has the equivalent rotation', async () => {
    const duties = [inboxDuty('a'), inboxDuty('b')]
    const officeDay = dayController(duties)
    const rotated = [officeDutyKey(duties[1]!), officeDutyKey(duties[0]!)]
    vi.mocked(officeDay.deferDuty).mockResolvedValueOnce({
      serverNow: 2_000,
      dayKey: '2026-09-01',
      timeZone: 'Asia/Shanghai',
      nextRolloverAt: 10_000,
      revision: 4,
      day: {
        ...officeDay.day!,
        shift: { ...officeDay.day!.shift, order: rotated },
      },
      applied: false,
      reason: 'no-change',
    })
    const hook = renderShift({
      candidates: duties,
      status: 'ready',
      unresolvedCount: 2,
      officeDay,
    })

    await expect(hook.result.current.defer(duties[0]!)).resolves.toBeUndefined()
    expect(officeDay.refresh).not.toHaveBeenCalled()
  })

  it('does not let a provider request started before a remote shift prove its duty absent', async () => {
    const stale = inboxDuty('old-a')
    const remote = inboxDuty('remote-b')
    const officeDay = dayController([remote])
    vi.mocked(officeDay.reconcileShift).mockImplementation(async (input) => ({
      serverNow: 2_000,
      dayKey: '2026-09-01',
      timeZone: 'Asia/Shanghai',
      nextRolloverAt: 10_000,
      revision: input.presentSlotIds.length === 0 ? 4 : 3,
      day: {
        ...officeDay.day!,
        shift: { ...officeDay.day!.shift, order: [...input.presentSlotIds] },
      },
      applied: input.presentSlotIds.length === 0,
      ...(input.presentSlotIds.length === 0 ? {} : { reason: 'no-change' as const }),
    }))
    const hook = renderShift({
      candidates: [stale],
      status: 'ready',
      unresolvedCount: 1,
      sourceEpochs: sourceEpochs({ inboxRequested: 2, inboxSuccessful: 1 }),
      officeDay,
    })
    await waitFor(() => expect(officeDay.reconcileShift).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentSlotIds: [officeDutyKey(remote)] }),
    ))

    hook.rerender({
      candidates: [stale],
      status: 'ready',
      unresolvedCount: 1,
      sourceEpochs: sourceEpochs({ inboxRequested: 2, inboxSuccessful: 2 }),
      officeDay,
    })
    await Promise.resolve()
    expect(vi.mocked(officeDay.reconcileShift).mock.calls.some(
      ([input]) => input.presentSlotIds.length === 0,
    )).toBe(false)

    hook.rerender({
      candidates: [stale],
      status: 'ready',
      unresolvedCount: 1,
      sourceEpochs: sourceEpochs({ inboxRequested: 3, inboxSuccessful: 2 }),
      officeDay,
    })
    await Promise.resolve()
    expect(vi.mocked(officeDay.reconcileShift).mock.calls.some(
      ([input]) => input.presentSlotIds.length === 0,
    )).toBe(false)

    hook.rerender({
      candidates: [stale],
      status: 'ready',
      unresolvedCount: 1,
      sourceEpochs: sourceEpochs({ inboxRequested: 3, inboxSuccessful: 3 }),
      officeDay,
    })
    await waitFor(() => expect(officeDay.reconcileShift).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentSlotIds: [] }),
    ))
  })

  it('advances negative authority independently for Inbox and Issues providers', async () => {
    const inbox = inboxDuty('remote-inbox')
    const cadence = cadenceDuty('remote-cadence')
    const officeDay = dayController([inbox, cadence])
    vi.mocked(officeDay.reconcileShift).mockImplementation(async (input) => ({
      serverNow: 2_000,
      dayKey: '2026-09-01',
      timeZone: 'Asia/Shanghai',
      nextRolloverAt: 10_000,
      revision: 3,
      day: {
        ...officeDay.day!,
        shift: { ...officeDay.day!.shift, order: [...input.presentSlotIds] },
      },
      applied: input.presentSlotIds.length < 2,
      ...(input.presentSlotIds.length < 2 ? {} : { reason: 'no-change' as const }),
    }))
    const hook = renderShift({
      candidates: [],
      status: 'ready',
      unresolvedCount: 0,
      sourceEpochs: sourceEpochs({
        inboxRequested: 4,
        inboxSuccessful: 3,
        issuesRequested: 8,
        issuesSuccessful: 7,
      }),
      officeDay,
    })
    await waitFor(() => expect(officeDay.reconcileShift).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presentSlotIds: [officeDutyKey(inbox), officeDutyKey(cadence)],
      }),
    ))

    hook.rerender({
      candidates: [],
      status: 'ready',
      unresolvedCount: 0,
      sourceEpochs: sourceEpochs({
        inboxRequested: 5,
        inboxSuccessful: 5,
        issuesRequested: 8,
        issuesSuccessful: 8,
      }),
      officeDay,
    })
    await waitFor(() => expect(officeDay.reconcileShift).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentSlotIds: [officeDutyKey(cadence)] }),
    ))

    hook.rerender({
      candidates: [],
      status: 'ready',
      unresolvedCount: 0,
      sourceEpochs: sourceEpochs({
        inboxRequested: 5,
        inboxSuccessful: 5,
        issuesRequested: 9,
        issuesSuccessful: 9,
      }),
      officeDay,
    })
    await waitFor(() => expect(officeDay.reconcileShift).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentSlotIds: [] }),
    ))
  })

  it('waits for a routine snapshot started after the Inbox snapshot before settling clear', async () => {
    const duty = inboxDuty('carried-report')
    const officeDay = dayController([duty])
    vi.mocked(officeDay.reconcileShift).mockImplementation(async (input) => ({
      serverNow: 2_000,
      dayKey: '2026-09-01',
      timeZone: 'Asia/Shanghai',
      nextRolloverAt: 10_000,
      revision: 4,
      day: {
        ...officeDay.day!,
        shift: {
          ...officeDay.day!.shift,
          order: [...input.presentSlotIds],
          cleared: input.presentSlotIds.length === 0 && input.unresolvedCount === 0,
        },
      },
      applied: true,
    }))
    const refresh = vi.fn(async () => undefined)
    const settlementSource = (
      requestEpoch: number,
      successEpoch: number,
    ): OfficeShiftSettlementSource => ({ requestEpoch, successEpoch, refresh })
    const hook = renderShift({
      candidates: [duty],
      status: 'ready',
      settlementStatus: 'ready',
      unresolvedCount: 1,
      sourceEpochs: sourceEpochs({ inboxRequested: 1, inboxSuccessful: 1 }),
      settlementSource: settlementSource(5, 5),
      officeDay,
    })

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    hook.rerender({
      candidates: [duty],
      status: 'ready',
      settlementStatus: 'ready',
      unresolvedCount: 1,
      sourceEpochs: sourceEpochs({ inboxRequested: 1, inboxSuccessful: 1 }),
      settlementSource: settlementSource(6, 6),
      officeDay,
    })
    await waitFor(() => expect(hook.result.current.state).toBe('active'))

    // Request 7 began before Inbox accepted the report as read. Its later
    // empty response cannot prove that the durable carry is visible yet.
    hook.rerender({
      candidates: [duty],
      status: 'ready',
      settlementStatus: 'ready',
      unresolvedCount: 1,
      sourceEpochs: sourceEpochs({ inboxRequested: 1, inboxSuccessful: 1 }),
      settlementSource: settlementSource(7, 6),
      officeDay,
    })
    hook.rerender({
      candidates: [],
      status: 'ready',
      settlementStatus: 'ready',
      unresolvedCount: 0,
      sourceEpochs: sourceEpochs({ inboxRequested: 2, inboxSuccessful: 2 }),
      settlementSource: settlementSource(7, 6),
      officeDay,
    })
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(officeDay.reconcileShift).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentSlotIds: [], unresolvedCount: 1 }),
    ))
    expect(hook.result.current.state).toBe('planning')

    hook.rerender({
      candidates: [],
      status: 'ready',
      settlementStatus: 'ready',
      unresolvedCount: 0,
      sourceEpochs: sourceEpochs({ inboxRequested: 2, inboxSuccessful: 2 }),
      settlementSource: settlementSource(7, 7),
      officeDay,
    })
    await Promise.resolve()
    expect(vi.mocked(officeDay.reconcileShift).mock.calls.some(
      ([input]) => input.unresolvedCount === 0,
    )).toBe(false)

    hook.rerender({
      candidates: [],
      status: 'ready',
      settlementStatus: 'ready',
      unresolvedCount: 0,
      sourceEpochs: sourceEpochs({ inboxRequested: 2, inboxSuccessful: 2 }),
      settlementSource: settlementSource(8, 7),
      officeDay,
    })
    await Promise.resolve()
    expect(vi.mocked(officeDay.reconcileShift).mock.calls.some(
      ([input]) => input.unresolvedCount === 0,
    )).toBe(false)

    hook.rerender({
      candidates: [],
      status: 'ready',
      settlementStatus: 'ready',
      unresolvedCount: 0,
      sourceEpochs: sourceEpochs({ inboxRequested: 2, inboxSuccessful: 2 }),
      settlementSource: settlementSource(8, 8),
      officeDay,
    })
    await waitFor(() => expect(officeDay.reconcileShift).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentSlotIds: [], unresolvedCount: 0 }),
    ))
  })
})
