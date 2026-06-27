/**
 * 0010_workspace_issues_to_markdown — convert legacy single-file workspace
 * schedule/issue declarations into the per-issue markdown format.
 *
 * The workspace self-describe format evolved twice this cycle:
 *   - `.alice/schedule.json` = { tasks:  [{ id, when, what, agent?, enabled? }] }   (original)
 *   - `.alice/schedule.json` / `.alice/issue.json` = { issues: [{ id, issue, … }] }  (interim)
 *   - NEW: one markdown file per issue at `.alice/issues/<id>.md` (frontmatter + body)
 *
 * The reader only understands the NEW shape; a workspace still carrying a legacy
 * file shows a loud "retired" error and its scheduled issues stop firing. The
 * feature is already in use (real workspaces carry these files), so on upgrade we
 * MUST convert rather than break — that is what this migration does.
 *
 * Unlike every prior migration, the data lives OUTSIDE `data/` — in each workspace
 * checkout under the launcher root (`AQ_LAUNCHER_ROOT`, else `~/.openalice/workspaces`).
 * The body therefore resolves the launcher root itself and uses raw fs; the
 * config-scoped `ctx` is unused. It is self-contained on purpose (a migration is a
 * frozen point-in-time artifact): it does NOT import the evolving
 * `src/workspaces/issues` reader.
 *
 * Mapping: `id`→filename stem; `issue`/`title`→`title` (fallback: the id);
 * `when`/`what`/`agent` carried over; `enabled:false`→`status:canceled` (the board
 * model has no `enabled` flag — a terminal status stops a schedule firing while
 * the issue stays visible); other fields take board defaults. The legacy file is
 * deleted after a successful conversion.
 *
 * Idempotent: a workspace that already has a `.alice/issues/` dir is skipped, and
 * the journal records the migration so it runs once. Never throws — a single bad
 * workspace/file is logged and skipped so it cannot block startup.
 */

