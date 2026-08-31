import { fetchJson } from './client'
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
}
