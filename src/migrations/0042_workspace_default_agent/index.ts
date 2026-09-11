import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import type { Migration } from '../types.js'

// Snapshot only this migration's destination boundary, independent of runtime
// config loading and future schema changes. Preserve all other preference fields.
const modeSchema = z.object({ defaultAgent: z.string().trim().min(1).max(64).optional() }).passthrough().default({})
const settingsSchema = z.object({
  version: z.literal(3),
  runtime: z.object({ interactive: modeSchema, headless: modeSchema }).passthrough().default({ interactive: {}, headless: {} }),
}).passthrough()
const emptySettings = () => ({
  version: 3 as const,
  runtime: {
    interactive: { agents: {}, recent: { agents: {} } },
    headless: { agents: {}, recent: { agents: {} } },
  },
})

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid object: ${path}`)
    return value as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, path)
}

export async function migrateWorkspaceDefaultAgent(launcherRoot: string): Promise<void> {
  const catalog = await readJson(join(launcherRoot, 'state', 'workspace-catalog.json'))
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.workspaces)) return
  for (const row of catalog.workspaces) {
    if (!row || typeof row !== 'object') continue
    if (row.lifecycle === 'purged' || row.lifecycle === 'purging' || typeof row.activeDir !== 'string') continue
    const metadataPath = join(row.activeDir, '.alice', 'workspace.json')
    const metadata = await readJson(metadataPath)
    if (!metadata || !Object.hasOwn(metadata, 'defaultAgent')) continue
    const agent = metadata.defaultAgent
    if (typeof agent !== 'string' || !agent.trim()) throw new Error(`invalid defaultAgent: ${metadataPath}`)
    const settingsPath = join(row.activeDir, '.alice', 'settings.json')
    const raw = await readJson(settingsPath)
    const settings = settingsSchema.parse(raw ?? emptySettings())
    // Fixed mode defaults win over the old generic fallback. Save the destination
    // first so an interrupted migration can safely resume without losing a choice.
    if (!settings.runtime.interactive.defaultAgent) {
      settings.runtime.interactive.defaultAgent = agent.trim()
      await writeJson(settingsPath, settings)
    }
    delete metadata.defaultAgent
    await writeJson(metadataPath, metadata)
  }
}

export const migration: Migration = {
  id: '0042_workspace_default_agent',
  appVersion: '0.92.1',
  introducedAt: '2026-09-10',
  affects: ['workspaces/*/.alice/workspace.json', 'workspaces/*/.alice/settings.json'],
  summary: 'Move the legacy Workspace default Agent into interactive runtime settings, preserving pinned defaults and Session bindings.',
  up: async (ctx) => migrateWorkspaceDefaultAgent(ctx.launcherRoot()),
}
