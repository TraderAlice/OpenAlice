// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api'
import type { OfficeRoutineDecision, OfficeRoutineFollowUp } from '../api/office'
import { useOfficeRoutineFollowUps } from './useOfficeRoutineFollowUps'

vi.mock('../api', () => ({
  api: {
    office: {
      listRoutineFollowUps: vi.fn(),
      carryRoutineFollowUp: vi.fn(),
      decideRoutineFollowUp: vi.fn(),
    },
  },
}))

function followUp(
  inboxEntryId: string,
  createdAt = 1_000,
): OfficeRoutineFollowUp {
  return {
    inboxEntryId,
    reportTs: createdAt - 100,
    issueWorkspaceId: `workspace-${inboxEntryId}`,
    issueId: `issue-${inboxEntryId}`,
    createdAt,
  }
}

function decision(
  inboxEntryId: string,
  outcome: OfficeRoutineDecision['outcome'] = 'maintain-plan',
  decidedAt = 2_000,
): OfficeRoutineDecision {
  return {
    ...followUp(inboxEntryId),
    outcome,
    ...(outcome === 'revise-plan' ? { note: 'Tighten the confirmation gate.' } : {}),
    decidedAt,
  }
}

interface RoutineListResponse {
  followUps: OfficeRoutineFollowUp[]
  decisions: OfficeRoutineDecision[]
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class TestBroadcastChannel {
  static readonly peers = new Set<TestBroadcastChannel>()

  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(readonly name: string) {
    TestBroadcastChannel.peers.add(this)
  }

  postMessage(data: unknown): void {
    for (const peer of TestBroadcastChannel.peers) {
      if (peer !== this && peer.name === this.name) {
        queueMicrotask(() => peer.onmessage?.(new MessageEvent('message', { data })))
      }
    }
  }

  close(): void {
    TestBroadcastChannel.peers.delete(this)
  }
}

beforeEach(() => {
  vi.mocked(api.office.listRoutineFollowUps).mockReset()
  vi.mocked(api.office.carryRoutineFollowUp).mockReset()
  vi.mocked(api.office.decideRoutineFollowUp).mockReset()
})

afterEach(() => {
  cleanup()
  TestBroadcastChannel.peers.clear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useOfficeRoutineFollowUps', () => {
  it('fails closed until the initial server list is ready', async () => {
    const request = deferred<RoutineListResponse>()
    vi.mocked(api.office.listRoutineFollowUps).mockReturnValue(request.promise)

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    expect(result.current.status).toBe('loading')
    expect(result.current.followUps).toEqual([])
    expect(result.current).toMatchObject({ requestEpoch: 1, successEpoch: 0 })

    await act(async () => {
      request.resolve({
        followUps: [followUp('later', 2_000), followUp('first', 1_000)],
        decisions: [],
      })
      await request.promise
    })
    expect(result.current.status).toBe('ready')
    expect(result.current).toMatchObject({ requestEpoch: 1, successEpoch: 1 })
    expect(result.current.followUps.map((item) => item.inboxEntryId)).toEqual(['first', 'later'])
  })

  it('surfaces initial failure without inventing a follow-up', async () => {
    vi.mocked(api.office.listRoutineFollowUps).mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.followUps).toEqual([])
    expect(result.current).toMatchObject({ requestEpoch: 1, successEpoch: 0 })
  })

  it('hydrates durable decision receipts separately from the active desk', async () => {
    const older = decision('older', 'maintain-plan', 2_000)
    const newer = decision('newer', 'revise-plan', 3_000)
    vi.mocked(api.office.listRoutineFollowUps).mockResolvedValue({
      followUps: [followUp('active')],
      decisions: [older, newer],
    })

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(result.current.followUps.map((item) => item.inboxEntryId)).toEqual(['active'])
    expect(result.current.decisions).toEqual([newer, older])
  })

  it('fails closed for a malformed successful list response', async () => {
    vi.mocked(api.office.listRoutineFollowUps).mockResolvedValue({
      followUps: [{ ...followUp('bad'), createdAt: -1 }],
      decisions: [],
    })

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.followUps).toEqual([])
    expect(result.current).toMatchObject({ requestEpoch: 1, successEpoch: 0 })
  })

