import { fetchJson } from './client'
import type { IssueExecution } from './issues'

export type ScheduleWhen =
  | { kind: 'at'; at: string }
  | { kind: 'every'; every: string }
  | { kind: 'cron'; cron: string }

export interface ScheduleTask {
  id: string
  /** Short title of the issue this entry is about — the human-facing label. */
  issue: string
  when: ScheduleWhen
  what: string
  agent?: string
  execution?: IssueExecution
  enabled: boolean
  /** When the scanner last fired this task (epoch ms), null if never. */
  lastFiredAtMs: number | null
  /** When it is next due (epoch ms), null if the schedule yields no future fire. */
  nextDueAtMs: number | null
}

export interface ScheduleWorkspace {
  wsId: string
  tag: string
  /** 'absent' = no schedule file; 'invalid' = present but unreadable/malformed. */
  status: 'ok' | 'absent' | 'invalid'
  error?: string
  tasks: ScheduleTask[]
}

export interface ScheduleSnapshot {
  workspaces: ScheduleWorkspace[]
}

export const scheduleApi = {
  /** Read-only dashboard: every workspace's declared schedule + last/next-due. */
  async get(): Promise<ScheduleSnapshot> {
    return fetchJson<ScheduleSnapshot>('/api/schedule')
  },
}
