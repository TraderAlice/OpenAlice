/**
 * Issue MUTATION helpers — the single read-modify-write seam shared by BOTH the
 * human/UI HTTP routes (`src/webui/routes/issues.ts`) and the agent-facing
 * workspace tool factories. There is exactly one implementation of "edit an
 * issue file" so the two surfaces can never drift on format, validation, or the
 * not-found / conflict contract.
 *
 * The issue file is the single source of truth (`<wsDir>/.alice/issues/<id>.md`,
 * YAML frontmatter + markdown What, git-versioned in the workspace's own
 * checkout). What lives in the markdown document below frontmatter; comments
 * live in a JSON sidecar managed by `./comments.ts`. All writes go through `writeWorkspaceFile`
 * (path-traversal guarded, working-tree only, NO auto-commit).
 *
 * Every function NEVER throws on a missing / conflicting target: it returns a
 * typed result (`not_found` / `conflict` / `invalid`) the caller maps to HTTP
 * status or a tool error. Frontmatter split + schema validation is shared with
 * `./declaration.ts` (`splitFrontmatter` / `parseIssueContent`) — not
 * re-implemented here; re-serialization uses the `yaml` lib while the markdown
 * body is preserved verbatim.
 */

import { join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { readWorkspaceFile, writeWorkspaceFile } from '../file-service.js'
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUES_DIR_REL,
  issueAssigneeResumeId,
  issueAssigneeSchema,
  issueFrontmatterSchema,
  parseIssueContent,
  splitLegacyIssueDocument,
  splitFrontmatter,
  type IssuePriority,
  type IssueRecord,
  type IssueStatus,
} from './declaration.js'
export { appendIssueComment } from './comments.js'

/** Fields a human/agent may patch on an existing issue. Most scheduling
 *  frontmatter is preserved untouched; `agent` is intentionally editable from
 *  the UI because it controls which runtime the scheduler uses next fire. */
export interface IssueFieldPatch {
  status?: IssueStatus
  priority?: IssuePriority
  assignee?: string
  /** Runtime override for scheduled fires; null removes the override. */
  agent?: string | null
  /** Canonical markdown work definition; exact scheduled prompt. */
  what?: string
}

/** Input to `createIssue`. `id` is optional — derived as a kebab slug from the
 *  title when omitted. `body` is the markdown description (optional). */
export interface CreateIssueInput {
  id?: string
  title: string
  status?: IssueStatus
  priority?: IssuePriority
  assignee?: string
  when?: unknown
  what?: string
  agent?: string
  /** @deprecated Compatibility alias for callers written before What became the
   * sole markdown document. New callers must use `what`. */
  body?: string
}

/** Result of an edit that targets an existing issue. */
export type MutateResult =
  | { ok: true; issue: IssueRecord; previous: IssueRecord }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid'; error: string }

/** Result of `createIssue` — adds the `conflict` case (id already exists). */
export type CreateResult =
  | { ok: true; issue: IssueRecord }
  | { ok: false; reason: 'conflict'; id: string }
  | { ok: false; reason: 'invalid'; error: string }

const relFor = (id: string): string => join(ISSUES_DIR_REL, `${id}.md`)

/** A valid issue id / filename stem — kebab-ish, no path separators (the file
 *  service guards traversal too, but reject early with a clear reason). */
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

/** Derive a stable kebab-case slug from a human title. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Serialize frontmatter + canonical What back into the Issue document. */
function serializeIssue(frontmatter: Record<string, unknown>, what: string, legacyComments = ''): string {
  const fm = stringifyYaml(frontmatter).trimEnd()
  const canonical = what.trim()
  // Startup migration normally removes this legacy block first. Preserve it on
  // an opportunistic mutation anyway: a partially migrated/manual test setup
  // must never lose comments merely because somebody changed priority.
  const comments = legacyComments.trim()
  const trimmed = comments ? `${canonical}\n\n## Comments\n\n${comments}` : canonical
  return trimmed ? `---\n${fm}\n---\n\n${trimmed}\n` : `---\n${fm}\n---\n`
}

/**
 * Patch one or more board fields on an existing issue. Reads the file, validates
 * each patched field against the Issue schema (including the owner contract), merges
 * into the existing frontmatter (preserving `when`/`agent` + any other
 * keys), re-serializes via the `yaml` lib, and writes. Returns the re-validated
 * IssueRecord, or `not_found` when the file is absent.
 */
