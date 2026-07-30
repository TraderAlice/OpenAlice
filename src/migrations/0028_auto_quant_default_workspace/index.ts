/**
 * 0028_auto_quant_default_workspace — introduce explicit AutoQuant readiness.
 *
 * Existing AutoQuant Workspaces are deliberately not selected automatically.
 * The AutoQuant entry asks the user which durable desk should become the
 * default, preserving the distinction between initialization and selection.
 */

import type { Migration } from '../types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function addAutoQuantDefaultWorkspacePreference(raw: unknown): {
  value: unknown
  updated: boolean
} {
  if (!isRecord(raw)) {
    return {
      value: {
        version: 1,
        quickChat: {
          lastCredentialByAgent: {},
          recentChatWorkspaceId: null,
        },
        autoQuant: { defaultWorkspaceId: null },
      },
      updated: true,
    }
  }
  if (isRecord(raw['autoQuant']) && 'defaultWorkspaceId' in raw['autoQuant']) {
    return { value: raw, updated: false }
  }
  return {
    value: {
      ...raw,
      version: 1,
      autoQuant: { defaultWorkspaceId: null },
    },
    updated: true,
  }
}

export const migration: Migration = {
  id: '0028_auto_quant_default_workspace',
  appVersion: '0.87.0-beta',
  introducedAt: '2026-07-30',
  affects: ['data/preferences.json'],
  summary: 'Add the explicit default Workspace pointer that defines whether AutoQuant is initialized.',
  rationale:
    'AutoQuant uses one durable desk by default; Workspace creation and switching are initialization concerns rather than daily research actions.',
  up: async (ctx) => {
    const path = '../preferences.json'
    const migrated = addAutoQuantDefaultWorkspacePreference(await ctx.readJson(path))
    if (migrated.updated) await ctx.writeJson(path, migrated.value)
  },
}
