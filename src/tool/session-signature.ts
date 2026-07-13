/** Agent-facing self identity. Structured actions are signed server-side; this
 * tool lets an Agent intentionally place the same signature in free-form files. */
import { tool } from 'ai'
import { z } from 'zod'

import { sessionOriginFromInboxOrigin } from '../core/provenance-store.js'
import type { WorkspaceToolFactory } from '../core/workspace-tool-center.js'
import { sessionSignature } from '../workspaces/session-signature.js'

export const sessionSignatureFactory: WorkspaceToolFactory = {
  name: 'session_signature',
  build(ctx) {
    return tool({
      description: [
        'Show this Agent Session’s OpenAlice signature.',
        'Structured Inbox/Issue actions are signed automatically. Add the returned',
        '`@resumeId` to standalone Markdown reports as `Signed-by: @resumeId` so',
        'another Agent or the user can return to the exact accountable Session.',
      ].join('\n'),
      inputSchema: z.object({}),
      execute: async () => {
        const origin = sessionOriginFromInboxOrigin(ctx.workspaceId, ctx.origin)
        if (!origin) {
          return {
            ok: false as const,
            error: 'no attributable Session is attached to this CLI call',
            hint: 'Run this inside an OpenAlice interactive or headless Session.',
          }
        }
        return {
          ok: true as const,
          signature: sessionSignature(origin.resumeId),
          resumeId: origin.resumeId,
          workspaceId: origin.workspaceId,
          agent: origin.agent,
          markdown: `Signed-by: ${sessionSignature(origin.resumeId)}`,
        }
      },
    })
  },
}

