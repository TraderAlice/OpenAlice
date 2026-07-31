import type { Tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { createMemoryInboxStore } from '../core/inbox-store.js'
import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import {
  conversationAskFactory,
  conversationAwaitFactory,
  conversationCollectFactory,
  conversationReadFactory,
} from './conversation.js'

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

const completedTask = {
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

describe('conversation_ask', () => {
  it('turns flat Issue flags into the internal conversation target', async () => {
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

    await expect(run(tool, { prompt: 'why?', wsId: 'ws-peer', issueId: 'audit' })).resolves.toMatchObject({
      ok: true, status: 'running', taskId: 'task-1', resolution: { mode: 'exact' },
    })
    expect(ask).toHaveBeenCalledWith({
      prompt: 'why?',
      target,
      source: { kind: 'workspace', workspaceId: 'ws-caller' },
    })
  })

  it('installs an execution watchdog only when timeoutMs is explicit', async () => {
    const ask = vi.fn(async () => ({
      status: 'dispatched' as const,
      taskId: 'task-1', resumeId: 'resume-1', workspaceId: 'ws-peer',
      workspace: 'peer', agent: 'pi',
      resolution: { mode: 'reconstructed' as const, workspaceId: 'ws-peer', reason: 'explicit-workspace' as const },
    }))
    const tool = conversationAskFactory.build(context({ conversation: { ask, read: vi.fn() } }))

    await run(tool, { prompt: 'why?', wsId: 'ws-peer', timeoutMs: 42_000 })

    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 42_000 }))
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
      prompt: 'why?', resumeId: 'resume-old',
    })).resolves.toEqual({
      ok: false,
      status: 'unavailable',
      resolution: { mode: 'unavailable', reason: 'missing-native-session' },
    })
  })

  it('rejects ambiguous or missing addressing flags', async () => {
    const tool = conversationAskFactory.build(context({
      conversation: { ask: vi.fn(), read: vi.fn() },
    }))
    await expect(run(tool, { prompt: 'why?' })).resolves.toMatchObject({
      ok: false, error: expect.stringContaining('choose exactly one target'),
    })
    await expect(run(tool, {
      prompt: 'why?', resumeId: 'resume-1', wsId: 'ws-peer',
    })).resolves.toMatchObject({
      ok: false, error: expect.stringContaining('choose exactly one target'),
    })
  })

  it('resolves an Inbox id to the attributable sender and preserves the subject', async () => {
    const inboxStore = createMemoryInboxStore()
    const entry = await inboxStore.append({
      workspaceId: 'ws-peer',
      comments: 'report ready',
      origin: { kind: 'headless', runId: 'run-peer', agent: 'pi' },
    })
    const ask = vi.fn(async () => ({
      status: 'dispatched' as const,
      taskId: 'task-1', resumeId: 'resume-peer', workspaceId: 'ws-peer',
      workspace: 'peer', agent: 'pi',
      resolution: {
        mode: 'exact' as const,
        origin: { kind: 'session' as const, workspaceId: 'ws-peer', resumeId: 'resume-peer', agent: 'pi' },
      },
    }))
    const tool = conversationAskFactory.build(context({
      inboxStore,
      resolveInboxOrigin: () => ({
        kind: 'headless', runId: 'run-peer', resumeId: 'resume-peer', agent: 'pi',
      }),
      conversation: { ask, read: vi.fn() },
    }))

    await expect(run(tool, {
      prompt: 'What did you send?', inboxId: entry.id,
    })).resolves.toMatchObject({
      ok: true,
      subject: { kind: 'inbox', id: entry.id },
    })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'resume', resumeId: 'resume-peer' },
      subject: { kind: 'inbox', entryId: entry.id },
    }))
  })

  it('addresses a fresh Session through a Harness default', async () => {
    const ask = vi.fn(async () => ({
      status: 'dispatched' as const,
      taskId: 'task-1', resumeId: 'resume-fresh', workspaceId: 'ws-aq',
      workspace: 'quant', agent: 'codex',
      resolution: {
        mode: 'reconstructed' as const,
        workspaceId: 'ws-aq',
        reason: 'harness-default' as const,
      },
    }))
    const tool = conversationAskFactory.build(context({
      conversation: { ask, read: vi.fn() },
    }))

    await run(tool, { prompt: 'Start a new study.', harness: 'autoquant' })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'harness', harness: 'autoquant' },
    }))
  })

  it('passes reconstruction guidance only when explicitly requested', async () => {
    const ask = vi.fn(async () => ({
      status: 'dispatched' as const,
      taskId: 'task-1', resumeId: 'resume-1', workspaceId: 'ws-peer',
      workspace: 'peer', agent: 'pi',
      resolution: {
        mode: 'reconstructed' as const,
        workspaceId: 'ws-peer',
        reason: 'explicit-workspace' as const,
      },
    }))
    const tool = conversationAskFactory.build(context({
      conversation: { ask, read: vi.fn() },
    }))

    await run(tool, {
      prompt: 'Reconstruct the missing report.', wsId: 'ws-peer', reconstruct: true,
    })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ reconstruct: true }))
  })

  it('stamps the authoritative caller Session into the dispatch', async () => {
    const ask = vi.fn(async () => ({
      status: 'dispatched' as const,
      taskId: 'task-1', resumeId: 'resume-peer', workspaceId: 'ws-peer',
      workspace: 'peer', agent: 'pi',
      resolution: {
        mode: 'reconstructed' as const,
        workspaceId: 'ws-peer',
        reason: 'explicit-workspace' as const,
      },
    }))
    const tool = conversationAskFactory.build(context({
      origin: {
        kind: 'headless',
        runId: 'run-caller',
        resumeId: 'resume-caller',
        agent: 'codex',
      },
      conversation: { ask, read: vi.fn() },
    }))

    await run(tool, { prompt: 'Please take this work.', wsId: 'ws-peer' })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      source: {
        kind: 'session',
        workspaceId: 'ws-caller',
        resumeId: 'resume-caller',
        agent: 'codex',
        execution: { kind: 'headless', taskId: 'run-caller' },
      },
    }))
  })

  it('awaits a recorded task server-side and returns its final reply', async () => {
    const ask = vi.fn(async () => ({
      status: 'dispatched' as const,
      taskId: completedTask.taskId,
      resumeId: completedTask.resumeId,
      workspaceId: completedTask.workspaceId,
      workspace: 'peer',
      agent: completedTask.agent,
      resolution: {
        mode: 'exact' as const,
        origin: { kind: 'session' as const, workspaceId: 'ws-peer', resumeId: 'resume-1', agent: 'pi' },
      },
    }))
    const read = vi.fn(async () => completedTask)
    const tool = conversationAskFactory.build(context({ conversation: { ask, read } }))

    await expect(run(tool, {
      prompt: 'why?', resumeId: 'resume-1', await: true,
    })).resolves.toMatchObject({
      ok: true,
      awaited: true,
      status: 'done',
      taskId: 'task-1',
      assistantText: 'The report followed the issue rule.',
    })
    expect(read).toHaveBeenCalledWith('task-1')
  })
})

