import type { Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import {
  headlessListFactory,
  headlessLogsFactory,
  headlessShowFactory,
  scheduleListFactory,
} from './headless-tools.js'
import type { ZodType } from 'zod'

async function run(tool: Tool, args: Record<string, unknown> = {}) {
  return await tool.execute!(args, { toolCallId: 'test', messages: [] }) as Record<string, unknown>
}

const schema = (tool: Tool) => tool.inputSchema as unknown as ZodType

const base = {
  workspaceId: 'ws-research',
  workspaceLabel: 'Research',
  inboxStore: {} as never,
  entityStore: {} as never,
} satisfies WorkspaceToolContext

const listing = {
  tasks: [{ taskId: 'task-1', status: 'done' }],
  summary: { done: 2, needsAttention: 1 },
  capacity: { running: 1, limit: 4 },
}

const ctx = (extra: Partial<WorkspaceToolContext> = {}): WorkspaceToolContext => ({
  ...base,
  headlessControl: {
    list: ({ wsId, status, limit }) => ({
      tasks: [{ taskId: 'task-1', status: 'done', wsId, status_filter: status, limit: limit ?? null }],
      summary: listing.summary,
      capacity: listing.capacity,
    }),
    show: (taskId) => taskId === 'task-1' ? { taskId, status: 'done' } : null,
    logs: async (taskId, tailBytes) => taskId === 'task-1' ? ({
      taskId,
      status: 'done',
      structured: { schemaVersion: 1, blocks: [] },
      stdout: { text: 'out', sizeBytes: 3, truncated: false },
      stderr: null,
      tailBytes: tailBytes ?? null,
    }) : null,
  },
  scheduleControl: {
    list: async (wsId) => ({ workspaces: [{ wsId: wsId ?? 'ws-all', tasks: [] }] }),
  },
  ...extra,
})

describe('headless_list', () => {
  it('returns tasks with summary and capacity', async () => {
    const result = await run(headlessListFactory.build(ctx()), { wsId: 'ws-research' })
    expect(result).toMatchObject({
      ok: true,
      summary: { done: 2, needsAttention: 1 },
      capacity: { running: 1, limit: 4 },
    })
    expect((result['tasks'] as Record<string, unknown>[])[0]).toMatchObject({ taskId: 'task-1', wsId: 'ws-research' })
  })

  it('coerces string limit and rejects invalid status flags', () => {
    const tool = headlessListFactory.build(ctx())
    expect(schema(tool).safeParse({ limit: '25', status: 'failed' }).success).toBe(true)
    expect(schema(tool).safeParse({ limit: '201' }).success).toBe(false)
    expect(schema(tool).safeParse({ status: 'bogus' }).success).toBe(false)
  })

  it('errors when the control plane is absent', async () => {
    expect(await run(headlessListFactory.build(base), {}))
      .toMatchObject({ ok: false, error: expect.stringContaining('unavailable') })
  })
})

describe('headless_show', () => {
  it('returns one task record', async () => {
    expect(await run(headlessShowFactory.build(ctx()), { taskId: 'task-1' }))
      .toMatchObject({ ok: true, task: { taskId: 'task-1', status: 'done' } })
  })

  it('reports unknown tasks', async () => {
    expect(await run(headlessShowFactory.build(ctx()), { taskId: 'task-x' }))
      .toMatchObject({ ok: false, error: 'headless task not found: task-x' })
  })
})

describe('headless_logs', () => {
  it('returns structured output and diagnostic tails', async () => {
    const result = await run(headlessLogsFactory.build(ctx()), { taskId: 'task-1', tailBytes: 4096 })
    expect(result).toMatchObject({
      ok: true,
      taskId: 'task-1',
      status: 'done',
      stdout: { text: 'out' },
    })
    expect(result['tailBytes']).toBe(4096)
  })

  it('coerces string tailBytes within bounds', () => {
    const tool = headlessLogsFactory.build(ctx())
    expect(schema(tool).safeParse({ taskId: 'task-1', tailBytes: '1024' }).success).toBe(true)
    expect(schema(tool).safeParse({ taskId: 'task-1', tailBytes: '128' }).success).toBe(false)
    expect(schema(tool).safeParse({ taskId: 'task-1', tailBytes: '2097152' }).success).toBe(false)
  })

  it('reports unknown tasks', async () => {
    expect(await run(headlessLogsFactory.build(ctx()), { taskId: 'task-x' }))
      .toMatchObject({ ok: false, error: 'headless task not found: task-x' })
  })
})

describe('schedule_list', () => {
  it('returns the schedule snapshot', async () => {
    expect(await run(scheduleListFactory.build(ctx()), {}))
      .toMatchObject({ ok: true, workspaces: [{ wsId: 'ws-all', tasks: [] }] })
  })

  it('narrows to one workspace', async () => {
    expect(await run(scheduleListFactory.build(ctx()), { wsId: 'ws-research' }))
      .toMatchObject({ ok: true, workspaces: [{ wsId: 'ws-research' }] })
  })

  it('errors when the control plane is absent', async () => {
    expect(await run(scheduleListFactory.build(base), {}))
      .toMatchObject({ ok: false, error: expect.stringContaining('unavailable') })
  })
})
