/**
 * Issue board snapshot — the read-only shape GET /api/issues returns, built by
 * SCANNING every workspace's `.alice/issues/` directory (never a central store).
 *
 * This is the board PROJECTION of the issue data model in `./declaration.ts`,
 * sibling to the scheduling projection in `../schedule/declaration.ts`. The board
 * shows ALL issues (scheduled or not); a scheduled issue additionally carries its
 * firing markers (`lastFiredAtMs` / `nextDueAtMs`) so the row matches real firing.
 *
 * Phase 1 is read-only and the list view does NOT include the markdown body — the
 * Phase 2 detail view loads it. Keeping the body out keeps the poll payload small.
 */

import type { InboxEntry } from '../../core/inbox-store.js'
import type { Schedule } from '../../core/schedule-expr.js'
import type {
  HeadlessTaskOutputSummary,
  HeadlessTaskRecord,
  HeadlessTaskStatus,
} from '../headless-task-registry.js'
import { issueExecution, type IssueExecution, type IssuePriority, type IssueRecord, type IssueStatus } from './declaration.js'

/** One board row: the issue's display fields, plus — iff it self-schedules — its
 *  `when` and the scanner's firing markers. No markdown body (Phase 2 loads it). */
export interface IssuesSnapshotIssue {
  id: string
  title: string
  status: IssueStatus
  priority: IssuePriority
  assignee: string
  /** Adapter id for the scheduled fire (frontmatter `agent`), if set. */
  agent?: string
  /** Effective scheduled owner policy. */
  execution: IssueExecution
  /** Present iff the issue self-schedules. */
  when?: Schedule
  /** When the scanner last fired this issue (epoch ms); only for scheduled issues. */
  lastFiredAtMs?: number | null
  /** When it is next due (epoch ms); only for scheduled issues. */
  nextDueAtMs?: number | null
  /** True iff this issue's NAME (title, case-insensitive) is also used by an
   *  issue in a DIFFERENT workspace. A name is a global team object, so a clash
   *  across workspaces is ambiguous and the UI warns on it. DETECTION ONLY — we
   *  never lint/reject duplicate names at write time; access stays wsId-precise.
   *  Computed by {@link annotateNameCollisions}; absent ⇒ unique. */
  nameCollision?: boolean
}

export interface IssuesSnapshotWorkspace {
  wsId: string
  tag: string
  /** 'invalid' = the issues dir was unreadable (e.g. a retired `.alice/issue.json`).
   *  A workspace with no issues dir is 'ok' with an empty list — absence is not an
   *  error on the board (it simply contributes no rows). */
  status: 'ok' | 'invalid'
  error?: string
  issues: IssuesSnapshotIssue[]
}

export interface IssuesSnapshot {
  workspaces: IssuesSnapshotWorkspace[]
  /** Display titles (first-seen casing) that occur in MORE THAN ONE workspace —
   *  the cross-workspace name clashes the board warns about. Empty when every
   *  name is globally unique. See {@link annotateNameCollisions}. */
  duplicateNames: string[]
}

/**
 * Detect issue NAMES (title, case-insensitive) that occur across MORE THAN ONE
 * workspace, mark each colliding board row `nameCollision: true` in place, and
 * return the list of colliding display titles (first-seen casing). Two issues
 * sharing a name WITHIN a single workspace are NOT a collision — the model is "a
 * name is a global team object; a clash is two workspaces both claiming it". The
 * scan already loaded every issue, so this is cheap.
 *
 * DETECTION ONLY: nothing here (or anywhere) rejects a duplicate name at write
 * time. The user resolves clashes manually; meanwhile access stays wsId-precise
 * (board rows + the detail route both carry wsId).
 */
export function annotateNameCollisions(workspaces: IssuesSnapshotWorkspace[]): string[] {
  const nameKey = (title: string): string => title.trim().toLowerCase()
  const seen = new Map<string, { wsIds: Set<string>; display: string }>()
  for (const ws of workspaces) {
    for (const issue of ws.issues) {
      const key = nameKey(issue.title)
      if (!key) continue
      const entry = seen.get(key)
      if (entry) entry.wsIds.add(ws.wsId)
      else seen.set(key, { wsIds: new Set([ws.wsId]), display: issue.title.trim() })
    }
  }
  const colliding = new Set<string>()
  const duplicateNames: string[] = []
  for (const [key, entry] of seen) {
    if (entry.wsIds.size > 1) {
      colliding.add(key)
      duplicateNames.push(entry.display)
    }
  }
  if (colliding.size > 0) {
    for (const ws of workspaces) {
      for (const issue of ws.issues) {
        if (colliding.has(nameKey(issue.title))) issue.nameCollision = true
      }
    }
  }
  return duplicateNames
}

