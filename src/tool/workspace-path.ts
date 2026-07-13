/**
 * workspace_path — resolve a peer workspace's absolute location by id.
 *
 * The addressing primitive for cross-workspace collaboration. Workspaces are
 * a group of collaborating agents; an inbox entry from a peer carries that
 * peer's `workspaceId` (see inbox_read). This tool turns that id into the
 * peer's absolute directory, so the agent can point its NATIVE file tools at
 * `<path>/<the doc path from the inbox entry>` to read — and, with the user's
 * approval prompt, edit — the peer's files.
 *
 * It deliberately returns only the directory and lets the agent concatenate
 * the doc path itself: coding agents locate and operate by absolute path, and
 * resolving server-side keeps the on-disk layout (sibling dirs under the
 * launcher root) out of the agent's prose contract — the layout can change
 * without retraining the agent.
 *
 * Cross-workspace edits are expected and fine; what's NOT fine is editing a
 * peer's file and walking away. Its repo is the owner's record — commit your
 * change there (the per-workspace git identity makes the author honest) so the
 * owner can review or revert it. That obligation lives in the skill/instruction
 * prose, not enforced here.
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
        "An inbox entry from another workspace (see inbox_read) carries its `workspaceId`; pass that here to get the peer's absolute path, then READ `<path>/<the entry's doc path>` with your normal file tools. Reading a peer is fine.",
        '',
        "EDITING a peer is different: only do it in an interactive session where a person is present to approve reaching outside your own workspace. An autonomous / headless run must read peers but write ONLY its own workspace. If you do edit a peer (with approval), commit the change in that repo with a clear message — it's the owner's record, and the commit is how they review or revert it. Never edit-and-walk-away.",
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
