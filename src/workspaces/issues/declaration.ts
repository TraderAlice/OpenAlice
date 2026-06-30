/**
 * Workspace-declared ISSUES — one markdown file per issue at
 * `<wsDir>/.alice/issues/<id>.md` inside a workspace's own checkout.
 *
 * This is the keystone data model behind the global Issue board (a Linear-style
 * human+AI surface that aggregates issues across ALL workspaces by SCANNING,
 * never via a central store) AND behind workspace self-scheduling. The two are
 * one object: an issue is a tracked work item; if it additionally carries a
 * `when`, it self-schedules exactly like the old schedule task. An issue WITHOUT
 * `when` is a pure board item — the scanner ignores it.
 *
 * The agent WRITES these files (a coding task; the self-scheduling skill teaches
 * the format) and the launcher READS them live each scan. The agent can edit any
 * file in its checkout, so a read is NEVER trusted: every file is re-validated,
 * size-capped, and isolated — one bad file is reported (not propagated), and one
 * bad workspace can't break the whole scan. Nothing here ever throws.
 *
 * File shape — YAML frontmatter + markdown body:
 *   ---
 *   title: <required, short human title>
 *   status: backlog | todo | in_progress | done | canceled   (optional → 'todo')
 *   priority: urgent | high | medium | low | none             (optional → 'none')
 *   assignee: "human" | "ws:<tag|id>" | "unassigned"          (optional → 'unassigned')
 *   when: { kind: at, at } | { kind: every, every } | { kind: cron, cron }  (OPTIONAL — present iff scheduled)
 *   what: <optional fire prompt; if absent, the fire prompt falls back to title+body>
 *   agent: <optional adapter id for the scheduled run>
 *   ---
 *   <markdown description body>
 *
 * `id` is the filename stem (kebab-case slug), stable; it keys the scanner's
 * last-fired marker for scheduled issues.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

import type { Schedule } from '../../core/schedule-expr.js'

/** Directory of per-issue markdown files, relative to a workspace's `dir`. */
export const ISSUES_DIR_REL = join('.alice', 'issues')

/** The retired single-file declaration. Used only to turn a silent "no issues"
 *  into a loud, actionable error when a workspace still has the old file. */
export const LEGACY_ISSUE_FILE_REL = join('.alice', 'issue.json')

/** Hard cap — an agent-authored issue should be tiny; refuse to parse a blob. */
const MAX_BYTES = 64 * 1024

export const ISSUE_STATUSES = ['backlog', 'todo', 'in_progress', 'done', 'canceled'] as const
export const ISSUE_PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]

/** Statuses at which a scheduled issue stops firing (it's resolved/abandoned).
 *  This is how a schedule is turned off under the board model — there is no
 *  separate `enabled` flag; mark the issue done/canceled to stop it. */
const TERMINAL_STATUSES: ReadonlySet<IssueStatus> = new Set<IssueStatus>(['done', 'canceled'])
export function isTerminalStatus(status: IssueStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

/** `when` — the shared Schedule shape (at / every / cron). Present iff scheduled.
 *  Exported so the agent-facing `issue_create` tool reuses the exact same shape
 *  (no parallel re-declaration that could drift from what the reader validates). */
export const issueWhenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('at'), at: z.string().min(1) }),
  z.object({ kind: z.literal('every'), every: z.string().min(1) }),
  z.object({ kind: z.literal('cron'), cron: z.string().min(1) }),
])

/**
 * The validated frontmatter of one issue. `id` and `body` are NOT here — `id`
 * comes from the filename, `body` from below the frontmatter (see IssueRecord).
 * Optional fields carry their board defaults so every read yields a complete row.
 */
export const issueFrontmatterSchema = z.object({
  /** Short human title — required; an issue without a title has no board row. */
  title: z.string().min(1),
  status: z.enum(ISSUE_STATUSES).default('todo'),
  priority: z.enum(ISSUE_PRIORITIES).default('none'),
  assignee: z.string().min(1).default('unassigned'),
  /** Present iff the issue self-schedules. Absent ⇒ pure board work item. */
  when: issueWhenSchema.optional(),
  /** Prompt fired on schedule; if absent, the fire prompt falls back to title+body. */
  what: z.string().min(1).optional(),
  /** Which agent runtime to run the scheduled fire with; omitted uses the user default / first runtime. */
  agent: z.string().min(1).optional(),
})
export type IssueFrontmatter = z.infer<typeof issueFrontmatterSchema>