// ==================== Flattened board rows (CLI / agent surface) ====================
// The `alice-workspace issue list` (issue_list) agent surface wants the board as
// ONE flat list of title rows tagged with their owning workspace — not the
// per-workspace tree GET /api/issues returns. Each row keeps the snapshot's
// display fields, replaces `when` with a plain `scheduled` boolean, and carries
// the workspace handle so the agent can scan titles globally then drill into one
// with issue_show. Pure projection — easy to unit-test without a service.

/** One flattened global-board row: an issue's display fields + the owning
 *  workspace handle (wsId precise, tag human). `scheduled` collapses the
 *  snapshot's `when`; `nameCollision` rides through iff the title clashes
 *  across workspaces. */
export interface BoardRow {
  id: string
  title: string
  status: IssueStatus
  priority: IssuePriority
  assignee: string
  /** Adapter id for the scheduled fire override, if set. */
  agent?: string
  /** Effective scheduled owner policy. */
  execution?: IssueExecution
  /** True iff the issue self-schedules (snapshot `when` present). */
  scheduled: boolean
  workspace: { wsId: string; tag: string }
  /** Present (true) iff this title clashes across workspaces — carried from
   *  the snapshot's `annotateNameCollisions`. Absent ⇒ unique. */
  nameCollision?: boolean
}

/** A workspace whose `.alice/issues/` dir was unreadable — surfaced rather than
 *  silently dropped, so a broken peer is visible on the agent's board. */
export interface BoardInvalidWorkspace {
  wsId: string
  tag: string
  error?: string
}

/** Flatten an {@link IssuesSnapshot} into the global board the issue_list tool
 *  returns: every workspace's issues as one tagged row list, plus the workspaces
 *  whose issues dir failed to read. Pure — no I/O, no service. */
export function flattenBoardRows(snapshot: IssuesSnapshot): {
  rows: BoardRow[]
  invalid: BoardInvalidWorkspace[]
} {
  const rows: BoardRow[] = []
  const invalid: BoardInvalidWorkspace[] = []
  for (const ws of snapshot.workspaces) {
    if (ws.status === 'invalid') {
      invalid.push({ wsId: ws.wsId, tag: ws.tag, ...(ws.error ? { error: ws.error } : {}) })
      continue
    }
    for (const issue of ws.issues) {
      rows.push({
        id: issue.id,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        assignee: issue.assignee,
        ...(issue.agent ? { agent: issue.agent } : {}),
        execution: issue.execution,
        scheduled: issue.when !== undefined,
        workspace: { wsId: ws.wsId, tag: ws.tag },
        ...(issue.nameCollision ? { nameCollision: true } : {}),
      })
    }
  }
  return { rows, invalid }
}

/** One issue reference returned by the `[[name]]` resolver — enough to render a
 *  disambiguation candidate and navigate to its wsId-precise detail route
 *  (`/issues/:wsId/:id`). `wsTag` is the human label; `wsId` is the precise key. */
export interface WikilinkIssueRef {
  wsId: string
  wsTag: string
  id: string
  title: string
}

/** The firing markers a scheduled issue carries on the board. Computed by the
 *  caller (from the scanner's marker store + `snapshotScheduledIssue`) so the
 *  board's last/next match the schedule dashboard exactly. */
export interface IssueFiringMarkers {
  lastFiredAtMs: number | null
  nextDueAtMs: number | null
}

// ==================== Detail (Phase 2a) ====================
// The read-only shape GET /api/issues/:wsId/:id returns: one issue's full
// fields INCLUDING the markdown body and (iff scheduled) its firing markers +
// scheduling frontmatter, plus that issue's headless run history (its Activity
// feed). Unlike the board list, the detail loads the body and the runs.

/** One issue's full detail fields: the board row's fields + the markdown body +
 *  the scheduling frontmatter (`what`/`agent`). Markers are present iff scheduled. */
export interface IssueDetailIssue {
  id: string
  title: string
  /** Markdown description body (the list view omits this; the detail loads it). */
  body: string
  status: IssueStatus
  priority: IssuePriority
  assignee: string
  /** Present iff the issue self-schedules. */
  when?: Schedule
  /** Scheduled fire prompt override (frontmatter `what`), if set. */
  what?: string
  /** Adapter id for the scheduled fire (frontmatter `agent`), if set. */
  agent?: string
  /** Effective policy; legacy files project as fresh. */
  execution: IssueExecution
  /** When the scanner last fired this issue (epoch ms); only for scheduled issues. */
  lastFiredAtMs?: number | null
  /** When it is next due (epoch ms); only for scheduled issues. */
  nextDueAtMs?: number | null
}

