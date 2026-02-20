/**
 * Cron Tools — AI-facing tool definitions for the cron engine.
 *
 * Exposes: cronList, cronAdd, cronUpdate, cronRemove, cronRunNow
 * These match the MCP tool interface the AI is already trained on.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { CronEngine } from './engine.js'

// ==================== Schema ====================

const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('at'),
    at: z.string().describe('ISO timestamp for one-shot execution, e.g. "2025-06-01T14:00:00Z"'),
  }),
  z.object({
    kind: z.literal('every'),
    every: z.string().describe('Repeating interval, e.g. "2h", "30m", "5m30s"'),
  }),
  z.object({
    kind: z.literal('cron'),
    cron: z.string().describe('5-field cron expression, e.g. "0 9 * * 1-5" (weekdays 9am)'),
  }),
])

// ==================== Factory ====================

export function createCronTools(cronEngine: CronEngine) {
  return {
    cronList: tool({
      description:
        'List all scheduled cron jobs.\n\n' +
        'Returns an array of jobs, each with:\n' +
        '- id: Short identifier (use this for update/remove/runNow)\n' +
        '- name: Human-readable name\n' +
        '- enabled: Whether the job is active\n' +
        '- schedule: When it runs (at/every/cron)\n' +
        '- payload: The message delivered to you when it fires\n' +
        '- state: Runtime info (nextRunAtMs, lastRunAtMs, lastStatus, consecutiveErrors)',
      inputSchema: z.object({}),
      execute: async () => {
        return cronEngine.list()
      },
    }),

    cronAdd: tool({
      description:
        'Create a new scheduled job.\n\n' +
        'The job will fire according to the schedule and deliver the payload text to you\n' +
        'as a system event during the next heartbeat tick.\n\n' +
        'Schedule types:\n' +
        '- at: One-shot at a specific time. E.g. { kind: "at", at: "2025-06-01T14:00:00Z" }\n' +
        '- every: Repeating interval. E.g. { kind: "every", every: "2h" } or { kind: "every", every: "30m" }\n' +
        '- cron: Cron expression. E.g. { kind: "cron", cron: "0 9 * * 1-5" } (weekdays 9am)\n\n' +
        "Returns the new job's id.",
      inputSchema: z.object({
        name: z.string().describe('Short descriptive name for the job, e.g. "Check ETH funding rate"'),
        payload: z.string().describe('The reminder/instruction text delivered to you when the job fires'),
        schedule: scheduleSchema.optional().describe('When the job should run'),
        enabled: z.boolean().optional().describe('Whether the job starts enabled (default: true)'),
        sessionTarget: z
          .enum(['main', 'isolated'])
          .optional()
          .describe('Where to run: "main" injects into heartbeat session (default), "isolated" runs in a fresh session'),
      }),
      execute: async ({ name, payload, schedule, enabled }) => {
        if (!schedule) {
          return { error: 'schedule is required' }
        }
        const id = await cronEngine.add({
          name,
          payload,
          schedule,
          enabled,
        })
        return { id }
      },
    }),

    cronUpdate: tool({
      description:
        'Update an existing cron job. Only provided fields are changed.\n\n' +
        'Use cronList first to get the job id.\n' +
        'If you change the schedule, the next run time is automatically recomputed.',
      inputSchema: z.object({
        id: z.string().describe('Job id (from cronList)'),
        name: z.string().optional().describe('New name'),
        payload: z.string().optional().describe('New payload text'),
        schedule: scheduleSchema.optional().describe('New schedule'),
        enabled: z.boolean().optional().describe('Enable or disable the job'),
        sessionTarget: z
          .enum(['main', 'isolated'])
          .optional()
          .describe('New session target'),
      }),
      execute: async ({ id, name, payload, schedule, enabled }) => {
        try {
          await cronEngine.update(id, { name, payload, schedule, enabled })
          return { ok: true }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),

    cronRemove: tool({
      description: 'Remove a cron job permanently. Use cronList first to get the job id.',
      inputSchema: z.object({
        id: z.string().describe('Job id to remove'),
      }),
      execute: async ({ id }) => {
        try {
          await cronEngine.remove(id)
          return { ok: true }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),

    cronRunNow: tool({
      description:
        'Manually trigger a cron job immediately, bypassing its schedule.\n\n' +
        "The job's payload will be injected as a system event and the scheduler will wake.\n" +
        "This does not affect the job's normal schedule — the next scheduled run remains unchanged.",
      inputSchema: z.object({
        id: z.string().describe('Job id to trigger'),
      }),
      execute: async ({ id }) => {
        try {
          await cronEngine.runNow(id)
          return { ok: true }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    }),
  }
}
