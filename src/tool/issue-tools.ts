/**
 * Issue tools — the agent-facing surface over a workspace's own issue board.
 *
 * These are **workspace-scoped tool factories** (same shape as inbox_push /
 * entity_upsert): the agent sees a schema WITHOUT any `wsId`, and the workspace
 * identity is closed over by the factory from the gateway URL (`/cli/:wsId` or
 * `/mcp/:wsId`). Registering each factory once makes it reachable via BOTH the
 * `alice-workspace issue …` CLI (the primary agent surface) AND MCP (one
 * adapter) for free — the gateway builds and dispatches both through the same
 * WorkspaceToolCenter.
 *
 * Every tool resolves THIS workspace's checkout dir (`resolveWorkspace(self)`)
 * and goes through the single read-modify-write seam in
 * `../workspaces/issues/mutate.ts` (shared with the human/UI HTTP routes) or the
 * live reader in `../workspaces/issues/declaration.ts`. The issue file
 * (`.alice/issues/<id>.md`, YAML frontmatter + canonical markdown What) is the single
 * source of truth; writes are working-tree only (no auto-commit).
 *
 * Comments and created-issue authorship are tagged `ws:<workspaceLabel>` — the
 * agent never names its own identity; the factory stamps it.
 */

import { join } from 'node:path'

import { tool } from 'ai'
import { z } from 'zod'

import type { WorkspaceToolFactory, WorkspaceToolContext } from '../core/workspace-tool-center.js'
import {
  ACTIVITY_UPDATE_COALESCE_MS,
  sessionOriginFromInboxOrigin,
  type ProvenanceAction,
} from '../core/provenance-store.js'
import { readWorkspaceFile } from '../workspaces/file-service.js'
import {
  ISSUES_DIR_REL,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  issueAssigneeResumeId,
  issueAssigneeSchema,
  issueWhenSchema,
  parseIssueContent,
  readWorkspaceIssues,
  type IssueRecord,
} from '../workspaces/issues/declaration.js'
import {
  appendIssueComment,
  createIssue,
  updateIssueFields,
} from '../workspaces/issues/mutate.js'
import { readIssueComments, type IssueComment } from '../workspaces/issues/comments.js'
import {
  WORKSPACE_ASSIGNEE,
  normalizeIssueAssigneeAlias,
  sessionSignature,
} from '../workspaces/session-signature.js'
import {
  flattenBoardRows,
  type BoardInvalidWorkspace,
  type BoardRow,
} from '../workspaces/issues/board.js'

/** Resolve THIS workspace's absolute checkout dir, or a clean error. */
function selfDir(ctx: WorkspaceToolContext): { ok: true; dir: string } | { ok: false; error: string } {
  const resolve = ctx.resolveWorkspace
  if (!resolve) return { ok: false, error: 'workspace resolution is unavailable in this context' }
  const meta = resolve(ctx.workspaceId)
  if (!meta) return { ok: false, error: `cannot locate this workspace (${ctx.workspaceId})` }
  return { ok: true, dir: meta.dir }
}

const issueAssigneeInputSchema = z.string().min(1).refine(
  (value) => value.toLowerCase() === '@me' || issueAssigneeSchema.safeParse(normalizeIssueAssigneeAlias(value)).success,
  'assignee must be @me, @workspace, @human, @unassigned, or an exact @resumeId',
)

