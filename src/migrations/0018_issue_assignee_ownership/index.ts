/**
 * 0018_issue_assignee_ownership
 *
 * Replace the parallel `assignee` + `execution` Issue ownership model with one
 * assignee contract:
 *   workspace | human | unassigned | session:<resumeId>
 *
 * Scheduled Issues are always workspace- or Session-owned. A Session owns its
 * runtime, so the old top-level agent override is removed in that case.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import type { Migration } from '../types.js'

interface WorkspaceMeta { dir?: unknown }

function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } | null {
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) return null
  return { frontmatter: lines.slice(1, end).join('\n'), body: lines.slice(end + 1).join('\n') }
}

function sessionAssignee(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^session:[^\s:][^\s]*$/.test(trimmed) ? trimmed : null
}

function migratedAssignee(frontmatter: Record<string, unknown>): string {
  const execution = frontmatter.execution
  if (execution && typeof execution === 'object' && !Array.isArray(execution)) {
    const record = execution as Record<string, unknown>
    if (record.mode === 'resume' && typeof record.resumeId === 'string' && record.resumeId.trim()) {
      return `session:${record.resumeId.trim()}`
    }
  }

  const existingSession = sessionAssignee(frontmatter.assignee)
  if (existingSession) return existingSession
  if (frontmatter.when !== undefined) return 'workspace'
  if (frontmatter.assignee === 'human' || frontmatter.assignee === 'unassigned') {
    return frontmatter.assignee
  }
  return 'workspace'
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(temp, content, 'utf8')
  await rename(temp, path)
}

async function normalizeIssue(path: string): Promise<boolean> {
  const raw = await readFile(path, 'utf8')
  const split = splitFrontmatter(raw)
  if (!split) return false

  let parsed: unknown
  try { parsed = parseYaml(split.frontmatter) } catch { return false }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false

  const frontmatter = parsed as Record<string, unknown>
  const assignee = migratedAssignee(frontmatter)
  frontmatter.assignee = assignee
  delete frontmatter.execution
  if (assignee.startsWith('session:')) delete frontmatter.agent

  const fm = stringifyYaml(frontmatter).trimEnd()
  const body = split.body.startsWith('\n') ? split.body : `\n${split.body}`
  const content = `---\n${fm}\n---${body}`
  if (content === raw) return false
  await writeAtomic(path, content)
  return true
}

export async function migrateIssueAssigneeOwnership(
  launcherRoot: string = defaultLauncherRoot(),
): Promise<{ updated: number; workspaces: number }> {
  let registry: { workspaces?: WorkspaceMeta[] }
  try { registry = JSON.parse(await readFile(join(launcherRoot, 'workspaces.json'), 'utf8')) as typeof registry }
  catch { return { updated: 0, workspaces: 0 } }

  const dirs = Array.isArray(registry.workspaces)
    ? registry.workspaces.map((workspace) => typeof workspace.dir === 'string' ? workspace.dir : '').filter(Boolean)
    : []
  let updated = 0
  let workspaces = 0
  for (const dir of dirs) {
    const issuesDir = join(dir, '.alice', 'issues')
    let files: string[]
    try { files = (await readdir(issuesDir)).filter((name) => name.toLowerCase().endsWith('.md')) }
    catch { continue }
    let touched = false
    for (const file of files) {
      try {
        if (await normalizeIssue(join(issuesDir, file))) {
          updated++
          touched = true
        }
      } catch (err) {
        console.log(`[migration 0018] skipped ${join(issuesDir, file)}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (touched) workspaces++
  }
  return { updated, workspaces }
}

export const migration: Migration = {
  id: '0018_issue_assignee_ownership',
  appVersion: '0.80.0-beta',
  introducedAt: '2026-07-12',
  affects: ['workspaces/<id>/.alice/issues/*.md'],
  summary: 'Replace Issue execution ownership with one workspace, human, unassigned, or Session assignee.',
  rationale: 'Schedule is an intrinsic Issue capability; assignee must be the single ownership and dispatch contract.',
  up: async () => { await migrateIssueAssigneeOwnership() },
}