import { readFile, writeFile, mkdir, rename, unlink, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { stringify as stringifyYaml } from 'yaml'
import type { Migration } from '../types.js'

/** Mirror of the launcher-root resolution in `src/workspaces/config.ts`. Inlined
 *  (not imported) to keep this migration frozen against that module's evolution. */
function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

/** Checked in order; the first present wins (interim `issue.json` over original). */
const LEGACY_BASENAMES = ['issue.json', 'schedule.json'] as const

interface LegacyEntry {
  id?: unknown
  issue?: unknown
  title?: unknown
  when?: unknown
  what?: unknown
  agent?: unknown
  enabled?: unknown
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

/** Carry a legacy `when` over only if it is a well-formed at/every/cron shape. */
function validWhen(w: unknown): Record<string, string> | undefined {
  if (w === null || typeof w !== 'object') return undefined
  const o = w as Record<string, unknown>
  const at = asString(o.at)
  const every = asString(o.every)
  const cron = asString(o.cron)
  if (o.kind === 'at' && at) return { kind: 'at', at }
  if (o.kind === 'every' && every) return { kind: 'every', every }
  if (o.kind === 'cron' && cron) return { kind: 'cron', cron }
  return undefined
}

/** Filename-safe kebab id; empty when nothing usable remains. */
function sanitizeId(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
}

/** Render one legacy entry as a `<id>.md` document, or null if it has no usable id. */
function renderIssue(entry: LegacyEntry, index: number): { id: string; content: string } | null {
  const id = sanitizeId(asString(entry.id) ?? '') || sanitizeId(`issue-${index + 1}`)
  if (!id) return null
  const fm: Record<string, unknown> = { title: asString(entry.issue) ?? asString(entry.title) ?? id }
  // No `enabled` in the board model: a disabled legacy task maps to a terminal
  // status so it stops firing while staying on the board.
  if (entry.enabled === false) fm.status = 'canceled'
  const when = validWhen(entry.when)
  if (when) fm.when = when
  const what = asString(entry.what)
  if (what) fm.what = what
  const agent = asString(entry.agent)
  if (agent) fm.agent = agent
  return { id, content: `---\n${stringifyYaml(fm).trimEnd()}\n---\n` }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function writeAtomic(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, target)
}

interface WsMeta {
  dir?: unknown
}

/**
 * Convert legacy workspace declarations under `launcherRoot` to per-issue
 * markdown. Exported so the spec can drive it against a temp launcher root.
 * Returns conversion counts. Never throws on a single bad workspace/file.
 */
export async function migrateWorkspaceIssues(
  launcherRoot: string = defaultLauncherRoot(),
): Promise<{ converted: number; workspaces: number }> {
  let registryRaw: string
  try {
    registryRaw = await readFile(join(launcherRoot, 'workspaces.json'), 'utf-8')
  } catch {
    return { converted: 0, workspaces: 0 } // no launcher / no workspaces yet — fresh install
  }

  let dirs: string[]
  try {
    const parsed = JSON.parse(registryRaw) as { workspaces?: WsMeta[] }
    dirs = Array.isArray(parsed.workspaces)
      ? parsed.workspaces.map((w) => (typeof w?.dir === 'string' ? w.dir : '')).filter(Boolean)
      : []
  } catch {
    return { converted: 0, workspaces: 0 }
  }

  let converted = 0
  let touched = 0
  for (const dir of dirs) {
    try {
      const issuesDir = join(dir, '.alice', 'issues')
      if (await exists(issuesDir)) continue // already on the new format — leave it alone

      // Find the first legacy file present (interim issue.json wins over original).
      let legacyPath: string | undefined
      let legacyRaw: string | undefined
      for (const base of LEGACY_BASENAMES) {
        const p = join(dir, '.alice', base)
        try {
          legacyRaw = await readFile(p, 'utf-8')
          legacyPath = p
          break
        } catch {
          /* not this one */
        }
      }
      if (!legacyPath || legacyRaw === undefined) continue // nothing legacy here

      let entries: LegacyEntry[]
      try {
        const data = JSON.parse(legacyRaw) as { issues?: unknown; tasks?: unknown }
        const arr = Array.isArray(data.issues) ? data.issues : Array.isArray(data.tasks) ? data.tasks : []
        entries = arr as LegacyEntry[]
      } catch {
        // Unparseable legacy file: leave it in place (don't destroy data we can't
        // read) — the reader's loud hint guides a manual fix.
        console.log(`[migration 0010] ${legacyPath} is not valid JSON — left in place for manual migration`)
        continue
      }

      const usedIds = new Set<string>()
      let wsConverted = 0
      for (let i = 0; i < entries.length; i++) {
        const rendered = renderIssue(entries[i], i)
        if (!rendered) continue
        let id = rendered.id
        while (usedIds.has(id)) id = `${rendered.id}-${randomUUID().slice(0, 4)}`
        usedIds.add(id)
        await writeAtomic(join(issuesDir, `${id}.md`), rendered.content)
        wsConverted++
      }

      // Conversion succeeded (an empty legacy file is simply removed).
      await unlink(legacyPath).catch(() => {})
      converted += wsConverted
      touched++
      console.log(
        `[migration 0010] ${dir}: converted ${wsConverted} issue(s) from .alice/${legacyPath.endsWith('issue.json') ? 'issue.json' : 'schedule.json'} → .alice/issues/`,
      )
    } catch (err) {
      console.log(`[migration 0010] skipped ${dir}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { converted, workspaces: touched }
}

export const migration: Migration = {
  id: '0010_workspace_issues_to_markdown',
  appVersion: '0.60.0-beta.1',
  introducedAt: '2026-06-27',
  affects: ['workspaces/<id>/.alice/{issue,schedule}.json'],
  summary:
    'Convert legacy workspace declarations (.alice/schedule.json, .alice/issue.json) into the per-issue markdown format (.alice/issues/<id>.md) so existing self-scheduled issues survive the upgrade.',
  rationale:
    'The self-describe format moved to one markdown file per issue; the reader only understands the new shape and shows a loud error for the old files. The feature is already in use, so upgrades must convert rather than break. Data lives under the launcher root (outside data/), so the body resolves AQ_LAUNCHER_ROOT and uses raw fs.',
  up: async () => {
    await migrateWorkspaceIssues()
  },
}
