import { fetchJson, headers } from './client'
import type { Entity } from './entities'
import type { HeadlessTaskRecord } from './headless'
import type { InboxEntry } from './inbox'
import type { ScheduleWhen } from './schedule'
import type { ModelReasoningEffort } from './types'

/**
 * Issue board — the canonical client shape for GET /api/issues.
 *
 * Each workspace owns its issues as one markdown file per issue
 * (`.alice/issues/<id>.md`); the board scans every workspace (like
 * /api/schedule does for the scheduling projection) — there is NO central
 * store. An issue WITH a `when` is scheduled (the scanner fires it as a
 * headless run); an issue WITHOUT `when` is a pure tracked work item.
 *
 * Phase 1 is read-only and the list does NOT carry markdown What — the
 * Phase 2 detail view loads that on demand.
 *
 * Demo handlers MUST import these types (do not inline an ad-hoc shape):
 * demo-shape drift has crashed the app before.
 */

export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'canceled'
export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none'
export type IssueAutomationHealthState =
  | 'inactive'
  | 'not_started'
  | 'due'
  | 'running'
  | 'healthy'
  | 'interrupted'
  | 'failed'
  | 'blocked'

export interface IssueAutomationHealth {
  state: IssueAutomationHealthState
  message: string
  latestTaskId?: string
}
export type IssueProvenanceAction = 'created' | 'updated' | 'commented' | 'sent' | 'decided' | 'reconstructed'
export type IssueProvenanceOrigin =
  | {
      kind: 'session'
      workspaceId: string
      resumeId: string
      agent: string
      execution?:
        | { kind: 'headless'; taskId: string }
        | { kind: 'interactive'; sessionRecordId: string }
    }
  | { kind: 'human' }
  | { kind: 'external'; system: string }
  | { kind: 'unknown'; reason: string }

export interface IssueProvenanceRecord {
  id: string
  action: IssueProvenanceAction
  origin: IssueProvenanceOrigin
  at: number
  mutation?: {
    fields: Array<{ field: string; before?: string; after?: string }>
  }
}

/** Human-facing Issue timeline. Runtime executions stay in `runs`. */
export type IssueActivityRecord =
  | ({ kind: 'change' } & IssueProvenanceRecord)
  | { kind: 'comment'; id: string; at: number; comment: IssueComment }

export type IssueCommentDelivery =
  | { state: 'pending'; targetResumeId: string; taskId: string }
  | { state: 'replied'; targetResumeId: string; taskId: string; replyCommentId: string }
  | { state: 'failed'; targetResumeId: string; taskId?: string; error: string }

export interface IssueComment {
  id: string
  author: string
  at: string
  /** Full markdown payload. Comments deliberately do not share the agent-editable What file. */
  markdown: string
  replyTo?: string
  delivery?: IssueCommentDelivery
}

export type IssueRunFailureKind =
  | 'system_paused'
  | 'launcher_restarted'
  | 'timeout'
  | 'launch_error'
  | 'process_exit'
  | 'runtime_error'

export interface IssueRunFailure {
  kind: IssueRunFailureKind
  title: string
  message: string
  retryable: boolean
}

/** Issue-safe headless projection. Native runtime session ids remain hidden;
 * failure is a read-side explanation derived by the backend. */
export interface IssueRunRecord extends HeadlessTaskRecord {
  issueId?: string
  failure?: IssueRunFailure
}