function resolveIssueAssignee(
  ctx: WorkspaceToolContext,
  requested: string | undefined,
): { ok: true; assignee?: string } | { ok: false; error: string } {
  if (!requested) return { ok: true }
  const isMe = requested.toLowerCase() === '@me'
  const selfResumeId = isMe
    ? sessionOriginFromInboxOrigin(ctx.workspaceId, ctx.origin)?.resumeId
    : undefined
  if (isMe && !selfResumeId) {
    return { ok: false, error: '@me needs an attributable product Session' }
  }
  const assignee = isMe ? sessionSignature(selfResumeId!) : normalizeIssueAssigneeAlias(requested)
  const parsed = issueAssigneeSchema.safeParse(assignee)
  if (!parsed.success) return { ok: false, error: 'invalid assignee' }
  const resumeId = issueAssigneeResumeId(parsed.data)
  if (!resumeId) return { ok: true, assignee: parsed.data }
  const identity = ctx.resolveSessionIdentity?.(resumeId)
  if (ctx.resolveSessionIdentity && !identity) {
    return { ok: false, error: `unknown product Session: ${resumeId}` }
  }
  if (identity && !identity.resumable) {
    return {
      ok: false,
      error: `product Session ${resumeId} is not resumable yet; complete one agent turn before assigning it`,
    }
  }
  return { ok: true, assignee: parsed.data }
}

/**
 * "Who creates it owns it" only applies when the caller is an actual product
 * Session that Alice can resume. Shell PTYs also carry an interactive
 * SessionRecord/resumeId for terminal bookkeeping, but they have no native
 * Agent Runtime conversation to continue. Treating those as owners creates an
 * Issue that cannot ever run; an omitted owner therefore falls back to the
 * Workspace, while an explicit `@me` remains a strict validation error.
 *
 * Older/test contexts may not expose the identity resolver. Preserve their
 * attributable-session behavior; production always supplies the resolver.
 */
function defaultIssueAssignee(ctx: WorkspaceToolContext): string {
  const origin = sessionOriginFromInboxOrigin(ctx.workspaceId, ctx.origin)
  if (!origin) return WORKSPACE_ASSIGNEE
  if (!ctx.resolveSessionIdentity) return '@me'
  return ctx.resolveSessionIdentity(origin.resumeId)?.resumable
    ? '@me'
    : WORKSPACE_ASSIGNEE
}

/** The comment / create author for this workspace's writes. */
const author = (ctx: WorkspaceToolContext): string => `ws:${ctx.workspaceLabel}`

async function recordIssueProvenance(
  ctx: WorkspaceToolContext,
  issueId: string,
  action: Extract<ProvenanceAction, 'created' | 'updated' | 'commented'>,
): Promise<void> {
  if (!ctx.provenanceStore) return
  const origin = sessionOriginFromInboxOrigin(ctx.workspaceId, ctx.origin) ?? {
    kind: 'unknown' as const,
    reason: 'missing-session-origin',
  }
  const input = {
    artifact: { kind: 'issue' as const, workspaceId: ctx.workspaceId, issueId },
    action,
    origin,
    at: Date.now(),
    ...(action === 'created' ? { fingerprint: `issue:${ctx.workspaceId}:${issueId}:created` } : {}),
  }
  if (action === 'updated') {
    await ctx.provenanceStore.append(input, { coalesceWithinMs: ACTIVITY_UPDATE_COALESCE_MS })
  } else {
    await ctx.provenanceStore.append(input)
  }
}

/** Project a full IssueRecord into the compact row the tools return. */
function rowOf(issue: IssueRecord) {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assignee: issue.assignee,
    ...(issue.agent ? { agent: issue.agent } : {}),
    scheduled: issue.when !== undefined,
  }
}

const ISSUE_LIST_DEFAULT_LIMIT = 8
const ISSUE_LIST_MAX_LIMIT = 50
const ISSUE_LIST_FOCUS_PRIORITIES = new Set(['urgent', 'high', 'medium'])
const TERMINAL_STATUSES = new Set(['done', 'canceled'])
const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
}
const STATUS_RANK: Record<string, number> = {
  in_progress: 0,
  todo: 1,
  backlog: 2,
  done: 3,
  canceled: 4,
}

function compareIssueRows(a: BoardRow, b: BoardRow): number {
  return (
    (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99) ||
    (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99) ||
    Number(a.scheduled) - Number(b.scheduled) ||
    a.workspace.tag.localeCompare(b.workspace.tag) ||
    a.id.localeCompare(b.id)
  )
}

