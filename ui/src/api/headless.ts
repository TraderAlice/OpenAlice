import { fetchJson } from './client'

export type HeadlessTaskStatus = 'running' | 'done' | 'failed' | 'interrupted'

export interface HeadlessTaskRecord {
  taskId: string
  wsId: string
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
}
