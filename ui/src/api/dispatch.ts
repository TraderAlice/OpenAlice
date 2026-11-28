import { fetchJson, type FetchRequestInit } from './client'
import type { ScheduleSkipState } from './schedule'

export type DispatchTemplateKind = 'commander' | 'chat' | 'auto-quant' | 'prediction' | 'custom'

export interface DispatchLane {
  workspaceId: string
  tag: string
  label: string
  template?: string
  templateKind: DispatchTemplateKind
}

export type DispatchSpanTrigger =
  | {
      kind: 'scheduled-issue'
      workspaceId: string
      issueId: string
      issueTitle?: string
      connectorId?: string
    }
  | {
      kind: 'inquiry'
      subjectKind: 'issue' | 'inbox'
      workspaceId?: string
      issueId?: string
      inboxEntryId?: string
      question: string
    }
  | {
      kind: 'orchestration'
      dispatchId: string
      parentWorkspaceId: string
      parentResumeId: string
    }
  | {
      kind: 'conversation'
      callerKind: 'session' | 'workspace' | 'human'
      callerWorkspaceId?: string
      callerResumeId?: string
    }
  | { kind: 'interactive'; surface: 'terminal' | 'webpi' | 'headless' }
  | { kind: 'manual' }

export type DispatchSpanDelivery =
  | {
      kind: 'connector'
      connectorId: string
      source: 'conversation' | 'automation'
      state: 'pending' | 'accepted' | 'uncertain' | 'closed'
      error?: string
    }
  | {
      kind: 'issue-comment' | 'issue-run'
      workspaceId: string
      issueId: string
    }

export interface DispatchSpan {
  id: string
  kind: 'headless' | 'interactive'
  workspaceId: string
  resumeId: string
  sessionLabel?: string
  agent: string
  model?: string
  status: 'running' | 'done' | 'failed' | 'interrupted'
  startedAt: number
  finishedAt: number | null
  durationMs: number
  trigger: DispatchSpanTrigger
  prompt?: string
  originalPrompt?: string
  assistantPreview?: string
  toolCalls: number
  toolFailures: number
  error?: string
  delivery?: DispatchSpanDelivery
}

export type DispatchEdgeKind =
  | 'dispatch'
  | 'question'
  | 'reply'
  | 'worker_done'
  | 'escalation'
  | 'send'
  | 'conversation'

export interface DispatchDeliverable {
  path: string
  workspaceId?: string
  summary?: string
}

export interface DispatchEdgeMetadata {
  outcome?: 'completed' | 'failed' | 'inconclusive'
  evidence?: string
  deliverables?: readonly DispatchDeliverable[]
  stopReason?: string
  assistantPreview?: string | null
  error?: string
  workerWorkspaceId?: string
  workerAgent?: string
}

export interface DispatchEdge {
  id: string
  kind: DispatchEdgeKind
  messageKind?: 'scheduled_report'
  fromWorkspaceId: string
  fromResumeId?: string
  toWorkspaceId: string
  toResumeId: string
  at: number
  taskId?: string
  dispatchId?: string
  taskStatus?: 'running' | 'waiting_parent' | 'done' | 'failed' | 'stopped'
  turnCount?: number
  deliveryStatus?: 'unread' | 'leased' | 'acked'
  leasedAt?: number
  ackedAt?: number
  subject?: string
  body?: string
  spec?: string
  outcome?: 'completed' | 'failed' | 'inconclusive'
  summary?: string
  evidence?: string
  deliverables?: readonly DispatchDeliverable[]
  stopReason?: string
  metadata?: DispatchEdgeMetadata
  originalPrompt?: string
  deliveredPrompt?: string
  promptMode?: 'plain' | 'reconstruction'
  resolution?: {
    mode: 'exact' | 'reconstructed'
    reason?: string
  }
  assistantText?: string | null
  durationMs?: number
}

export type DispatchArtifact =
  | {
      id: string
      kind: 'inbox'
      entryId: string
      workspaceId: string
      at: number
      title: string
      body: string
      files: readonly string[]
      unread: boolean
      runId?: string
      resumeId?: string
      issueId?: string
    }
  | {
      id: string
      kind: 'report'
      workspaceId: string
      at: number
      path: string
      action: string
      summary?: string
      runId?: string
      resumeId?: string
    }

export interface DispatchScheduleMarker {
  workspaceId: string
  issueId: string
  title: string
  nextDueAtMs: number | null
  lastFiredAtMs: number | null
  skipState?: ScheduleSkipState
}

export interface DispatchBoardSummary {
  activeWorkspaceCount: number
  runningSpanCount: number
  totalSpanCount: number
  edgeCount: number
  artifactCount: number
  errorSpanCount: number
}

export interface DispatchBoardSnapshot {
  fromMs: number
  toMs: number
  generatedAt: number
  lanes: readonly DispatchLane[]
  spans: readonly DispatchSpan[]
  edges: readonly DispatchEdge[]
  artifacts: readonly DispatchArtifact[]
  scheduleMarkers: readonly DispatchScheduleMarker[]
  summary: DispatchBoardSummary
}

export const dispatchApi = {
  get: (opts?: { from?: number; to?: number; priority?: 'high' | 'low' }) => {
    const params = new URLSearchParams()
    if (opts?.from !== undefined) params.set('from', String(Math.floor(opts.from)))
    if (opts?.to !== undefined) params.set('to', String(Math.floor(opts.to)))
    const qs = params.toString()
    const init: FetchRequestInit | undefined = opts?.priority ? { priority: opts.priority } : undefined
    return fetchJson<DispatchBoardSnapshot>(qs ? `/api/dispatch?${qs}` : '/api/dispatch', init)
  },
}
