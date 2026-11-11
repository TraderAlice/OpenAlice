/**
 * Session control-plane tools — inspect, interrupt, reconfigure, and change
 * presence of product Sessions from the CLI or MCP. All addresses are
 * OpenAlice-owned resumeIds; adapter-native ids never cross this boundary.
 */
import { tool } from 'ai'
import { z } from 'zod'

import { MODEL_REASONING_EFFORTS } from '../ai-providers/model-semantics.js'
import type { WorkspaceToolFactory } from '../core/workspace-tool-center.js'

const errMsg = (err: unknown): string => err instanceof Error ? err.message : String(err)

export const sessionListFactory: WorkspaceToolFactory = {
  name: 'session_list',
  build(ctx) {
    return tool({
      description: [
        "List product Sessions with their presence, agent, and unread mailbox count.",
        '',
        "Defaults to this Workspace's active Sessions. From the workspace-manager",
        'context, omitting wsId aggregates across every registered Workspace.',
        'Pass state "deleted" to inspect archived Sessions or "all" for both.',
      ].join('\n'),
      inputSchema: z.object({
        wsId: z.string().min(1).optional().describe('Workspace id. Defaults to this Workspace; omit only from workspace-manager to aggregate.'),
        state: z.enum(['active', 'deleted', 'all']).optional().describe('Presence filter (default "active").'),
        limit: z.coerce.number().int().min(1).max(100).optional().describe('Newest Sessions to return (default 50).'),
      }),
      execute: async ({ wsId, state = 'active', limit = 50 }) => {
        try {
          const { sessionDirectory } = ctx
          if (!sessionDirectory) {
            return { ok: false as const, error: 'Session directory is unavailable in this context' }
          }
          const enrich = (sessions: readonly Record<string, unknown>[]) =>
            sessions
              .filter((s) =>
                state === 'all'
                || (state === 'deleted'
                  ? s['presence'] === 'deleted'
                  : (s['presence'] ?? 'active') === 'active'))
              .map((s) => ({ ...s, unreadMailboxCount: ctx.sessionControl?.unreadCount(String(s['resumeId'])) ?? 0 }))

          const targetWsId = wsId ?? ctx.workspaceId
          if (!wsId && ctx.workspaceId === 'workspace-manager') {
            if (!ctx.workspaceInventory) {
              return { ok: false as const, error: 'workspace-manager requires --ws-id (workspace inventory unavailable in this context)' }
            }
            const inventory = await ctx.workspaceInventory()
            const workspaces = await Promise.all(inventory.map(async (meta) => {
              const directory = await sessionDirectory(meta.id, limit)
              return {
                wsId: meta.id,
                tag: meta.tag,
                sessions: directory ? enrich(directory.sessions as unknown as Record<string, unknown>[]) : [],
              }
            }))
            return { ok: true as const, workspaces }
          }

          const directory = await sessionDirectory(targetWsId, limit)
          if (!directory) return { ok: false as const, error: `unknown workspace: ${targetWsId}` }
          return {
            ok: true as const,
            workspace: directory.workspace,
            sessions: enrich(directory.sessions as unknown as Record<string, unknown>[]),
          }
        } catch (err) {
          return { ok: false as const, error: errMsg(err) }
        }
      },
    })
  },
}

export const sessionShowFactory: WorkspaceToolFactory = {
  name: 'session_show',
  build(ctx) {
    return tool({
      description: 'Show one product Session: dossier, unread mailbox, live interactive state, current execution, and recent headless executions.',
      inputSchema: z.object({
        resumeId: z.string().min(1).describe('Product Session resumeId.'),
      }),
      execute: async ({ resumeId }) => {
        try {
          if (!ctx.sessionControl) {
            return { ok: false as const, error: 'Session control is unavailable in this context' }
          }
          const session = await ctx.sessionControl.show(resumeId)
          return session
            ? { ok: true as const, session }
            : { ok: false as const, error: `unknown Session: ${resumeId}` }
        } catch (err) {
          return { ok: false as const, error: errMsg(err) }
        }
      },
    })
  },
}