export interface IssueListItem {
  id: string
  title: string
  status: IssueStatus
  priority: IssuePriority
  /** @workspace | @new | @human | @unassigned | exact @resumeId Session signature. */
  assignee: string
  /** Adapter id for the scheduled fire override, if set. */
  agent?: string
  /** Native model id for the scheduled fire override, if set. */
  model?: string
  /** Native reasoning effort for the scheduled fire override, if set. */
  effort?: ModelReasoningEffort
  /** Present iff the issue is scheduled (shares the core Schedule union). */
  when?: ScheduleWhen
  /** Scanner last-fired marker (epoch ms) — scheduled issues only. */
  lastFiredAtMs?: number | null
  /** Computed next fire (epoch ms) — scheduled issues only. */
  nextDueAtMs?: number | null
  /** Live scheduler/worker health; present iff the Issue has a schedule. */
  automationHealth?: IssueAutomationHealth
  /**
   * True iff this issue's NAME (title, case-insensitive) is also claimed by an
   * issue in a DIFFERENT workspace. A `[[name]]` is a global team object, so a
   * clash across workspaces is ambiguous and the board warns on it. DETECTION
   * ONLY — duplicate names are never linted/rejected at write time; access stays
   * wsId-precise. Absent ⇒ the name is unique.
   */
  nameCollision?: boolean
}

export interface IssueWorkspace {
  wsId: string
  tag: string
  /** 'invalid' = the `.alice/issues/` dir is present but unreadable/legacy. */
  status: 'ok' | 'invalid'
  error?: string
  issues: IssueListItem[]
}

export interface IssueSnapshot {
  workspaces: IssueWorkspace[]
  /**
   * Display titles (first-seen casing) used in MORE THAN ONE workspace — the
   * cross-workspace name clashes the board warns about. Optional on the client
   * (older payloads / the demo fixture may omit it); the board's per-row warning
   * keys off each row's `nameCollision` flag, not this list. Detection only.
   */
  duplicateNames?: string[]
}

// ==================== Wikilink resolver ====================
// GET /api/wikilink/resolve?name=<token> — the cross-namespace `[[name]]`
// resolver. In the `[[]]` graph an issue and an entity are the SAME kind of
// target: a globally-meaningful name. This tells the UI everything a token could
// point at across BOTH namespaces, so a clickable wikilink either navigates
// (unique target) or offers a disambiguation picker (collision). Mirrors the
// server's `createWikilinkRoutes` response.

/** One issue candidate the resolver returns — enough to render a picker entry
 *  and navigate to its wsId-precise detail (`/issues/:wsId/:id`). */
export interface WikilinkIssueRef {
  wsId: string
  wsTag: string
  id: string
  title: string
}

/** Everything a `[[name]]` token resolves to, across both namespaces. A unique
 *  token yields exactly one target (entity XOR a single issue); a colliding
 *  token (entity + issue(s), or >1 issue) yields several, for the UI to
 *  disambiguate by workspace. */
export interface WikilinkResolution {
  /** The token, echoed. */
  name: string
  /** The matching tracked entity (case-insensitive on its `name` key), or null.
   *  Its `name` is the navigation key for the Tracked detail. */
  entity: Entity | null
  /** Every issue (all workspaces) whose id OR title matches the token. */
  issues: WikilinkIssueRef[]
}

// ==================== Detail (Phase 2a) ====================
// GET /api/issues/:wsId/:id — the read-only DETAIL shape: one issue's full
// fields INCLUDING markdown What and (iff scheduled) its firing markers +
// scheduling frontmatter, plus that issue's headless run history (its Activity
// feed). Mirrors the server's `IssueDetail` / `IssueDetailIssue` in
// `src/workspaces/issues/board.ts`. Demo handlers MUST import these types.

/** One issue's full detail fields plus canonical markdown What. */
export interface IssueDetailIssue {
  id: string
  title: string
  /** Human-visible work definition; exact scheduled prompt. */
  what: string
  status: IssueStatus
  priority: IssuePriority
  /** @workspace | @new | @human | @unassigned | exact @resumeId Session signature. */
  assignee: string
  /** Present iff the issue self-schedules. */
  when?: ScheduleWhen
  /** Adapter id for the scheduled fire (frontmatter `agent`), if set. */
  agent?: string
  /** Native model id for the scheduled fire (frontmatter `model`), if set. */
  model?: string
  /** Native reasoning effort for the scheduled fire (frontmatter `effort`), if set. */
  effort?: ModelReasoningEffort
  /** Scanner last-fired marker (epoch ms) — scheduled issues only. */
  lastFiredAtMs?: number | null
  /** Computed next fire (epoch ms) — scheduled issues only. */
  nextDueAtMs?: number | null
  /** Live scheduler/worker health; present iff the Issue has a schedule. */
  automationHealth?: IssueAutomationHealth
}

