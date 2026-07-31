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
 * with ordinary native file tools — no Workspace-level file-read API needed.
 * Foreign entries carry the other Workspace id so `peer path` can resolve an
 * absolute root for those same native tools.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { resolve, sep } from 'node:path'
import {
  toSafeInboxOrigin,
  type WorkspaceToolFactory,
  type WorkspaceToolContext,
} from '../core/workspace-tool-center.js'

const DEFAULT_LIMIT = 20

function resolveInboxDocPath(workspaceDir: string | undefined, docPath: string): string | null {
  if (!workspaceDir) return null
  const root = resolve(workspaceDir)
  const absolutePath = resolve(root, docPath)
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) return null
  return absolutePath
}

export const inboxReadFactory: WorkspaceToolFactory = {
  name: 'inbox_read',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        "Read recent entries from the user's inbox — the push log workspaces post finished work and questions to.",
        '',
        'Use this to recall what you already reported, or to see the broader stream of what every workspace has surfaced to the user.',
        '',
        "Pass `self` to limit the list to entries THIS workspace pushed.",
        '',
        'Each attachment appears in `files` with its stored `relativePath`, a directly usable `absolutePath`, and the published `revision` when known. `absolutePath` is null only when the source Workspace is unavailable or the stored path is unsafe.',
        '',
        'The legacy `docs` relative-path list and `docRevisions` map remain for compatibility. `workspaceId` can still be resolved with `workspace_path` (CLI: `alice-workspace peer path`) when inspecting the source desk itself.',
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
            'Only entries pushed by THIS workspace. Their doc paths are relative to your own cwd, so you can use native file tools directly.',
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
              const workspace = ctx.resolveWorkspace?.(e.workspaceId)
              const files = (e.docs ?? []).map((doc) => ({
                relativePath: doc.path,
                absolutePath: resolveInboxDocPath(workspace?.dir, doc.path),
                ...(doc.revision ? { revision: doc.revision } : {}),
              }))
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
                files,
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
