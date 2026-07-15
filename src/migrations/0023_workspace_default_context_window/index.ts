import { DEFAULT_WORKSPACE_CONTEXT_WINDOW } from '@/core/workspace-defaults.js'
import type { Migration } from '../types.js'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface WorkspaceDefaultContextMigrationResult {
  readonly changed: boolean
  readonly value: unknown
}

/** Add an explicit safe context preference to existing Pi/OpenCode defaults. */
export function addWorkspaceDefaultContextWindows(
  raw: unknown,
): WorkspaceDefaultContextMigrationResult {
  if (!isRecord(raw) || !isRecord(raw.workspaceCredentialDefaults)) {
    return { changed: false, value: raw }
  }

  const nextDefaults: JsonRecord = { ...raw.workspaceCredentialDefaults }
  let changed = false
  for (const agentId of ['opencode', 'pi']) {
    const current = nextDefaults[agentId]
    if (!isRecord(current) || typeof current.credentialSlug !== 'string' || !current.credentialSlug) {
      continue
    }
    if (
      typeof current.contextWindow === 'number' &&
      Number.isInteger(current.contextWindow) &&
      current.contextWindow > 0
    ) {
      continue
    }
    nextDefaults[agentId] = {
      ...current,
      contextWindow: DEFAULT_WORKSPACE_CONTEXT_WINDOW,
    }
    changed = true
  }

  return changed
    ? { changed: true, value: { ...raw, workspaceCredentialDefaults: nextDefaults } }
    : { changed: false, value: raw }
}

export const migration: Migration = {
  id: '0023_workspace_default_context_window',
  appVersion: '0.81.0-beta',
  introducedAt: '2026-07-15',
  affects: ['ai-provider-manager.json'],
  summary: 'Make the 256K Pi/OpenCode context limit explicit in existing new-Workspace credential defaults.',
  up: async (ctx) => {
    const raw = await ctx.readJson('ai-provider-manager.json')
    const result = addWorkspaceDefaultContextWindows(raw)
    if (result.changed) await ctx.writeJson('ai-provider-manager.json', result.value)
  },
}
