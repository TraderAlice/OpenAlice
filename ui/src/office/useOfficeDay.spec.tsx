// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  OfficeDayEnvelope,
  OfficeDayMutationResponse,
  OfficeDayRecord,
} from '../api/office'
import { officeDutyKey, type OfficeCadenceDutyCandidate } from './duty-registry'
import { useOfficeDay } from './useOfficeDay'

const officeApiMock = vi.hoisted(() => ({
  day: vi.fn(),
  openDay: vi.fn(),
  commandDay: vi.fn(),
}))

vi.mock('../api', () => ({
  api: { office: officeApiMock },
}))

const DAY_KEY = '2026-09-01'
const TIME_ZONE = 'Asia/Shanghai'

function cadenceDuty(fingerprint = 'failed-run-a'): OfficeCadenceDutyCandidate {
  return {
    id: 'scheduled-issue-health:ws-a:weekly-review',
    registrationId: 'scheduled-issue-health',
    kind: 'cadence',
    count: 1,
    destination: {
      kind: 'issue',
      workspaceId: 'ws-a',
      issueId: 'weekly-review',
      targetId: 'operations',
    },
    receipt: {
      kind: 'evidence',
      subjectKey: '["scheduled-issue","ws-a","weekly-review"]',
      fingerprint,
      scope: 'office-day',
    },
    cadence: {
      workspaceId: 'ws-a',
      workspaceTag: 'weekly',
      issueId: 'weekly-review',
      title: 'Review weekly report',
      priority: 'high',
      assignee: '@new-each-run',
      when: { kind: 'every', every: '1w' },
      health: { state: 'failed', message: 'Latest run failed.', latestTaskId: fingerprint },
      nextDueAtMs: null,
    },
  }
}

function dayRecord(overrides: Partial<OfficeDayRecord> = {}): OfficeDayRecord {
  const duty = cadenceDuty()
  const exactDutyId = officeDutyKey(duty)
  return {
    dayKey: DAY_KEY,
    timeZone: TIME_ZONE,
    openedAt: 1_000,
    updatedAt: 1_000,
    shift: {
      id: 1,
      openedAt: 1_000,
      slots: [exactDutyId],
      order: [exactDutyId],
      cleared: false,
    },
    seenDutyIds: [exactDutyId],
    evidenceReceipts: [],
    ...overrides,
  }
}

function envelope(overrides: Partial<OfficeDayEnvelope> = {}): OfficeDayEnvelope {
  return {
    serverNow: 1_000,
    dayKey: DAY_KEY,
    timeZone: TIME_ZONE,
    nextRolloverAt: 86_400_000,
    revision: 1,
    day: dayRecord(),
    ...overrides,
  }
}

function mutation(
  overrides: Partial<OfficeDayMutationResponse> = {},
): OfficeDayMutationResponse {
  return { ...envelope(), applied: true, ...overrides }
}