export async function updateIssueFields(
  wsDir: string,
  id: string,
  patch: IssueFieldPatch,
): Promise<MutateResult> {
  if (!ID_RE.test(id)) return { ok: false, reason: 'not_found' }
  const raw = await readWorkspaceFile(wsDir, relFor(id))
  if (raw === null) return { ok: false, reason: 'not_found' }

  const split = splitFrontmatter(raw)
  if (!split) return { ok: false, reason: 'invalid', error: 'missing YAML frontmatter' }

  // Re-validate the existing content first so we never write back a file that
  // was already broken, and so the merge starts from a known-good frontmatter.
  const current = parseIssueContent(id, raw)
  if (!current.ok) return { ok: false, reason: 'invalid', error: current.error }

  // Parse the raw frontmatter object (NOT the zod-defaulted record) so we
  // preserve every author-written key verbatim and only overwrite what changed.
  const data = parseFrontmatterObject(split.frontmatter)
  if (!data) return { ok: false, reason: 'invalid', error: 'frontmatter is not a mapping' }

  if (patch.status !== undefined) {
    if (!ISSUE_STATUSES.includes(patch.status)) {
      return { ok: false, reason: 'invalid', error: `invalid status: ${patch.status}` }
    }
    data.status = patch.status
  }
  if (patch.priority !== undefined) {
    if (!ISSUE_PRIORITIES.includes(patch.priority)) {
      return { ok: false, reason: 'invalid', error: `invalid priority: ${patch.priority}` }
    }
    data.priority = patch.priority
  }
  if (patch.assignee !== undefined) {
    const a = patch.assignee.trim()
    const assignee = issueAssigneeSchema.safeParse(a)
    if (!assignee.success) {
      return { ok: false, reason: 'invalid', error: 'assignee must be @workspace, @new, @human, @unassigned, or an exact @resumeId' }
    }
    data.assignee = assignee.data
    if (issueAssigneeResumeId(assignee.data)) delete data.agent
  }
  if (patch.agent !== undefined) {
    if (patch.agent === null) {
      delete data.agent
    } else {
      const a = patch.agent.trim()
      if (a.length === 0) return { ok: false, reason: 'invalid', error: 'agent must be a non-empty string or null' }
      data.agent = a
    }
  }
  let what = current.issue.what
  if (patch.what !== undefined) {
    what = patch.what.trim()
    if (!what) return { ok: false, reason: 'invalid', error: 'what must be non-empty markdown' }
  }

  // Any mutation opportunistically upgrades a legacy file. The old YAML What
  // must not survive beside the canonical markdown What and silently diverge.
  delete data.what

  const legacyComments = splitLegacyIssueDocument(split.body).legacyComments
  const content = serializeIssue(data, what, legacyComments)
  // Final guard: never persist a file that wouldn't read back cleanly.
  const reparsed = parseIssueContent(id, content)
  if (!reparsed.ok) return { ok: false, reason: 'invalid', error: reparsed.error }
  await writeWorkspaceFile(wsDir, relFor(id), content)
  return { ok: true, issue: reparsed.issue, previous: current.issue }
}

/**
 * Create a new issue file. Derives a kebab slug from `title` when `id` is
 * omitted; refuses to overwrite an existing file (returns `conflict`). Validates
 * the assembled frontmatter against the issue schema. Returns the freshly-read
 * record on success.
 */
export async function createIssue(wsDir: string, input: CreateIssueInput): Promise<CreateResult> {
  const title = input.title?.trim()
  if (!title) return { ok: false, reason: 'invalid', error: 'title is required' }

  const id = (input.id?.trim() || slugify(title))
  if (!id || !ID_RE.test(id)) {
    return { ok: false, reason: 'invalid', error: `cannot derive a valid id from title "${title}" (pass an explicit id)` }
  }

  const existing = await readWorkspaceFile(wsDir, relFor(id))
  if (existing !== null) return { ok: false, reason: 'conflict', id }
  // Assemble frontmatter from only the provided keys (so we don't write default
  // noise), then validate the whole thing against the issue schema.
  const data: Record<string, unknown> = { title }
  if (input.status !== undefined) data.status = input.status
  if (input.priority !== undefined) data.priority = input.priority
  if (input.assignee !== undefined) data.assignee = input.assignee
  if (input.when !== undefined) data.when = input.when
  if (input.agent !== undefined) data.agent = input.agent

  const parsed = issueFrontmatterSchema.safeParse(data)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }
  }

  const what = input.what?.trim() || input.body?.trim() || title
  const content = serializeIssue(data, what)
  const reparsed = parseIssueContent(id, content)
  if (!reparsed.ok) return { ok: false, reason: 'invalid', error: reparsed.error }
  await writeWorkspaceFile(wsDir, relFor(id), content)
  return { ok: true, issue: reparsed.issue }
}

/** Parse a YAML frontmatter block into a plain object, or null when it isn't a
 *  mapping. Yields the RAW object for in-place merge — the record from
 *  `parseIssueContent` has defaults baked in and drops author keys we want to
 *  keep verbatim (the caller has already validated parseability). */
function parseFrontmatterObject(frontmatter: string): Record<string, unknown> | null {
  let data: unknown
  try {
    data = parseYaml(frontmatter)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
  return data as Record<string, unknown>
}
