/**
 * entity_search — the agent's live lookup of what the user is already
 * tracking, so it reuses an existing `[[name]]` instead of creating a
 * near-duplicate.
 *
 * Why a live tool and not injected context: a workspace's context (CLAUDE.md
 * etc.) is written once, at creation time. A long-running workspace would be
 * blind to entities created after it started — so a static "here are the
 * tracked entities" snapshot can't keep dedup honest. This tool reads the
 * store fresh on every call.
 */

import { tool } from 'ai'
import { z } from 'zod'

import type { WorkspaceToolFactory, WorkspaceToolContext } from '../core/workspace-tool-center.js'

export const entitySearchFactory: WorkspaceToolFactory = {
  name: 'entity_search',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        "Search the user's tracked entities by name or description.",
        'Call this before creating a new entity, to reuse an existing name and avoid duplicates',
        '(write `[[stock-vst]]` consistently rather than also inventing `[[vst]]`).',
        'Pass an empty query to list everything currently tracked.',
      ].join(' '),
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe(
            'Substring matched against entity name + description (case-insensitive). Empty or omitted = list all.',
          ),
      }),
      execute: async ({ query }) => {
        try {
          const entities = await ctx.entityStore.search(query ?? '')
          return {
            ok: true as const,
            entities: entities.map((e) => ({ name: e.name, type: e.type, description: e.description })),
          }
        } catch (err) {
          return {
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      },
    })
  },
}
