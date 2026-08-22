/**
 * Read-only Office floor projection. Roster decides who is on the floor;
 * the occupancy journal decides mood and bubble. This is not a persist store.
 */
import type { ProvenanceRecord } from '../core/provenance-store.js'
import type {
  AgentRuntimeEvent,
  AgentRuntimePayload,
  AgentRuntimeSurface,
} from './agent-runtime-log.js'

export const OFFICE_REVIEW_HOLD_MS = 30_000
export const OFFICE_DRAWER_LIMIT = 6
export type OfficeHarness = 'chat' | 'auto-quant' | 'prediction' | 'other'

export const OFFICE_CONFIG = {
  workspaceSleepAfterMs: 3 * 24 * 60 * 60 * 1000,
  harnessMinimumVisibleGroups: {
    chat: 1,
    'auto-quant': 1,
    prediction: 1,
    other: 0,
  } satisfies Record<OfficeHarness, number>,
} as const

export type OfficeEmployeeMood =
  | 'idle'
  | 'working'
  | 'talking'
  | 'waiting'
  | 'review'
  | 'failed'

export type OfficeBubble =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'tool'; readonly name: string }
  | { readonly kind: 'error'; readonly text: string }
  | { readonly kind: 'rejected' }

export interface OfficeRosterPerson {
  readonly resumeId: string
  readonly agent: string
  readonly name: string
  readonly title?: string
  readonly displayName?: string
  readonly sessionRecordId?: string
  readonly presence?: 'active' | 'archived' | 'deleted'
  readonly lifecycle?: 'active' | 'retired'
  readonly lastInteractionAt: number
}

export type OfficeDrawerKind = 'report' | 'issue' | 'inbox' | 'trade-decision'

export interface OfficeDrawerItem {
  readonly id: string
  readonly kind: OfficeDrawerKind
  readonly action: string
  readonly at: number
  readonly label: string
  readonly path?: string
  readonly issueId?: string
  readonly inboxEntryId?: string
}

export interface OfficeFloorEmployee {
  readonly resumeId: string
  readonly agent: string
  readonly name: string
  readonly title?: string
  readonly displayName?: string
  readonly sessionRecordId?: string
  readonly mood: OfficeEmployeeMood
  readonly surface?: AgentRuntimeSurface
  readonly bubble: OfficeBubble | null
  readonly lastSeq: number
  readonly lastInteractionAt: number
  readonly drawers: readonly OfficeDrawerItem[]
}

export interface OfficeFloor {
  readonly workspaceId: string
  readonly lastInteractionAt: number
  readonly sleeping: boolean
  readonly employees: readonly OfficeFloorEmployee[]
}

interface MutableEmployee {
  mood: OfficeEmployeeMood
  surface?: AgentRuntimeSurface
  bubble: OfficeBubble | null
  lastSeq: number
  lastTs: number
}

type FloorPayload = AgentRuntimePayload & {
  readonly surface?: AgentRuntimeSurface
  readonly toolStatus?: 'running' | 'completed' | 'failed'
  readonly toolName?: string
  readonly text?: string
  readonly message?: string
  readonly error?: string
  readonly status?: 'done' | 'failed' | 'interrupted' | 'paused'
  readonly assistantText?: string
}

function payloadOf(event: AgentRuntimeEvent): FloorPayload {
  return event.payload as FloorPayload
}

function applyEvent(state: MutableEmployee, event: AgentRuntimeEvent, now: number): void {
  const payload = payloadOf(event)
  state.lastSeq = event.seq
  state.lastTs = event.ts
  if (payload.surface) state.surface = payload.surface

  switch (event.type) {
    case 'session.born':
      if (state.lastSeq === event.seq && state.mood === 'idle' && !state.bubble) return
      break
    case 'runtime.started':
      state.mood = 'working'
      state.bubble = null
      break
    case 'runtime.turn.tool': {
      const status = payload.toolStatus
      state.mood = status === 'failed' ? 'failed' : 'working'
      state.bubble = payload.toolName ? { kind: 'tool', name: payload.toolName } : null
      break
    }
    case 'runtime.turn.text':
      state.mood = 'talking'
      state.bubble = payload.text ? { kind: 'text', text: payload.text } : null
      break
    case 'runtime.turn.error':
    case 'runtime.spawn_failed':
      state.mood = 'failed'
      state.bubble = payload.message || payload.error
        ? { kind: 'error', text: payload.message ?? payload.error ?? '' }
        : null
      break
    case 'runtime.rejected':
      state.mood = 'waiting'
      state.bubble = { kind: 'rejected' }
      break
    case 'runtime.stopped':
      if (payload.status === 'failed') {
        state.mood = 'failed'
        state.bubble = payload.error ? { kind: 'error', text: payload.error } : null
        break
      }
      if (payload.status === 'done') {
        const fresh = now - event.ts < OFFICE_REVIEW_HOLD_MS
        state.mood = fresh ? 'review' : 'idle'
        state.bubble = fresh && payload.assistantText
          ? { kind: 'text', text: payload.assistantText }
          : null
        break
      }
      state.mood = 'idle'
      state.bubble = null
      break
    default:
      break
  }
}

export function isOnOfficeFloor(person: OfficeRosterPerson): boolean {
  return person.lifecycle !== 'retired'
    && person.presence !== 'archived'
    && person.presence !== 'deleted'
}

