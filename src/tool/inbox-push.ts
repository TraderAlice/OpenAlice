import { inboxFiles } from '@traderalice/connector-protocol'
import { createHash } from 'node:crypto'

import { tool } from 'ai'
import { z } from 'zod'
import type { WorkspaceToolFactory, WorkspaceToolContext } from '../core/workspace-tool-center.js'
import { sessionOriginFromInboxOrigin } from '../core/provenance-store.js'
import { createReadStream } from 'node:fs'
import { resolveInboxFile } from '../core/inbox-files.js'

export function reportContentRevision(content: string | Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

export const inboxPushFactory: WorkspaceToolFactory = {
  name: 'inbox_push',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: 'Send a notification or report to the human Inbox. body is Markdown; use [[report/file.pdf]] for live files relative to this Workspace root. CLI --body-file reads a Markdown file as the published body. Use normal replies for in-chat responses. Inbox is not a file store or an Agent-to-Agent channel. Origin is recorded automatically.',
      inputSchema: z.object({
        body: z.string().min(1).describe('Markdown message to the human. Inline [[relative/path.ext]] references resolve in this Workspace.'),
      }),
      execute: async ({ body }) => {
        try {
          const workspace = ctx.resolveWorkspace?.(ctx.workspaceId)
          const publishedDocs = await Promise.all(inboxFiles({ body }).map(async (doc) => {
            const path = await resolveInboxFile(workspace?.dir, doc.path)
            if (!path) return doc
            try {
              const hash = createHash('sha256')
              for await (const chunk of createReadStream(path)) hash.update(chunk)
              return { ...doc, revision: `sha256:${hash.digest('hex')}` }
            }
            catch { return doc } // A live file can disappear; keep the notification intact.
          }))
          const entry = await ctx.inboxStore.append({
            workspaceId: ctx.workspaceId,
            workspaceLabel: ctx.workspaceLabel,
            body,
            fileRevisions: Object.fromEntries(publishedDocs.filter(doc => doc.revision).map(doc => [doc.path, doc.revision!])),
            // Agent-invisible: stamped from the server-resolved run origin, NOT
            // from anything in the tool's input schema. Omit the key entirely
            // when absent (interactive / no run header) so the JSONL stays clean.
            ...(ctx.origin ? { origin: ctx.origin } : {}),
          })
          if (ctx.provenanceStore) {
            const sessionOrigin = sessionOriginFromInboxOrigin(ctx.workspaceId, ctx.origin)
            const origin = sessionOrigin ?? { kind: 'unknown' as const, reason: 'missing-session-origin' }
            await ctx.provenanceStore.append({
              artifact: { kind: 'inbox', inboxEntryId: entry.id },
              action: 'sent',
              origin,
              at: entry.ts,
              fingerprint: `inbox:${entry.id}:sent`,
            })
            for (const doc of inboxFiles(entry)) {
              await ctx.provenanceStore.append({
                artifact: {
                  kind: 'report',
                  workspaceId: ctx.workspaceId,
                  path: doc.path,
                  ...(doc.revision ? { revision: doc.revision } : {}),
                },
                action: 'sent',
                origin,
                at: entry.ts,
                fingerprint: `report:${ctx.workspaceId}:${doc.path}:${doc.revision ?? 'unversioned'}:sent:${entry.id}`,
              })
            }
          }
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
