/** 0019_issue_session_signatures — make Issue ownership use the same
 * human-readable `@resumeId` signature agents place in Markdown artifacts. */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import type { Migration } from '../types.js'

interface WorkspaceMeta { dir: string }

function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/.exec(raw)
  return match ? { frontmatter: match[1]!, body: match[2]! } : null
}

function signedAssignee(value: unknown): string {
  if (typeof value !== 'string') return '@workspace'
  if (value.startsWith('session:')) return `@${value.slice('session:'.length)}`
  if (value === 'human') return '@human'
  if (value === 'unassigned') return '@unassigned'
  if (value === 'workspace') return '@workspace'
  return value
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
}

async function migrateOne(path: string): Promise<boolean> {
  const raw = await readFile(path, 'utf8')
  const split = splitFrontmatter(raw)
  if (!split) return false
  let parsed: unknown
  try { parsed = parseYaml(split.frontmatter) } catch { return false }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const frontmatter = parsed as Record<string, unknown>
  const next = signedAssignee(frontmatter.assignee)
  if (frontmatter.assignee === next) return false
  frontmatter.assignee = next
  const body = split.body.startsWith('\n') ? split.body : `\n${split.body}`
  await writeAtomic(path, `---\n${stringifyYaml(frontmatter).trimEnd()}\n---${body}`)
  return true
}

export async function migrateIssueSessionSignatures(
  launcherRoot: string = defaultLauncherRoot(),
): Promise<{ updated: number; workspaces: number }> {
  let registry: { workspaces?: WorkspaceMeta[] }
  try { registry = JSON.parse(await readFile(join(launcherRoot, 'workspaces.json'), 'utf8')) as typeof registry }
  catch { return { updated: 0, workspaces: 0 } }
  let updated = 0
  let workspaces = 0
  for (const ws of registry.workspaces ?? []) {
    const dir = join(ws.dir, '.alice', 'issues')
    let files: string[]
    try { files = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.md')) }
    catch { continue }
    let touched = false
    for (const file of files) {
      try {
        if (await migrateOne(join(dir, file))) { updated++; touched = true }
      } catch (err) {
        console.log(`[migration 0019] skipped ${join(dir, file)}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (touched) workspaces++
  }
  return { updated, workspaces }
}

export const migration: Migration = {
  id: '0019_issue_session_signatures',
  appVersion: '0.80.0-beta',
  introducedAt: '2026-07-12',
  affects: ['workspaces/<id>/.alice/issues/*.md'],
  summary: 'Write Issue ownership as @workspace or an exact @resumeId Session signature.',
  rationale: 'One visible signature syntax should identify accountable Sessions across Issue and Markdown artifacts.',
  up: async () => { await migrateIssueSessionSignatures() },
}
