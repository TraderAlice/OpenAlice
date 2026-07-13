/**
 * inbox_read — workspace's inbound view of the user's inbox.
 *
 * The read counterpart to {@link inboxPushFactory}. inbox_push is the
 * outbound channel (workspace → user); this is the agent looking *back*
 * at what has landed in the inbox — its own prior pushes ("what did I
 * already report?") or the full cross-workspace stream.
 *
 * Same workspace-scoped factory shape: the agent sees only `{ self?,
 * limit? }`; the workspaceId is baked in by the gateway from `/cli/:wsId`
 * (or `/mcp/:wsId`), so `--self` can filter to *this* workspace without
 * the agent ever naming its own id.
 *
 * The `self` case is the load-bearing one: an entry's `docs` are paths
 * relative to the workspace that pushed it. For self-entries that root IS
 * the agent's own cwd, so once it has the paths back it reads the files
 * with ordinary shell tools — no cross-workspace file API needed. Foreign
 * entries' doc paths are relative to *another* workspace's root and are
 * surfaced for awareness only, not directly readable from here.
 */

import { tool } from 'ai'
import { z } from 'zod'
import {
  toSafeInboxOrigin,
  type WorkspaceToolFactory,
  type WorkspaceToolContext,
} from '../core/workspace-tool-center.js'

const DEFAULT_LIMIT = 20

export const inboxReadFactory: WorkspaceToolFactory = {
  name: 'inbox_read',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        "Read recent entries from the user's inbox — the push log workspaces post finished work and questions to.",
        '',
        'Use this to recall what you already reported, or to see the broader stream of what every workspace has surfaced to the user.',
        '',
        "Pass `self` to limit the list to entries THIS workspace pushed; their `docs` paths are relative to your own workspace root, so you can open them directly with your shell (cat / read the path).",
        '',
        'Entries from other workspaces each carry a `workspaceId` — resolve it with `workspace_path` (CLI: `alice-workspace peer path`) to locate and read that peer\'s files.',
        '',
        'When an entry came from an agent run/session, `origin` carries its safe OpenAlice provenance (`runId` / `sessionId`, `resumeId`, `issueId`, `agent`). Native runtime session ids are never exposed.',
        '',
        `\`limit\` caps how many most-recent entries come back (newest first; default ${DEFAULT_LIMIT}).`,
      ].join('\n'),
      inputSchema: z.object({
        self: z
          .stringbool()
          .optional()
          .describe(
            'Only entries pushed by THIS workspace. Their doc paths are relative to your own cwd, so you can read the files directly.',
          ),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(`Max entries to return, newest first (default ${DEFAULT_LIMIT}).`),
      }),
      execute: async ({ self, limit }) => {
        try {
          const { entries, hasMore } = await ctx.inboxStore.read({
            limit: limit ?? DEFAULT_LIMIT,
            workspaceId: self ? ctx.workspaceId : undefined,
          })
          return {
            ok: true as const,
            count: entries.length,
            hasMore,
            entries: entries.map((e) => {
              const origin = toSafeInboxOrigin(ctx.resolveInboxOrigin?.(e) ?? e.origin)
              return {
                id: e.id,
                ts: new Date(e.ts).toISOString(),
                // mine === true → the doc paths below are relative to your own
                // workspace root and you can open them with shell tools.
                mine: e.workspaceId === ctx.workspaceId,
                // The dir-resolvable id (vs the human `workspace` label). For a
                // peer entry, feed this to `workspace_path` to locate its files.
                workspaceId: e.workspaceId,
                workspace: e.workspaceLabel ?? e.workspaceId,
                comments: e.comments,
                docs: (e.docs ?? []).map((d) => d.path),
                ...((e.docs ?? []).some((doc) => doc.revision)
                  ? {
                      docRevisions: Object.fromEntries(
                        (e.docs ?? [])
                          .filter((doc) => doc.revision)
                          .map((doc) => [doc.path, doc.revision]),
                      ),
                    }
                  : {}),
                ...(origin ? { origin } : {}),
              }
            }),
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
