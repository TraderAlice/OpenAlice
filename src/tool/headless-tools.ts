/**
 * Headless-run and schedule observability tools — the CLI/MCP mirror of the
 * WebUI's /api/headless and /api/schedule panels. Read-only; adapter-native
 * agent session ids never cross this boundary.
 */
import { tool } from 'ai'
import { z } from 'zod'

import type { WorkspaceToolFactory } from '../core/workspace-tool-center.js'

const errMsg = (err: unknown): string => err instanceof Error ? err.message : String(err)

export const headlessListFactory: WorkspaceToolFactory = {
  name: 'headless_list',
  build(ctx) {
    return tool({
      description: 'List background headless runs, newest first, with a done/needs-attention summary and current running capacity.',
      inputSchema: z.object({
        wsId: z.string().min(1).optional().describe('Filter to one Workspace (defaults to all).'),
        status: z.enum(['running', 'done', 'failed', 'interrupted']).optional().describe('Filter by task status.'),
        limit: z.coerce.number().int().min(1).max(200).optional().describe('Newest runs to return (default 50).'),
      }),
      execute: async (input) => {
        try {
          if (!ctx.headlessControl) {
            return { ok: false as const, error: 'Headless task registry is unavailable in this context' }
          }
          return { ok: true as const, ...ctx.headlessControl.list(input) }
        } catch (err) {
          return { ok: false as const, error: errMsg(err) }
        }
      },
    })
  },
}

export const headlessShowFactory: WorkspaceToolFactory = {
  name: 'headless_show',
  build(ctx) {
    return tool({
      description: 'Show one headless run: prompt, status, timing, exit code, output summary, and live progress.',
      inputSchema: z.object({
        taskId: z.string().min(1).describe('Headless task id.'),
      }),
      execute: async ({ taskId }) => {
        try {
          if (!ctx.headlessControl) {
            return { ok: false as const, error: 'Headless task registry is unavailable in this context' }
          }
          const task = ctx.headlessControl.show(taskId)
          return task
            ? { ok: true as const, task }
            : { ok: false as const, error: `headless task not found: ${taskId}` }
        } catch (err) {
          return { ok: false as const, error: errMsg(err) }
        }
      },
    })
  },
}

export const headlessLogsFactory: WorkspaceToolFactory = {
  name: 'headless_logs',
  build(ctx) {
    return tool({
      description: [
        'Read one headless run\'s structured output plus bounded stdout/stderr diagnostic tails.',
        'Historical runs without a stored structured snapshot are parsed from the stdout tail.',
      ].join('\n'),
      inputSchema: z.object({
        taskId: z.string().min(1).describe('Headless task id.'),
        tailBytes: z.coerce.number().int().min(256).max(1048576).optional().describe('Diagnostic tail size per stream (default 65536).'),
      }),
      execute: async ({ taskId, tailBytes }) => {
        try {
          if (!ctx.headlessControl) {
            return { ok: false as const, error: 'Headless task registry is unavailable in this context' }
          }
          const logs = await ctx.headlessControl.logs(taskId, tailBytes)
          return logs
            ? { ok: true as const, ...logs }
            : { ok: false as const, error: `headless task not found: ${taskId}` }
        } catch (err) {
          return { ok: false as const, error: errMsg(err) }
        }
      },
    })
  },
}

export const scheduleListFactory: WorkspaceToolFactory = {
  name: 'schedule_list',
  build(ctx) {
    return tool({
      description: 'List scheduled Workspace Issues and their next due times (optionally narrowed to one Workspace).',
      inputSchema: z.object({
        wsId: z.string().min(1).optional().describe('Limit to one Workspace (defaults to every Workspace).'),
      }),
      execute: async ({ wsId }) => {
        try {
          if (!ctx.scheduleControl) {
            return { ok: false as const, error: 'Schedule snapshot is unavailable in this context' }
          }
          return { ok: true as const, ...(await ctx.scheduleControl.list(wsId) as object) }
        } catch (err) {
          return { ok: false as const, error: errMsg(err) }
        }
      },
    })
  },
}

export const headlessToolFactories: readonly WorkspaceToolFactory[] = [
  headlessListFactory,
  headlessShowFactory,
  headlessLogsFactory,
  scheduleListFactory,
]