export function isOfficeWorkspaceSleeping(
  lastInteractionAt: number,
  now = Date.now(),
  sleepAfterMs = OFFICE_CONFIG.workspaceSleepAfterMs,
): boolean {
  return lastInteractionAt <= 0 || now - lastInteractionAt >= sleepAfterMs
}

export function officeHarnessForTemplate(template: string): OfficeHarness {
  if (template === 'chat') return 'chat'
  if (template === 'auto-quant-v2') return 'auto-quant'
  if (template === 'auto-prediction') return 'prediction'
  return 'other'
}

/** Chat, Quant, Prediction, then everyone else. Stable id tie-break. */
export function compareOfficeRooms(
  a: { readonly tag: string; readonly id: string },
  b: { readonly tag: string; readonly id: string },
): number {
  const rank = (tag: string): number => {
    if (tag === 'chat') return 0
    if (tag === 'auto-quant') return 1
    if (tag === 'prediction') return 2
    return 3
  }
  const byKind = rank(a.tag) - rank(b.tag)
  return byKind !== 0 ? byKind : a.id.localeCompare(b.id)
}

export function projectOfficeFloor(
  workspaceId: string,
  roster: readonly OfficeRosterPerson[],
  events: readonly AgentRuntimeEvent[],
  now = Date.now(),
): OfficeFloor {
  const present = roster.filter(isOnOfficeFloor)
  const byResume = new Map<string, MutableEmployee>()
  for (const event of events) {
    const payload = payloadOf(event)
    if (payload.workspaceId !== workspaceId) continue
    const resumeId = payload.resumeId
    if (!resumeId) continue
    const current = byResume.get(resumeId) ?? {
      mood: 'idle' as const,
      bubble: null,
      lastSeq: 0,
      lastTs: 0,
    }
    applyEvent(current, event, now)
    byResume.set(resumeId, current)
  }

  const employees = present.map((person) => {
      const live = byResume.get(person.resumeId)
      const lastInteractionAt = Math.max(person.lastInteractionAt, live?.lastTs ?? 0)
      return {
        resumeId: person.resumeId,
        agent: person.agent,
        name: person.name,
        ...(person.title ? { title: person.title } : {}),
        ...(person.displayName ? { displayName: person.displayName } : {}),
        ...(person.sessionRecordId ? { sessionRecordId: person.sessionRecordId } : {}),
        mood: live?.mood ?? 'idle',
        ...(live?.surface ? { surface: live.surface } : {}),
        bubble: live?.bubble ?? null,
        lastSeq: live?.lastSeq ?? 0,
        lastInteractionAt,
        drawers: [],
      }
    })
  const lastInteractionAt = employees.reduce(
    (latest, employee) => Math.max(latest, employee.lastInteractionAt),
    0,
  )
  return {
    workspaceId,
    lastInteractionAt,
    sleeping: isOfficeWorkspaceSleeping(lastInteractionAt, now),
    employees,
  }
}

export function eventsThroughSeq(
  events: readonly AgentRuntimeEvent[],
  asOfSeq: number,
): AgentRuntimeEvent[] {
  return events.filter((event) => event.seq <= asOfSeq)
}

export function officeProjectionNow(
  events: readonly AgentRuntimeEvent[],
  asOfSeq: number | undefined,
  lastSeq: number,
  wallNow = Date.now(),
): number {
  if (asOfSeq == null || asOfSeq >= lastSeq) return wallNow
  let ts = wallNow
  for (const event of events) {
    if (event.seq <= asOfSeq) ts = event.ts
  }
  return ts
}

function drawerBelongsToOffice(record: ProvenanceRecord, workspaceId: string): boolean {
  const { artifact, origin } = record
  if (artifact.kind === 'report' || artifact.kind === 'issue') {
    return artifact.workspaceId === workspaceId
  }
  return origin.kind === 'session' && origin.workspaceId === workspaceId
}

function drawerLabel(record: ProvenanceRecord): string {
  const { artifact } = record
  if (artifact.kind === 'report') {
    return artifact.path.split('/').filter(Boolean).pop() ?? artifact.path
  }
  if (artifact.kind === 'issue') return artifact.issueId
  if (artifact.kind === 'inbox') return artifact.inboxEntryId
  return artifact.decisionId
}

export function projectOfficeDrawers(
  workspaceId: string,
  resumeId: string,
  records: readonly ProvenanceRecord[],
  limit = OFFICE_DRAWER_LIMIT,
): OfficeDrawerItem[] {
  const items: OfficeDrawerItem[] = []
  for (const record of records) {
    if (items.length >= limit) break
    if (!drawerBelongsToOffice(record, workspaceId)) continue
    if (record.origin.kind === 'session' && record.origin.resumeId !== resumeId) continue
    if (record.origin.kind !== 'session') continue
    const { artifact } = record
    items.push({
      id: record.id,
      kind: artifact.kind,
      action: record.action,
      at: record.at,
      label: drawerLabel(record),
      ...(artifact.kind === 'report' ? { path: artifact.path } : {}),
      ...(artifact.kind === 'issue' ? { issueId: artifact.issueId } : {}),
      ...(artifact.kind === 'inbox' ? { inboxEntryId: artifact.inboxEntryId } : {}),
    })
  }
  return items
}
