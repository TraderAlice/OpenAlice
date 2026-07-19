/**
 * Retire Alice's legacy in-process compaction policy.
 *
 * Native Workspace Agent CLIs own their model loops and context management.
 * Keeping a global context/output limit beside model and Workspace semantics
 * creates an ambiguous policy layer even when no current adapter consumes it.
 */

import type { Migration } from '../types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function retireGlobalContextDefault(raw: unknown): { value: unknown; updated: boolean } {
  if (!isRecord(raw) || !Object.prototype.hasOwnProperty.call(raw, 'workspaceDefaultContextWindow')) {
    return { value: raw, updated: false }
  }
  const { workspaceDefaultContextWindow: _retired, ...value } = raw
  return { value, updated: true }
}

export const migration: Migration = {
  id: '0025_retire_global_compaction_config',
  appVersion: '0.83.0-beta',
  introducedAt: '2026-07-19',
  affects: ['compaction.json', 'ai-provider-manager.json'],
  summary: 'Remove retired global context and compaction limits so model and native Agent runtime semantics remain authoritative.',
  rationale: 'Context and output limits belong to the selected model and Workspace runtime, never a global Alice override.',
  up: async (ctx) => {
    await ctx.removeJson('compaction.json')
    const providerConfig = await ctx.readJson('ai-provider-manager.json')
    const migrated = retireGlobalContextDefault(providerConfig)
    if (migrated.updated) await ctx.writeJson('ai-provider-manager.json', migrated.value)
  },
}
