// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduleSnapshot } from '../api/schedule'
import {
  refreshSchedules,
  resetSchedulesCache,
  resolveScheduleSkipState,
  useSchedules,
  useScheduleSnapshot,
} from './useSchedules'

const mocks = vi.hoisted(() => ({
  getSchedule: vi.fn<() => Promise<ScheduleSnapshot>>(),
}))

vi.mock('../api', () => ({
  api: {
    schedule: {
      get: () => mocks.getSchedule(),
    },
  },
}))

function makeSnapshot(
  skipState?: NonNullable<ScheduleSnapshot['workspaces'][number]['tasks'][number]['skipState']>,
  enabled = true,
): ScheduleSnapshot {
  return {
    workspaces: [
      {
        wsId: 'ws-1',
        tag: 'quant',
        status: 'ok',
        tasks: [
          {
            id: 'scan',
            issue: 'Morning scan',
            when: { kind: 'every', every: '1h' },
            what: 'Run scan',
            assignee: '@new-each-run',
            enabled,
            lastFiredAtMs: 1_000,
            nextDueAtMs: 2_000,
            ...(skipState ? { skipState } : {}),
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  resetSchedulesCache()
  vi.clearAllMocks()
})

afterEach(() => {
  resetSchedulesCache()
})

describe('useSchedules', () => {
  it('loads GET /api/schedule, caches across remounts, and propagates refresh()', async () => {
    const deferred = makeSnapshot({
      kind: 'deferred',
      code: 'session_blocked',
      reason: 'User cooldown',
      retryAtMs: 120_000,
      sinceMs: 60_000,
    })
    mocks.getSchedule.mockResolvedValueOnce(deferred)

    const first = renderHook(() => useSchedules())
    expect(first.result.current.loading).toBe(true)

    await waitFor(() => expect(first.result.current.snapshot).toEqual(deferred))
    expect(first.result.current.loading).toBe(false)
    expect(first.result.current.error).toBeNull()
    first.unmount()

    const recovered = makeSnapshot(undefined)
    mocks.getSchedule.mockResolvedValueOnce(recovered)
    const second = renderHook(() => useScheduleSnapshot())
    // Warm cache serves immediately before the refresh resolves.
    expect(second.result.current.snapshot).toEqual(deferred)
    await waitFor(() => expect(second.result.current.snapshot).toEqual(recovered))

    const parked = makeSnapshot({
      kind: 'parked',
      code: 'retired',
      reason: 'Session retired',
      sinceMs: 90_000,
    })
    mocks.getSchedule.mockResolvedValueOnce(parked)
    await act(async () => {
      await refreshSchedules()
    })
    expect(second.result.current.snapshot).toEqual(parked)
    second.unmount()
  })

  it('does not fetch when enabled is false', () => {
    const { result, unmount } = renderHook(() => useScheduleSnapshot({ enabled: false }))
    expect(result.current.snapshot).toBeNull()
    expect(mocks.getSchedule).not.toHaveBeenCalled()
    unmount()
  })

  it('resolves authoritative skipState and clears fallback once snapshot loads without skipState', () => {
    const fallback = {
      kind: 'parked' as const,
      code: 'session_blocked',
      reason: 'Fallback reason',
      sinceMs: 1_000,
    }
    expect(resolveScheduleSkipState(null, 'ws-1', 'scan', fallback)).toEqual(fallback)

    const active = makeSnapshot({
      kind: 'deferred',
      code: 'not_ready',
      reason: 'Initializing',
      retryAtMs: 5_000,
      sinceMs: 2_000,
    })
    expect(resolveScheduleSkipState(active, 'ws-1', 'scan', fallback)?.code).toBe('not_ready')

    // Recovered in GET /api/schedule => clears even if fallback still had stale state.
    expect(resolveScheduleSkipState(makeSnapshot(undefined), 'ws-1', 'scan', fallback)).toBeUndefined()

    // Disabled (terminal) task => never reports active skipState.
    expect(resolveScheduleSkipState(makeSnapshot(fallback, false), 'ws-1', 'scan')).toBeUndefined()
  })
})
