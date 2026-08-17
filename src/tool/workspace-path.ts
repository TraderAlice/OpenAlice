/**
 * workspace_path — resolve a peer workspace's absolute location by id.
 *
 * The addressing primitive for cross-workspace collaboration. Workspaces are
 * a group of collaborating agents; an inbox entry from a peer carries that
 * peer's `workspaceId` (see inbox_read). This tool turns that id into the
 * peer's absolute directory, so the agent can point its NATIVE file, search,
 * and Git tools at `<path>/<the doc path from the inbox entry>`.
 *
 * It deliberately returns only the directory and lets the agent concatenate
 * the doc path itself: coding agents locate and operate by absolute path, and
 * resolving server-side keeps the on-disk layout (sibling dirs under the
 * launcher root) out of the agent's prose contract — the layout can change
 * without retraining the agent.
 *
 * This is intentionally an address resolver, not a second file-read API.
 * Cross-workspace mutation policy lives in the Workspace guidance rather than
 * being implied by a read-oriented addressing primitive.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { WorkspaceToolFactory, WorkspaceToolContext } from '../core/workspace-tool-center.js'

export const workspacePathFactory: WorkspaceToolFactory = {
  name: 'workspace_path',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        "Resolve a workspace's absolute directory by its id — the addressing step for reading a peer workspace's files.",
        '',
        "An Inbox entry from another Workspace carries its `workspaceId`; pass it here, combine the returned path with the entry's relative document path, and use your native file, search, and Git tools.",
        '',
        'This command resolves identity and location only. It deliberately does not reimplement Coding Agent file operations.',
        '',
        "For your OWN entries (inbox_read `mine: true`) you don't need this — those doc paths are already relative to your current working directory.",
      ].join('\n'),
      inputSchema: z.object({
        id: z
          .string()
          .min(1)
          .describe("The workspace id to locate (e.g. the `workspaceId` from an inbox_read entry)."),
      }),
      execute: async ({ id }) => {
        try {
          const resolve = ctx.resolveWorkspace
          if (!resolve) {
            return { ok: false as const, error: 'workspace resolution is unavailable in this context' }
          }
          const meta = resolve(id)
          if (!meta) {
            return { ok: false as const, error: `unknown workspace: ${id}` }
          }
          return {
            ok: true as const,
            id: meta.id,
            tag: meta.tag,
            path: meta.dir,
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
