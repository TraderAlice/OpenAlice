import { http, HttpResponse } from 'msw'

import type {
  OfficeDayCommand,
  OfficeDayEnvelope,
  OfficeDayMutationReason,
  OfficeDayMutationResponse,
  OfficeDayRecord,
  OfficeRoutineFollowUp,
} from '../../api/office'
import { demoInboxEntries } from '../fixtures/inbox'
import { demoIssueDetail } from '../fixtures/issues'
import { demoInboxReadAt } from './inbox'
import {
  DEMO_AUTO_PREDICTION_WORKSPACE_ID,
  DEMO_AUTO_QUANT_WORKSPACE_ID,
  DEMO_CHAT_WORKSPACE_ID,
  demoChatWorkspace,
} from '../fixtures/workspaces'

const demoRoutineFollowUps = new Map<string, OfficeRoutineFollowUp>()
export const DEMO_OFFICE_DAY_STORAGE_KEY = 'openalice:demo:office-day:v1'
const DEMO_OFFICE_DAY_MUTATION_LOCK = 'openalice:demo:office-day:mutation'

let demoOfficeDayMutationTail: Promise<void> = Promise.resolve()

interface DemoOfficeDayState {
  readonly version: 1
  readonly revision: number
  readonly day: OfficeDayRecord | null
}

type DemoOfficeCalendar = Omit<OfficeDayEnvelope, 'revision' | 'day'>

const demoOfficeTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function isExactIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
}

function isExactDutyList(value: unknown, allowEmpty = true): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.length <= 4
    && value.every(isExactIdentity)
    && new Set(value).size === value.length
}

function isDemoOfficeDayRecord(value: unknown): value is OfficeDayRecord {
  if (!value || typeof value !== 'object') return false
  const day = value as Record<string, unknown>
  if (typeof day.dayKey !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(day.dayKey)
    || !isExactIdentity(day.timeZone)
    || !isTimestamp(day.openedAt)
    || !isTimestamp(day.updatedAt)
    || day.updatedAt < day.openedAt
    || !day.shift
    || typeof day.shift !== 'object'
    || !Array.isArray(day.seenDutyIds)
    || day.seenDutyIds.length > 1_024
    || !day.seenDutyIds.every(isExactIdentity)
    || new Set(day.seenDutyIds).size !== day.seenDutyIds.length
    || !Array.isArray(day.evidenceReceipts)
    || day.evidenceReceipts.length > 256) return false

  const shift = day.shift as Record<string, unknown>
  if (!isTimestamp(shift.id)
    || shift.id === 0
    || !isTimestamp(shift.openedAt)
    || !isExactDutyList(shift.slots)
    || !isExactDutyList(shift.order)
    || typeof shift.cleared !== 'boolean') return false
  if (shift.cleared && (shift.slots.length === 0 || shift.order.length > 0)) return false
  const slots = new Set(shift.slots)
  const seenDutyIds = new Set(day.seenDutyIds)
  if (!shift.order.every((dutyId) => slots.has(dutyId))
    || !shift.slots.every((dutyId) => seenDutyIds.has(dutyId))) return false

  const seenReceipts = new Set<string>()
  return day.evidenceReceipts.every((value) => {
    if (!value || typeof value !== 'object') return false
    const receipt = value as Record<string, unknown>
    if (!isExactIdentity(receipt.subjectKey)
      || !isExactIdentity(receipt.fingerprint)
      || !isTimestamp(receipt.reviewedAt)) return false
    const exactReceipt = JSON.stringify([receipt.subjectKey, receipt.fingerprint])
    if (seenReceipts.has(exactReceipt)) return false
    seenReceipts.add(exactReceipt)
    return true
  })
}

function emptyDemoOfficeDayState(): DemoOfficeDayState {
  return { version: 1, revision: 0, day: null }
}

