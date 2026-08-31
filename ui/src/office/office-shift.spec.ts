// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import type { OfficeDutyCandidate } from './duty-registry'
import {
  OFFICE_SHIFT_LIMIT,
  OFFICE_SHIFT_STORAGE_KEY,
  createOfficeShiftSnapshot,
  deferOfficeShiftDuty,
  readOfficeShiftSnapshot,
  reconcileOfficeShiftSnapshot,
  writeOfficeShiftSnapshot,
} from './office-shift'

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
        docs: [{ path: `reports/${id}.md`, revision: `revision-${id}` }],
      },
    },
  }
}

function routineInboxDuty(
  id: string,
  workspaceId: string,
  issueId: string,
  ts = 1_000,
): OfficeDutyCandidate {
  const duty = inboxDuty(id)
  if (duty.kind !== 'inbox') throw new Error('Expected Inbox duty')
  return {
    ...duty,
    delivery: {
      ...duty.delivery,
      entry: { ...duty.delivery.entry, ts },
      declaredIssue: {
        workspaceId,
        issueId,
        title: `Routine ${issueId}`,
        priority: 'medium',
        nextDueAtMs: null,
        unreadSiblingCount: 0,
        olderUnreadCount: 0,
      },
    },
  }
}

function cadenceDuty(workspaceId: string, issueId: string): OfficeDutyCandidate {
  return {
    id: `scheduled-issue-health:${workspaceId}:${issueId}`,
    registrationId: 'scheduled-issue-health',
    kind: 'cadence',
    count: 1,
    destination: {
      kind: 'issue',
      workspaceId,
      issueId,
      targetId: 'operations',
    },
    receipt: {
      kind: 'evidence',
      subjectKey: JSON.stringify(['scheduled-issue', workspaceId, issueId]),
      fingerprint: `fingerprint-${workspaceId}-${issueId}`,
      scope: 'session',
    },
    cadence: {
      workspaceId,
      workspaceTag: workspaceId,
      issueId,
      title: `Routine ${issueId}`,
      priority: 'high',
      assignee: '@new-each-run',
      when: { kind: 'every', every: '1h' },
      health: { state: 'failed', message: 'Run failed' },
      nextDueAtMs: null,
    },
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
})

describe('Office shift snapshot', () => {
  it('freezes at four unique duties without padding or admitting the fifth', () => {
    const duties = ['a', 'b', 'c', 'd', 'e'].map(inboxDuty)
    const snapshot = createOfficeShiftSnapshot([
      ...duties,
      duties[0]!,
    ], 1_234)

    expect(OFFICE_SHIFT_LIMIT).toBe(4)
    expect(snapshot).toEqual({
      version: 1,
      createdAt: 1_234,
      slots: duties.slice(0, 4).map((duty) => duty.id),
      order: duties.slice(0, 4).map((duty) => duty.id),
      cleared: false,
    })
  })

  it('covers distinct routines before repeating a cross-kind Scheduled Issue', () => {
    const cadence = cadenceDuty('macro', 'asia-close')
    const sameRoutineNewest = routineInboxDuty('asia-new', 'macro', 'asia-close', 3_000)
    const sameRoutineOlder = routineInboxDuty('asia-old', 'macro', 'asia-close', 2_000)
    const otherRoutine = routineInboxDuty('weekly', 'research', 'weekly-report')
    const ordinary = inboxDuty('manual-note')

    const snapshot = createOfficeShiftSnapshot([
      cadence,
      sameRoutineNewest,
      sameRoutineOlder,
      otherRoutine,
      ordinary,
    ], 1_500)

    expect(snapshot.slots).toEqual([
      cadence.id,
      otherRoutine.id,
      ordinary.id,
      sameRoutineNewest.id,
    ])
    expect(snapshot.slots).not.toContain(sameRoutineOlder.id)
  })

  it('does not group ambiguous or unlinked Inbox rows without a declared Issue join', () => {
    const ungrouped = ['ambiguous-a', 'ambiguous-b', 'unlinked-a', 'unlinked-b', 'later']
      .map(inboxDuty)

    expect(createOfficeShiftSnapshot(ungrouped, 1_600).slots)
      .toEqual(ungrouped.slice(0, OFFICE_SHIFT_LIMIT).map((duty) => duty.id))
  })

  it('fills the finite batch with separate versions when only one routine exists', () => {
    const versions = ['newest', 'newer', 'older', 'oldest', 'overflow']
      .map((id, index) => routineInboxDuty(id, 'macro', 'asia-close', 5_000 - index))

    const snapshot = createOfficeShiftSnapshot(versions, 1_700)

    expect(snapshot.slots).toEqual(versions.slice(0, OFFICE_SHIFT_LIMIT).map((duty) => duty.id))
    expect(snapshot.order).toEqual(snapshot.slots)
  })

  it('rotates Later to the tail without completing or changing membership', () => {
    const snapshot = createOfficeShiftSnapshot(['a', 'b', 'c'].map(inboxDuty), 2_000)
    const deferred = deferOfficeShiftDuty(snapshot, inboxDuty('a').id)

    expect(deferred).not.toBe(snapshot)
    expect(deferred.slots).toEqual(snapshot.slots)
    expect(deferred.order).toEqual([
      inboxDuty('b').id,
      inboxDuty('c').id,
      inboxDuty('a').id,
    ])
    expect(deferred.order).toHaveLength(snapshot.order.length)
    expect(deferred.cleared).toBe(false)
    expect(deferred.createdAt).toBe(snapshot.createdAt)
  })

  it('reconciles missing duties only after the source is ready', () => {
    const duties = ['a', 'b'].map(inboxDuty)
    const snapshot = createOfficeShiftSnapshot(duties, 3_000)

    expect(reconcileOfficeShiftSnapshot(snapshot, [duties[1]!], 'loading', 1)).toBe(snapshot)
    expect(reconcileOfficeShiftSnapshot(snapshot, [duties[1]!], 'error', 1)).toBe(snapshot)

    const ready = reconcileOfficeShiftSnapshot(snapshot, [duties[1]!], 'ready', 1)
    expect(ready).toEqual({
      ...snapshot,
      order: [duties[1]!.id],
      cleared: false,
    })
  })

  it('does not let a new arrival enter or jump ahead of an active frozen shift', () => {
    const duties = ['a', 'b', 'c'].map(inboxDuty)
    const snapshot = createOfficeShiftSnapshot(duties, 4_000)
    const arrival = inboxDuty('new')

    const reconciled = reconcileOfficeShiftSnapshot(
      snapshot,
      [arrival, ...duties],
      'ready',
      4,
    )

    expect(reconciled).toBe(snapshot)
    expect(reconciled?.order).toEqual(duties.map((duty) => duty.id))
    expect(reconciled?.slots).not.toContain(arrival.id)
  })

  it('round-trips the frozen order through sessionStorage', () => {
    const snapshot = deferOfficeShiftDuty(
      createOfficeShiftSnapshot(['a', 'b', 'c'].map(inboxDuty), 5_000),
      inboxDuty('a').id,
    )

    writeOfficeShiftSnapshot(snapshot)

    expect(JSON.parse(window.sessionStorage.getItem(OFFICE_SHIFT_STORAGE_KEY)!)).toEqual(snapshot)
    expect(readOfficeShiftSnapshot()).toEqual(snapshot)
  })
})