/** GET /api/issues/:wsId/:id — one issue + its run history (Activity feed) +
 *  the inbox reports it produced. */
export interface IssueDetail {
  issue: IssueDetailIssue
  /** This issue's headless runs (wsId + issueId match), newest first.
   *  Runtime-native session ids are deliberately not part of this projection. */
  runs: IssueRunRecord[]
  /** Inbox reports this issue produced — entries whose server-stamped
   *  `origin.issueId` is this issue, newest-first. The issue→inbox direction of
   *  the cross-link (`runs` is the run→issue one). */
  inboxReports: InboxEntry[]
}

/** Agent/UI-safe projection of one execution. `resumeId` is the only public
 * conversation handle; adapter-native session ids stay in ResumeRegistry. */
export interface IssueRunRecord {
  taskId: string
  resumeId: string
  parentTaskId?: string
  wsId: string
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
  output?: HeadlessTaskOutputSummary
  /** Whether OpenAlice currently has a native runtime mapping for resumeId. */
  resumable: boolean
}

/** Explicit whitelist: do not spread HeadlessTaskRecord here. Old registry
 * records may contain adapter-specific compatibility fields. */
export function issueRunRecord(task: HeadlessTaskRecord, resumable: boolean): IssueRunRecord {
  return {
    taskId: task.taskId,
    resumeId: task.resumeId,
    ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
    wsId: task.wsId,
    ...(task.issueId ? { issueId: task.issueId } : {}),
    agent: task.agent,
    prompt: task.prompt,
    status: task.status,
    startedAt: task.startedAt,
    ...(task.finishedAt !== undefined ? { finishedAt: task.finishedAt } : {}),
    ...(task.durationMs !== undefined ? { durationMs: task.durationMs } : {}),
    ...(task.exitCode !== undefined ? { exitCode: task.exitCode } : {}),
    ...(task.signal !== undefined ? { signal: task.signal } : {}),
    ...(task.killed !== undefined ? { killed: task.killed } : {}),
    ...(task.error !== undefined ? { error: task.error } : {}),
    ...(task.output !== undefined ? { output: task.output } : {}),
    resumable,
  }
}

/** Filter a workspace's inbox entries to the ones a given issue produced
 *  (`origin.issueId` match). Pure + order-preserving, so the caller's
 *  newest-first read order carries through. The issue→inbox join, kept in the
 *  domain (not the HTTP route) so every surface — CLI, MCP — gets it. */
export function inboxReportsForIssue(entries: readonly InboxEntry[], issueId: string): InboxEntry[] {
  return entries.filter((e) => e.origin?.issueId === issueId)
}

/** A missing assignee in a workspace-owned issue means "this workspace owns it".
 *  Keep an explicit `assignee: unassigned` as unassigned so human edits survive. */
export function issueAssigneeForWorkspace(issue: IssueRecord, workspaceTag?: string): string {
  return issue.assigneeDefaulted && workspaceTag ? `ws:${workspaceTag}` : issue.assignee
}

/** Map a validated issue (+ its firing markers, iff scheduled) to the detail
 *  issue shape. Keeps the body and the scheduling frontmatter the board drops. */
export function detailIssue(
  issue: IssueRecord,
  markers: IssueFiringMarkers | null,
  workspaceTag?: string,
): IssueDetailIssue {
  return {
    id: issue.id,
    title: issue.title,
    body: issue.body,
    status: issue.status,
    priority: issue.priority,
    assignee: issueAssigneeForWorkspace(issue, workspaceTag),
    ...(issue.when ? { when: issue.when } : {}),
    ...(issue.what ? { what: issue.what } : {}),
    ...(issue.agent ? { agent: issue.agent } : {}),
    execution: issueExecution(issue),
    ...(markers ? { lastFiredAtMs: markers.lastFiredAtMs, nextDueAtMs: markers.nextDueAtMs } : {}),
  }
}

/** Map one validated issue (+ its firing markers, iff scheduled) to a board row.
 *  Pure: the caller resolves `markers` for scheduled issues and passes `null` for
 *  pure board work items. The markdown body is intentionally dropped. */
export function snapshotBoardIssue(
  issue: IssueRecord,
  markers: IssueFiringMarkers | null,
  workspaceTag?: string,
): IssuesSnapshotIssue {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assignee: issueAssigneeForWorkspace(issue, workspaceTag),
    ...(issue.agent ? { agent: issue.agent } : {}),
    execution: issueExecution(issue),
    ...(issue.when ? { when: issue.when } : {}),
    ...(markers ? { lastFiredAtMs: markers.lastFiredAtMs, nextDueAtMs: markers.nextDueAtMs } : {}),
  }
}