  it('preserves the last confirmed list when refresh transiently fails', async () => {
    const known = followUp('known')
    vi.mocked(api.office.listRoutineFollowUps)
      .mockResolvedValueOnce({ followUps: [known], decisions: [] })
      .mockRejectedValueOnce(new Error('offline'))

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.status).toBe('error')
    expect(result.current.followUps).toEqual([known])
    expect(result.current).toMatchObject({ requestEpoch: 2, successEpoch: 1 })
  })

  it('starts a causal refresh after an older read and advances success only for the accepted read', async () => {
    const older = deferred<RoutineListResponse>()
    const causal = deferred<RoutineListResponse>()
    const current = followUp('current')
    vi.mocked(api.office.listRoutineFollowUps)
      .mockResolvedValueOnce({ followUps: [], decisions: [] })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(causal.promise)

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current).toMatchObject({
      status: 'ready',
      requestEpoch: 1,
      successEpoch: 1,
    }))

    let olderPromise!: Promise<void>
    let causalPromise!: Promise<void>
    act(() => {
      olderPromise = result.current.refresh()
      causalPromise = result.current.refresh()
    })
    expect(result.current).toMatchObject({ requestEpoch: 3, successEpoch: 1 })

    await act(async () => {
      older.resolve({ followUps: [], decisions: [] })
      await olderPromise
    })
    expect(result.current.successEpoch).toBe(1)

    await act(async () => {
      causal.resolve({ followUps: [current], decisions: [] })
      await causalPromise
    })
    expect(result.current).toMatchObject({
      status: 'ready',
      followUps: [current],
      requestEpoch: 3,
      successEpoch: 3,
    })
  })

  it('invalidates another tab after carry so its stale ready-empty snapshot refreshes', async () => {
    vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)
    const carried = followUp('report-a')
    let serverFollowUps: OfficeRoutineFollowUp[] = []
    vi.mocked(api.office.listRoutineFollowUps).mockImplementation(async () => ({
      followUps: [...serverFollowUps],
      decisions: [],
    }))
    vi.mocked(api.office.carryRoutineFollowUp).mockImplementation(async () => {
      serverFollowUps = [carried]
      return { followUp: carried, created: true }
    })
    vi.mocked(api.office.decideRoutineFollowUp).mockImplementation(async (inboxEntryId, input) => {
      serverFollowUps = []
      return {
        decision: {
          ...carried,
          ...input,
          decidedAt: 3_000,
        },
        created: true,
      }
    })

    const tabA = renderHook(() => useOfficeRoutineFollowUps())
    const tabB = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => {
      expect(tabA.result.current.status).toBe('ready')
      expect(tabB.result.current.status).toBe('ready')
    })
    expect(tabB.result.current).toMatchObject({
      followUps: [],
      requestEpoch: 1,
      successEpoch: 1,
    })

    await act(async () => {
      await tabA.result.current.carry('report-a')
    })

    await waitFor(() => expect(tabB.result.current.followUps).toEqual([carried]))
    expect(tabB.result.current.requestEpoch).toBeGreaterThan(1)
    expect(tabB.result.current.successEpoch).toBe(tabB.result.current.requestEpoch)

    const afterCarryEpoch = tabB.result.current.successEpoch
    await act(async () => {
      await tabA.result.current.decide('report-a', { outcome: 'maintain-plan' })
    })
    await waitFor(() => expect(tabB.result.current.followUps).toEqual([]))
    expect(tabB.result.current.successEpoch).toBeGreaterThan(afterCarryEpoch)
    tabA.unmount()
    tabB.unmount()
  })

  it('refreshes authoritative follow-ups on focus, visible return, and polling', async () => {
    vi.useFakeTimers()
    vi.mocked(api.office.listRoutineFollowUps).mockResolvedValue({ followUps: [], decisions: [] })
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const hook = renderHook(() => useOfficeRoutineFollowUps())

    await act(async () => { await Promise.resolve() })
    expect(api.office.listRoutineFollowUps).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })
    expect(api.office.listRoutineFollowUps).toHaveBeenCalledTimes(2)

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(api.office.listRoutineFollowUps).toHaveBeenCalledTimes(3)

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(api.office.listRoutineFollowUps).toHaveBeenCalledTimes(4)
    hook.unmount()
    if (visibility) Object.defineProperty(document, 'visibilityState', visibility)
  })

  it('publishes a confirmed carry once and coalesces an identical inflight retry', async () => {
    const carried = followUp('report-a')
    const request = deferred<{ followUp: OfficeRoutineFollowUp; created: boolean }>()
    vi.mocked(api.office.listRoutineFollowUps).mockResolvedValue({ followUps: [], decisions: [] })
    vi.mocked(api.office.carryRoutineFollowUp).mockReturnValue(request.promise)

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let first!: Promise<void>
    let replay!: Promise<void>
    act(() => {
      first = result.current.carry('report-a')
      replay = result.current.carry('report-a')
    })
    expect(first).toBe(replay)
    await waitFor(() => expect(api.office.carryRoutineFollowUp).toHaveBeenCalledTimes(1))
    expect(result.current.status).toBe('loading')
    expect(result.current.followUps).toEqual([])

    await act(async () => {
      request.resolve({ followUp: carried, created: true })
      await first
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.followUps).toEqual([carried])
  })

  it('publishes an idempotent decision receipt and removes the active carry', async () => {
    const known = followUp('report-a')
    const receipt = decision('report-a')
    vi.mocked(api.office.listRoutineFollowUps).mockResolvedValue({
      followUps: [known],
      decisions: [],
    })
    vi.mocked(api.office.decideRoutineFollowUp).mockResolvedValue({
      decision: receipt,
      created: false,
    })

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await result.current.decide('report-a', { outcome: 'maintain-plan' })
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.followUps).toEqual([])
    expect(result.current.decisions).toEqual([receipt])
  })

  it('keeps known facts unchanged when carry or decision save fails', async () => {
    const known = followUp('known')
    vi.mocked(api.office.listRoutineFollowUps).mockResolvedValue({
      followUps: [known],
      decisions: [],
    })
    vi.mocked(api.office.carryRoutineFollowUp).mockRejectedValue(new Error('carry failed'))
    vi.mocked(api.office.decideRoutineFollowUp).mockRejectedValue(new Error('decision failed'))

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await expect(result.current.carry('new-report')).rejects.toThrow('carry failed')
    })
    expect(result.current.status).toBe('error')
    expect(result.current.followUps).toEqual([known])

    await act(async () => {
      await expect(result.current.decide('known', { outcome: 'maintain-plan' }))
        .rejects.toThrow('decision failed')
    })
    expect(result.current.status).toBe('error')
    expect(result.current.followUps).toEqual([known])
  })

  it('rejects a mismatched successful mutation response without changing known facts', async () => {
    const known = followUp('known')
    vi.mocked(api.office.listRoutineFollowUps).mockResolvedValue({
      followUps: [known],
      decisions: [],
    })
    vi.mocked(api.office.carryRoutineFollowUp).mockResolvedValue({
      followUp: followUp('different-report'),
      created: true,
    })
    vi.mocked(api.office.decideRoutineFollowUp).mockResolvedValue({
      decision: decision('different-report'),
      created: true,
    })

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => {
      await expect(result.current.carry('requested-report'))
        .rejects.toThrow('Invalid Office routine follow-up response')
    })
    expect(result.current.followUps).toEqual([known])

    await act(async () => {
      await expect(result.current.decide('known', { outcome: 'maintain-plan' }))
        .rejects.toThrow('Invalid Office routine decision response')
    })
    expect(result.current.status).toBe('error')
    expect(result.current.followUps).toEqual([known])
  })

  it('does not let a stale refresh erase a later confirmed carry', async () => {
    const staleRefresh = deferred<RoutineListResponse>()
    const carried = followUp('carried')
    const external = followUp('external', 2_000)
    vi.mocked(api.office.listRoutineFollowUps)
      .mockResolvedValueOnce({ followUps: [], decisions: [] })
      .mockReturnValueOnce(staleRefresh.promise)
    vi.mocked(api.office.carryRoutineFollowUp).mockResolvedValue({
      followUp: carried,
      created: true,
    })

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let refreshPromise!: Promise<void>
    act(() => {
      refreshPromise = result.current.refresh()
    })
    await act(async () => {
      await result.current.carry('carried')
    })
    expect(result.current.followUps).toEqual([carried])

    await act(async () => {
      staleRefresh.resolve({ followUps: [external], decisions: [] })
      await refreshPromise
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.followUps).toEqual([carried, external])
  })

  it('finishes a newer refresh gate without replacing a write that lands during it', async () => {
    const carryRequest = deferred<{ followUp: OfficeRoutineFollowUp; created: boolean }>()
    const refreshRequest = deferred<RoutineListResponse>()
    const carried = followUp('carried')
    vi.mocked(api.office.listRoutineFollowUps)
      .mockResolvedValueOnce({ followUps: [], decisions: [] })
      .mockReturnValueOnce(refreshRequest.promise)
    vi.mocked(api.office.carryRoutineFollowUp).mockReturnValue(carryRequest.promise)

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let carryPromise!: Promise<void>
    let refreshPromise!: Promise<void>
    act(() => {
      carryPromise = result.current.carry('carried')
      refreshPromise = result.current.refresh()
    })
    await act(async () => {
      carryRequest.resolve({ followUp: carried, created: true })
      await carryPromise
    })
    expect(result.current.status).toBe('loading')
    expect(result.current.followUps).toEqual([carried])

    await act(async () => {
      refreshRequest.resolve({ followUps: [], decisions: [] })
      await refreshPromise
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.followUps).toEqual([carried])
  })

  it('does not let a stale successful refresh clear a mutation error that happened after it began', async () => {
    const staleRefresh = deferred<RoutineListResponse>()
    const carried = followUp('carried')
    vi.mocked(api.office.listRoutineFollowUps)
      .mockResolvedValueOnce({ followUps: [], decisions: [] })
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce({ followUps: [carried], decisions: [] })
    vi.mocked(api.office.carryRoutineFollowUp).mockRejectedValue(new Error('response lost'))

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let refreshPromise!: Promise<void>
    act(() => {
      refreshPromise = result.current.refresh()
    })
    await act(async () => {
      await expect(result.current.carry('carried')).rejects.toThrow('response lost')
    })
    expect(result.current.status).toBe('loading')

    await act(async () => {
      staleRefresh.resolve({ followUps: [], decisions: [] })
      await refreshPromise
    })
    expect(result.current.status).toBe('error')
    expect(result.current.followUps).toEqual([])

    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.followUps).toEqual([carried])
  })

  it('does not let a superseded carry resurrect an entry after a decision', async () => {
    const staleCarry = deferred<{ followUp: OfficeRoutineFollowUp; created: boolean }>()
    const carried = followUp('report-a')
    vi.mocked(api.office.listRoutineFollowUps)
      .mockResolvedValueOnce({ followUps: [carried], decisions: [] })
      .mockResolvedValueOnce({ followUps: [], decisions: [decision('report-a')] })
    vi.mocked(api.office.carryRoutineFollowUp).mockReturnValue(staleCarry.promise)
    vi.mocked(api.office.decideRoutineFollowUp).mockResolvedValue({
      decision: decision('report-a'),
      created: true,
    })

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let carryPromise!: Promise<void>
    act(() => {
      carryPromise = result.current.carry('report-a')
    })
    await waitFor(() => expect(api.office.carryRoutineFollowUp).toHaveBeenCalledTimes(1))
    let decidePromise!: Promise<void>
    act(() => {
      decidePromise = result.current.decide('report-a', { outcome: 'maintain-plan' })
    })
    expect(api.office.decideRoutineFollowUp).not.toHaveBeenCalled()

    await act(async () => {
      staleCarry.resolve({ followUp: carried, created: false })
      await carryPromise
      await decidePromise
    })
    expect(api.office.decideRoutineFollowUp).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('ready')
    expect(result.current.followUps).toEqual([])

    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.followUps).toEqual([])
  })

  it('keeps status loading until independent inflight mutations have all settled', async () => {
    const firstRequest = deferred<{ followUp: OfficeRoutineFollowUp; created: boolean }>()
    const secondRequest = deferred<{ followUp: OfficeRoutineFollowUp; created: boolean }>()
    const first = followUp('first', 1_000)
    const second = followUp('second', 2_000)
    vi.mocked(api.office.listRoutineFollowUps).mockResolvedValue({ followUps: [], decisions: [] })
    vi.mocked(api.office.carryRoutineFollowUp).mockImplementation((inboxEntryId) =>
      inboxEntryId === 'first' ? firstRequest.promise : secondRequest.promise)

    const { result } = renderHook(() => useOfficeRoutineFollowUps())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let firstPromise!: Promise<void>
    let secondPromise!: Promise<void>
    act(() => {
      firstPromise = result.current.carry('first')
      secondPromise = result.current.carry('second')
    })
    await act(async () => {
      secondRequest.resolve({ followUp: second, created: true })
      await secondPromise
    })
    expect(result.current.status).toBe('loading')
    expect(result.current.followUps).toEqual([second])

    await act(async () => {
      firstRequest.resolve({ followUp: first, created: true })
      await firstPromise
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.followUps).toEqual([first, second])
  })
})
