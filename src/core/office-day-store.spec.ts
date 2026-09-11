import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  OfficeDayStore,
  OfficeDayUnavailableError,
  officeDayKey,
} from './office-day-store.js'

const UTC_NOON = Date.parse('2026-09-01T12:00:00.000Z')
const DAY_KEY = '2026-09-01'

const fixtureDirs: string[] = []

afterEach(async () => {
  await Promise.all(fixtureDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(initialNow = UTC_NOON, timeZone = 'UTC') {
  const dir = await mkdtemp(join(tmpdir(), 'openalice-office-day-'))
  fixtureDirs.push(dir)
  const path = join(dir, 'nested', 'day.json')
  const clock = { now: initialNow }
  const store = await OfficeDayStore.load({ path, timeZone, now: () => clock.now })
  return { dir, path, clock, store }
}

function cadenceDutyId(candidateId: string, subjectKey: string, fingerprint: string): string {
  return JSON.stringify(['office-duty-v1', 'cadence', candidateId, subjectKey, fingerprint])
}

describe('OfficeDayStore', () => {
  it('observes one server-local IANA day and its next local-midnight rollover', async () => {
    const { store } = await fixture()

    expect(store.observe()).toEqual({
      serverNow: UTC_NOON,
      dayKey: DAY_KEY,
      timeZone: 'UTC',
      nextRolloverAt: Date.parse('2026-09-02T00:00:00.000Z'),
      revision: 0,
      day: null,
    })
  })

  it('resolves a DST boundary using the server IANA timezone instead of a fixed offset', async () => {
    const now = Date.parse('2026-03-08T06:30:00.000Z')
    const { store } = await fixture(now, 'America/New_York')

    expect(store.observe()).toMatchObject({
      serverNow: now,
      dayKey: '2026-03-08',
      timeZone: 'America/New_York',
      nextRolloverAt: Date.parse('2026-03-09T04:00:00.000Z'),
    })
    expect(officeDayKey(now, 'America/New_York')).toBe('2026-03-08')
  })

  it('opens and atomically persists a strict day with exact duty keys', async () => {
    const { dir, path, store } = await fixture()
    const slots = [
      'inbox\u0000report-1\u0000fingerprint-a',
      'cadence\u0000workspace-1\u0000issue-1\u00001756800000000',
    ]

    const result = await store.open({ dayKey: DAY_KEY, slots })

    expect(result).toMatchObject({ applied: true, revision: 1 })
    expect(result.day).toEqual({
      dayKey: DAY_KEY,
      timeZone: 'UTC',
      openedAt: UTC_NOON,
      updatedAt: UTC_NOON,
      shift: {
        id: 1,
        openedAt: UTC_NOON,
        slots,
        order: slots,
        cleared: false,
      },
      seenDutyIds: slots,
      evidenceReceipts: [],
    })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      revision: 1,
      day: result.day,
    })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readdir(join(dir, 'nested'))).toEqual(['day.json'])
  })

  it('makes same-day open idempotent and rejects a stale calendar day without writing', async () => {
    const { path, store } = await fixture()
    await store.open({ dayKey: DAY_KEY, slots: ['duty-a'] })
    const persisted = await readFile(path, 'utf8')

    await expect(store.open({ dayKey: DAY_KEY, slots: ['different-duty'] })).resolves.toMatchObject({
      applied: false,
      reason: 'no-change',
      revision: 1,
      day: { shift: { slots: ['duty-a'] } },
    })
    await expect(store.open({ dayKey: '2026-08-31', slots: ['stale-duty'] })).resolves.toMatchObject({
      applied: false,
      reason: 'stale-day',
      revision: 1,
    })
    expect(await readFile(path, 'utf8')).toBe(persisted)
  })

  it('serializes concurrent shift commands and persists every accepted order change', async () => {
    const { path, store } = await fixture()
    const opened = await store.open({ dayKey: DAY_KEY, slots: ['a', 'b', 'c'] })
    const shiftId = opened.day!.shift.id

    const [first, second] = await Promise.all([
      store.execute({ type: 'defer-duty', dayKey: DAY_KEY, shiftId, dutyId: 'a' }),
      store.execute({ type: 'defer-duty', dayKey: DAY_KEY, shiftId, dutyId: 'b' }),
    ])

    expect(first.applied).toBe(true)
    expect(second.applied).toBe(true)
    expect(store.observe()).toMatchObject({
      revision: 3,
      day: { shift: { order: ['c', 'a', 'b'] } },
    })
    expect((await OfficeDayStore.load({ path, timeZone: 'UTC', now: () => UTC_NOON })).observe())
      .toMatchObject({ revision: 3, day: { shift: { order: ['c', 'a', 'b'] } } })
  })

  it('reconciles only the frozen exact keys and clears only after domain facts settle', async () => {
    const { store } = await fixture()
    const opened = await store.open({ dayKey: DAY_KEY, slots: ['exact-a', 'exact-b'] })
    const shiftId = opened.day!.shift.id

    const partial = await store.execute({
      type: 'reconcile-shift',
      dayKey: DAY_KEY,
      shiftId,
      presentSlotIds: ['exact-b'],
      proposedSlots: ['new-duty-that-must-not-enter-the-frozen-shift'],
      unresolvedCount: 1,
    })
    expect(partial).toMatchObject({
      applied: true,
      day: {
        shift: {
          slots: ['exact-a', 'exact-b'],
          order: ['exact-b'],
          cleared: false,
        },
      },
    })

    const waiting = await store.execute({
      type: 'reconcile-shift',
      dayKey: DAY_KEY,
      shiftId,
      presentSlotIds: [],
      proposedSlots: ['still-not-in-this-shift'],
      unresolvedCount: 1,
    })
    expect(waiting).toMatchObject({ applied: true, day: { shift: { order: [], cleared: false } } })

    const cleared = await store.execute({
      type: 'reconcile-shift',
      dayKey: DAY_KEY,
      shiftId,
      presentSlotIds: [],
      proposedSlots: ['still-not-in-this-shift'],
      unresolvedCount: 0,
    })
    expect(cleared).toMatchObject({ applied: true, day: { shift: { order: [], cleared: true } } })
  })

  it('uses dayKey plus shiftId to reject a stale tab after a monotonic next shift', async () => {
    const { path, store } = await fixture()
    const opened = await store.open({ dayKey: DAY_KEY, slots: ['old-duty'] })
    const oldShiftId = opened.day!.shift.id
    await store.execute({
      type: 'reconcile-shift',
      dayKey: DAY_KEY,
      shiftId: oldShiftId,
      presentSlotIds: [],
      proposedSlots: [],
      unresolvedCount: 0,
    })
    const next = await store.execute({
      type: 'start-next-shift',
      dayKey: DAY_KEY,
      shiftId: oldShiftId,
      slots: ['new-duty'],
    })
    expect(next).toMatchObject({ applied: true, revision: 3, day: { shift: { id: 3 } } })
    const persisted = await readFile(path, 'utf8')

    const stale = await store.execute({
      type: 'defer-duty',
      dayKey: DAY_KEY,
      shiftId: oldShiftId,
      dutyId: 'old-duty',
    })
    expect(stale).toMatchObject({
      applied: false,
      reason: 'stale-shift',
      revision: 3,
      day: { shift: { id: 3, slots: ['new-duty'] } },
    })
    expect(await readFile(path, 'utf8')).toBe(persisted)
  })

  it('never re-admits a seen exact key from stale sources but admits a new fingerprint', async () => {
    const { store } = await fixture()
    const exactA = 'inbox-report@fingerprint-a'
    const exactB = 'inbox-report@fingerprint-b'
    const exactC = 'inbox-report@fingerprint-c'
    const opened = await store.open({ dayKey: DAY_KEY, slots: [exactA] })
    const shiftA = opened.day!.shift.id
    const clearedA = await store.execute({
      type: 'reconcile-shift',
      dayKey: DAY_KEY,
      shiftId: shiftA,
      presentSlotIds: [],
      proposedSlots: [],
      unresolvedCount: 0,
    })
    expect(clearedA).toMatchObject({
      revision: 2,
      day: { shift: { id: shiftA, cleared: true }, seenDutyIds: [exactA] },
    })

    const staleControllerA = await store.execute({
      type: 'reconcile-shift',
      dayKey: DAY_KEY,
      shiftId: shiftA,
      presentSlotIds: [exactA],
      proposedSlots: [exactA],
      unresolvedCount: 1,
    })
    expect(staleControllerA).toMatchObject({
      applied: false,
      reason: 'no-change',
      revision: 2,
      day: { shift: { id: shiftA, slots: [exactA], order: [], cleared: true } },
    })
    await expect(store.execute({
      type: 'start-next-shift',
      dayKey: DAY_KEY,
      shiftId: shiftA,
      slots: [exactA],
    })).resolves.toMatchObject({ applied: false, reason: 'no-change', revision: 2 })

    const openedB = await store.execute({
      type: 'reconcile-shift',
      dayKey: DAY_KEY,
      shiftId: shiftA,
      presentSlotIds: [],
      proposedSlots: [exactA, exactB],
      unresolvedCount: 1,
    })
    expect(openedB).toMatchObject({
      applied: true,
      revision: 3,
      day: {
        shift: { id: 3, slots: [exactB], order: [exactB] },
        seenDutyIds: [exactA, exactB],
      },
    })

    await store.execute({
      type: 'reconcile-shift',
      dayKey: DAY_KEY,
      shiftId: 3,
      presentSlotIds: [],
      proposedSlots: [],
      unresolvedCount: 0,
    })
    const twoShiftsOldA = await store.execute({
      type: 'start-next-shift',
      dayKey: DAY_KEY,
      shiftId: 3,
      slots: [exactA],
    })
    expect(twoShiftsOldA).toMatchObject({
      applied: false,
      reason: 'no-change',
      revision: 4,
      day: { shift: { id: 3, slots: [exactB], cleared: true } },
    })

    const openedC = await store.execute({
      type: 'start-next-shift',
      dayKey: DAY_KEY,
      shiftId: 3,
      slots: [exactA, exactC],
    })
    expect(openedC).toMatchObject({
      applied: true,
      revision: 5,
      day: {
        shift: { id: 5, slots: [exactC], order: [exactC] },
        seenDutyIds: [exactA, exactB, exactC],
      },
    })
  })

  it('will not start the next shift while the current shift remains unresolved', async () => {
    const { store } = await fixture()
    const opened = await store.open({ dayKey: DAY_KEY, slots: ['duty-a'] })

    await expect(store.execute({
      type: 'start-next-shift',
      dayKey: DAY_KEY,
      shiftId: opened.day!.shift.id,
      slots: ['duty-b'],
    })).resolves.toMatchObject({
      applied: false,
      reason: 'shift-not-complete',
      revision: 1,
    })
  })

  it('starts the next finite batch after its frozen order settles even when more backlog exists', async () => {
    const { store } = await fixture()
    const opened = await store.open({ dayKey: DAY_KEY, slots: ['duty-a'] })
    const shiftId = opened.day!.shift.id
    const settled = await store.execute({
      type: 'reconcile-shift',
      dayKey: DAY_KEY,
      shiftId,
      presentSlotIds: [],
      proposedSlots: ['duty-b'],
      unresolvedCount: 1,
    })
    expect(settled).toMatchObject({ day: { shift: { order: [], cleared: false } } })

    await expect(store.execute({
      type: 'start-next-shift',
      dayKey: DAY_KEY,
      shiftId,
      slots: ['duty-b'],
    })).resolves.toMatchObject({
      applied: true,
      revision: 3,
      day: { shift: { id: 3, slots: ['duty-b'], order: ['duty-b'], cleared: false } },
    })
  })

  it('atomically records exact evidence and removes its matching pending duty', async () => {
    const { path, store } = await fixture()
    const subjectKey = 'scheduled-issue\u0000workspace-1\u0000issue-1'
    const fingerprint = 'fingerprint-a'
    const dutyId = cadenceDutyId('scheduled-issue-health:workspace-1:issue-1', subjectKey, fingerprint)
    const opened = await store.open({ dayKey: DAY_KEY, slots: [dutyId, 'other-duty'] })
    const shiftId = opened.day!.shift.id

    const reviewed = await store.execute({
      type: 'review-evidence',
      dayKey: DAY_KEY,
      shiftId,
      dutyId,
      subjectKey,
      fingerprint,
    })

    expect(reviewed).toMatchObject({
      applied: true,
      revision: 2,
      day: {
        shift: { order: ['other-duty'] },
        evidenceReceipts: [{
          subjectKey,
          fingerprint,
          reviewedAt: UTC_NOON,
        }],
      },
    })
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      revision: 2,
      day: {
        shift: { order: ['other-duty'] },
        evidenceReceipts: [{ subjectKey, fingerprint }],
      },
    })
    await expect(store.execute({
      type: 'review-evidence',
      dayKey: DAY_KEY,
      shiftId,
      dutyId,
      subjectKey,
      fingerprint,
    })).resolves.toMatchObject({ applied: false, reason: 'no-change', revision: 2 })
  })

  it('rejects review evidence whose receipt identity does not match the pending exact duty key', async () => {
    const { path, store } = await fixture()
    const dutyId = cadenceDutyId('scheduled-issue-health:a', 'subject-a', 'fingerprint-a')
    await store.open({ dayKey: DAY_KEY, slots: [dutyId] })
    const persisted = await readFile(path, 'utf8')

    await expect(store.execute({
      type: 'review-evidence',
      dayKey: DAY_KEY,
      shiftId: 1,
      dutyId,
      subjectKey: 'subject-b',
      fingerprint: 'fingerprint-b',
    })).rejects.toThrow('review evidence identity does not match')
    expect(store.observe()).toMatchObject({
      revision: 1,
      day: { shift: { order: [dutyId] }, evidenceReceipts: [] },
    })
    expect(await readFile(path, 'utf8')).toBe(persisted)
  })

  it('accepts an exact duty key that embeds the maximum evidence fingerprint', async () => {
    const { store } = await fixture()
    const fingerprint = 'f'.repeat(8_192)
    const dutyId = cadenceDutyId(
      'scheduled-issue-health:large-report',
      'scheduled-issue-large-report',
      fingerprint,
    )
    expect(dutyId.length).toBeGreaterThan(1_024)

    const opened = await store.open({ dayKey: DAY_KEY, slots: [dutyId] })
    await expect(store.execute({
      type: 'review-evidence',
      dayKey: DAY_KEY,
      shiftId: opened.day!.shift.id,
      dutyId,
      subjectKey: 'scheduled-issue-large-report',
      fingerprint,
    })).resolves.toMatchObject({
      applied: true,
      day: {
        shift: { order: [] },
        evidenceReceipts: [{ subjectKey: 'scheduled-issue-large-report', fingerprint }],
      },
    })
  })

  it('keeps distinct evidence fingerprints and forgets every receipt for one exact subject', async () => {
    const { store } = await fixture()
    const dutyV1 = cadenceDutyId('scheduled-issue-health:subject-a', 'subject-a', 'version-1')
    const dutyV2 = cadenceDutyId('scheduled-issue-health:subject-a', 'subject-a', 'version-2')
    const first = await store.open({ dayKey: DAY_KEY, slots: [dutyV1] })
    const firstShiftId = first.day!.shift.id
    await store.execute({
      type: 'review-evidence',
      dayKey: DAY_KEY,
      shiftId: firstShiftId,
      dutyId: dutyV1,
      subjectKey: 'subject-a',
      fingerprint: 'version-1',
    })
    await store.execute({
      type: 'reconcile-shift',
      dayKey: DAY_KEY,
      shiftId: firstShiftId,
      presentSlotIds: [],
      proposedSlots: [],
      unresolvedCount: 0,
    })
    const second = await store.execute({
      type: 'start-next-shift',
      dayKey: DAY_KEY,
      shiftId: firstShiftId,
      slots: [dutyV2],
    })
    await store.execute({
      type: 'review-evidence',
      dayKey: DAY_KEY,
      shiftId: second.day!.shift.id,
      dutyId: dutyV2,
      subjectKey: 'subject-a',
      fingerprint: 'version-2',
    })

    expect(store.observe().day?.evidenceReceipts.map((receipt) => receipt.fingerprint))
      .toEqual(['version-1', 'version-2'])
    await expect(store.execute({
      type: 'forget-evidence',
      dayKey: DAY_KEY,
      subjectKey: 'subject-a',
    })).resolves.toMatchObject({ applied: true, day: { evidenceReceipts: [] } })
  })

  it('rolls over by calendar day, rejects yesterday commands, and resets daily state on open', async () => {
    const { clock, store } = await fixture()
    const first = await store.open({ dayKey: DAY_KEY, slots: ['yesterday-duty'] })
    clock.now = Date.parse('2026-09-02T00:00:01.000Z')

    expect(store.observe()).toMatchObject({ dayKey: '2026-09-02', revision: 1, day: null })
    await expect(store.execute({
      type: 'defer-duty',
      dayKey: DAY_KEY,
      shiftId: first.day!.shift.id,
      dutyId: 'yesterday-duty',
    })).resolves.toMatchObject({
      applied: false,
      reason: 'stale-day',
      dayKey: '2026-09-02',
      revision: 1,
      day: null,
    })

    const today = await store.open({ dayKey: '2026-09-02', slots: ['today-duty'] })
    expect(today).toMatchObject({
      applied: true,
      revision: 2,
      day: {
        dayKey: '2026-09-02',
        shift: { id: 2, slots: ['today-duty'] },
        evidenceReceipts: [],
      },
    })
  })

  it.each([
    ['invalid JSON', '{'],
    ['wrong version', JSON.stringify({ version: 2, revision: 1, day: {} })],
    ['unknown file field', JSON.stringify({ version: 1, revision: 1, day: {}, extra: true })],
    ['invalid shift relation', JSON.stringify({
      version: 1,
      revision: 1,
      day: {
        dayKey: DAY_KEY,
        timeZone: 'UTC',
        openedAt: UTC_NOON,
        updatedAt: UTC_NOON,
        shift: { id: 1, openedAt: UTC_NOON, slots: ['a'], order: ['b'], cleared: false },
        seenDutyIds: ['a'],
        evidenceReceipts: [],
      },
    })],
    ['cleared empty shift', JSON.stringify({
      version: 1,
      revision: 1,
      day: {
        dayKey: DAY_KEY,
        timeZone: 'UTC',
        openedAt: UTC_NOON,
        updatedAt: UTC_NOON,
        shift: { id: 1, openedAt: UTC_NOON, slots: [], order: [], cleared: true },
        seenDutyIds: [],
        evidenceReceipts: [],
      },
    })],
    ['cleared shift with a pending order', JSON.stringify({
      version: 1,
      revision: 1,
      day: {
        dayKey: DAY_KEY,
        timeZone: 'UTC',
        openedAt: UTC_NOON,
        updatedAt: UTC_NOON,
        shift: { id: 1, openedAt: UTC_NOON, slots: ['a'], order: ['a'], cleared: true },
        seenDutyIds: ['a'],
        evidenceReceipts: [],
      },
    })],
    ['oversized day admission ledger', JSON.stringify({
      version: 1,
      revision: 1,
      day: {
        dayKey: DAY_KEY,
        timeZone: 'UTC',
        openedAt: UTC_NOON,
        updatedAt: UTC_NOON,
        shift: { id: 1, openedAt: UTC_NOON, slots: ['seen-0'], order: ['seen-0'], cleared: false },
        seenDutyIds: Array.from({ length: 1_025 }, (_value, index) => `seen-${index}`),
        evidenceReceipts: [],
      },
    })],
  ])('fails closed instead of replacing malformed durable state: %s', async (_label, body) => {
    const dir = await mkdtemp(join(tmpdir(), 'openalice-office-day-malformed-'))
    fixtureDirs.push(dir)
    const path = join(dir, 'office', 'day.json')
    await mkdir(join(dir, 'office'), { recursive: true })
    await writeFile(path, body, 'utf8')

    await expect(OfficeDayStore.load({ path, timeZone: 'UTC', now: () => UTC_NOON })).rejects.toThrow()
    const store = await OfficeDayStore.loadOrUnavailable({ path, timeZone: 'UTC', now: () => UTC_NOON })
    expect(store.available).toBe(false)
    expect(() => store.observe()).toThrow(OfficeDayUnavailableError)
    await expect(store.open({ dayKey: DAY_KEY, slots: ['replacement'] }))
      .rejects.toBeInstanceOf(OfficeDayUnavailableError)
    await expect(store.execute({
      type: 'forget-evidence',
      dayKey: DAY_KEY,
      subjectKey: 'anything',
    })).rejects.toBeInstanceOf(OfficeDayUnavailableError)
    expect(await readFile(path, 'utf8')).toBe(body)
  })

  it('rejects malformed commands before any durable mutation', async () => {
    const { path, store } = await fixture()
    await store.open({ dayKey: DAY_KEY, slots: ['duty-a'] })
    const persisted = await readFile(path, 'utf8')

    await expect(store.execute({
      type: 'defer-duty',
      dayKey: DAY_KEY,
      shiftId: 1,
      dutyId: ' duty-a',
      extra: true,
    })).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(persisted)
  })
})