function summarizeIssueRows(
  rows: BoardRow[],
  invalid: BoardInvalidWorkspace[],
  selfWsId: string,
  limit: number,
) {
  const active = rows.filter((row) => !TERMINAL_STATUSES.has(row.status))
  const focus = active
    .filter((row) => row.workspace.wsId === selfWsId || ISSUE_LIST_FOCUS_PRIORITIES.has(row.priority))
    .sort(compareIssueRows)
    .slice(0, limit)

  const visibleKeys = new Set(focus.map((row) => `${row.workspace.wsId}/${row.id}`))
  const hiddenActive = active.filter((row) => !visibleKeys.has(`${row.workspace.wsId}/${row.id}`))
  const hiddenLowPriority = hiddenActive.filter((row) => !ISSUE_LIST_FOCUS_PRIORITIES.has(row.priority)).length
  const hiddenOverflow = Math.max(0, active.length - focus.length - hiddenLowPriority)
  const terminal = rows.length - active.length

  return {
    ok: true as const,
    mode: 'summary' as const,
    summary: {
      total: rows.length,
      focus: focus.length,
      hiddenActive: hiddenActive.length,
      hiddenLowPriority,
      hiddenOverflow,
      terminal,
      invalid: invalid.length,
    },
    issues: focus.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      assignee: row.assignee,
      scheduled: row.scheduled,
      workspace: row.workspace.tag,
      ...(row.nameCollision ? { nameCollision: true as const } : {}),
    })),
    invalid: invalid.map((row) => ({
      workspace: row.tag,
      ...(row.error ? { error: row.error } : {}),
    })),
    hint:
      'Summary shows local issues plus active urgent/high/medium rows. Use `alice-workspace issue list --mode detailed` for the full board, then `alice-workspace issue show --id <id>` before acting.',
  }
}

// ==================== issue_update ====================

export const issueUpdateFactory: WorkspaceToolFactory = {
  name: 'issue_update',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        "Update one of THIS workspace's issues — its board fields.",
        '',
        'Patch any subset of `status`, `priority`, `assignee`, `what`; omitted fields are',
        'left untouched. `assignee:"@me"` binds this current product',
        'Session; pass an exact `@resumeId` to assign another known Session. What is the',
        'canonical markdown work definition and exact scheduled prompt. Other scheduling',
        'frontmatter (`when`/`agent`) is preserved — edit it by writing the file directly',
        '(`.alice/issues/<id>.md`).',
        '',
        'Marking an issue `done` or `canceled` is how a self-scheduled issue is',
        'turned off — there is no separate enabled flag.',
      ].join('\n'),
      inputSchema: z.object({
        id: z.string().min(1).describe('The issue id (the filename stem of `.alice/issues/<id>.md`).'),
        status: z.enum(ISSUE_STATUSES).optional().describe('New status.'),
        priority: z.enum(ISSUE_PRIORITIES).optional().describe('New priority.'),
        assignee: issueAssigneeInputSchema
          .optional()
          .describe('@workspace, @human, @unassigned, @me, or an exact @resumeId.'),
        what: z.string().min(1).optional().describe('Canonical markdown work definition; exact scheduled prompt.'),
      }),
      execute: async ({ id, status, priority, assignee, what }) => {
        const dir = selfDir(ctx)
        if (!dir.ok) return { ok: false as const, error: dir.error }
        const resolvedAssignee = resolveIssueAssignee(ctx, assignee)
        if (!resolvedAssignee.ok) return { ok: false as const, error: resolvedAssignee.error }
        if (status === undefined && priority === undefined && resolvedAssignee.assignee === undefined && what === undefined) {
          return { ok: false as const, error: 'no fields to update (pass status/priority/assignee/what)' }
        }
        const res = await updateIssueFields(dir.dir, id, {
          status,
          priority,
          assignee: resolvedAssignee.assignee,
          what,
        })
        if (res.ok) {
          await recordIssueProvenance(ctx, res.issue.id, 'updated')
          return { ok: true as const, issue: rowOf(res.issue) }
        }
        if (res.reason === 'not_found') return { ok: false as const, error: `no such issue: ${id}` }
        return { ok: false as const, error: res.error }
      },
    })
  },
}

