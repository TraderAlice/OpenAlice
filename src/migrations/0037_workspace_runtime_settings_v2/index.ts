import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { z } from 'zod'

import type { Migration } from '../types.js'

const WORKSPACE_RUNTIME_SETTINGS_REL = '.alice/settings.json'
const runtimeIdSchema = z.string().trim().min(1).max(64)
const modelSchema = z.string().trim().min(1).max(512)
const credentialSlugSchema = z.string().trim().min(1).max(128)
const reasoningEffortSchema = z.enum([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
])
const wireShapeSchema = z.enum([
  'anthropic',
  'google-generative-ai',
  'openai-chat',
  'openai-responses',
])
const workspaceRuntimePreferenceSchema = z.discriminatedUnion('accessMode', [
  z.object({
    accessMode: z.literal('native'),
    model: modelSchema.optional(),
    reasoningEffort: reasoningEffortSchema.optional(),
  }).strict(),
  z.object({
    accessMode: z.literal('vault'),
    credentialSlug: credentialSlugSchema,
    wireShape: wireShapeSchema.optional(),
    model: modelSchema.optional(),
    reasoningEffort: reasoningEffortSchema.optional(),
  }).strict(),
])
const currentRecentSchema = z.object({
  agent: runtimeIdSchema.optional(),
  agents: z.record(runtimeIdSchema, workspaceRuntimePreferenceSchema).default({}),
}).strict()
const currentScenarioSchema = z.object({
  defaultAgent: runtimeIdSchema.optional(),
  agents: z.record(runtimeIdSchema, workspaceRuntimePreferenceSchema).default({}),
  recent: currentRecentSchema.default({ agents: {} }),
}).strict()
const workspaceRuntimeSettingsSchema = z.object({
  version: z.literal(2),
  runtime: z.object({
    askAlice: currentScenarioSchema.default({ agents: {}, recent: { agents: {} } }),
    issues: currentScenarioSchema.default({ agents: {}, recent: { agents: {} } }),
  }).strict(),
}).strict()
type WorkspaceRuntimeSettings = z.infer<typeof workspaceRuntimeSettingsSchema>

const legacyScenarioSchema = z.object({
  recentAgent: runtimeIdSchema.optional(),
  agents: z.record(runtimeIdSchema, workspaceRuntimePreferenceSchema).default({}),
}).strict().default({ agents: {} })

const legacySettingsSchema = z.object({
  version: z.literal(1),
  runtime: z.object({
    interactive: legacyScenarioSchema,
    headless: legacyScenarioSchema,
  }).strict().default({ interactive: { agents: {} }, headless: { agents: {} } }),
}).strict()

interface WorkspaceDirectory {
  readonly kind: 'active' | 'departed'
  readonly name: string
  readonly dir: string
}

interface MigrationOptions {
  readonly backupRoot?: string
}

async function workspaceDirectories(
  root: string,
  kind: WorkspaceDirectory['kind'],
): Promise<WorkspaceDirectory[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ kind, name: entry.name, dir: join(root, entry.name) }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function upgradeLegacySettings(
  legacy: z.infer<typeof legacySettingsSchema>,
): WorkspaceRuntimeSettings {
  return workspaceRuntimeSettingsSchema.parse({
    version: 2,
    runtime: {
      askAlice: {
        agents: {},
        recent: {
          ...(legacy.runtime.interactive.recentAgent
            ? { agent: legacy.runtime.interactive.recentAgent }
            : {}),
          agents: legacy.runtime.interactive.agents,
        },
      },
      issues: {
        agents: {},
        recent: {
          ...(legacy.runtime.headless.recentAgent
            ? { agent: legacy.runtime.headless.recentAgent }
            : {}),
          agents: legacy.runtime.headless.agents,
        },
      },
    },
  })
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

export async function migrateWorkspaceRuntimeSettingsV2(
  launcherRoot: string,
  options: MigrationOptions = {},
): Promise<{ scanned: number; migrated: number; current: number; skipped: number }> {
  const workspaces = [
    ...await workspaceDirectories(join(launcherRoot, 'workspaces'), 'active'),
    ...await workspaceDirectories(join(launcherRoot, 'departed-workspaces'), 'departed'),
  ]
  let migrated = 0
  let current = 0
  let skipped = 0

  for (const workspace of workspaces) {
    const path = join(workspace.dir, WORKSPACE_RUNTIME_SETTINGS_REL)
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      skipped += 1
      console.warn(
        `[migration] kept invalid Workspace runtime settings at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }

    if (workspaceRuntimeSettingsSchema.safeParse(parsed).success) {
      current += 1
      continue
    }
    const legacy = legacySettingsSchema.safeParse(parsed)
    if (!legacy.success) {
      skipped += 1
      console.warn(`[migration] kept unrecognized Workspace runtime settings at ${path}`)
      continue
    }

    if (options.backupRoot) {
      const backup = join(
        options.backupRoot,
        workspace.kind,
        workspace.name,
        WORKSPACE_RUNTIME_SETTINGS_REL,
      )
      await mkdir(dirname(backup), { recursive: true })
      await copyFile(path, backup)
    }
    await atomicWrite(path, `${JSON.stringify(upgradeLegacySettings(legacy.data), null, 2)}\n`)
    migrated += 1
  }

  return { scanned: workspaces.length, migrated, current, skipped }
}

export const migration: Migration = {
  id: '0037_workspace_runtime_settings_v2',
  appVersion: '0.89.2-beta',
  introducedAt: '2026-08-10',
  affects: [
    'workspaces/workspaces/*/.alice/settings.json',
    'workspaces/departed-workspaces/*/.alice/settings.json',
  ],
  summary: 'Convert legacy interactive/headless Workspace runtime preferences to scenario-aware settings.',
  rationale: 'A one-time migration keeps the normal runtime reader single-version while preserving prior successful launch choices as recent fallbacks.',
  up: async (ctx) => {
    const userDataHome = resolve(ctx.configDir(), '..', '..')
    const launcherRoot = resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(userDataHome, 'workspaces'))
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRoot = join(
      dirname(ctx.configDir()),
      '_backup',
      `${timestamp}-pre-0037_workspace_runtime_settings_v2`,
      'workspace-runtime-settings',
    )
    await migrateWorkspaceRuntimeSettingsV2(launcherRoot, { backupRoot })
  },
}
