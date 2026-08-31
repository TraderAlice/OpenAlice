// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueListItem, IssueSnapshot } from '../api/issues'
import type { UseIssues } from '../hooks/useIssues'
import { useOfficeDuties } from './useOfficeDuties'
import type { OfficeProductActivity } from './useOfficeProductActivity'

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

function issues(issue: IssueListItem | null, error: string | null = null): UseIssues {
  const data: IssueSnapshot = {
    workspaces: [{ wsId: 'ws-a', tag: 'weekly', status: 'ok', issues: issue ? [issue] : [] }],
  }
  return { data, error, loading: false }
}

function activity(): OfficeProductActivity {
  return {
    agent: null,
    inbox: null,
    news: null,
    attention: { agent: false, inbox: false, news: false },
    pending: { agent: 0, inbox: 0, news: 0 },
    freshKind: null,
    sourceStatus: 'ready',
    acknowledgeThrough: vi.fn(),
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => vi.restoreAllMocks())

describe('useOfficeDuties', () => {
  it('persists a cadence receipt for this browser session and restores it on remount', () => {
    const productActivity = activity()
    const first = renderHook(() => useOfficeDuties(productActivity, issues(exception())))
    const duty = first.result.current.candidates[0]!
    expect(duty.kind).toBe('cadence')
    act(() => first.result.current.acknowledge(duty))
    expect(first.result.current.candidates).toEqual([])
    first.unmount()

    const second = renderHook(() => useOfficeDuties(productActivity, issues(exception())))
    expect(second.result.current.candidates).toEqual([])
    expect(second.result.current.status).toBe('ready')
  })

  it('keeps new evidence pending when an older captured dossier is stamped', () => {
    const productActivity = activity()
    const { result, rerender } = renderHook(
      ({ issue }) => useOfficeDuties(productActivity, issues(issue)),
      { initialProps: { issue: exception('run-a') } },
    )
    const captured = result.current.candidates[0]!
    rerender({ issue: exception('run-b') })
    expect(result.current.candidates[0]?.id).toBe(captured.id)
    expect(result.current.candidates[0]?.receipt).not.toEqual(captured.receipt)

    act(() => result.current.acknowledge(captured))
    expect(result.current.candidates).toHaveLength(1)
    expect(result.current.candidates[0]?.receipt).not.toEqual(captured.receipt)
  })

  it('clears a recovered subject receipt so the same exception can recur later', async () => {
    const productActivity = activity()
    const { result, rerender } = renderHook(
      ({ issue }) => useOfficeDuties(productActivity, issues(issue)),
      { initialProps: { issue: exception() as IssueListItem | null } },
    )
    const first = result.current.candidates[0]!
    act(() => result.current.acknowledge(first))
    expect(result.current.candidates).toEqual([])

    rerender({ issue: { ...exception(), automationHealth: { state: 'healthy', message: 'Recovered.' } } })
    await waitFor(() => expect(result.current.candidates).toEqual([]))
    rerender({ issue: exception() })
    await waitFor(() => expect(result.current.candidates[0]?.kind).toBe('cadence'))
  })

  it('keeps a stale exception actionable but refuses to call the shift clear after stamping', () => {
    const productActivity = activity()
    const hook = renderHook(() => useOfficeDuties(
      productActivity,
      issues(exception(), 'scanner unavailable'),
    ))
    const duty = hook.result.current.candidates[0]!
    expect(hook.result.current.status).toBe('error')
    act(() => hook.result.current.acknowledge(duty))
    expect(hook.result.current.candidates).toEqual([])
    expect(hook.result.current.status).toBe('error')
  })

  it('treats an invalid Issue workspace as degraded even without a candidate', () => {
    const invalid: UseIssues = {
      data: { workspaces: [{ wsId: 'ws-b', tag: 'broken', status: 'invalid', error: 'bad data', issues: [] }] },
      error: null,
      loading: false,
    }
    const hook = renderHook(() => useOfficeDuties(activity(), invalid))
    expect(hook.result.current.candidates).toEqual([])
    expect(hook.result.current.status).toBe('error')
  })

  it('keeps an exact healthy-workspace exception reviewable when another workspace is invalid', () => {
    const mixed: UseIssues = {
      data: {
        workspaces: [
          { wsId: 'ws-a', tag: 'weekly', status: 'ok', issues: [exception()] },
          { wsId: 'ws-b', tag: 'broken', status: 'invalid', error: 'bad data', issues: [] },
        ],
      },
      error: null,
      loading: false,
    }
    const hook = renderHook(() => useOfficeDuties(activity(), mixed))
    expect(hook.result.current.candidates[0]?.kind).toBe('cadence')
    expect(hook.result.current.cadenceStatus).toBe('ready')
    expect(hook.result.current.status).toBe('error')
    act(() => hook.result.current.acknowledge(hook.result.current.candidates[0]!))
    expect(hook.result.current.candidates).toEqual([])
    expect(hook.result.current.status).toBe('error')
  })

  it('does not call a cached empty snapshot shift-clear while Issue refresh is loading', () => {
    const refreshing: UseIssues = {
      data: { workspaces: [{ wsId: 'ws-a', tag: 'weekly', status: 'ok', issues: [] }] },
      error: null,
      loading: true,
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
})
