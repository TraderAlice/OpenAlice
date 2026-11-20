import { fetchJson } from './client'
import type { IssueTimeout } from './issues'
import type { ModelReasoningEffort } from './types'

export type ScheduleWhen =
  | { kind: 'at'; at: string }
  | { kind: 'every'; every: string }
  | { kind: 'cron'; cron: string; timezone?: string; catchUp?: boolean }

export interface ScheduleSkipState {
  /** 'deferred' = temporary cooldown or capped backoff (will retry at retryAtMs);
   *  'parked'   = structural/permanent blocker (paused until issue/session/config changes). */
  kind: 'deferred' | 'parked'
  /** Stable machine-readable skip code (e.g. 'session_blocked', 'not_ready', 'retired', 'deleted', 'workspace_unavailable', 'no_headless', 'unknown'). */
  code: string
  /** Human-readable reason from the last dispatch failure. */
  reason: string
  /** Epoch ms when the scanner will next attempt dispatch (present when kind === 'deferred'). */
  retryAtMs?: number
  /** Epoch ms when this skip state was first recorded for the current streak. */
  sinceMs: number
}

export interface ScheduleTask {
  id: string
  /** Short title of the issue this entry is about — the human-facing label. */
  issue: string
  when: ScheduleWhen
  what: string
  agent?: string
  credential?: string
  credentialSource?: 'native'
  model?: string
  effort?: ModelReasoningEffort
  timeout?: IssueTimeout
  assignee: string
  enabled: boolean
  /** When the scanner last fired this task (epoch ms), null if never. */
  lastFiredAtMs: number | null
  /** When it is next due (epoch ms), null if the schedule yields no future fire. */
  nextDueAtMs: number | null
  /** Present when the scanner's dispatch gate is deferring or parking this scheduled issue. */
  skipState?: ScheduleSkipState
}

export type ScheduleSnapshotTask = ScheduleTask

export interface ScheduleWorkspace {
  wsId: string
  tag: string
  /** 'absent' = no schedule file; 'invalid' = present but unreadable/malformed. */
  status: 'ok' | 'absent' | 'invalid'
  error?: string
  tasks: ScheduleTask[]
}

export type ScheduleSnapshotWorkspace = ScheduleWorkspace

export interface ScheduleSnapshot {
  workspaces: ScheduleWorkspace[]
}

export const scheduleApi = {
  /** Read-only dashboard: every workspace's declared schedule + last/next-due. */
  async get(): Promise<ScheduleSnapshot> {
    return fetchJson<ScheduleSnapshot>('/api/schedule')
  },
}