// ==================== issue_comment ====================

export const issueCommentFactory: WorkspaceToolFactory = {
  name: 'issue_comment',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        "Append a comment to one of THIS workspace's issues.",
        '',
        'The markdown comment is appended to the Issue’s structured JSON sidecar,',
        'authored as `ws:<this workspace>`. It never mutates the canonical What',
        'or silently changes the next scheduled prompt. Use it to leave a',
        'progress note, a finding, or a question for the human reading the board.',
      ].join('\n'),
      inputSchema: z.object({
        id: z.string().min(1).describe('The issue id to comment on.'),
        text: z.string().min(1).describe('The comment text (markdown).'),
      }),
      execute: async ({ id, text }) => {
        const dir = selfDir(ctx)
        if (!dir.ok) return { ok: false as const, error: dir.error }
        const res = await appendIssueComment(dir.dir, id, author(ctx), text)
        if (res.ok) {
          await recordIssueProvenance(ctx, res.issue.id, 'commented')
          return { ok: true as const, issue: rowOf(res.issue) }
        }
        if (res.reason === 'not_found') return { ok: false as const, error: `no such issue: ${id}` }
        return { ok: false as const, error: res.error }
      },
    })
  },
}

// ==================== issue_create ====================

export const issueCreateFactory: WorkspaceToolFactory = {
  name: 'issue_create',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        'Create a new issue on THIS workspace’s board.',
        '',
        '`title` is required; `id` is optional (derived as a kebab slug from the',
        'title when omitted). Creating over an existing id is refused — pick a',
        'different id or update the existing one with issue_update.',
        '',
        'The markdown `what` is the Issue’s work definition. Add a `when` and',
        'the scanner sends that exact visible What to the Agent Runtime; without',
        '`when` the same What remains a pure board work item. Assignee is the',
        'only ownership field:',
        '`@workspace` recruits a new Session each fire. `@me` resolves to this',
        'calling Session, while an exact `@resumeId` keeps one accountable',
        'Session (including a deliberately signed Session from another Workspace).',
        'A scheduled run is unattended: if its result is meant for the human,',
        'What must explicitly tell it to use `alice-workspace inbox push`.',
      ].join('\n'),
      inputSchema: z.object({
        title: z.string().min(1).describe('Short human title (required).'),
        id: z
          .string()
          .min(1)
          .optional()
          .describe('Explicit id (filename stem). Omit to derive a kebab slug from the title.'),
        status: z.enum(ISSUE_STATUSES).optional().describe('Initial status (default "todo").'),
        priority: z.enum(ISSUE_PRIORITIES).optional().describe('Initial priority (default "none").'),
        assignee: issueAssigneeInputSchema
          .optional()
          .describe('Initial owner. Omit or use @me for the current Session; use @workspace to recruit a fresh Session each fire.'),
        when: issueWhenSchema
          .optional()
          .describe('Schedule shape — { kind:"at", at } | { kind:"every", every } | { kind:"cron", cron, timezone?:"local"|IANA }. Present iff the issue self-schedules.'),
        what: z.string().min(1).optional().describe('Markdown work definition; exact scheduled prompt. Defaults to title.'),
        agent: z.string().min(1).optional().describe('Adapter id when assignee is @workspace; Session assignees own their runtime.'),
      }),
      execute: async ({ title, id, status, priority, assignee, when, what, agent }) => {
        const dir = selfDir(ctx)
        if (!dir.ok) return { ok: false as const, error: dir.error }
        // Structured creation is attributable: "who creates it owns it". A
        // human/unattributed caller has no Session to sign with, so its safe
        // fallback is the Issue's home Workspace recruiting a fresh worker.
        const defaultAssignee = defaultIssueAssignee(ctx)
        const resolvedAssignee = resolveIssueAssignee(ctx, assignee ?? defaultAssignee)
        if (!resolvedAssignee.ok) return { ok: false as const, error: resolvedAssignee.error }
        const res = await createIssue(dir.dir, {
          title,
          id,
          status,
          priority,
          assignee: resolvedAssignee.assignee,
          when,
          what,
          agent,
        })
        if (res.ok) {
          await recordIssueProvenance(ctx, res.issue.id, 'created')
          return { ok: true as const, issue: rowOf(res.issue) }
        }
        if (res.reason === 'conflict') return { ok: false as const, error: `issue already exists: ${res.id}` }
        return { ok: false as const, error: res.error }
      },
    })
  },
}