export const sessionInterruptFactory: WorkspaceToolFactory = {
  name: 'session_interrupt',
  build(ctx) {
    return tool({
      description: 'Interrupt a Session\'s current running turn (interactive or headless). Idempotent: a stopped-inert Session reports stopped: false.',
      inputSchema: z.object({
        resumeId: z.string().min(1).describe('Product Session resumeId.'),
      }),
      execute: async ({ resumeId }) => {
        try {
          if (!ctx.sessionControl) {
            return { ok: false as const, error: 'Session control is unavailable in this context' }
          }
          const { stopped } = await ctx.sessionControl.interrupt(resumeId)
          return { ok: true as const, resumeId, stopped }
        } catch (err) {
          return { ok: false as const, error: errMsg(err) }
        }
      },
    })
  },
}

export const sessionConfigFactory: WorkspaceToolFactory = {
  name: 'session_config',
  build(ctx) {
    return tool({
      description: [
        "Update an idle Session's idle AI runtime configuration (credential, model, effort).",
        'The Session must not have a running turn. The Agent runtime itself cannot change.',
      ].join('\n'),
      inputSchema: z.object({
        resumeId: z.string().min(1).describe('Product Session resumeId.'),
        credential: z.string().min(1).optional().describe('Vault credential slug. Mutually exclusive with credentialSource.'),
        credentialSource: z.literal('native').optional().describe('Use the native CLI credential store. Mutually exclusive with credential.'),
        model: z.string().min(1).optional().describe('Model id for later turns.'),
        effort: z.enum(MODEL_REASONING_EFFORTS).optional().describe('Reasoning effort for later turns.'),
      }),
      execute: async (input) => {
        try {
          if (input.credential && input.credentialSource) {
            return { ok: false as const, error: 'credential and credentialSource are mutually exclusive' }
          }
          if (!ctx.sessionControl) {
            return { ok: false as const, error: 'Session control is unavailable in this context' }
          }
          if (!input.credential && !input.credentialSource && !input.model && !input.effort) {
            return { ok: false as const, error: 'nothing to configure: pass credential, credentialSource, model, or effort' }
          }
          const result = await ctx.sessionControl.configure(input)
          return { ok: true as const, resumeId: result.resumeId, agent: result.agent, runtime: result.runtime }
        } catch (err) {
          return { ok: false as const, error: errMsg(err) }
        }
      },
    })
  },
}

const presenceFactory = (
  name: 'session_delete' | 'session_restore',
  presence: 'deleted' | 'active',
  description: string,
): WorkspaceToolFactory => ({
  name,
  build(ctx) {
    return tool({
      description,
      inputSchema: z.object({
        resumeId: z.string().min(1).describe('Product Session resumeId.'),
      }),
      execute: async ({ resumeId }) => {
        try {
          if (!ctx.sessionControl) {
            return { ok: false as const, error: 'Session control is unavailable in this context' }
          }
          const result = await ctx.sessionControl.setPresence({ resumeId, presence })
          return { ok: true as const, resumeId: result.resumeId, presence: result.presence }
        } catch (err) {
          return { ok: false as const, error: errMsg(err) }
        }
      },
    })
  },
})

export const sessionDeleteFactory: WorkspaceToolFactory = presenceFactory(
  'session_delete',
  'deleted',
  "Archive a product Session (soft delete). It disappears from active rosters; `session_restore` brings it back. Blocked while a turn is running.",
)

export const sessionRestoreFactory: WorkspaceToolFactory = presenceFactory(
  'session_restore',
  'active',
  "Restore a previously archived product Session to active presence. Blocked while a turn is running.",
)

export const sessionToolFactories: readonly WorkspaceToolFactory[] = [
  sessionListFactory,
  sessionShowFactory,
  sessionInterruptFactory,
  sessionConfigFactory,
  sessionDeleteFactory,
  sessionRestoreFactory,
]