/** A fully read issue: validated frontmatter + its filename id + markdown body. */
export interface IssueRecord extends IssueFrontmatter {
  /** Filename stem (kebab-case slug) — stable; keys the scanner's marker. */
  id: string
  /** Markdown description below the frontmatter (trimmed). */
  body: string
}

/** A file that could not be read/validated — reported, never propagated. */
export interface InvalidIssue {
  /** Filename stem of the offending file. */
  id: string
  error: string
}

export type ReadIssuesResult =
  | { ok: true; issues: IssueRecord[]; invalid: InvalidIssue[] }
  | { ok: false; reason: 'absent' }
  | { ok: false; reason: 'invalid'; error: string }

/** Does an issue self-schedule AND is it still live (non-terminal)? */
export function isFireable(issue: IssueRecord): issue is IssueRecord & { when: Schedule } {
  return issue.when !== undefined && !isTerminalStatus(issue.status)
}

/** The prompt a scheduled fire hands to the headless run: explicit `what`, else
 *  title + body, else just the title. The launcher interprets none of it. */
export function issueFirePrompt(issue: IssueRecord): string {
  const what = issue.what?.trim()
  if (what) return what
  const body = issue.body.trim()
  return body ? `${issue.title}\n\n${body}` : issue.title
}

/**
 * Read + validate every issue in a workspace's `.alice/issues/` directory from
 * its live working tree. Never throws. Per-file isolation: a bad file lands in
 * `invalid` and the rest still load. The legacy single-file declaration is
 * surfaced as a loud, actionable error rather than a silent "no issues".
 */
export async function readWorkspaceIssues(wsDir: string): Promise<ReadIssuesResult> {
  const dir = join(wsDir, ISSUES_DIR_REL)

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Loud over silent: a workspace still carrying the retired single file gets
      // an actionable rename hint, not a bland "no issues" that hides the file.
      try {
        await stat(join(wsDir, LEGACY_ISSUE_FILE_REL))
        return {
          ok: false,
          reason: 'invalid',
          error:
            '`.alice/issue.json` is retired — split each issue into its own `.alice/issues/<id>.md` (one markdown file per issue, see the self-scheduling skill)',
        }
      } catch {
        return { ok: false, reason: 'absent' }
      }
    }
    return { ok: false, reason: 'invalid', error: err instanceof Error ? err.message : String(err) }
  }

  const files = entries.filter((f) => f.toLowerCase().endsWith('.md')).sort()
  const issues: IssueRecord[] = []
  const invalid: InvalidIssue[] = []
  for (const file of files) {
    const id = file.slice(0, -'.md'.length)
    const one = await readOneIssue(join(dir, file), id)
    if (one.ok) issues.push(one.issue)
    else invalid.push({ id, error: one.error })
  }
  return { ok: true, issues, invalid }
}

async function readOneIssue(
  path: string,
  id: string,
): Promise<{ ok: true; issue: IssueRecord } | { ok: false; error: string }> {
  let raw: string
  try {
    const info = await stat(path)
    if (info.size > MAX_BYTES) return { ok: false, error: `issue file too large (${info.size} bytes)` }
    raw = await readFile(path, 'utf8')
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  return parseIssueContent(id, raw)
}

/**
 * Pure parse of one issue's file content (frontmatter + body) into a validated
 * IssueRecord — no disk IO, no size cap. The shared validation seam: the reader
 * (`readOneIssue`) calls it after the file read + size check, and the mutation
 * helper (`./mutate.ts`) calls it to re-validate the content it just wrote so
 * both paths agree on the exact schema + error shape. Never throws.
 */
export function parseIssueContent(
  id: string,
  raw: string,
): { ok: true; issue: IssueRecord } | { ok: false; error: string } {
  const split = splitFrontmatter(raw)
  if (!split) return { ok: false, error: 'missing YAML frontmatter (expected a leading `---` block)' }

  let data: unknown
  try {
    data = parseYaml(split.frontmatter)
  } catch (err) {
    return { ok: false, error: `invalid YAML frontmatter: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'frontmatter is not a mapping' }
  }

  const parsed = issueFrontmatterSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }

  return { ok: true, issue: { id, ...parsed.data, body: split.body } }
}

/** Split a `---\n<yaml>\n---\n<body>` document. Line-based so a `---` inside the
 *  body (e.g. a markdown horizontal rule) never confuses the close fence. Returns
 *  null when there is no leading frontmatter block. */
export function splitFrontmatter(raw: string): { frontmatter: string; body: string } | null {
  const text = raw.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) return null
  return {
    frontmatter: lines.slice(1, end).join('\n'),
    body: lines.slice(end + 1).join('\n').trim(),
  }
}
