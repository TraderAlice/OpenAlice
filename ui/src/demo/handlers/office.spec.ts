// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setupServer } from 'msw/node'

import { officeApi } from '../../api/office'
import {
  DEMO_AUTO_PREDICTION_WORKSPACE_ID,
  DEMO_AUTO_QUANT_WORKSPACE_ID,
  DEMO_CHAT_RESUME_ID,
  DEMO_CHAT_SESSION_ID,
  DEMO_CHAT_WORKSPACE_ID,
  demoChatWorkspace,
} from '../fixtures/workspaces'
import { demoMoversReport, demoWorkspaceFiles } from '../fixtures/inbox'
import { demoIssuesSnapshot } from '../fixtures/issues'
import { inboxHandlers } from './inbox'
import {
  DEMO_OFFICE_DAY_STORAGE_KEY,
  officeHandlers,
  resetDemoOfficeDay,
} from './office'

const server = setupServer(...inboxHandlers, ...officeHandlers)
const baseUrl = window.location.origin

function cadenceDutyId(candidateId: string, subjectKey: string, fingerprint: string): string {
  return JSON.stringify(['office-duty-v1', 'cadence', candidateId, subjectKey, fingerprint])
}

class SerialDemoLockManager {
  readonly requestedNames: string[] = []
  private tail: Promise<void> = Promise.resolve()

  request<T>(name: string, callback: (lock: Lock) => T | PromiseLike<T>): Promise<T> {
    this.requestedNames.push(name)
    const run = this.tail.then(() => callback({ name, mode: 'exclusive' } as Lock))
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }
}

function installNavigatorLocks(locks: LockManager | undefined): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks')
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
  return () => {
    if (descriptor) Object.defineProperty(navigator, 'locks', descriptor)
    else delete (navigator as unknown as { locks?: LockManager }).locks
  }
}

async function reviewTwoDemoDutiesConcurrently(prefix: string) {
  const subjectA = `subject-${prefix}-a`
  const subjectB = `subject-${prefix}-b`
  const fingerprintA = `fingerprint-${prefix}-a`
  const fingerprintB = `fingerprint-${prefix}-b`
  const dutyA = cadenceDutyId(`scheduled-issue-health:${prefix}:a`, subjectA, fingerprintA)
  const dutyB = cadenceDutyId(`scheduled-issue-health:${prefix}:b`, subjectB, fingerprintB)
  const initial = await officeApi.day()
  const opened = await officeApi.openDay({
    dayKey: initial.dayKey,
    slots: [dutyA, dutyB],
  })

  const results = await Promise.all([
    officeApi.commandDay({
      type: 'review-evidence',
      dayKey: opened.dayKey,
      shiftId: opened.day!.shift.id,
      dutyId: dutyA,
      subjectKey: subjectA,
      fingerprint: fingerprintA,
    }),
    officeApi.commandDay({
      type: 'review-evidence',
      dayKey: opened.dayKey,
      shiftId: opened.day!.shift.id,
      dutyId: dutyB,
      subjectKey: subjectB,
      fingerprint: fingerprintB,
    }),
  ])

  return {
    opened,
    results,
    observed: await officeApi.day(),
    receipts: [
      { subjectKey: subjectA, fingerprint: fingerprintA },
      { subjectKey: subjectB, fingerprint: fingerprintB },
    ],
  }
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetDemoOfficeDay()
  vi.restoreAllMocks()
})
afterAll(() => server.close())