beforeEach(() => {
  officeApiMock.day.mockReset()
  officeApiMock.openDay.mockReset()
  officeApiMock.commandDay.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useOfficeDay', () => {
  it.each([
    ['a missing day admission ledger', () => {
      const { seenDutyIds: _seenDutyIds, ...day } = dayRecord()
      return day
    }],
    ['an oversized day admission ledger', () => ({
      ...dayRecord(),
      seenDutyIds: Array.from({ length: 1_025 }, (_value, index) => `seen-${index}`),
    })],
    ['an active shift duty absent from the admission ledger', () => ({
      ...dayRecord(),
      seenDutyIds: ['some-other-duty'],
    })],
  ])('fails closed on %s', async (_label, makeDay) => {
    officeApiMock.day.mockResolvedValue({ ...envelope(), day: makeDay() })

    const hook = renderHook(() => useOfficeDay())

    await waitFor(() => expect(hook.result.current.status).toBe('error'))
    expect(hook.result.current.day).toBeNull()
  })

  it('loads exact Project Day receipts without reading or writing session storage', async () => {
    const subjectKey = cadenceDuty().receipt.subjectKey
    officeApiMock.day.mockResolvedValue(envelope({
      day: dayRecord({
        evidenceReceipts: [
          { subjectKey, fingerprint: 'failed-run-a', reviewedAt: 1_010 },
          { subjectKey, fingerprint: 'failed-run-b', reviewedAt: 1_020 },
        ],
      }),
    }))
    const readStorage = vi.spyOn(Storage.prototype, 'getItem')
    const writeStorage = vi.spyOn(Storage.prototype, 'setItem')

    const hook = renderHook(() => useOfficeDay())
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))

    expect(hook.result.current.evidenceReceipts).toHaveLength(2)
    expect(hook.result.current.hasEvidenceReceipt(subjectKey, 'failed-run-a')).toBe(true)
    expect(hook.result.current.hasEvidenceReceipt(subjectKey, 'failed-run-b')).toBe(true)
    expect(readStorage).not.toHaveBeenCalled()
    expect(writeStorage).not.toHaveBeenCalled()
  })

  it('serializes mutations so one tab cannot reorder shift commands', async () => {
    officeApiMock.day.mockResolvedValue(envelope())
    let releaseFirst!: (value: OfficeDayMutationResponse) => void
    officeApiMock.commandDay
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve }))
      .mockResolvedValueOnce(mutation({ revision: 3 }))
    const hook = renderHook(() => useOfficeDay())
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))

    let first!: Promise<OfficeDayMutationResponse>
    let second!: Promise<OfficeDayMutationResponse>
    act(() => {
      first = hook.result.current.deferDuty({
        dayKey: DAY_KEY,
        shiftId: 1,
        dutyId: 'exact-a',
      })
      second = hook.result.current.startNextShift({
        dayKey: DAY_KEY,
        shiftId: 1,
        slots: ['exact-b'],
      })
    })
    await waitFor(() => expect(officeApiMock.commandDay).toHaveBeenCalledTimes(1))
    expect(officeApiMock.commandDay).toHaveBeenNthCalledWith(1, {
      type: 'defer-duty',
      dayKey: DAY_KEY,
      shiftId: 1,
      dutyId: 'exact-a',
    })

    await act(async () => {
      releaseFirst(mutation({ revision: 2 }))
      await first
    })
    await waitFor(() => expect(officeApiMock.commandDay).toHaveBeenCalledTimes(2))
    expect(officeApiMock.commandDay).toHaveBeenNthCalledWith(2, {
      type: 'start-next-shift',
      dayKey: DAY_KEY,
      shiftId: 1,
      slots: ['exact-b'],
    })
    await act(async () => { await second })
    expect(hook.result.current.revision).toBe(3)
  })

  it('does not let a late older refresh roll back a newer mutation', async () => {
    officeApiMock.day.mockResolvedValueOnce(envelope())
    const hook = renderHook(() => useOfficeDay())
    await waitFor(() => expect(hook.result.current.revision).toBe(1))

    let releaseRefresh!: (value: OfficeDayEnvelope) => void
    officeApiMock.day.mockImplementationOnce(() => new Promise((resolve) => { releaseRefresh = resolve }))
    officeApiMock.commandDay.mockResolvedValueOnce(mutation({ revision: 2 }))
    let refresh!: Promise<void>
    act(() => { refresh = hook.result.current.refresh() })
    await act(async () => {
      await hook.result.current.deferDuty({
        dayKey: DAY_KEY,
        shiftId: 1,
        dutyId: officeDutyKey(cadenceDuty()),
      })
    })
    expect(hook.result.current.revision).toBe(2)

    await act(async () => {
      releaseRefresh(envelope({ revision: 1, day: null }))
      await refresh
    })
    expect(hook.result.current.revision).toBe(2)
    expect(hook.result.current.day).not.toBeNull()
  })

  it('does not let an out-of-order old-day refresh roll back a same-revision rollover', async () => {
    officeApiMock.day.mockResolvedValueOnce(envelope({ serverNow: 100, revision: 4 }))
    const hook = renderHook(() => useOfficeDay())
    await waitFor(() => expect(hook.result.current.revision).toBe(4))

    let releaseOldDay!: (value: OfficeDayEnvelope) => void
    let releaseNewDay!: (value: OfficeDayEnvelope) => void
    officeApiMock.day
      .mockImplementationOnce(() => new Promise((resolve) => { releaseOldDay = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { releaseNewDay = resolve }))
    let oldRequest!: Promise<void>
    let newRequest!: Promise<void>
    act(() => {
      oldRequest = hook.result.current.refresh()
      newRequest = hook.result.current.refresh()
    })

    await act(async () => {
      releaseNewDay(envelope({
        serverNow: 200,
        dayKey: '2026-09-02',
        nextRolloverAt: 20_000,
        revision: 4,
        day: null,
      }))
      await newRequest
    })
    expect(hook.result.current.dayKey).toBe('2026-09-02')

    await act(async () => {
      releaseOldDay(envelope({ serverNow: 150, revision: 4 }))
      await oldRequest
    })
    expect(hook.result.current.dayKey).toBe('2026-09-02')
    expect(hook.result.current.day).toBeNull()
  })

  it('rolls over using the server-reported delta and drops yesterday receipts', async () => {
    const subjectKey = cadenceDuty().receipt.subjectKey
    officeApiMock.day
      .mockResolvedValueOnce(envelope({
        serverNow: 10_000,
        nextRolloverAt: 10_100,
        day: dayRecord({
          evidenceReceipts: [{ subjectKey, fingerprint: 'failed-run-a', reviewedAt: 10_000 }],
        }),
      }))
      .mockResolvedValueOnce(envelope({
        serverNow: 10_100,
        dayKey: '2026-09-02',
        nextRolloverAt: 20_000,
        revision: 2,
        day: null,
      }))
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(9_000_000_000)

    const hook = renderHook(() => useOfficeDay())
    await waitFor(() => expect(hook.result.current.dayKey).toBe(DAY_KEY))
    expect(hook.result.current.hasEvidenceReceipt(subjectKey, 'failed-run-a')).toBe(true)
    await waitFor(() => expect(hook.result.current.dayKey).toBe('2026-09-02'), { timeout: 1_000 })

    expect(officeApiMock.day).toHaveBeenCalledTimes(2)
    expect(hook.result.current.day).toBeNull()
    expect(hook.result.current.hasEvidenceReceipt(subjectKey, 'failed-run-a')).toBe(false)
    dateNow.mockRestore()
  })

  it('refreshes when the renderer becomes visible or focused', async () => {
    officeApiMock.day.mockResolvedValue(envelope())
    const hook = renderHook(() => useOfficeDay())
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))
    officeApiMock.day.mockClear()
    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })

    act(() => document.dispatchEvent(new Event('visibilitychange')))
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(officeApiMock.day).toHaveBeenCalledTimes(2))

    if (visibility) Object.defineProperty(document, 'visibilityState', visibility)
  })

  it('reviews one exact frozen cadence duty atomically', async () => {
    const duty = cadenceDuty()
    const reviewedDay = dayRecord({
      updatedAt: 1_100,
      shift: { ...dayRecord().shift, order: [] },
      evidenceReceipts: [{
        subjectKey: duty.receipt.subjectKey,
        fingerprint: duty.receipt.fingerprint,
        reviewedAt: 1_100,
      }],
    })
    officeApiMock.day.mockResolvedValue(envelope())
    officeApiMock.commandDay
      .mockResolvedValueOnce(mutation({ revision: 2, day: reviewedDay }))
      .mockResolvedValueOnce(mutation({
        revision: 2,
        day: reviewedDay,
        applied: false,
        reason: 'no-change',
      }))
    const hook = renderHook(() => useOfficeDay())
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))

    await expect(hook.result.current.reviewEvidence(duty)).resolves.toBe('acknowledged')
    expect(officeApiMock.commandDay).toHaveBeenNthCalledWith(1, {
      type: 'review-evidence',
      dayKey: DAY_KEY,
      shiftId: 1,
      dutyId: officeDutyKey(duty),
      subjectKey: duty.receipt.subjectKey,
      fingerprint: duty.receipt.fingerprint,
    })
    await expect(hook.result.current.reviewEvidence(duty)).resolves.toBe('already-resolved')
  })
})