const demoOfficeDayStorage = {
  read(): DemoOfficeDayState {
    const raw = globalThis.localStorage.getItem(DEMO_OFFICE_DAY_STORAGE_KEY)
    if (raw === null) return emptyDemoOfficeDayState()
    try {
      const value: unknown = JSON.parse(raw)
      if (!value || typeof value !== 'object') return emptyDemoOfficeDayState()
      const state = value as Record<string, unknown>
      if (state.version !== 1
        || !isTimestamp(state.revision)
        || (state.day !== null && !isDemoOfficeDayRecord(state.day))
        || (state.day !== null && state.revision < state.day.shift.id)) {
        return emptyDemoOfficeDayState()
      }
      return {
        version: 1,
        revision: state.revision,
        day: state.day,
      }
    } catch {
      return emptyDemoOfficeDayState()
    }
  },
  write(state: DemoOfficeDayState): void {
    globalThis.localStorage.setItem(DEMO_OFFICE_DAY_STORAGE_KEY, JSON.stringify(state))
  },
  reset(): void {
    globalThis.localStorage.removeItem(DEMO_OFFICE_DAY_STORAGE_KEY)
  },
}

/**
 * Demo handlers run in each browser tab, while their localStorage authority is
 * shared by the whole origin. Web Locks preserve the production store's
 * cross-tab mutation serialization; the promise tail keeps tests and browsers
 * without that API safe within one JavaScript realm.
 */
function withDemoOfficeDayMutation<T>(mutation: () => T): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (locks) return locks.request(DEMO_OFFICE_DAY_MUTATION_LOCK, mutation)

  const run = demoOfficeDayMutationTail.then(mutation, mutation)
  demoOfficeDayMutationTail = run.then(() => undefined, () => undefined)
  return run
}

function demoOfficeDayKey(now: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: demoOfficeTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now))
  const read = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value
  return `${read('year')}-${read('month')}-${read('day')}`
}

function demoOfficeCalendar(): DemoOfficeCalendar {
  const serverNow = Date.now()
  const next = new Date(serverNow)
  next.setHours(24, 0, 0, 0)
  return {
    serverNow,
    dayKey: demoOfficeDayKey(serverNow),
    timeZone: demoOfficeTimeZone,
    nextRolloverAt: next.getTime(),
  }
}

function currentDemoOfficeDay(
  state: DemoOfficeDayState,
  calendar: DemoOfficeCalendar,
): OfficeDayRecord | null {
  return state.day?.dayKey === calendar.dayKey && state.day.timeZone === calendar.timeZone
    ? state.day
    : null
}

function demoOfficeEnvelope(
  calendar: DemoOfficeCalendar,
  state: DemoOfficeDayState,
): OfficeDayEnvelope {
  return {
    ...calendar,
    revision: state.revision,
    day: currentDemoOfficeDay(state, calendar),
  }
}

function demoOfficeMutation(
  calendar: DemoOfficeCalendar,
  state: DemoOfficeDayState,
  applied: boolean,
  reason?: OfficeDayMutationReason,
): OfficeDayMutationResponse {
  return { ...demoOfficeEnvelope(calendar, state), applied, ...(reason ? { reason } : {}) }
}

function nextDemoShift(
  state: DemoOfficeDayState,
  day: OfficeDayRecord,
  slots: readonly string[],
  now: number,
): DemoOfficeDayState {
  const revision = state.revision + 1
  const next = {
    version: 1 as const,
    revision,
    day: {
      ...day,
      updatedAt: now,
      shift: {
        id: revision,
        openedAt: now,
        slots: [...slots],
        order: [...slots],
        cleared: false,
      },
      seenDutyIds: [...day.seenDutyIds, ...slots],
    },
  }
  demoOfficeDayStorage.write(next)
  return next
}

function commitDemoOfficeDay(
  state: DemoOfficeDayState,
  day: OfficeDayRecord,
  now: number,
): DemoOfficeDayState {
  const next = {
    version: 1 as const,
    revision: state.revision + 1,
    day: { ...day, updatedAt: now },
  }
  demoOfficeDayStorage.write(next)
  return next
}

export function resetDemoOfficeDay(): void {
  demoOfficeDayStorage.reset()
  demoOfficeDayMutationTail = Promise.resolve()
}

function unseenDemoDutyIds(day: OfficeDayRecord, proposedSlots: readonly string[]): string[] {
  const seenDutyIds = new Set(day.seenDutyIds)
  return proposedSlots.filter((dutyId) => !seenDutyIds.has(dutyId))
}

