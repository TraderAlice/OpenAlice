/** 0033_semantic_issue_assignees — retire ambiguous Issue dispatch aliases. */
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import type { Migration } from '../types.js'

interface WorkspaceMeta { id?: unknown; dir?: unknown }
interface MigrationOptions { backupRoot?: string }

function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/.exec(raw.replace(/^\uFEFF/, ''))
  return match ? { frontmatter: match[1]!, body: match[2]! } : null
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(temp, content, 'utf8')
  await rename(temp, path)
}

async function migrateOne(
  path: string,
  backupPath?: string,
): Promise<boolean> {
  const raw = await readFile(path, 'utf8')
  const split = splitFrontmatter(raw)
  if (!split) return false
  let parsed: unknown
  try { parsed = parseYaml(split.frontmatter) } catch { return false }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const frontmatter = parsed as Record<string, unknown>
  const current = frontmatter.assignee
  const scheduled = frontmatter.when !== undefined
  const next = current === '@workspace'
    ? scheduled ? '@new-each-run' : '@unassigned'
    : current === '@new'
      ? '@new-then-resume'
      : null
  if (!next) return false

  if (backupPath) {
    await mkdir(dirname(backupPath), { recursive: true })
    await copyFile(path, backupPath)
  }
  frontmatter.assignee = next
  const body = split.body.startsWith('\n') || split.body.length === 0
    ? split.body
    : `\n${split.body}`
  await writeAtomic(path, `---\n${stringifyYaml(frontmatter).trimEnd()}\n---${body}`)
  return true
}

export async function migrateSemanticIssueAssignees(
  launcherRoot: string = defaultLauncherRoot(),
  options: MigrationOptions = {},
): Promise<{ updated: number; workspaces: number }> {
  let registry: { workspaces?: WorkspaceMeta[] }
  try {
    registry = JSON.parse(await readFile(join(launcherRoot, 'workspaces.json'), 'utf8')) as typeof registry
  } catch {
    return { updated: 0, workspaces: 0 }
  }

  let updated = 0
  let workspaces = 0
  for (const [index, workspace] of (registry.workspaces ?? []).entries()) {
    if (typeof workspace.dir !== 'string') continue
    const issuesDir = join(workspace.dir, '.alice', 'issues')
    let files: string[]
    try { files = (await readdir(issuesDir)).filter((name) => name.toLowerCase().endsWith('.md')) }
    catch { continue }
    const backupWorkspace = typeof workspace.id === 'string'
      ? workspace.id
      : `${index}-${basename(workspace.dir)}`
    let touched = false
    for (const file of files) {
      try {
        const backupPath = options.backupRoot
          ? join(options.backupRoot, backupWorkspace, file)
          : undefined
        if (await migrateOne(join(issuesDir, file), backupPath)) {
          updated++
          touched = true
        }
      } catch (error) {
        console.log(`[migration 0033] skipped ${join(issuesDir, file)}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (touched) workspaces++
  }
  return { updated, workspaces }
}

export const migration: Migration = {
  id: '0033_semantic_issue_assignees',
  appVersion: '0.90.0-beta',
  introducedAt: '2026-08-06',
  affects: ['workspaces/<id>/.alice/issues/*.md'],
  summary: 'Replace deprecated @workspace/@new Issue aliases with behavior-named assignee tokens.',
  rationale: 'A self-contained Issue must state whether it recruits every run or recruits once and resumes without requiring implementation history to interpret its assignee.',
  up: async (ctx) => {
    const userDataHome = resolve(ctx.configDir(), '..', '..')
    const launcherRoot = resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(userDataHome, 'workspaces'))
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    await migrateSemanticIssueAssignees(launcherRoot, {
      backupRoot: join(
        dirname(ctx.configDir()),
        '_backup',
        `${timestamp}-pre-0033_semantic_issue_assignees`,
        'issues',
      ),
    })
  },
}
