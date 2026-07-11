import { tool } from 'ai'
import { z } from 'zod'

import type { WorkspaceToolFactory } from '../core/workspace-tool-center.js'
import type { HeadlessMessageBlock } from '../workspaces/headless-output.js'

const DEFAULT_TIMEOUT_MS = 300_000
const MAX_TIMEOUT_MS = 1_800_000
const MAX_PROMPT_CHARS = 16_000

const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('resume'), resumeId: z.string().min(1) }),
  z.object({ kind: z.literal('workspace'), workspaceId: z.string().min(1) }),
  z.object({
    kind: z.literal('inbox'),
    inboxEntryId: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('issue'),
    workspaceId: z.string().min(1),
    issueId: z.string().min(1),
    action: z.enum(['created', 'updated', 'commented']).optional(),
  }),
  z.object({
    kind: z.literal('report'),
    workspaceId: z.string().min(1),
    path: z.string().min(1),
    revision: z.string().min(1).optional(),
    action: z.enum(['created', 'updated', 'sent']).optional(),
  }),
  z.object({
    kind: z.literal('trade-decision'),
    accountId: z.string().min(1),
    decisionId: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
  }),
])

export const conversationAskFactory: WorkspaceToolFactory = {
  name: 'conversation_ask',
  build(ctx) {
    return tool({
      description: [
        'Ask the agent responsible for a business artifact through embedded headless dispatch.',
        '',
        'Pass a typed target object. Issue/Inbox/report/trade targets resolve immutable',
        'provenance first. A known Session is resumed exactly. If no Session origin exists',
        'but the target carries a live Workspace, a fresh worker reconstructs the answer and',
        'the result says mode=reconstructed. An attributed but unavailable Session is never',
        'silently replaced. Direct resume/workspace targets are the explicit low-level forms.',
        '',
        'The call is asynchronous and returns taskId. Poll with conversation_read.',
      ].join('\n'),
      inputSchema: z.object({
        prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS)
          .describe('Question for the responsible Session or reconstructing worker.'),
        target: targetSchema.describe('Typed business target or explicit resume/workspace target.'),
        agent: z.string().min(1).optional()
          .describe('Optional runtime for reconstructed/fresh work only; exact Session runtime cannot be overridden.'),
        timeoutMs: z.coerce.number().int().positive().max(MAX_TIMEOUT_MS).optional()
          .describe(`Headless watchdog in milliseconds (default ${DEFAULT_TIMEOUT_MS}).`),
      }),
      execute: async ({ prompt, target, agent, timeoutMs }) => {
        if (!ctx.conversation) {
          return { ok: false as const, error: 'workspace conversation control is unavailable' }
        }
        try {
          const result = await ctx.conversation.ask({
            prompt,
            target,
            timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
            ...(agent ? { agent } : {}),
          })
          if (result.status === 'unavailable') {
            return { ok: false as const, status: result.status, resolution: result.resolution }
          }
          return {
            ok: true as const,
            status: 'running' as const,
            taskId: result.taskId,
            resumeId: result.resumeId,
            workspaceId: result.workspaceId,
            workspace: result.workspace,
            agent: result.agent,
            resolution: result.resolution,
          }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  },
}

export const conversationReadFactory: WorkspaceToolFactory = {
  name: 'conversation_read',
  build(ctx) {
    return tool({
      description: [
        'Read one headless follow-up started by conversation_ask.',
        '',
        'Summary returns the latest assistant reply plus compact tool/error activity.',
        'Detailed mode includes normalized message blocks. Running tasks may have partial output.',
      ].join('\n'),
      inputSchema: z.object({
        taskId: z.string().min(1).describe('taskId returned by conversation_ask.'),
        mode: z.enum(['summary', 'detailed']).optional().default('summary'),
      }),
      execute: async ({ taskId, mode }) => {
        if (!ctx.conversation) {
          return { ok: false as const, error: 'workspace conversation control is unavailable' }
        }
        try {
          const task = await ctx.conversation.read(taskId)
          if (!task) return { ok: false as const, error: `conversation task not found: ${taskId}` }
          const structured = task.structured
          const tools = structured?.blocks
            .filter((block): block is Extract<HeadlessMessageBlock, { type: 'tool' }> => block.type === 'tool')
            .map((block) => ({ name: block.name, status: block.status })) ?? []
          const errors = structured?.blocks
            .filter((block): block is Extract<HeadlessMessageBlock, { type: 'error' }> => block.type === 'error')
            .map((block) => block.message) ?? []
          return {
            ok: true as const,
            taskId: task.taskId,
            resumeId: task.resumeId,
            workspaceId: task.workspaceId,
            agent: task.agent,
            status: task.status,
            assistantText: structured?.assistantText ?? null,
            tools,
            errors,
            ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
            ...(task.durationMs !== undefined ? { durationMs: task.durationMs } : {}),
            ...(task.error ? { error: task.error } : {}),
            ...(mode === 'detailed' ? { blocks: structured?.blocks ?? [] } : {}),
          }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  },
}

export const conversationToolFactories: WorkspaceToolFactory[] = [
  conversationAskFactory,
  conversationReadFactory,
]