// ==================== issue_list ====================

export const issueListFactory: WorkspaceToolFactory = {
  name: 'issue_list',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        'List the issue board for agent startup.',
        '',
        'Default `summary` mode is intentionally small: it shows local issues',
        'plus active urgent/high/medium rows from the global board, hiding',
        'low-priority scheduled noise behind counts. Use `mode:"detailed"`',
        'when you are deliberately auditing the whole board.',
      ].join('\n'),
      inputSchema: z.object({
        mode: z
          .enum(['summary', 'detailed'])
          .optional()
          .describe('summary (default) returns a short startup-safe focus list; detailed returns every row.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(ISSUE_LIST_MAX_LIMIT)
          .optional()
          .describe(`Max summary focus rows (default ${ISSUE_LIST_DEFAULT_LIMIT}; ignored in detailed mode).`),
      }),
      execute: async ({ mode, limit }) => {
        // GLOBAL board when the service-backed reader is wired (the
        // `alice-workspace` surface). Reads EVERY workspace's issues.
        if (ctx.board) {
          const snapshot = await ctx.board.snapshot()
          const { rows, invalid } = flattenBoardRows(snapshot)
          if (mode === 'detailed') {
            return {
              ok: true as const,
              mode: 'detailed' as const,
              count: rows.length,
              issues: rows.sort(compareIssueRows),
              invalid,
            }
          }
          return summarizeIssueRows(
            rows,
            invalid,
            ctx.workspaceId,
            limit ?? ISSUE_LIST_DEFAULT_LIMIT,
          )
        }
        // FALLBACK (no service: older contexts / unit tests): this workspace's
        // own files only, preserving the original self-scoped behavior.
        const dir = selfDir(ctx)
        if (!dir.ok) return { ok: false as const, error: dir.error }
        const res = await readWorkspaceIssues(dir.dir)
        if (res.ok) {
          const rows = res.issues.map((issue) => ({
            ...rowOf(issue),
            workspace: { wsId: ctx.workspaceId, tag: ctx.workspaceLabel },
            ...(issue.when !== undefined ? { scheduled: true } : { scheduled: false }),
          }))
          if (mode === 'detailed') {
            return { ok: true as const, mode: 'detailed' as const, count: rows.length, issues: rows, invalid: res.invalid }
          }
          return summarizeIssueRows(
            rows,
            res.invalid.map((invalid) => ({
              wsId: ctx.workspaceId,
              tag: ctx.workspaceLabel,
              error: `${invalid.id}: ${invalid.error}`,
            })),
            ctx.workspaceId,
            limit ?? ISSUE_LIST_DEFAULT_LIMIT,
          )
        }
        if (res.reason === 'absent') {
          return summarizeIssueRows([], [], ctx.workspaceId, limit ?? ISSUE_LIST_DEFAULT_LIMIT)
        }
        return { ok: false as const, error: res.error }
      },
    })
  },
}

// ==================== issue_show ====================