function matchesCanonicalCadenceDuty(
  dutyId: string,
  subjectKey: string,
  fingerprint: string,
): boolean {
  try {
    const value: unknown = JSON.parse(dutyId)
    return Array.isArray(value)
      && value.length === 5
      && value[0] === 'office-duty-v1'
      && value[1] === 'cadence'
      && isExactIdentity(value[2])
      && value[3] === subjectKey
      && value[4] === fingerprint
      && JSON.stringify(value) === dutyId
  } catch {
    return false
  }
}

export const officeHandlers = [
  http.get('/api/office/floor', ({ request }) => {
    const asOfRaw = new URL(request.url).searchParams.get('asOfSeq')
    const asOfSeq = asOfRaw == null ? undefined : Number.parseInt(asOfRaw, 10)
    const working = asOfSeq == null || asOfSeq >= 4
    const now = Date.now()
    return HttpResponse.json({
      config: {
        workspaceSleepAfterMs: 3 * 24 * 60 * 60 * 1000,
        harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 1, other: 0 },
      },
      lastSeq: 6,
      firstSeq: 1,
      ...(asOfSeq != null ? { asOfSeq } : {}),
      offices: [
        {
          workspace: { id: DEMO_CHAT_WORKSPACE_ID, tag: 'chat', harness: 'chat' },
          lastInteractionAt: now,
          sleeping: false,
          employees: demoChatWorkspace.sessions.map((session, index) => ({
            resumeId: session.resumeId,
            agent: session.agent,
            name: session.name,
            title: session.title,
            sessionRecordId: session.id,
            mood: working && session.state === 'running' ? 'working' : 'idle',
            ...(session.surface ? { surface: session.surface } : {}),
            bubble: working && session.state === 'running'
              ? { kind: 'tool' as const, name: index === 0 ? 'workspace_list' : 'research' }
              : null,
            lastSeq: working && session.state === 'running' ? 4 : 2,
            lastInteractionAt: Date.parse(session.lastActiveAt),
            drawers: index === 0 ? [{
              id: 'prov-demo',
              kind: 'report' as const,
              action: 'created',
              at: Date.now() - 60_000,
              label: 'ai-chain-2026-06-02.md',
              path: 'rotation/ai-chain-2026-06-02.md',
            }] : [],
          })),
        },
        {
          workspace: { id: DEMO_AUTO_QUANT_WORKSPACE_ID, tag: 'auto-quant', harness: 'auto-quant' },
          lastInteractionAt: now,
          sleeping: false,
          employees: [],
        },
        {
          workspace: {
            id: DEMO_AUTO_PREDICTION_WORKSPACE_ID,
            tag: 'prediction',
            harness: 'prediction',
          },
          lastInteractionAt: now,
          sleeping: false,
          employees: [],
        },
      ],
    })
  }),
  http.get('/api/office/day', () => {
    const calendar = demoOfficeCalendar()
    const state = demoOfficeDayStorage.read()
    return HttpResponse.json(demoOfficeEnvelope(calendar, state))
  }),
  http.post('/api/office/day/open', async ({ request }) => {
    const input = await request.json() as { dayKey?: unknown; slots?: unknown }
    return withDemoOfficeDayMutation(() => {
      const calendar = demoOfficeCalendar()
      const state = demoOfficeDayStorage.read()
      if (input.dayKey !== calendar.dayKey) {
        return HttpResponse.json(demoOfficeMutation(calendar, state, false, 'stale-day'))
      }
      if (!isExactDutyList(input.slots)) {
        return HttpResponse.json({ error: 'invalid_office_day_command' }, { status: 400 })
      }
      if (currentDemoOfficeDay(state, calendar)) {
        return HttpResponse.json(demoOfficeMutation(calendar, state, false, 'no-change'))
      }
      const revision = state.revision + 1
      const nextState: DemoOfficeDayState = {
        version: 1,
        revision,
        day: {
          dayKey: calendar.dayKey,
          timeZone: calendar.timeZone,
          openedAt: calendar.serverNow,
          updatedAt: calendar.serverNow,
          shift: {
            id: revision,
            openedAt: calendar.serverNow,
            slots: [...input.slots],
            order: [...input.slots],
            cleared: false,
          },
          seenDutyIds: [...input.slots],
          evidenceReceipts: [],
        },
      }
      demoOfficeDayStorage.write(nextState)
      return HttpResponse.json(demoOfficeMutation(calendar, nextState, true))
    })
  }),
  http.post('/api/office/day/commands', async ({ request }) => {
    const command = await request.json() as OfficeDayCommand
    return withDemoOfficeDayMutation(() => {
      const calendar = demoOfficeCalendar()
      const state = demoOfficeDayStorage.read()
      const day = currentDemoOfficeDay(state, calendar)
      if (!day || command.dayKey !== calendar.dayKey) {
        return HttpResponse.json(demoOfficeMutation(calendar, state, false, 'stale-day'))
      }
      if (command.type === 'forget-evidence') {
        const evidenceReceipts = day.evidenceReceipts.filter(
          (receipt) => receipt.subjectKey !== command.subjectKey,
        )
        if (evidenceReceipts.length === day.evidenceReceipts.length) {
          return HttpResponse.json(demoOfficeMutation(calendar, state, false, 'no-change'))
        }
        const nextState = commitDemoOfficeDay(
          state,
          { ...day, evidenceReceipts },
          calendar.serverNow,
        )
        return HttpResponse.json(demoOfficeMutation(calendar, nextState, true))
      }
      if (command.shiftId !== day.shift.id) {
        return HttpResponse.json(demoOfficeMutation(calendar, state, false, 'stale-shift'))
      }

      switch (command.type) {
        case 'reconcile-shift': {
          if (!isExactDutyList(command.presentSlotIds)
            || !isExactDutyList(command.proposedSlots)) {
            return HttpResponse.json({ error: 'invalid_office_day_command' }, { status: 400 })
          }
          if (day.shift.cleared || day.shift.slots.length === 0) {
            const unseenSlots = unseenDemoDutyIds(day, command.proposedSlots)
            if (unseenSlots.length > 0) {
              const nextState = nextDemoShift(state, day, unseenSlots, calendar.serverNow)
              return HttpResponse.json(demoOfficeMutation(calendar, nextState, true))
            }
            if (day.shift.cleared) {
              return HttpResponse.json(demoOfficeMutation(calendar, state, false, 'no-change'))
            }
          }
          const present = new Set(command.presentSlotIds)
          const order = day.shift.order.filter((dutyId) => present.has(dutyId))
          const cleared = day.shift.slots.length > 0
            && order.length === 0
            && command.unresolvedCount === 0
          if (order.length === day.shift.order.length
            && order.every((dutyId, index) => dutyId === day.shift.order[index])
            && cleared === day.shift.cleared) {
            return HttpResponse.json(demoOfficeMutation(calendar, state, false, 'no-change'))
          }
          const nextState = commitDemoOfficeDay(
            state,
            { ...day, shift: { ...day.shift, order, cleared } },
            calendar.serverNow,
          )
          return HttpResponse.json(demoOfficeMutation(calendar, nextState, true))
        }
        case 'defer-duty': {
          const index = day.shift.order.indexOf(command.dutyId)
          if (index < 0) {
            return HttpResponse.json(demoOfficeMutation(calendar, state, false, 'duty-not-pending'))
          }
          if (day.shift.order.length < 2 || index === day.shift.order.length - 1) {
            return HttpResponse.json(demoOfficeMutation(calendar, state, false, 'no-change'))
          }
          const order = [...day.shift.order]
          order.splice(index, 1)
          order.push(command.dutyId)
          const nextState = commitDemoOfficeDay(
            state,
            { ...day, shift: { ...day.shift, order } },
            calendar.serverNow,
          )
          return HttpResponse.json(demoOfficeMutation(calendar, nextState, true))
        }
        case 'start-next-shift': {
          if (day.shift.order.length > 0) {
            return HttpResponse.json(demoOfficeMutation(calendar, state, false, 'shift-not-complete'))
          }
          if (!isExactDutyList(command.slots, false)) {
            return HttpResponse.json({ error: 'invalid_office_day_command' }, { status: 400 })
          }
          const unseenSlots = unseenDemoDutyIds(day, command.slots)
          if (unseenSlots.length === 0) {
            return HttpResponse.json(demoOfficeMutation(calendar, state, false, 'no-change'))
          }
          const nextState = nextDemoShift(state, day, unseenSlots, calendar.serverNow)
          return HttpResponse.json(demoOfficeMutation(calendar, nextState, true))
        }
        case 'review-evidence': {
          if (!matchesCanonicalCadenceDuty(
            command.dutyId,
            command.subjectKey,
            command.fingerprint,
          )) {
            return HttpResponse.json({ error: 'invalid_office_day_command' }, { status: 400 })
          }
          const index = day.shift.order.indexOf(command.dutyId)
          const exists = day.evidenceReceipts.some((receipt) => (
            receipt.subjectKey === command.subjectKey
            && receipt.fingerprint === command.fingerprint
          ))
          if (index < 0) {
            return HttpResponse.json(demoOfficeMutation(
              calendar,
              state,
              false,
              exists ? 'no-change' : 'duty-not-pending',
            ))
          }
          const evidenceReceipts = exists
            ? day.evidenceReceipts
            : [...day.evidenceReceipts, {
                subjectKey: command.subjectKey,
                fingerprint: command.fingerprint,
                reviewedAt: calendar.serverNow,
              }]
          const nextState = commitDemoOfficeDay(
            state,
            {
              ...day,
              shift: {
                ...day.shift,
                order: day.shift.order.filter((dutyId) => dutyId !== command.dutyId),
                cleared: false,
              },
              evidenceReceipts,
            },
            calendar.serverNow,
          )
          return HttpResponse.json(demoOfficeMutation(calendar, nextState, true))
        }
      }
    })
  }),
  http.get('/api/office/routine-follow-ups', () => HttpResponse.json({
    followUps: [...demoRoutineFollowUps.values()].sort((left, right) =>
      left.createdAt - right.createdAt
      || left.inboxEntryId.localeCompare(right.inboxEntryId)),
  })),
  http.put('/api/office/routine-follow-ups/:inboxEntryId', ({ params }) => {
    const inboxEntryId = String(params.inboxEntryId)
    const report = demoInboxEntries.find((entry) => entry.id === inboxEntryId)
    if (!report) {
      return HttpResponse.json({
        error: 'inbox_entry_not_found',
        message: 'The Inbox report no longer exists.',
      }, { status: 404 })
    }
    if (report.origin?.kind !== 'headless'
      || !isExactIdentity(report.origin.issueWorkspaceId)
      || !isExactIdentity(report.origin.issueId)
      || !Number.isFinite(report.ts)
      || !Number.isInteger(report.ts)
      || report.ts < 0) {
      return HttpResponse.json({
        error: 'not_a_routine_report',
        message: 'Only a server-attributed scheduled Issue report can be carried for follow-up.',
      }, { status: 422 })
    }

    const existing = demoRoutineFollowUps.get(inboxEntryId)
    if (existing) {
      const sameAuthority = existing.reportTs === report.ts
        && existing.issueWorkspaceId === report.origin.issueWorkspaceId
        && existing.issueId === report.origin.issueId
      return sameAuthority
        ? HttpResponse.json({ followUp: existing, created: false })
        : HttpResponse.json({
            error: 'routine_follow_up_conflict',
            message: `Routine follow-up authority changed for Inbox entry ${inboxEntryId}.`,
          }, { status: 409 })
    }

    if (demoInboxReadAt(inboxEntryId) !== undefined) {
      return HttpResponse.json({
        error: 'routine_report_already_reviewed',
        message: 'This Inbox report was already reviewed and cannot be carried again.',
      }, { status: 409 })
    }

    const issue = demoIssueDetail(report.origin.issueWorkspaceId, report.origin.issueId)
    if (!issue) {
      return HttpResponse.json({
        error: 'routine_issue_not_found',
        message: 'The Issue that produced this report no longer exists.',
      }, { status: 404 })
    }
    if (!issue.issue.when) {
      return HttpResponse.json({
        error: 'routine_issue_not_scheduled',
        message: 'The Issue that produced this report is not scheduled.',
      }, { status: 422 })
    }

    const followUp: OfficeRoutineFollowUp = {
      inboxEntryId,
      reportTs: report.ts,
      issueWorkspaceId: report.origin.issueWorkspaceId,
      issueId: report.origin.issueId,
      createdAt: Date.now(),
    }
    demoRoutineFollowUps.set(inboxEntryId, followUp)
    return HttpResponse.json({ followUp, created: true })
  }),
  http.delete('/api/office/routine-follow-ups/:inboxEntryId', ({ params }) => {
    const removed = demoRoutineFollowUps.delete(String(params.inboxEntryId))
    return HttpResponse.json({ ok: true, removed })
  }),
]
