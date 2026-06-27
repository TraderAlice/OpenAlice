import { fetchJson, headers } from './client'
import type { Entity } from './entities'
import type { HeadlessTaskRecord } from './headless'
import type { InboxEntry } from './inbox'
import type { ScheduleWhen } from './schedule'

/**
 * Issue board — the canonical client shape for GET /api/issues.
 *
 * Each workspace owns its issues as one markdown file per issue
 * (`.alice/issues/<id>.md`); the board scans every workspace (like
 * /api/schedule does for the scheduling projection) — there is NO central
 * store. An issue WITH a `when` is scheduled (the scanner fires it as a
 * headless run); an issue WITHOUT `when` is a pure tracked work item.
 *
 * Phase 1 is read-only and the list does NOT carry the markdown body — the
 * Phase 2 detail view loads that on demand.
 *
 * Demo handlers MUST import these types (do not inline an ad-hoc shape):
 * demo-shape drift has crashed the app before.
 */

export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'canceled'
export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none'

export interface IssueListItem {
  id: string
  title: string
  status: IssueStatus
  priority: IssuePriority
  /** "human" | "ws:<tag|id>" | "unassigned" — free-form, rendered verbatim. */
  assignee: string
  /** Present iff the issue is scheduled (shares the core Schedule union). */
  when?: ScheduleWhen
  /** Scanner last-fired marker (epoch ms) — scheduled issues only. */
  lastFiredAtMs?: number | null
  /** Computed next fire (epoch ms) — scheduled issues only. */
  nextDueAtMs?: number | null
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
// fields INCLUDING the markdown body and (iff scheduled) its firing markers +
// scheduling frontmatter, plus that issue's headless run history (its Activity
// feed). Mirrors the server's `IssueDetail` / `IssueDetailIssue` in
// `src/workspaces/issues/board.ts`. Demo handlers MUST import these types.

/** One issue's full detail fields: the board row's fields + the markdown body +
 *  the scheduling frontmatter (`what`/`agent`). Markers present iff scheduled. */
export interface IssueDetailIssue {
  id: string
  title: string
  /** Markdown description body (the list omits this; the detail loads it). */
  body: string
  status: IssueStatus
  priority: IssuePriority
  assignee: string
  /** Present iff the issue self-schedules. */
  when?: ScheduleWhen
  /** Scheduled fire prompt override (frontmatter `what`), if set. */
  what?: string
  /** Adapter id for the scheduled fire (frontmatter `agent`), if set. */
  agent?: string
  /** Scanner last-fired marker (epoch ms) — scheduled issues only. */
  lastFiredAtMs?: number | null
  /** Computed next fire (epoch ms) — scheduled issues only. */
  nextDueAtMs?: number | null
}

/** GET /api/issues/:wsId/:id — one issue + its run history (Activity feed). */
export interface IssueDetail {
  issue: IssueDetailIssue
  /** This issue's headless runs (wsId + issueId match), newest first. */
  runs: HeadlessTaskRecord[]
  /**
   * The inbox reports this issue produced — every inbox entry from this
   * workspace whose server-stamped `origin.issueId` is this issue, newest-first.
   * The issue→inbox direction of the cross-link (the run→issue direction is
   * `runs`). Optional on the client: legacy/demo payloads may omit it, and an
   * issue with no reports yields an empty array.
   */
  inboxReports?: InboxEntry[]
}

export const issuesApi = {
  /** Read-only board: every workspace's issues, scanned across all workspaces. */
  async get(): Promise<IssueSnapshot> {
    return fetchJson<IssueSnapshot>('/api/issues')
  },

  /** Read-only detail: one issue's full fields + markdown body + its run feed. */
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
   * status / priority / assignee). Returns the SAME detail shape as `getDetail`
   * so the caller can apply it directly (refetch-free). Working-tree write on
   * the server, no commit.
   */
  async update(
    wsId: string,
    id: string,
    patch: { status?: IssueStatus; priority?: IssuePriority; assignee?: string },
  ): Promise<IssueDetail> {
    return fetchJson<IssueDetail>(
      `/api/issues/${encodeURIComponent(wsId)}/${encodeURIComponent(id)}`,
      { method: 'PATCH', headers, body: JSON.stringify(patch) },
    )
  },

  /**
   * Human write path: append a comment (author fixed to "human" server-side) to
   * the issue body's `## Comments` section. Returns the updated detail — the
   * returned `body` already carries the new comment, so the existing markdown
   * renderer surfaces it with no client-side re-parsing.
   */
  async addComment(wsId: string, id: string, text: string): Promise<IssueDetail> {
    return fetchJson<IssueDetail>(
      `/api/issues/${encodeURIComponent(wsId)}/${encodeURIComponent(id)}/comments`,
      { method: 'POST', headers, body: JSON.stringify({ text }) },
    )
  },
}
