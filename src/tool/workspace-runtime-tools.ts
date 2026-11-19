/**
 * Workspace default AI runtime settings tools — inspect and update a Workspace's
 * persisted default agent, credential, model, and reasoning effort (.alice/settings.json).
 */
import { tool } from 'ai'
import { z } from 'zod'

import { MODEL_REASONING_EFFORTS } from '../ai-providers/model-semantics.js'
import type { WorkspaceToolFactory } from '../core/workspace-tool-center.js'
import { isDefaultRuntimeModel } from '../workspaces/workspace-runtime-settings.js'

const errMsg = (err: unknown): string => err instanceof Error ? err.message : String(err)

const harnessSchema = z.enum(['chat', 'autoquant', 'prediction'])

export const workspaceRuntimeGetFactory: WorkspaceToolFactory = {
  name: 'workspace_runtime_get',
  build(ctx) {
    return tool({
      description: [
        "Inspect a Workspace's saved and effective default AI runtime settings (agent, credential, credentialSource, model, effort).",
        '',
        'Defaults to the current Workspace. Pass --ws-id for a specific Workspace or --harness (chat, autoquant, prediction) for that Harness default desk.',
      ].join('\n'),
      inputSchema: z.object({
        wsId: z.string().min(1).optional().describe('Target Workspace id or unique tag. Mutually exclusive with harness; omit both for this Workspace.'),
        harness: harnessSchema.optional().describe('Inspect the default Chat, AutoQuant, or Prediction Workspace. Mutually exclusive with wsId.'),
        mode: z.enum(['interactive', 'headless']).optional().describe('Restrict inspection to interactive or headless mode. Omit to inspect both.'),
        agent: z.string().min(1).optional().describe('Optional agent runtime id to preview effective settings for instead of the mode default.'),
      }),
      execute: async ({ wsId, harness, mode, agent }) => {
        try {
          if (wsId && harness) {
            return { ok: false as const, error: 'wsId and harness are mutually exclusive' }
          }
          if (!ctx.workspaceRuntimeControl) {
            return { ok: false as const, error: 'Workspace runtime control is unavailable in this context' }
          }
          const result = await ctx.workspaceRuntimeControl.get({
            ...(harness ? { harness } : { wsId: wsId ?? ctx.workspaceId }),
            ...(mode ? { mode } : {}),
            ...(agent ? { agent } : {}),
          })
          return { ok: true as const, ...result }
        } catch (err) {
          return { ok: false as const, error: errMsg(err) }
        }
      },
    })
  },
}

export const workspaceRuntimeSetFactory: WorkspaceToolFactory = {
  name: 'workspace_runtime_set',
  build(ctx) {
    return tool({
      description: [
        "Update a Workspace's saved default AI runtime settings (agent, credential, credentialSource, model, effort) in .alice/settings.json.",
        '',
        'Defaults to the current Workspace and updates both interactive and headless modes unless --mode is specified.',
        'Pass --model default or --clear-model to clear a persisted model back to the runtime default.',
      ].join('\n'),
      inputSchema: z.object({
        wsId: z.string().min(1).optional().describe('Target Workspace id or unique tag. Mutually exclusive with harness; omit both for this Workspace.'),
        harness: harnessSchema.optional().describe('Update the default Chat, AutoQuant, or Prediction Workspace. Mutually exclusive with wsId.'),
        mode: z.enum(['interactive', 'headless', 'both']).optional().describe('Which launch mode(s) to update (default "both").'),
        agent: z.string().min(1).optional().describe('Default agent runtime id (e.g. codex, claude, pi). Also selects which agent preference to update.'),
        credential: z.string().min(1).optional().describe('OpenAlice vault credential slug, never an API key. Mutually exclusive with credentialSource.'),
        credentialSource: z.literal('native').optional().describe('Use the runtime own authentication. Mutually exclusive with credential.'),
        model: z.string().min(1).optional().describe('Default model id to persist, or "default" to clear any persisted model back to runtime default.'),
        clearModel: z.boolean().optional().describe('Clear any persisted model so the runtime uses its own default.'),
        effort: z.enum(MODEL_REASONING_EFFORTS).optional().describe('Default reasoning effort to persist.'),
        clearEffort: z.boolean().optional().describe('Clear any persisted reasoning effort.'),
      }),
      execute: async ({
        wsId,
        harness,
        mode,
        agent,
        credential,
        credentialSource,
        model,
        clearModel,
        effort,
        clearEffort,
      }) => {
        try {
          if (wsId && harness) {
            return { ok: false as const, error: 'wsId and harness are mutually exclusive' }
          }
          if (credential && credentialSource) {
            return { ok: false as const, error: 'credential and credentialSource are mutually exclusive' }
          }
          if (clearModel && model && !isDefaultRuntimeModel(model)) {
            return { ok: false as const, error: 'model and clearModel are mutually exclusive' }
          }
          if (clearEffort && effort) {
            return { ok: false as const, error: 'effort and clearEffort are mutually exclusive' }
          }
          if (!agent && !credential && !credentialSource && !model && !clearModel && !effort && !clearEffort) {
            return {
              ok: false as const,
              error: 'nothing to update: pass agent, credential, credentialSource, model, clearModel, effort, or clearEffort',
            }
          }
          if (!ctx.workspaceRuntimeControl) {
            return { ok: false as const, error: 'Workspace runtime control is unavailable in this context' }
          }
          const result = await ctx.workspaceRuntimeControl.set({
            ...(harness ? { harness } : { wsId: wsId ?? ctx.workspaceId }),
            ...(mode ? { mode } : {}),
            ...(agent ? { agent } : {}),
            ...(credential ? { credential } : {}),
            ...(credentialSource ? { credentialSource } : {}),
            ...(model ? { model } : {}),
            ...(clearModel ? { clearModel: true } : {}),
            ...(effort ? { effort } : {}),
            ...(clearEffort ? { clearEffort: true } : {}),
          })
          return { ok: true as const, ...result }
        } catch (err) {
          return { ok: false as const, error: errMsg(err) }
        }
      },
    })
  },
}

export const workspaceRuntimeToolFactories: readonly WorkspaceToolFactory[] = [
  workspaceRuntimeGetFactory,
  workspaceRuntimeSetFactory,
]
