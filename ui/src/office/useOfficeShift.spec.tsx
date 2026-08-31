// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { OfficeDutyCandidate, OfficeDutySourceStatus } from './duty-registry'
import { OFFICE_SHIFT_STORAGE_KEY } from './office-shift'
import { useOfficeShift } from './useOfficeShift'

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

interface HookProps {
  readonly candidates: readonly OfficeDutyCandidate[]
  readonly status: OfficeDutySourceStatus
  readonly unresolvedCount: number
}

function renderShift(initialProps: HookProps) {
  return renderHook(
    (props: HookProps) => useOfficeShift(props),
    { initialProps },
  )
}

beforeEach(() => {
  window.sessionStorage.clear()
})

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

    act(() => hook.result.current.defer(duties[0]!))

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

  it('restores the frozen rotation from sessionStorage after remount', async () => {
    const duties = ['a', 'b', 'c'].map(inboxDuty)
    const first = renderShift({ candidates: duties, status: 'ready', unresolvedCount: 3 })
    await waitFor(() => expect(first.result.current.state).toBe('active'))
    act(() => first.result.current.defer(duties[0]!))

    const stored = window.sessionStorage.getItem(OFFICE_SHIFT_STORAGE_KEY)
    expect(stored).toContain(duties[1]!.id)
    first.unmount()

    const restored = renderShift({ candidates: duties, status: 'ready', unresolvedCount: 3 })
    expect(restored.result.current.candidates.map((duty) => duty.id)).toEqual([
      duties[1]!.id,
      duties[2]!.id,
      duties[0]!.id,
    ])
    expect(restored.result.current).toMatchObject({ total: 3, completed: 0, position: 1 })
  })

  it('keeps complete with backlog distinct from clear and starts the next backlog shift explicitly', async () => {
    const firstShift = ['a', 'b', 'c', 'd'].map(inboxDuty)
    const carryover = [inboxDuty('e'), inboxDuty('f')]
    const hook = renderShift({
      candidates: [...firstShift, ...carryover],
      status: 'ready',
      unresolvedCount: 6,
    })
    await waitFor(() => expect(hook.result.current.total).toBe(4))

    hook.rerender({ candidates: carryover, status: 'ready', unresolvedCount: 2 })
    await waitFor(() => expect(hook.result.current.state).toBe('complete'))
    expect(hook.result.current).toMatchObject({
      total: 4,
      completed: 4,
      position: null,
      backlogCount: 2,
      canStartNext: true,
    })

    act(() => hook.result.current.startNext())
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
})