/** GET /api/issues/:wsId/:id — one issue + Activity, Runs, and reports. */
export interface IssueDetail {
  issue: IssueDetailIssue
  /** Structured markdown comments from `<id>.comments.json`. */
  comments?: IssueComment[]
  /** This issue's headless runs (wsId + issueId match), newest first. */
  runs: IssueRunRecord[]
  /**
   * The inbox reports this issue produced — every inbox entry from this
   * workspace whose server-stamped `origin.issueId` is this issue, newest-first.
   * The issue→inbox direction of the cross-link (the run→issue direction is
   * `runs`). Optional on the client: legacy/demo payloads may omit it, and an
   * issue with no reports yields an empty array.
   */
  inboxReports?: InboxEntry[]
  /** Raw provenance edges. Nearby updates from one origin are coalesced. */
  provenance?: IssueProvenanceRecord[]
  /** Changes + comments, oldest first. Optional for older/demo servers. */
  activity?: IssueActivityRecord[]
}

export interface IssuePatch {
  status?: IssueStatus
  priority?: IssuePriority
  assignee?: string
  agent?: string | null
  model?: string | null
  effort?: ModelReasoningEffort | null
  what?: string
}

export const issuesApi = {
  /** Read-only board: every workspace's issues, scanned across all workspaces. */
  async get(): Promise<IssueSnapshot> {
    return fetchJson<IssueSnapshot>('/api/issues')
  },

  /** Read-only detail: one issue's full fields + canonical What + its run feed. */
  async getDetail(wsId: string, id: string): Promise<IssueDetail> {
    return fetchJson<IssueDetail>(
      `/api/issues/${encodeURIComponent(wsId)}/${encodeURIComponent(id)}`,
    )
  },

  /**
   * Resolve a `[[name]]` token across BOTH namespaces (entity + issues). Used by
   * the issue-detail body's clickable wikilinks: a unique target navigates
   * straight through; a collision opens the disambiguation picker.
   */
  async resolveWikilink(name: string): Promise<WikilinkResolution> {
    return fetchJson<WikilinkResolution>(
      `/api/wikilink/resolve?name=${encodeURIComponent(name)}`,
    )
  },

  /**
   * Human write path: patch one issue's editable fields (any subset of
   * status / priority / assignee / agent / model / effort / what). Null runtime
   * fields clear their one-run overrides so Workspace/native defaults apply. Returns the SAME detail
   * shape as `getDetail` so the caller can apply it directly (refetch-free).
   * Working-tree write on the server, no commit.
   */
  async update(
    wsId: string,
    id: string,
    patch: IssuePatch,
  ): Promise<IssueDetail> {
    return fetchJson<IssueDetail>(
      `/api/issues/${encodeURIComponent(wsId)}/${encodeURIComponent(id)}`,
      { method: 'PATCH', headers, body: JSON.stringify(patch) },
    )
  },

  /**
   * Human write path: append a structured markdown comment (author fixed to
   * "human" server-side) to the Issue's JSON sidecar.
   */
  async addComment(wsId: string, id: string, text: string): Promise<IssueDetail> {
    return fetchJson<IssueDetail>(
      `/api/issues/${encodeURIComponent(wsId)}/${encodeURIComponent(id)}/comments`,
      { method: 'POST', headers, body: JSON.stringify({ text }) },
    )
  },

  /** Retry the latest failed/interrupted scheduled run with its live Issue
   * prompt, owner, and runtime. The backend preserves the cadence marker. */
  async retry(wsId: string, id: string): Promise<IssueDetail> {
    return fetchJson<IssueDetail>(
      `/api/issues/${encodeURIComponent(wsId)}/${encodeURIComponent(id)}/retry`,
      { method: 'POST', headers },
    )
  },
}
