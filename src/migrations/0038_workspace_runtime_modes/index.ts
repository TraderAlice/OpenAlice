import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { z } from 'zod'

import type { Migration } from '../types.js'

const SETTINGS_REL = '.alice/settings.json'
const runtimeId = z.string().trim().min(1).max(64)
const preference = z.discriminatedUnion('accessMode', [
  z.object({
    accessMode: z.literal('native'),
    model: z.string().trim().min(1).max(512).optional(),
    reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
  }).strict(),
  z.object({
    accessMode: z.literal('vault'),
    credentialSlug: z.string().trim().min(1).max(128),
    wireShape: z.enum(['anthropic', 'google-generative-ai', 'openai-chat', 'openai-responses']).optional(),
    model: z.string().trim().min(1).max(512).optional(),
    reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
  }).strict(),
])
const recent = z.object({
  agent: runtimeId.optional(),
  agents: z.record(runtimeId, preference).default({}),
}).strict()
const mode = z.object({
  defaultAgent: runtimeId.optional(),
  agents: z.record(runtimeId, preference).default({}),
  recent: recent.default({ agents: {} }),
}).strict()
const v2 = z.object({
  version: z.literal(2),
  runtime: z.object({ askAlice: mode, issues: mode }).strict(),
}).strict()
const v3 = z.object({
  version: z.literal(3),
  runtime: z.object({ interactive: mode, headless: mode }).strict(),
}).strict()

interface WorkspaceDirectory {
  readonly kind: 'active' | 'departed'
  readonly name: string
  readonly dir: string
}

async function workspaceDirectories(root: string, kind: WorkspaceDirectory['kind']): Promise<WorkspaceDirectory[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ kind, name: entry.name, dir: join(root, entry.name) }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

export async function migrateWorkspaceRuntimeModes(
  launcherRoot: string,
  options: { readonly backupRoot?: string } = {},
): Promise<{ scanned: number; migrated: number; current: number; skipped: number }> {
  const workspaces = [
    ...await workspaceDirectories(join(launcherRoot, 'workspaces'), 'active'),
    ...await workspaceDirectories(join(launcherRoot, 'departed-workspaces'), 'departed'),
  ]
  let migrated = 0
  let current = 0
  let skipped = 0

  for (const workspace of workspaces) {
    const path = join(workspace.dir, SETTINGS_REL)
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      skipped += 1
      console.warn(`[migration] kept invalid Workspace runtime settings at ${path}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    if (v3.safeParse(parsed).success) {
      current += 1
      continue
    }
    const source = v2.safeParse(parsed)
    if (!source.success) {
      skipped += 1
      console.warn(`[migration] kept unrecognized Workspace runtime settings at ${path}`)
      continue
    }

    if (options.backupRoot) {
      const backup = join(options.backupRoot, workspace.kind, workspace.name, SETTINGS_REL)
      await mkdir(dirname(backup), { recursive: true })
      await copyFile(path, backup)
    }
    const target = v3.parse({
      version: 3,
      runtime: {
        interactive: source.data.runtime.askAlice,
        headless: source.data.runtime.issues,
      },
    })
    await atomicWrite(path, `${JSON.stringify(target, null, 2)}\n`)
    migrated += 1
  }

  return { scanned: workspaces.length, migrated, current, skipped }
}

export const migration: Migration = {
  id: '0038_workspace_runtime_modes',
  appVersion: '0.89.2-beta',
  introducedAt: '2026-08-10',
  affects: [
    'workspaces/workspaces/*/.alice/settings.json',
    'workspaces/departed-workspaces/*/.alice/settings.json',
  ],
  summary: 'Rename Workspace runtime settings from entry surfaces to interactive and headless launch modes.',
  rationale: 'Mode-based keys keep the durable settings portable across Ask Alice, Issues, automation, CLI, and API entry surfaces.',
  up: async (ctx) => {
    const userDataHome = resolve(ctx.configDir(), '..', '..')
    const launcherRoot = resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(userDataHome, 'workspaces'))
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = join(
      dirname(ctx.configDir()),
      '_backup',
      `${timestamp}-pre-0038_workspace_runtime_modes`,
      'workspace-runtime-settings',
    )
    await migrateWorkspaceRuntimeModes(launcherRoot, { backupRoot })
  },
}
