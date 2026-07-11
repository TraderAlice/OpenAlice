import type { Tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import { conversationAskFactory, conversationReadFactory } from './conversation.js'

async function run(tool: Tool, args: Record<string, unknown>) {
  return tool.execute!(args, { toolCallId: 'test', messages: [] })
}

function context(over: Partial<WorkspaceToolContext> = {}): WorkspaceToolContext {
  return {
    workspaceId: 'ws-caller',
    workspaceLabel: 'caller',
    inboxStore: {} as never,
    entityStore: {} as never,
    ...over,
  }
}

describe('conversation_ask', () => {
  it('requires exactly one target', async () => {
    const tool = conversationAskFactory.build(context({
      conversation: { ask: vi.fn(), read: vi.fn() },
    }))

    await expect(run(tool, { prompt: 'why?' })).resolves.toMatchObject({ ok: false })
    await expect(run(tool, {
      prompt: 'why?', resumeId: 'resume-1', workspaceId: 'ws-1',
    })).resolves.toMatchObject({ ok: false })
  })

  it('dispatches a resumed follow-up and returns its task handle', async () => {
    const ask = vi.fn(async () => ({
      taskId: 'task-1',
      resumeId: 'resume-1',
      workspaceId: 'ws-peer',
      workspace: 'peer',
      agent: 'pi',
      continued: true,
    }))
    const tool = conversationAskFactory.build(context({
      conversation: { ask, read: vi.fn() },
    }))

    await expect(run(tool, {
      prompt: 'why?', resumeId: 'resume-1',
    })).resolves.toMatchObject({ ok: true, status: 'running', taskId: 'task-1' })
    expect(ask).toHaveBeenCalledWith({
      prompt: 'why?', resumeId: 'resume-1', timeoutMs: 300_000,
    })
  })
})

describe('conversation_read', () => {
  const task = {
    taskId: 'task-1',
    resumeId: 'resume-1',
    workspaceId: 'ws-peer',
    agent: 'pi',
    status: 'done' as const,
    startedAt: 1,
    durationMs: 2,
    structured: {
      schemaVersion: 1 as const,
      assistantText: 'The report followed the issue rule.',
      blocks: [
        { type: 'tool' as const, id: 'tool-1', name: 'Read', status: 'completed' as const, input: 'a.md', output: 'ok' },
        { type: 'text' as const, text: 'The report followed the issue rule.' },
      ],
      metrics: { textBlocks: 1, toolCalls: 1, toolFailures: 0 },
      truncated: false,
    },
  }

  it('keeps default output decision-oriented', async () => {
    const tool = conversationReadFactory.build(context({
      conversation: { ask: vi.fn(), read: vi.fn(async () => task) },
    }))
    const result = await run(tool, { taskId: task.taskId })

    expect(result).toMatchObject({
      ok: true,
      assistantText: 'The report followed the issue rule.',
      tools: [{ name: 'Read', status: 'completed' }],
    })
    expect(result).not.toHaveProperty('blocks')
  })

  it('returns normalized blocks only in detailed mode', async () => {
    const tool = conversationReadFactory.build(context({
      conversation: { ask: vi.fn(), read: vi.fn(async () => task) },
    }))
    await expect(run(tool, { taskId: task.taskId, mode: 'detailed' }))
      .resolves.toMatchObject({ blocks: task.structured.blocks })
  })
})
