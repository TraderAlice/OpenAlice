import { tool } from 'ai'
import { z } from 'zod'

import type { WorkspaceToolFactory, WorkspaceToolContext } from '../core/workspace-tool-center.js'

/** Explicitly stop tracking one named anchor; never infer lifecycle from backlinks. */
export const entityRemoveFactory: WorkspaceToolFactory = {
  name: 'entity_remove',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        'Preview removal of one exact named entity from the shared tracked index.',
        'Only apply when the user explicitly asks to stop tracking that entity; pass apply=true.',
        'Zero backlinks are not evidence that an entity is obsolete.',
        'Removes only the index anchor, never reports, authored links, Issues, Inbox or provenance.',
        'This is removal, not archive: use entity_upsert to track the name again.',
      ].join(' '),
      inputSchema: z.object({
        name: z.string().trim().min(1).regex(/^\S+$/).describe('Exact entity name, case-insensitive. No search or bulk removal.'),
        apply: z.boolean().optional().describe('Explicitly apply the reviewed removal. Omit to preview without writing.'),
      }),
      execute: async ({ name, apply }) => {
        try {
          if (!apply) return { ok: true, applied: false, entity: await ctx.entityStore.get(name) }
          return { ok: true, applied: true, name, removed: await ctx.entityStore.delete(name) }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  },
}
