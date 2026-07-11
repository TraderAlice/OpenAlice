import { tool } from 'ai'
import { z } from 'zod'

import type { WorkspaceToolFactory } from '../core/workspace-tool-center.js'
import type { HeadlessMessageBlock } from '../workspaces/headless-output.js'

const DEFAULT_TIMEOUT_MS = 300_000
const MAX_TIMEOUT_MS = 1_800_000
const MAX_PROMPT_CHARS = 16_000

export const conversationAskFactory: WorkspaceToolFactory = {
  name: 'conversation_ask',
  build(ctx) {
    return tool({
      description: [
        'Ask an agent in a Workspace through OpenAlice headless dispatch.',
        '',
        'Pass exactly one target: `resumeId` continues the specific agent conversation exposed by Inbox/Issue provenance; `workspaceId` starts a fresh conversation with that workspace\'s first enabled runtime (or the explicit `agent`).',
        '',
        'The call is asynchronous and returns `taskId`. Poll it with `conversation_read` (CLI: `alice-workspace conversation read --taskId …`). This embedded Workspace capability does not call the public HTTP API.',
      ].join('\n'),
      inputSchema: z.object({
        prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS)
          .describe('The question or follow-up for the target agent.'),
        resumeId: z.string().min(1).optional()
          .describe('Continue one specific OpenAlice conversation. Mutually exclusive with workspaceId.'),
        workspaceId: z.string().min(1).optional()
          .describe('Start a fresh worker in this workspace when no originating conversation is available.'),
        agent: z.string().min(1).optional()
          .describe('Runtime for a fresh workspace target. Not allowed with resumeId.'),
        timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
          .describe(`Headless watchdog in milliseconds (default ${DEFAULT_TIMEOUT_MS}).`),
      }),
      execute: async ({ prompt, resumeId, workspaceId, agent, timeoutMs }) => {
        if (!ctx.conversation) {
          return { ok: false as const, error: 'workspace conversation control is unavailable' }
        }
        if (Boolean(resumeId) === Boolean(workspaceId)) {
          return { ok: false as const, error: 'pass exactly one of resumeId or workspaceId' }
        }
        if (resumeId && agent) {
          return { ok: false as const, error: 'agent cannot be used with resumeId' }
        }
        try {
          const dispatched = await ctx.conversation.ask({
            prompt,
            timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
            ...(resumeId ? { resumeId } : {}),
            ...(workspaceId ? { workspaceId } : {}),
            ...(agent ? { agent } : {}),
          })
          return { ok: true as const, status: 'running' as const, ...dispatched }
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
        'Read one headless conversation turn started by `conversation_ask`.',
        '',
        'Default `summary` returns the latest assistant reply plus compact tool/error activity. Use `detailed` only when tool inputs/outputs or the full normalized block timeline are needed. A running task may have partial or no structured output yet; poll again.',
      ].join('\n'),
      inputSchema: z.object({
        taskId: z.string().min(1).describe('The taskId returned by conversation_ask.'),
        mode: z.enum(['summary', 'detailed']).optional()
          .describe('summary (default) or detailed normalized message blocks.'),
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
