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
  it('passes a typed business target to embedded conversation control', async () => {
    const ask = vi.fn(async () => ({
      status: 'dispatched' as const,
      taskId: 'task-1', resumeId: 'resume-1', workspaceId: 'ws-peer',
      workspace: 'peer', agent: 'pi',
      resolution: {
        mode: 'exact' as const,
        origin: { kind: 'session' as const, workspaceId: 'ws-peer', resumeId: 'resume-1', agent: 'pi' },
        artifact: { kind: 'issue' as const, workspaceId: 'ws-peer', issueId: 'audit' },
      },
    }))
    const tool = conversationAskFactory.build(context({
      conversation: { ask, read: vi.fn() },
    }))
    const target = { kind: 'issue' as const, workspaceId: 'ws-peer', issueId: 'audit' }

    await expect(run(tool, { prompt: 'why?', target })).resolves.toMatchObject({
      ok: true, status: 'running', taskId: 'task-1', resolution: { mode: 'exact' },
    })
    expect(ask).toHaveBeenCalledWith({ prompt: 'why?', target, timeoutMs: 300_000 })
  })

  it('surfaces unavailable attribution without starting another worker', async () => {
    const tool = conversationAskFactory.build(context({
      conversation: {
        ask: vi.fn(async () => ({
          status: 'unavailable' as const,
          resolution: { mode: 'unavailable' as const, reason: 'missing-native-session' as const },
        })),
        read: vi.fn(),
      },
    }))
    await expect(run(tool, {
      prompt: 'why?', target: { kind: 'resume', resumeId: 'resume-old' },
    })).resolves.toEqual({
      ok: false,
      status: 'unavailable',
      resolution: { mode: 'unavailable', reason: 'missing-native-session' },
    })
  })
})

describe('conversation_read', () => {
  const task = {
    taskId: 'task-1', resumeId: 'resume-1', workspaceId: 'ws-peer', agent: 'pi',
    status: 'done' as const, startedAt: 1, durationMs: 2,
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

