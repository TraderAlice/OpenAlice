import { tool } from 'ai'
import { z } from 'zod'

import {
  toSafeInboxOrigin,
  type WorkspaceToolContext,
  type WorkspaceToolFactory,
} from '../core/workspace-tool-center.js'
import { issueAssigneeResumeId } from '../workspaces/issues/declaration.js'
import {
  askWorkspaceConversation,
  conversationAskCommonShape,
} from './conversation.js'

function withSubject<T extends object>(subject: Record<string, unknown>, result: T) {
  return { subject, ...result }
}

export const inboxAskFactory: WorkspaceToolFactory = {
  name: 'inbox_ask',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        'Ask the Session that produced one Inbox entry.',
        '',
        'The entry id is enough: OpenAlice resolves server-stamped provenance. A known',
        'Session is resumed exactly. An entry without an attributable Session recruits a',
        'fresh worker only in its source Workspace and labels the answer reconstructed.',
        'Prefer --await for one entry; dispatch several without it before collecting them.',
      ].join('\n'),
      inputSchema: z.object({
        id: z.string().min(1).describe('Inbox entry id returned by inbox read.'),
        ...conversationAskCommonShape,
      }),
      execute: async ({ id, prompt, agent, timeoutMs, await: shouldAwait = false }) => {
        try {
          const entry = await ctx.inboxStore.get(id)
          if (!entry) return { ok: false as const, error: `inbox entry not found: ${id}` }
          const origin = toSafeInboxOrigin(ctx.resolveInboxOrigin?.(entry) ?? entry.origin)
          const target = origin?.resumeId
            ? { kind: 'resume' as const, resumeId: origin.resumeId }
            : {
                kind: 'inbox' as const,
                inboxEntryId: entry.id,
                workspaceId: entry.workspaceId,
              }
          const result = await askWorkspaceConversation(ctx, {
            prompt,
            target,
            subject: { kind: 'inbox', entryId: entry.id },
            ...(agent ? { agent } : {}),
            ...(timeoutMs ? { timeoutMs } : {}),
            await: shouldAwait,
          })
          return withSubject({ kind: 'inbox', id: entry.id }, result)
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  },
}

export const issueAskFactory: WorkspaceToolFactory = {
  name: 'issue_ask',
  build(ctx: WorkspaceToolContext) {
    return tool({
      description: [
        'Ask the creator, declared owner, or one run of an Issue.',
        '',
        'The Issue name resolves across the global board. Omit selectors to ask its creator;',
        'use --owner for a stable resume owner or --run-id for one exact execution Session.',
        'A duplicate Issue name returns candidates; add --ws-id only to disambiguate.',
      ].join('\n'),
      inputSchema: z.object({
        id: z.string().min(1).describe('Issue id or title, resolved across the global board.'),
        wsId: z.string().min(1).optional().describe('Optional Workspace id only for disambiguating duplicate Issue names.'),
        creator: z.boolean().optional().default(false).describe('Ask the Issue creator (the default when no selector is passed).'),
        owner: z.boolean().optional().default(false).describe('Ask the declared stable resume owner.'),
        runId: z.string().min(1).optional().describe('Ask the product Session behind one Issue run task id.'),
        ...conversationAskCommonShape,
      }),
      execute: async ({
        id,
        wsId,
        creator = false,
        owner = false,
        runId,
        prompt,
        agent,
        timeoutMs,
        await: shouldAwait = false,
      }) => {
        if (!ctx.board) return { ok: false as const, error: 'global issue board is unavailable' }
        const selectorCount = Number(creator) + Number(owner) + Number(Boolean(runId))
        if (selectorCount > 1) {
          return { ok: false as const, error: 'choose only one of --creator, --owner, or --run-id' }
        }
        try {
          const refs = (await ctx.board.resolveByName(id))
            .filter((ref) => !wsId || ref.wsId === wsId)
          if (refs.length === 0) {
            return { ok: false as const, error: `issue not found: ${id}${wsId ? ` in ${wsId}` : ''}` }
          }
          if (refs.length > 1) {
            return {
              ok: false as const,
              ambiguous: refs.map((ref) => ({
                wsId: ref.wsId,
                wsTag: ref.wsTag,
                id: ref.id,
                title: ref.title,
              })),
              error: 'issue name is ambiguous; retry with --ws-id',
            }
          }
          const ref = refs[0]!
          const detail = await ctx.board.detail(ref.wsId, ref.id)
          if (!detail) return { ok: false as const, error: `issue disappeared: ${ref.id}` }

          let target
          let relation: 'creator' | 'owner' | 'run'
          if (runId) {
            const run = detail.runs.find((candidate) => candidate.taskId === runId)
            if (!run) {
              return {
                ok: false as const,
                error: `issue run not found: ${runId}; use alice-workspace issue show --id ${ref.id} to list this Issue's runs`,
              }
            }
            target = { kind: 'resume' as const, resumeId: run.resumeId }
            relation = 'run'
          } else if (owner) {
            const resumeId = issueAssigneeResumeId(detail.issue.assignee)
            if (!resumeId) {
              return {
                ok: false as const,
                error: 'this Issue is assigned to its Workspace and has no stable Session owner; ask --creator or choose --run-id',
              }
            }
            target = {
              kind: 'resume' as const,
              resumeId,
            }
            relation = 'owner'
          } else {
            target = {
              kind: 'issue' as const,
              workspaceId: ref.wsId,
              issueId: ref.id,
              action: 'created' as const,
            }
            relation = 'creator'
          }

          const result = await askWorkspaceConversation(ctx, {
            prompt,
            target,
            subject: {
              kind: 'issue',
              workspaceId: ref.wsId,
              issueId: ref.id,
              relation,
              ...(runId ? { runId } : {}),
            },
            ...(agent ? { agent } : {}),
            ...(timeoutMs ? { timeoutMs } : {}),
            await: shouldAwait,
          })
          return withSubject({
            kind: 'issue',
            id: ref.id,
            workspaceId: ref.wsId,
            relation,
            ...(runId ? { runId } : {}),
          }, result)
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  },
}

export const artifactConversationToolFactories: WorkspaceToolFactory[] = [
  inboxAskFactory,
  issueAskFactory,
]
