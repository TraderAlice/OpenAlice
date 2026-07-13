/**
 * 0011_workspace_issue_assignee_defaults — retire materialized `unassigned`
 * defaults in workspace issue files.
 *
 * Issue files live inside each workspace checkout, not under data/config. Early
 * issue writers sometimes materialized the old board default as
 * `assignee: unassigned`. The board model now treats a missing assignee as
 * "owned by this workspace" (`ws:<tag>`), which better matches workspace
 * self-description. This migration deletes only that legacy default value; any
 * other explicit assignee survives untouched.
 */

import { randomUUID } from 'node:crypto'
import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import type { Migration } from '../types.js'

function defaultLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

interface WsMeta {
  dir?: unknown
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } | null {
  const text = raw.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end === -1) return null
  return {
    frontmatter: lines.slice(1, end).join('\n'),
    body: lines.slice(end + 1).join('\n'),
  }
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
  const tmp = join(dirname(target), `.${randomUUID()}.tmp`)
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, target)
}

async function normalizeIssueFile(path: string): Promise<boolean> {
  const raw = await readFile(path, 'utf-8')
  const split = splitFrontmatter(raw)
  if (!split) return false

  let data: unknown
  try {
    data = parseYaml(split.frontmatter)
  } catch {
    return false
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return false
  const frontmatter = data as Record<string, unknown>
  if (frontmatter.assignee !== 'unassigned') return false

  delete frontmatter.assignee
  const fm = stringifyYaml(frontmatter).trimEnd()
  const content = split.body.length > 0 ? `---\n${fm}\n---\n${split.body}` : `---\n${fm}\n---\n`
  await writeAtomic(path, content)
  return true
}

export async function migrateWorkspaceIssueAssigneeDefaults(
  launcherRoot: string = defaultLauncherRoot(),
): Promise<{ updated: number; workspaces: number }> {
  let registryRaw: string
  try {
    registryRaw = await readFile(join(launcherRoot, 'workspaces.json'), 'utf-8')
  } catch {
    return { updated: 0, workspaces: 0 }
  }

  let dirs: string[]
  try {
    const parsed = JSON.parse(registryRaw) as { workspaces?: WsMeta[] }
    dirs = Array.isArray(parsed.workspaces)
      ? parsed.workspaces.map((w) => (typeof w?.dir === 'string' ? w.dir : '')).filter(Boolean)
      : []
  } catch {
    return { updated: 0, workspaces: 0 }
  }

  let updated = 0
  let touchedWorkspaces = 0
  for (const dir of dirs) {
    const issuesDir = join(dir, '.alice', 'issues')
    if (!(await exists(issuesDir))) continue
    let files: string[]
    try {
      files = (await readdir(issuesDir)).filter((name) => name.toLowerCase().endsWith('.md'))
    } catch {
      continue
    }

    let touched = 0
    for (const file of files) {
      try {
        if (await normalizeIssueFile(join(issuesDir, file))) touched++
      } catch (err) {
        console.log(`[migration 0011] skipped ${join(issuesDir, file)}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (touched > 0) {
      updated += touched
      touchedWorkspaces++
      console.log(`[migration 0011] ${dir}: normalized ${touched} issue assignee default(s)`)
    }
  }
  return { updated, workspaces: touchedWorkspaces }
}

export const migration: Migration = {
  id: '0011_workspace_issue_assignee_defaults',
  appVersion: '0.72.0-beta',
  introducedAt: '2026-07-04',
  affects: ['workspaces/<id>/.alice/issues/*.md'],
  summary:
    'Remove legacy `assignee: unassigned` defaults from workspace issue files so missing assignees resolve to the owning workspace.',
  rationale:
    'Workspace issues are self-description files. A missing assignee should mean the workspace owns the issue; older files sometimes persisted the previous unassigned default, which made the board look ownerless.',
  up: async () => {
    await migrateWorkspaceIssueAssigneeDefaults()
  },
}