describe('conversation_await', () => {
  it('collects an already-running peer task without exposing diagnostic blocks', async () => {
    const tool = conversationAwaitFactory.build(context({
      conversation: { ask: vi.fn(), read: vi.fn(async () => completedTask) },
    }))
    const result = await run(tool, { taskId: completedTask.taskId })
    expect(result).toMatchObject({
      ok: true,
      awaited: true,
      status: 'done',
      assistantText: 'The report followed the issue rule.',
    })
    expect(result).not.toHaveProperty('blocks')
    expect(result).not.toHaveProperty('tools')
  })

  it('returns a running task for later polling when the wait budget expires', async () => {
    const runningTask = {
      ...completedTask,
      status: 'running' as const,
      durationMs: undefined,
      structured: null,
    }
    const tool = conversationAwaitFactory.build(context({
      conversation: { ask: vi.fn(), read: vi.fn(async () => runningTask) },
    }))
    await expect(run(tool, { taskId: runningTask.taskId, timeoutMs: 1 }))
      .resolves.toMatchObject({
        ok: true,
        awaited: false,
        status: 'running',
        next: 'alice-workspace conversation read --task-id task-1',
      })
  })
})

describe('conversation_collect', () => {
  it('awaits several tasks concurrently and preserves input order', async () => {
    const read = vi.fn(async (taskId: string) => ({
      ...completedTask,
      taskId,
      resumeId: `resume-${taskId}`,
      structured: {
        ...completedTask.structured,
        assistantText: `reply ${taskId}`,
      },
    }))
    const tool = conversationCollectFactory.build(context({
      conversation: { ask: vi.fn(), read },
    }))
    await expect(run(tool, { taskId: ['run-a', 'run-b'] })).resolves.toMatchObject({
      ok: true,
      complete: true,
      count: 2,
      running: 0,
      results: [
        { taskId: 'run-a', assistantText: 'reply run-a' },
        { taskId: 'run-b', assistantText: 'reply run-b' },
      ],
    })
    expect(read).toHaveBeenCalledWith('run-a')
    expect(read).toHaveBeenCalledWith('run-b')
  })

  it('reports missing tasks without hiding completed replies', async () => {
    const tool = conversationCollectFactory.build(context({
      conversation: {
        ask: vi.fn(),
        read: vi.fn(async (taskId: string) => taskId === 'missing' ? null : completedTask),
      },
    }))
    await expect(run(tool, { taskId: ['task-1', 'missing'] })).resolves.toMatchObject({
      ok: false,
      complete: false,
      missing: 1,
      results: [
        { ok: true, assistantText: 'The report followed the issue rule.' },
        { ok: false, taskId: 'missing' },
      ],
    })
  })
})

describe('conversation_read', () => {

  it('keeps default output decision-oriented', async () => {
    const tool = conversationReadFactory.build(context({
      conversation: { ask: vi.fn(), read: vi.fn(async () => completedTask) },
    }))
    const result = await run(tool, { taskId: completedTask.taskId })
    expect(result).toMatchObject({
      ok: true,
      assistantText: 'The report followed the issue rule.',
    })
    expect(result).not.toHaveProperty('blocks')
    expect(result).not.toHaveProperty('tools')
    expect(result).not.toHaveProperty('errors')
  })

  it('returns normalized blocks only in detailed mode', async () => {
    const tool = conversationReadFactory.build(context({
      conversation: { ask: vi.fn(), read: vi.fn(async () => completedTask) },
    }))
    await expect(run(tool, { taskId: completedTask.taskId, mode: 'detailed' }))
      .resolves.toMatchObject({
        tools: [{ name: 'Read', status: 'completed' }],
        blocks: completedTask.structured.blocks,
      })
  })
})
