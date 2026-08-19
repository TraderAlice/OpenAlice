import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import type { Migration } from '../types.js'

const CATALOG_REL = join('state', 'workspace-catalog.json')
const ISSUES_REL = join('.alice', 'issues')

export async function migrateConnectorDeskFlag(launcherRoot: string): Promise<void> {
  const catalog = await readOptionalJson(join(launcherRoot, CATALOG_REL))
  for (const dir of workspaceDirs(catalog)) {
    await rewriteWorkspaceIssues(dir)
  }
}

async function rewriteWorkspaceIssues(wsDir: string): Promise<void> {
  let files: string[]
  try {
    files = (await readdir(join(wsDir, ISSUES_REL))).filter((name) => name.endsWith('.md'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const file of files) {
    const path = join(wsDir, ISSUES_REL, file)
    const raw = await readFile(path, 'utf8')
    const next = rewriteIssueDocument(raw)
    if (next !== raw) await atomicWrite(path, next)
  }
}

async function atomicWrite(path: string, value: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, value, 'utf8')
  await rename(temporary, path)
}

export function rewriteIssueDocument(raw: string): string {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return raw
  const parsed = parseYaml(match[1] ?? '')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw
  const data = parsed as Record<string, unknown>
  if (data.telegramConnector !== true) return raw
  if (typeof data.connectorDesk === 'string' && data.connectorDesk !== 'telegram') return raw
  data.connectorDesk = 'telegram'
  delete data.telegramConnector
  const body = match[2] ?? ''
  return `---\n${stringifyYaml(data).trimEnd()}\n---\n${body.startsWith('\n') ? body : `\n${body}`}`
}

function workspaceDirs(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const root = value as Record<string, unknown>
  if (root['version'] !== 1 || !Array.isArray(root['workspaces'])) return []
  return root['workspaces'].flatMap((row): string[] => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return []
    const rec = row as Record<string, unknown>
    if (rec['lifecycle'] === 'purged' || rec['lifecycle'] === 'purging') return []
    return typeof rec['activeDir'] === 'string' ? [rec['activeDir']] : []
  })
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export const migration: Migration = {
  id: '0041_connector_desk_flag',
  appVersion: '0.89.5-beta',
  introducedAt: '2026-08-19',
  affects: [
    'workspaces/*/.alice/issues/*.md',
  ],
  summary: 'Rewrite shipped telegramConnector: true Issue flags to connectorDesk: telegram.',
  up: async (ctx) => {
    await migrateConnectorDeskFlag(ctx.launcherRoot())
  },
}