export const issueShowFactory: WorkspaceToolFactory = {
  name: 'issue_show',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        'Show one issue from the global board in full — resolved by its NAME',
        '(case-insensitive id OR title), across every workspace.',
        '',
        'Summary mode (default) returns the issue once plus compact execution and',
        'report references. Detailed mode includes each run prompt and full report.',
        'If the name matches issues in MORE THAN ONE workspace, returns',
        '`ambiguous` (candidate { wsId, wsTag, id, title } list) — pick one by',
        'workspace and call again. Use this before updating or commenting.',
      ].join('\n'),
      inputSchema: z.object({
        id: z.string().min(1).describe("The issue's name to show — its id OR title (case-insensitive)."),
        mode: z.enum(['summary', 'detailed']).optional().default('summary'),
      }),
      execute: async ({ id, mode }) => {
        const outputMode = mode ?? 'summary'
        // GLOBAL by-name resolution when the service-backed reader is wired.
        // Handle-addressed: the agent never supplies a wsId UUID up front; a
        // collision returns candidates so it can disambiguate by workspace.
        if (ctx.board) {
          const refs = await ctx.board.resolveByName(id)
          if (refs.length === 1) {
            const detail = await ctx.board.detail(refs[0].wsId, refs[0].id)
            if (detail) {
              if (outputMode === 'detailed') return { ok: true as const, mode: outputMode, ...detail }
              return {
                ok: true as const,
                mode: outputMode,
                issue: detail.issue,
                runs: detail.runs.map((run) => ({
                  taskId: run.taskId,
                  resumeId: run.resumeId,
                  ...(run.parentTaskId ? { parentTaskId: run.parentTaskId } : {}),
                  agent: run.agent,
                  status: run.status,
                  startedAt: run.startedAt,
                  ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
                  ...(run.error ? { error: run.error } : {}),
                  ...(run.output ? { output: run.output } : {}),
                  resumable: run.resumable,
                })),
                inboxReports: detail.inboxReports.map((entry) => ({
                  id: entry.id,
                  workspaceId: entry.workspaceId,
                  workspaceLabel: entry.workspaceLabel,
                  ts: entry.ts,
                  ...(entry.docs ? {
                    docs: entry.docs.map((doc) => ({
                      path: doc.path,
                      ...(doc.revision ? { revision: doc.revision } : {}),
                    })),
                  } : {}),
                  ...(entry.comments ? { comments: entry.comments } : {}),
                  ...(entry.origin ? { origin: entry.origin } : {}),
                })),
                provenance: detail.provenance,
                hint: 'Use --mode detailed only when you need every execution prompt and full report metadata.',
              }
            }
            // detail vanished between resolve and read → fall through to self.
          } else if (refs.length > 1) {
            return {
              ok: true as const,
              ambiguous: refs.map((r) => ({ wsId: r.wsId, wsTag: r.wsTag, id: r.id, title: r.title })),
            }
          }
          // 0 matches → fall through to the self-file read so a local id still
          // resolves; if that misses too, it returns the not_found error.
        }
        return readSelfIssue(ctx, id)
      },
    })
  },
}

/** Read one issue from THIS workspace's own files — the issue_show fallback
 *  when the global board reader is absent or finds no match. */
async function readSelfIssue(
  ctx: WorkspaceToolContext,
  id: string,
): Promise<{ ok: true; issue: IssueRecord; comments: IssueComment[] } | { ok: false; error: string }> {
  const dir = selfDir(ctx)
  if (!dir.ok) return { ok: false, error: dir.error }
  const raw = await readWorkspaceFile(dir.dir, join(ISSUES_DIR_REL, `${id}.md`))
  if (raw === null) return { ok: false, error: `no such issue: ${id}` }
  const parsed = parseIssueContent(id, raw)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const comments = await readIssueComments(dir.dir, id)
  if (!comments.ok) return { ok: false, error: comments.error }
  return { ok: true, issue: parsed.issue, comments: comments.comments }
}

/** All issue tool factories, in registration order. */
export const issueToolFactories: WorkspaceToolFactory[] = [
  issueUpdateFactory,
  issueCommentFactory,
  issueCreateFactory,
  issueListFactory,
  issueShowFactory,
]
