/**
 * Rename a product Session in this Workspace. Writes only the coworker
 * nametag on the Session dossier; never the frozen AI binding or launcher title.
 */
import { tool } from 'ai'
import { z } from 'zod'

import type { WorkspaceToolFactory } from '../core/workspace-tool-center.js'
import { ResumePresenceError } from '../workspaces/resume-registry.js'
import {
  MAX_SESSION_DISPLAY_NAME,
  SessionDisplayNameError,
} from '../workspaces/session-runtime-store.js'

export const sessionRenameFactory: WorkspaceToolFactory = {
  name: 'session_rename',
  build(ctx) {
    return tool({
      description: [
        "Rename a product Session in this Workspace.",
        '',
        'Sets the Workspace-owned coworker nametag (`displayName`). It does not',
        'change the conversation title copied from the native CLI, the sticky',
        'launcher nickname (`p1`), or the frozen AI binding.',
        'Pass an empty displayName to clear the nametag.',
      ].join('\n'),
      inputSchema: z.object({
        resumeId: z.string().min(1).describe('Product Session resumeId in this Workspace.'),
        displayName: z.string().max(MAX_SESSION_DISPLAY_NAME).describe(
          'Coworker nametag. Empty clears the name and falls back to the conversation title.',
        ),
      }),
      execute: async ({ resumeId, displayName }) => {
        try {
          if (!ctx.setSessionDisplayName) {
            return { ok: false as const, error: 'Session rename is unavailable in this context' }
          }
          const identity = await ctx.setSessionDisplayName({ resumeId, displayName })
          return {
            ok: true as const,
            resumeId: identity.resumeId,
            ...(identity.displayName ? { displayName: identity.displayName } : {}),
          }
        } catch (err) {
          if (err instanceof SessionDisplayNameError) {
            return { ok: false as const, error: err.message }
          }
          if (err instanceof ResumePresenceError) {
            return { ok: false as const, error: err.message }
          }
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  },
}