describe('demo Office handlers', () => {
  it('rehydrates the shared revision, day, and admission ledger from same-origin storage', async () => {
    const calendar = await officeApi.day()
    const persistedDay = {
      dayKey: calendar.dayKey,
      timeZone: calendar.timeZone,
      openedAt: calendar.serverNow,
      updatedAt: calendar.serverNow,
      shift: {
        id: 7,
        openedAt: calendar.serverNow,
        slots: ['duty-a', 'duty-b'],
        order: ['duty-a', 'duty-b'],
        cleared: false,
      },
      seenDutyIds: ['duty-from-earlier-shift', 'duty-a', 'duty-b'],
      evidenceReceipts: [],
    }
    localStorage.setItem(DEMO_OFFICE_DAY_STORAGE_KEY, JSON.stringify({
      version: 1,
      revision: 7,
      day: persistedDay,
    }))

    const firstClient = await officeApi.day()
    expect(firstClient).toMatchObject({
      revision: 7,
      day: {
        shift: { id: 7, order: ['duty-a', 'duty-b'] },
        seenDutyIds: ['duty-from-earlier-shift', 'duty-a', 'duty-b'],
      },
    })

    const mutated = await officeApi.commandDay({
      type: 'defer-duty',
      dayKey: firstClient.dayKey,
      shiftId: 7,
      dutyId: 'duty-a',
    })
    expect(mutated).toMatchObject({
      applied: true,
      revision: 8,
      day: {
        shift: { order: ['duty-b', 'duty-a'] },
        seenDutyIds: ['duty-from-earlier-shift', 'duty-a', 'duty-b'],
      },
    })

    const secondClient = await officeApi.day()
    expect(secondClient).toMatchObject({
      revision: 8,
      day: {
        shift: { order: ['duty-b', 'duty-a'] },
        seenDutyIds: ['duty-from-earlier-shift', 'duty-a', 'duty-b'],
      },
    })
    expect(JSON.parse(localStorage.getItem(DEMO_OFFICE_DAY_STORAGE_KEY)!)).toMatchObject({
      revision: 8,
      day: { seenDutyIds: ['duty-from-earlier-shift', 'duty-a', 'duty-b'] },
    })
  })

  it('serializes same-revision Demo mutations with the same-realm fallback', async () => {
    const restoreLocks = installNavigatorLocks(undefined)
    try {
      const { opened, results, observed, receipts } = await reviewTwoDemoDutiesConcurrently(
        'fallback',
      )

      expect(results.every((result) => result.applied)).toBe(true)
      expect(results.map((result) => result.revision).sort((left, right) => left - right)).toEqual([
        opened.revision + 1,
        opened.revision + 2,
      ])
      expect(observed).toMatchObject({
        revision: opened.revision + 2,
        day: { shift: { order: [] } },
      })
      expect(observed.day?.evidenceReceipts).toEqual(expect.arrayContaining(
        receipts.map((receipt) => expect.objectContaining(receipt)),
      ))
    } finally {
      restoreLocks()
    }
  })

  it('serializes same-revision Demo mutations across tabs with Web Locks', async () => {
    const lockManager = new SerialDemoLockManager()
    const restoreLocks = installNavigatorLocks(lockManager as unknown as LockManager)
    try {
      const { opened, results, observed, receipts } = await reviewTwoDemoDutiesConcurrently(
        'web-locks',
      )

      expect(results.every((result) => result.applied)).toBe(true)
      expect(observed).toMatchObject({
        revision: opened.revision + 2,
        day: { shift: { order: [] } },
      })
      expect(observed.day?.evidenceReceipts).toEqual(expect.arrayContaining(
        receipts.map((receipt) => expect.objectContaining(receipt)),
      ))
      expect(lockManager.requestedNames).toEqual([
        'openalice:demo:office-day:mutation',
        'openalice:demo:office-day:mutation',
        'openalice:demo:office-day:mutation',
      ])
    } finally {
      restoreLocks()
    }
  })

  it('uses one calendar snapshot for open and command responses across a rollover', async () => {
    const firstDay = new Date(2026, 8, 1, 10, 0, 0, 0).getTime()
    const nextDay = new Date(2026, 8, 2, 10, 0, 0, 0).getTime()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(firstDay)
    const initial = await officeApi.day()

    let calendarReads = 0
    clock.mockImplementation(() => {
      if (new Error().stack?.includes('demoOfficeCalendar')) {
        calendarReads += 1
        return calendarReads === 1 ? firstDay : nextDay
      }
      return firstDay
    })
    const opened = await officeApi.openDay({
      dayKey: initial.dayKey,
      slots: ['duty-a', 'duty-b'],
    })
    expect(opened).toMatchObject({
      applied: true,
      serverNow: firstDay,
      dayKey: initial.dayKey,
      day: { dayKey: initial.dayKey, shift: { order: ['duty-a', 'duty-b'] } },
    })
    expect(calendarReads).toBe(1)

    calendarReads = 0
    clock.mockImplementation(() => {
      if (new Error().stack?.includes('demoOfficeCalendar')) {
        calendarReads += 1
        return calendarReads === 1 ? firstDay + 1 : nextDay
      }
      return firstDay + 1
    })
    const deferred = await officeApi.commandDay({
      type: 'defer-duty',
      dayKey: opened.dayKey,
      shiftId: opened.day!.shift.id,
      dutyId: 'duty-a',
    })
    expect(deferred).toMatchObject({
      applied: true,
      serverNow: firstDay + 1,
      dayKey: initial.dayKey,
      day: { dayKey: initial.dayKey, shift: { order: ['duty-b', 'duty-a'] } },
    })
    expect(calendarReads).toBe(1)
  })

  it('shares one command-shaped Office Day and rejects stale shift mutations', async () => {
    const subjectKey = '["scheduled-issue","macro","weekly"]'
    const fingerprint = 'fingerprint-v1'
    const cadenceA = cadenceDutyId('scheduled-issue-health:macro:weekly', subjectKey, fingerprint)
    const initial = await officeApi.day()
    const opened = await officeApi.openDay({
      dayKey: initial.dayKey,
      slots: [cadenceA, 'inbox-b@v1'],
    })
    expect(opened.applied).toBe(true)
    expect(opened.day?.shift.order).toEqual([cadenceA, 'inbox-b@v1'])
    const firstShiftId = opened.day!.shift.id

    const deferred = await officeApi.commandDay({
      type: 'defer-duty',
      dayKey: opened.dayKey,
      shiftId: firstShiftId,
      dutyId: cadenceA,
    })
    expect(deferred.day?.shift.order).toEqual(['inbox-b@v1', cadenceA])

    const reviewed = await officeApi.commandDay({
      type: 'review-evidence',
      dayKey: opened.dayKey,
      shiftId: firstShiftId,
      dutyId: cadenceA,
      subjectKey,
      fingerprint,
    })
    expect(reviewed.day?.evidenceReceipts).toMatchObject([{
      subjectKey,
      fingerprint,
    }])
    expect(reviewed.day?.shift.order).toEqual(['inbox-b@v1'])

    const settled = await officeApi.commandDay({
      type: 'reconcile-shift',
      dayKey: opened.dayKey,
      shiftId: firstShiftId,
      presentSlotIds: [],
      proposedSlots: [],
      unresolvedCount: 1,
    })
    expect(settled.day?.shift.order).toEqual([])
    const next = await officeApi.commandDay({
      type: 'start-next-shift',
      dayKey: opened.dayKey,
      shiftId: firstShiftId,
      slots: ['inbox-c@v1'],
    })
    expect(next.applied).toBe(true)
    expect(next.day?.shift.id).not.toBe(firstShiftId)

    const stale = await officeApi.commandDay({
      type: 'defer-duty',
      dayKey: opened.dayKey,
      shiftId: firstShiftId,
      dutyId: 'inbox-b@v1',
    })
    expect(stale).toMatchObject({ applied: false, reason: 'stale-shift' })
    expect(stale.day?.shift.order).toEqual(['inbox-c@v1'])
  })

  it('does not re-admit exact keys from stale controllers but accepts a new fingerprint', async () => {
    const exactA = 'inbox-report@fingerprint-a'
    const exactB = 'inbox-report@fingerprint-b'
    const exactC = 'inbox-report@fingerprint-c'
    const initial = await officeApi.day()
    const openedA = await officeApi.openDay({ dayKey: initial.dayKey, slots: [exactA] })
    const shiftA = openedA.day!.shift.id
    await officeApi.commandDay({
      type: 'reconcile-shift',
      dayKey: openedA.dayKey,
      shiftId: shiftA,
      presentSlotIds: [],
      proposedSlots: [],
      unresolvedCount: 0,
    })

    const staleA = await officeApi.commandDay({
      type: 'reconcile-shift',
      dayKey: openedA.dayKey,
      shiftId: shiftA,
      presentSlotIds: [exactA],
      proposedSlots: [exactA],
      unresolvedCount: 1,
    })
    expect(staleA).toMatchObject({
      applied: false,
      reason: 'no-change',
      day: { shift: { id: shiftA, slots: [exactA], order: [], cleared: true } },
    })

    const openedB = await officeApi.commandDay({
      type: 'reconcile-shift',
      dayKey: openedA.dayKey,
      shiftId: shiftA,
      presentSlotIds: [],
      proposedSlots: [exactA, exactB],
      unresolvedCount: 1,
    })
    expect(openedB).toMatchObject({
      applied: true,
      day: {
        shift: { slots: [exactB], order: [exactB] },
        seenDutyIds: [exactA, exactB],
      },
    })
    const shiftB = openedB.day!.shift.id
    await officeApi.commandDay({
      type: 'reconcile-shift',
      dayKey: openedA.dayKey,
      shiftId: shiftB,
      presentSlotIds: [],
      proposedSlots: [],
      unresolvedCount: 0,
    })

    const twoShiftsOldA = await officeApi.commandDay({
      type: 'reconcile-shift',
      dayKey: openedA.dayKey,
      shiftId: shiftB,
      presentSlotIds: [exactA],
      proposedSlots: [exactA],
      unresolvedCount: 1,
    })
    expect(twoShiftsOldA).toMatchObject({
      applied: false,
      reason: 'no-change',
      day: { shift: { id: shiftB, slots: [exactB], order: [], cleared: true } },
    })
    await expect(officeApi.commandDay({
      type: 'start-next-shift',
      dayKey: openedA.dayKey,
      shiftId: shiftB,
      slots: [exactA],
    })).resolves.toMatchObject({ applied: false, reason: 'no-change' })

    const openedC = await officeApi.commandDay({
      type: 'start-next-shift',
      dayKey: openedA.dayKey,
      shiftId: shiftB,
      slots: [exactA, exactC],
    })
    expect(openedC).toMatchObject({
      applied: true,
      day: {
        shift: { slots: [exactC], order: [exactC] },
        seenDutyIds: [exactA, exactB, exactC],
      },
    })
  })

  it('rejects review evidence when its receipt does not match the pending exact duty key', async () => {
    const exactA = cadenceDutyId(
      'scheduled-issue-health:a',
      'subject-a',
      'fingerprint-a',
    )
    const initial = await officeApi.day()
    const opened = await officeApi.openDay({ dayKey: initial.dayKey, slots: [exactA] })

    const response = await fetch(`${baseUrl}/api/office/day/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'review-evidence',
        dayKey: opened.dayKey,
        shiftId: opened.day!.shift.id,
        dutyId: exactA,
        subjectKey: 'subject-b',
        fingerprint: 'fingerprint-b',
      }),
    })

    expect(response.status).toBe(400)
    expect(await officeApi.day()).toMatchObject({
      revision: 1,
      day: { shift: { order: [exactA] }, evidenceReceipts: [] },
    })
  })

  it('rolls the Office Day at the server-local boundary without copying receipts', async () => {
    const firstDay = new Date(2026, 8, 1, 10, 0, 0, 0).getTime()
    const nextDay = new Date(2026, 8, 2, 10, 0, 0, 0).getTime()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(firstDay)
    const subjectKey = '["scheduled-issue","macro","weekly"]'
    const fingerprint = 'fingerprint-v1'
    const dutyId = cadenceDutyId('scheduled-issue-health:macro:weekly', subjectKey, fingerprint)
    const initial = await officeApi.day()
    const opened = await officeApi.openDay({ dayKey: initial.dayKey, slots: [dutyId] })
    await officeApi.commandDay({
      type: 'review-evidence',
      dayKey: opened.dayKey,
      shiftId: opened.day!.shift.id,
      dutyId,
      subjectKey,
      fingerprint,
    })

    clock.mockReturnValue(nextDay)
    const rolled = await officeApi.day()
    expect(rolled.dayKey).not.toBe(opened.dayKey)
    expect(rolled.day).toBeNull()
    const stale = await officeApi.commandDay({
      type: 'forget-evidence',
      dayKey: opened.dayKey,
      subjectKey: '["scheduled-issue","macro","weekly"]',
    })
    expect(stale).toMatchObject({ applied: false, reason: 'stale-day', day: null })
  })

  it('projects Workspaces and Sessions that exist in the shared demo roster', async () => {
    const response = await fetch(`${baseUrl}/api/office/floor`)
    const body = await response.json() as {
      offices: Array<{
        workspace: { id: string }
        employees: Array<{
          resumeId: string
          sessionRecordId?: string
          drawers: Array<{ path?: string }>
        }>
      }>
    }

    expect(response.status).toBe(200)
    expect(body.offices.map((office) => office.workspace.id)).toEqual([
      DEMO_CHAT_WORKSPACE_ID,
      DEMO_AUTO_QUANT_WORKSPACE_ID,
      DEMO_AUTO_PREDICTION_WORKSPACE_ID,
    ])
    expect(body.offices[0]?.employees[0]?.sessionRecordId).toBe(DEMO_CHAT_SESSION_ID)
    expect(body.offices[0]?.employees[0]?.resumeId).toBe(DEMO_CHAT_RESUME_ID)
    expect(body.offices[0]?.employees).toHaveLength(demoChatWorkspace.sessions.length)
    expect(body.offices[0]?.employees.map((employee) => employee.sessionRecordId)).toEqual(
      demoChatWorkspace.sessions.map((session) => session.id),
    )
    const drawerPath = body.offices[0]?.employees[0]?.drawers[0]?.path
    expect(drawerPath).toBe('rotation/ai-chain-2026-06-02.md')
    expect(demoWorkspaceFiles[drawerPath ?? '']).toBeTruthy()
  })

  it('persists one exact routine follow-up and atomically records an idempotent decision', async () => {
    const inboxEntryId = 'demo-inbox-morning-1'
    const endpoint = `${baseUrl}/api/office/routine-follow-ups/${inboxEntryId}`
    const readEndpoint = `${baseUrl}/api/inbox/${inboxEntryId}/read`
    await fetch(readEndpoint, { method: 'DELETE' })

    try {
      const firstBody = await officeApi.carryRoutineFollowUp(inboxEntryId)
      expect(firstBody.created).toBe(true)
      expect(firstBody.followUp).toMatchObject({
        inboxEntryId,
        issueWorkspaceId: 'demo-ws-auto-quant',
        issueId: 'morning-scan',
      })

      const replay = await fetch(endpoint, { method: 'PUT' })
      const replayBody = await replay.json() as typeof firstBody
      expect(replay.status).toBe(200)
      expect(replayBody).toEqual({ followUp: firstBody.followUp, created: false })

      const originalReportTs = demoMoversReport.ts
      try {
        demoMoversReport.ts = originalReportTs + 1
        const conflict = await fetch(endpoint, { method: 'PUT' })
        expect(conflict.status).toBe(409)
      } finally {
        demoMoversReport.ts = originalReportTs
      }

      const listedBody = await officeApi.listRoutineFollowUps()
      expect(listedBody.followUps).toContainEqual(firstBody.followUp)
      expect(listedBody.decisions).toEqual([])

      const falseUnavailable = await fetch(`${endpoint}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome: 'evidence-unavailable' }),
      })
      expect(falseUnavailable.status).toBe(409)
      expect(await falseUnavailable.json()).toMatchObject({
        error: 'routine_follow_up_evidence_available',
      })

      const decided = await officeApi.decideRoutineFollowUp(inboxEntryId, {
        outcome: 'revise-plan',
        note: 'Wait for breadth confirmation.',
      })
      expect(decided).toMatchObject({
        created: true,
        decision: {
          ...firstBody.followUp,
          outcome: 'revise-plan',
          note: 'Wait for breadth confirmation.',
        },
      })
      expect(await officeApi.decideRoutineFollowUp(inboxEntryId, {
        outcome: 'revise-plan',
        note: '  Wait for breadth confirmation.  ',
      })).toEqual({ decision: decided.decision, created: false })
      expect(await officeApi.listRoutineFollowUps()).toMatchObject({
        followUps: [],
        decisions: [decided.decision],
      })

      const conflictingDecision = await fetch(`${endpoint}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome: 'maintain-plan' }),
      })
      expect(conflictingDecision.status).toBe(409)
      expect(await conflictingDecision.json()).toMatchObject({
        error: 'routine_follow_up_decision_conflict',
      })

      const originalOrigin = demoMoversReport.origin
      try {
        demoMoversReport.origin = { kind: 'manual' }
        const receiptReplay = await fetch(endpoint, { method: 'PUT' })
        expect(receiptReplay.status).toBe(409)
        expect(await receiptReplay.json()).toMatchObject({
          error: 'routine_follow_up_no_longer_active',
        })
      } finally {
        demoMoversReport.origin = originalOrigin
      }

      const markedRead = await fetch(readEndpoint, { method: 'PUT' })
      expect(markedRead.status).toBe(200)
      const staleReplay = await fetch(endpoint, { method: 'PUT' })
      expect(staleReplay.status).toBe(409)
      expect(await staleReplay.json()).toMatchObject({
        error: 'routine_follow_up_no_longer_active',
      })
    } finally {
      await fetch(readEndpoint, { method: 'DELETE' })
    }
  })

  it.each([
    ['malformed JSON', '{'],
    ['invalid decision', JSON.stringify({ outcome: 'maintain-plan', note: 'not accepted' })],
  ])('rejects a %s with the production decision error contract', async (_label, body) => {
    const response = await fetch(
      `${baseUrl}/api/office/routine-follow-ups/demo-inbox-morning-1/decision`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'invalid_routine_follow_up_decision',
    })
  })

  it('uses the production missing-decision error when no carry or receipt exists', async () => {
    const response = await fetch(
      `${baseUrl}/api/office/routine-follow-ups/demo-inbox-morning-1/decision`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome: 'maintain-plan' }),
      },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: 'routine_follow_up_decision_missing',
    })
  })

  it('replays an existing carry after its Issue stops scheduling and permits only unavailable evidence', async () => {
    const inboxEntryId = demoMoversReport.id
    const endpoint = `${baseUrl}/api/office/routine-follow-ups/${inboxEntryId}`
    const readEndpoint = `${baseUrl}/api/inbox/${inboxEntryId}/read`
    const issue = demoIssuesSnapshot.workspaces
      .find((workspace) => workspace.wsId === 'demo-ws-auto-quant')
      ?.issues.find((candidate) => candidate.id === 'morning-scan')
    expect(issue?.when).toBeTruthy()
    const originalWhen = issue!.when
    await fetch(readEndpoint, { method: 'DELETE' })

    try {
      const first = await officeApi.carryRoutineFollowUp(inboxEntryId)
      delete issue!.when

      const replay = await fetch(endpoint, { method: 'PUT' })
      expect(replay.status).toBe(200)
      expect(await replay.json()).toEqual({ followUp: first.followUp, created: false })

      const falseJudgment = await fetch(`${endpoint}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome: 'maintain-plan' }),
      })
      expect(falseJudgment.status).toBe(409)
      expect(await falseJudgment.json()).toMatchObject({
        error: 'routine_follow_up_evidence_unavailable',
      })

      const unavailable = await officeApi.decideRoutineFollowUp(inboxEntryId, {
        outcome: 'evidence-unavailable',
      })
      expect(unavailable).toMatchObject({
        created: true,
        decision: { outcome: 'evidence-unavailable' },
      })
    } finally {
      issue!.when = originalWhen
      await fetch(readEndpoint, { method: 'DELETE' })
    }
  })

  it('refuses to invent a decision subject for an ordinary Inbox entry', async () => {
    const response = await fetch(
      `${baseUrl}/api/office/routine-follow-ups/demo-inbox-aapl-q1`,
      { method: 'PUT' },
    )
    expect(response.status).toBe(422)
  })

  it('requires the exact originating Issue to remain scheduled', async () => {
    const endpoint = `${baseUrl}/api/office/routine-follow-ups/${demoMoversReport.id}`
    const originalIssueId = demoMoversReport.origin?.issueId
    try {
      demoMoversReport.origin!.issueId = 'rebalance-sizing-review'
      const response = await fetch(endpoint, { method: 'PUT' })
      expect(response.status).toBe(422)
    } finally {
      demoMoversReport.origin!.issueId = originalIssueId
    }
  })
})
