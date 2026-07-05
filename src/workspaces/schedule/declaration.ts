/**
 * Schedule snapshot machinery — the read-only view GET /api/schedule returns,
 * built from a workspace's SCHEDULED issues.
 *
 * The data model itself now lives in `../issues/declaration.ts`: each workspace
 * declares issues as one markdown file per issue under `.alice/issues/`. An issue
 * that carries a `when` self-schedules exactly like the old schedule task; an
 * issue without `when` is a pure board work item and never reaches this layer.
 * This module is just the scheduling projection of those scheduled issues — it
 * pairs each one's `when` with the scanner's last-fired marker and the computed
 * next-due, so the dashboard matches real firing behavior.
 *
 * The issue reader (`readWorkspaceIssues`) is re-exported here so the scanner and
 * the route layer can import everything scheduling-related from one place.
 */

import { computeNextRun, type Schedule } from '../../core/schedule-expr.js'
import {
  isFireable,
  isTerminalStatus,
  issueFirePrompt,
  readWorkspaceIssues,
  type IssueRecord,
} from '../issues/declaration.js'

export {
  isFireable,
  isTerminalStatus,
  issueFirePrompt,
  readWorkspaceIssues,
  type IssueRecord,
  type ReadIssuesResult,
} from '../issues/declaration.js'

// ==================== Dashboard snapshot ====================
// The read-only shape GET /api/schedule returns: each workspace's SCHEDULED
// issues enriched with the scanner's last-fired marker and the computed next-due.

export interface ScheduleSnapshotTask {
  /** Issue id (filename stem). */
  id: string
  /** Issue title — what the dashboard shows. */
  issue: string
  when: Schedule
  /** The prompt this fire hands to the headless run (resolved `what`/title+body). */
  what: string
  agent?: string
  /** False once the owning issue reaches a terminal status (done/canceled). */
  enabled: boolean
  /** When the scanner last fired this issue (epoch ms), null if never. */
  lastFiredAtMs: number | null
  /** When it is next due (epoch ms), null if the schedule yields no future fire. */
  nextDueAtMs: number | null
}

export interface ScheduleSnapshotWorkspace {
  wsId: string
  tag: string
  /** 'absent' = no issues dir; 'invalid' = unreadable (e.g. legacy issue.json). */
  status: 'ok' | 'absent' | 'invalid'
  error?: string
  tasks: ScheduleSnapshotTask[]
}

export interface ScheduleSnapshot {
  workspaces: ScheduleSnapshotWorkspace[]
}

/** The base timestamp for due-ness: the last fire, or a synthetic never-fired
 *  baseline. `every`/`at` seed from epoch (so they're due on first sight).
 *  `cron` looks back one scan interval — seeding a never-fired cron from `now`
 *  would make it NEVER due (computeNextRun is always strictly future), and
 *  seeding from epoch would fire it immediately; the lookback catches an
 *  occurrence that just passed without firing a stale backlog. */
export function fireBase(
  when: Schedule,
  lastFiredAtMs: number | null,
  nowMs: number,
  lookbackMs: number,
): number {
  if (lastFiredAtMs !== null) return lastFiredAtMs
  return when.kind === 'cron' ? nowMs - lookbackMs : 0
}

/** Build a dashboard row for a SCHEDULED issue: its `when` + last-fired marker +
 *  computed next-due (same base-seed as the scanner's due-ness, so the dashboard
 *  matches real firing). Caller must pass an issue that has a `when`. */
export function snapshotScheduledIssue(
  issue: IssueRecord,
  when: Schedule,
  lastFiredAtMs: number | null,
  nowMs: number,
  lookbackMs: number,
): ScheduleSnapshotTask {
  const next = computeNextRun(when, fireBase(when, lastFiredAtMs, nowMs, lookbackMs))
  return {
    id: issue.id,
    issue: issue.title,
    when,
    what: issueFirePrompt(issue),
    ...(issue.agent ? { agent: issue.agent } : {}),
    enabled: !isTerminalStatus(issue.status),
    lastFiredAtMs,
    // An overdue computed time clamps to now: a due-now task reads "due now",
    // never a past/epoch instant — keeps the display consistent with firing.
    nextDueAtMs: next === null ? null : Math.max(next, nowMs),
  }
}
