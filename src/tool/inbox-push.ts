/**
 * inbox_push — workspace's outbound channel to the user's inbox.
 *
 * This is a **workspace-scoped tool factory**. The agent inside a workspace
 * sees only `{ docs?, comments? }` in the schema; the workspaceId is filled
 * by the MCP router from the URL path (`/mcp/:wsId`) and closed over by
 * the factory's build() at request time. Hiding workspaceId from the
 * schema is deliberate: it makes forgery impossible (agent can't push to
 * a different workspace's inbox) and removes a wsId parameter the agent
 * would otherwise have to manage.
 *
 * Registered with WorkspaceToolCenter, exposed only at `/mcp/:wsId`. The
 * generic `/mcp` route (workspace-independent tools) does not see it —
 * external MCP consumers won't accidentally find a workspace-shaped tool
 * they can't sensibly use.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { WorkspaceToolFactory, WorkspaceToolContext } from '../core/workspace-tool-center.js'

export const inboxPushFactory: WorkspaceToolFactory = {
  name: 'inbox_push',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        "Push an update to the user's inbox from this workspace.",
        'Use this when you have something the user should see —',
        'a finished analysis (point to the report file via `docs`),',
        'a question back to the user (write it as `comments`),',
        'a blocked task that needs input, or a status check-in.',
        '',
        '`docs` are paths relative to this workspace root. Each one',
        'is rendered live in the inbox UI when the user opens the',
        'entry — no snapshot is taken, so later edits to the file',
        'will be reflected on subsequent reads.',
        '',
        '`comments` is markdown — your voice to the user about what',
        'you did or want to ask. Keep it short and direct; if more',
        'detail is needed put it in a doc and reference it.',
        '',
        'At least one of `docs` or `comments` must be present.',
        '',
        'Entries are automatically linked back to the run that produced',
        'them — you do not pass any run, session, or issue identity.',
      ].join(' '),
      inputSchema: z.object({
        docs: z
          .array(
            z.object({
              path: z
                .string()
                .min(1)
                .describe(
                  "Relative path to a file inside this workspace, e.g. 'research/macro-2026-05-14.md'.",
                ),
            }),
          )
          .optional()
          .describe(
            'Workspace files to surface in the inbox entry. Rendered live, not snapshotted.',
          ),
        comments: z
          .string()
          .optional()
          .describe(
            "Your message to the user (markdown). Renders below docs in the inbox detail pane.",
          ),
      }),
      execute: async ({ docs, comments }) => {
        try {
          const entry = await ctx.inboxStore.append({
            workspaceId: ctx.workspaceId,
            workspaceLabel: ctx.workspaceLabel,
            docs,
            comments,
            // Agent-invisible: stamped from the server-resolved run origin, NOT
            // from anything in the tool's input schema. Omit the key entirely
            // when absent (interactive / no run header) so the JSONL stays clean.
            ...(ctx.origin ? { origin: ctx.origin } : {}),
          })
          return {
            ok: true as const,
            entryId: entry.id,
            ts: entry.ts,
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
