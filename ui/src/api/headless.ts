import { fetchJson } from './client'

export type HeadlessTaskStatus = 'running' | 'done' | 'failed' | 'interrupted'

export interface HeadlessTaskRecord {
  taskId: string
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
  /** The agent CLI's own session id, captured from the run's stdout — when
   *  present (and the run is finished) the run can be reopened as a normal
   *  interactive session via spawn { resume: agentSessionId }. */
  agentSessionId?: string
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
  stdout: HeadlessOutputStream | null
  stderr: HeadlessOutputStream | null
}

export const headlessApi = {
  /** List headless runs across all workspaces, newest-first. */
  async list(
    opts: { wsId?: string; status?: HeadlessTaskStatus; limit?: number } = {},
  ): Promise<HeadlessTaskRecord[]> {
    const q = new URLSearchParams()
    if (opts.wsId) q.set('wsId', opts.wsId)
    if (opts.status) q.set('status', opts.status)
    if (opts.limit) q.set('limit', String(opts.limit))
    const qs = q.toString()
    const { tasks } = await fetchJson<{ tasks: HeadlessTaskRecord[] }>(
      `/api/headless${qs ? `?${qs}` : ''}`,
    )
    return tasks
  },

  /** Tail of a run's on-disk stdout/stderr log (poll while running). */
  async output(taskId: string, opts: { tailBytes?: number } = {}): Promise<HeadlessOutput> {
    const q = opts.tailBytes ? `?tailBytes=${opts.tailBytes}` : ''
    return fetchJson<HeadlessOutput>(`/api/headless/${taskId}/output${q}`)
  },
}
