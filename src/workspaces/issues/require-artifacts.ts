/**
 * Optional post-run artifact gate for scheduled headless issues.
 *
 * Exit code 0 only means "the agent process exited cleanly" — pi/claude can
 * still exit 0 after reporting failure in-band. When an issue declares
 * `requireArtifacts`, a successful run must also leave matching files in the
 * workspace that were written during (or just after) the run window.
 */

import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { readWorkspaceIssues } from './declaration.js'

/** Clock skew / FS mtime granularity slack when comparing against startedAt. */
const MTIME_SLACK_MS = 60_000

export interface VerifyIssueArtifactsInput {
  wsDir: string
  issueId: string
  /** Headless run start time (ms). Matching files must be at least this fresh. */
  sinceMs: number
}

export type VerifyIssueArtifactsResult =
  | { ok: true; checked: string[] }
  | { ok: true; skipped: true; reason: 'no_requirements' | 'issue_unavailable' }
  | { ok: false; error: string; missing: string[] }

/**
 * Glob a single path pattern relative to `wsDir`.
 * Supports one `*` in the final path segment only (e.g. `outputs/foo-*.md`).
 */
export async function matchWorkspaceArtifact(
  wsDir: string,
  pattern: string,
  sinceMs: number,
): Promise<string[]> {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('..')) return []

  const star = normalized.lastIndexOf('*')
  if (star === -1) {
    const abs = join(wsDir, normalized)
    try {
      const st = await stat(abs)
      if (st.isFile() && st.mtimeMs >= sinceMs - MTIME_SLACK_MS) return [normalized]
    } catch { /* missing */ }
    return []
  }

  // Only allow a single * in the basename.
  const dirPart = dirname(normalized)
  const basePat = basename(normalized)
  if (basePat.indexOf('*') !== basePat.lastIndexOf('*')) return []
  if (dirPart.includes('*')) return []

  const [prefix, suffix] = basePat.split('*')
  const absDir = join(wsDir, dirPart === '.' ? '' : dirPart)
  let names: string[]
  try {
    names = await readdir(absDir)
  } catch {
    return []
  }

  const hits: string[] = []
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue
    if (prefix.length + suffix.length > name.length) continue
    const rel = dirPart === '.' ? name : join(dirPart, name)
    try {
      const st = await stat(join(wsDir, rel))
      if (st.isFile() && st.mtimeMs >= sinceMs - MTIME_SLACK_MS) hits.push(rel.replace(/\\/g, '/'))
    } catch { /* race */ }
  }
  return hits.sort()
}

/**
 * If the issue declares `requireArtifacts`, every pattern must match ≥1 fresh
 * file. Issues without the field are a no-op (skipped).
 */
export async function verifyIssueArtifacts(
  input: VerifyIssueArtifactsInput,
): Promise<VerifyIssueArtifactsResult> {
  const res = await readWorkspaceIssues(input.wsDir)
  if (!res.ok) return { ok: true, skipped: true, reason: 'issue_unavailable' }

  const issue = res.issues.find((i) => i.id === input.issueId)
  if (!issue) return { ok: true, skipped: true, reason: 'issue_unavailable' }

  const required = issue.requireArtifacts ?? []
  if (required.length === 0) return { ok: true, skipped: true, reason: 'no_requirements' }

  const missing: string[] = []
  const checked: string[] = []
  for (const pattern of required) {
    const hits = await matchWorkspaceArtifact(input.wsDir, pattern, input.sinceMs)
    if (hits.length === 0) missing.push(pattern)
    else checked.push(...hits)
  }

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      error:
        `required artifacts missing or stale (not written during this run): ${missing.join(', ')}. ` +
        `Exit code 0 is not enough — the scheduled issue requires these files.`,
    }
  }
  return { ok: true, checked }
}
