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
  surface?: AgentRuntimeSurface
  bubble: OfficeBubble | null
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

export const officeApi = {
  async floor(opts?: { workspaceId?: string; asOfSeq?: number }): Promise<OfficeBuildingSnapshot> {
    const params = new URLSearchParams()
    if (opts?.workspaceId) params.set('workspaceId', opts.workspaceId)
    if (opts?.asOfSeq != null) params.set('asOfSeq', String(opts.asOfSeq))
    const query = params.toString()
    return fetchJson<OfficeBuildingSnapshot>(`/api/office/floor${query ? `?${query}` : ''}`)
  },
}
