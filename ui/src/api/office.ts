import { fetchJson, headers } from './client'
import type { AgentRuntimeSurface } from './agentRuntimeLog'

export type OfficeEmployeeMood =
  | 'idle'
  | 'working'
  | 'talking'
  | 'waiting'
  | 'review'
  | 'failed'

export type OfficeHarness = 'chat' | 'auto-quant' | 'prediction' | 'other'

export type OfficeBubble =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'error'; text: string }
  | { kind: 'rejected' }

export type OfficeDrawerKind = 'report' | 'issue' | 'inbox' | 'trade-decision'

export interface OfficeDrawerItem {
  id: string
  kind: OfficeDrawerKind
  action: string
  at: number
  label: string
  path?: string
  issueId?: string
  inboxEntryId?: string
}

export interface OfficeFloorEmployee {
  resumeId: string
  agent: string
  name: string
  title?: string
  displayName?: string
  sessionRecordId?: string
  mood: OfficeEmployeeMood
  awake: boolean
  surface?: AgentRuntimeSurface
  bubble: OfficeBubble | null
  latestResult?: {
    text: string
    at: number
  }
  lastSeq: number
  lastInteractionAt: number
  drawers: OfficeDrawerItem[]
}

export interface OfficeRoomSnapshot {
  workspace: { id: string; tag: string; harness: OfficeHarness }
  lastInteractionAt: number
  sleeping: boolean
  employees: OfficeFloorEmployee[]
}

export interface OfficeBuildingSnapshot {
  config: {
    workspaceSleepAfterMs: number
    harnessMinimumVisibleGroups: Record<OfficeHarness, number>
  }
  offices: OfficeRoomSnapshot[]
  lastSeq: number
  firstSeq: number
  asOfSeq?: number
}

/**
 * One exact routine report deliberately carried from the evidence patrol into
 * Office's later decision phase. This is a diligence fact, not an Issue
 * mutation: persisting it must never dispatch Agent work.
 */
export interface OfficeRoutineFollowUp {
  inboxEntryId: string
  reportTs: number
  issueWorkspaceId: string
  issueId: string
  createdAt: number
}

export interface OfficeRoutineFollowUpsResponse {
  followUps: OfficeRoutineFollowUp[]
}

export interface OfficeRoutineFollowUpPutResponse {
  followUp: OfficeRoutineFollowUp
  created: boolean
}

export interface OfficeRoutineFollowUpDeleteResponse {
  ok: true
  removed: boolean
}

export interface OfficeDayEvidenceReceipt {
  subjectKey: string
  fingerprint: string
  reviewedAt: number
}

export interface OfficeDayShiftSnapshot {
  id: number
  openedAt: number
  /** Exact duty keys frozen into this finite shift. */
  slots: string[]
  /** Pending exact duty keys. Later only rotates this list. */
  order: string[]
  cleared: boolean
}

export interface OfficeDayRecord {
  dayKey: string
  timeZone: string
  openedAt: number
  updatedAt: number
  shift: OfficeDayShiftSnapshot
  /** Exact duty keys admitted by any shift during this day; server-owned and append-only. */
  seenDutyIds: string[]
  evidenceReceipts: OfficeDayEvidenceReceipt[]
}

/** Server-clock envelope shared by every renderer of one AliceProject. */
export interface OfficeDayEnvelope {
  serverNow: number
  dayKey: string
  timeZone: string
  nextRolloverAt: number
  revision: number
  day: OfficeDayRecord | null
}

export type OfficeDayMutationReason =
  | 'stale-day'
  | 'stale-shift'
  | 'no-change'
  | 'duty-not-pending'
  | 'shift-not-complete'

export interface OfficeDayMutationResponse extends OfficeDayEnvelope {
  applied: boolean
  reason?: OfficeDayMutationReason
}

export type OfficeDayCommand =
  | {
      type: 'reconcile-shift'
      dayKey: string
      shiftId: number
      presentSlotIds: string[]
      proposedSlots: string[]
      unresolvedCount: number
    }
  | {
      type: 'defer-duty'
      dayKey: string
      shiftId: number
      dutyId: string
    }
  | {
      type: 'start-next-shift'
      dayKey: string
      shiftId: number
      slots: string[]
    }
  | {
      type: 'review-evidence'
      dayKey: string
      shiftId: number
      dutyId: string
      subjectKey: string
      fingerprint: string
    }
  | {
      type: 'forget-evidence'
      dayKey: string
      subjectKey: string
    }

export const officeApi = {
  async floor(opts?: { workspaceId?: string; asOfSeq?: number }): Promise<OfficeBuildingSnapshot> {
    const params = new URLSearchParams()
    if (opts?.workspaceId) params.set('workspaceId', opts.workspaceId)
    if (opts?.asOfSeq != null) params.set('asOfSeq', String(opts.asOfSeq))
    const query = params.toString()
    return fetchJson<OfficeBuildingSnapshot>(`/api/office/floor${query ? `?${query}` : ''}`)
  },

  async listRoutineFollowUps(): Promise<OfficeRoutineFollowUpsResponse> {
    return fetchJson('/api/office/routine-follow-ups')
  },

  async carryRoutineFollowUp(
    inboxEntryId: string,
  ): Promise<OfficeRoutineFollowUpPutResponse> {
    return fetchJson(`/api/office/routine-follow-ups/${encodeURIComponent(inboxEntryId)}`, {
      method: 'PUT',
    })
  },

  async resolveRoutineFollowUp(
    inboxEntryId: string,
  ): Promise<OfficeRoutineFollowUpDeleteResponse> {
    return fetchJson(`/api/office/routine-follow-ups/${encodeURIComponent(inboxEntryId)}`, {
      method: 'DELETE',
    })
  },

  async day(): Promise<OfficeDayEnvelope> {
    return fetchJson('/api/office/day')
  },

  async openDay(input: {
    dayKey: string
    slots: string[]
  }): Promise<OfficeDayMutationResponse> {
    return fetchJson('/api/office/day/open', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    })
  },

  async commandDay(command: OfficeDayCommand): Promise<OfficeDayMutationResponse> {
    return fetchJson('/api/office/day/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify(command),
    })
  },
}
