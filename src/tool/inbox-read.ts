import { tool } from 'ai'
import { z } from 'zod'
import { inboxFiles } from '@traderalice/connector-protocol'
import { resolveInboxFile } from '../core/inbox-files.js'
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
      description: 'Read human Inbox notifications and reports. body is the published Markdown. files are derived from its [[relative/path.ext]] references: relativePath is rooted in the source Workspace, absolutePath is directly readable with native file tools (null if missing, unreadable or unsafe), and revision identifies the published file content when available. File contents are not expanded. Use self to filter this Workspace. Origin identifies the producing Session or Issue.',
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
            entries: await Promise.all(entries.map(async (e) => {
              const origin = toSafeInboxOrigin(ctx.resolveInboxOrigin?.(e) ?? e.origin)
              const workspace = ctx.resolveWorkspace?.(e.workspaceId)
              const files = await Promise.all(inboxFiles(e).map(async (doc) => ({
                relativePath: doc.path,
                absolutePath: await resolveInboxFile(workspace?.dir, doc.path),
                ...(doc.revision ? { revision: doc.revision } : {}),
              })))
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
                body: e.body,
                files,
                ...(origin ? { origin } : {}),
              }
            })),
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
