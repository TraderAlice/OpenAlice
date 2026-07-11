import { fetchJson } from './client'

export type HeadlessTaskStatus = 'running' | 'done' | 'failed' | 'interrupted'

export interface HeadlessTaskRecord {
  taskId: string
  /** Stable product conversation identity shared by every resumed turn. */
  resumeId: string
  /** Direct execution lineage within this resumable conversation. */
  parentTaskId?: string
  wsId: string
  /** The workspace ISSUE that fired this run (the issue filename stem), when it
   *  was dispatched by the scheduler from a scheduled `.alice/issues/<id>.md`.
   *  Absent on manual/external dispatches and on runs predating the field. This
   *  is the run↔issue link the issue detail's Activity feed joins on. */
  issueId?: string
  agent: string
  prompt: string
  status: HeadlessTaskStatus
  startedAt: number
  finishedAt?: number
  durationMs?: number
  exitCode?: number | null
  signal?: string | null
  killed?: boolean
  error?: string
  /** Backend has resolved this product identity to a native runtime session. */
  resumable: boolean
  output?: {
    hasAssistantReply: boolean
    assistantPreview?: string
    blockCount: number
    toolCalls: number
    toolFailures: number
  }
}

export type HeadlessToolStatus = 'running' | 'completed' | 'failed'

export type HeadlessMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; status: HeadlessToolStatus; input?: unknown; output?: unknown }
  | { type: 'error'; message: string }

export interface HeadlessStructuredOutput {
  schemaVersion: 1
  assistantText: string | null
  blocks: HeadlessMessageBlock[]
  metrics: { textBlocks: number; toolCalls: number; toolFailures: number }
  truncated: boolean
}

export interface HeadlessListSnapshot {
  tasks: HeadlessTaskRecord[]
  page: { total: number; hasMore: boolean; nextCursor: string | null }
  summary: { done: number; needsAttention: number }
  capacity: { running: number; limit: number }
}

/** One stream's tail from GET /api/headless/:taskId/output. */
export interface HeadlessOutputStream {
  text: string
  sizeBytes: number
  truncated: boolean
}

export interface HeadlessOutput {
  taskId: string
  status: HeadlessTaskStatus
  structured: HeadlessStructuredOutput
  stdout: HeadlessOutputStream | null
  stderr: HeadlessOutputStream | null
}

export const headlessApi = {
  async snapshot(
    opts: { wsId?: string; status?: HeadlessTaskStatus; limit?: number; cursor?: string } = {},
  ): Promise<HeadlessListSnapshot> {
    const q = new URLSearchParams()
    if (opts.wsId) q.set('wsId', opts.wsId)
    if (opts.status) q.set('status', opts.status)
    if (opts.limit) q.set('limit', String(opts.limit))
    if (opts.cursor) q.set('cursor', opts.cursor)
    const qs = q.toString()
    return fetchJson<HeadlessListSnapshot>(`/api/headless${qs ? `?${qs}` : ''}`)
  },

  /** List headless runs across all workspaces, newest-first. */
  async list(
    opts: { wsId?: string; status?: HeadlessTaskStatus; limit?: number; cursor?: string } = {},
  ): Promise<HeadlessTaskRecord[]> {
    return (await this.snapshot(opts)).tasks
  },

  /** Resolve legacy task provenance to its product conversation identity. */
  async get(taskId: string): Promise<HeadlessTaskRecord> {
    return fetchJson<HeadlessTaskRecord>(`/api/headless/${encodeURIComponent(taskId)}`)
  },

  /** Tail of a run's on-disk stdout/stderr log (poll while running). */
  async output(taskId: string, opts: { tailBytes?: number } = {}): Promise<HeadlessOutput> {
    const q = opts.tailBytes ? `?tailBytes=${opts.tailBytes}` : ''
    return fetchJson<HeadlessOutput>(`/api/headless/${taskId}/output${q}`)
  },
}
