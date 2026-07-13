import type { Tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { createMemoryInboxStore } from '../core/inbox-store.js'
import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import { inboxAskFactory, issueAskFactory } from './conversation-artifacts.js'

async function run(tool: Tool, args: Record<string, unknown>) {
  return tool.execute!(args, { toolCallId: 'test', messages: [] })
}

function dispatchedAsk() {
  return vi.fn(async () => ({
    status: 'dispatched' as const,
    taskId: 'run-short123',
    resumeId: 'resume-peer',
    workspaceId: 'ws-peer',
    workspace: 'peer',
    agent: 'pi',
    resolution: {
      mode: 'exact' as const,
      origin: {
        kind: 'session' as const,
        workspaceId: 'ws-peer',
        resumeId: 'resume-peer',
        agent: 'pi',
      },
    },
  }))
}

function baseContext(over: Partial<WorkspaceToolContext> = {}): WorkspaceToolContext {
  return {
    workspaceId: 'ws-caller',
    workspaceLabel: 'caller',
    inboxStore: createMemoryInboxStore(),
    entityStore: {} as never,
    ...over,
  }
}

describe('inbox_ask', () => {
  it('resolves one entry id to its authoritative Session origin', async () => {
    const inboxStore = createMemoryInboxStore()
    const entry = await inboxStore.append({
      workspaceId: 'ws-peer',
      comments: 'result',
      origin: { kind: 'headless', runId: 'run-old', agent: 'pi' },
    })
    const ask = dispatchedAsk()
    const tool = inboxAskFactory.build(baseContext({
      inboxStore,
      resolveInboxOrigin: () => ({
        kind: 'headless', runId: 'run-old', resumeId: 'resume-peer', agent: 'pi',
      }),
      conversation: { ask, read: vi.fn() },
    }))

    await expect(run(tool, { id: entry.id, prompt: 'why?' })).resolves.toMatchObject({
      ok: true,
      subject: { kind: 'inbox', id: entry.id },
      taskId: 'run-short123',
    })
    expect(ask).toHaveBeenCalledWith({
      prompt: 'why?',
      target: { kind: 'resume', resumeId: 'resume-peer' },
      subject: { kind: 'inbox', entryId: entry.id },
      timeoutMs: 300_000,
    })
  })

  it('uses the Inbox provenance resolver with a Workspace fallback for unattributed entries', async () => {
    const inboxStore = createMemoryInboxStore()
    const entry = await inboxStore.append({ workspaceId: 'ws-peer', comments: 'manual result' })
    const ask = dispatchedAsk()
    const tool = inboxAskFactory.build(baseContext({
      inboxStore,
      conversation: { ask, read: vi.fn() },
    }))
    await run(tool, { id: entry.id, prompt: 'reconstruct this' })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'inbox', inboxEntryId: entry.id, workspaceId: 'ws-peer' },
    }))
  })
})

function issueContext(opts: {
  assignee?: string
  runs?: Array<{ taskId: string; resumeId: string }>
} = {}) {
  const ask = dispatchedAsk()
  const detail = {
    issue: {
      id: 'audit', title: 'Audit', body: '', status: 'todo', priority: 'none',
      assignee: opts.assignee ?? 'workspace',
    },
    runs: (opts.runs ?? []).map((run) => ({
      ...run,
      wsId: 'ws-peer', agent: 'pi', prompt: 'work', status: 'done',
      startedAt: 1, resumable: true,
    })),
    inboxReports: [],
    provenance: [],
  }
  const ctx = baseContext({
    board: {
      snapshot: vi.fn(),
      resolveByName: vi.fn(async () => [{
        wsId: 'ws-peer', wsTag: 'peer', id: 'audit', title: 'Audit',
      }]),
      detail: vi.fn(async () => detail as never),
    },
    conversation: { ask, read: vi.fn() },
  })
  return { ctx, ask }
}

describe('issue_ask', () => {
  it('asks the creator by default through Issue provenance', async () => {
    const { ctx, ask } = issueContext()
    const result = await run(issueAskFactory.build(ctx), { id: 'audit', prompt: 'why?' })
    expect(result).toMatchObject({
      ok: true,
      subject: { kind: 'issue', id: 'audit', workspaceId: 'ws-peer', relation: 'creator' },
    })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'issue', workspaceId: 'ws-peer', issueId: 'audit', action: 'created' },
    }))
  })

  it('asks the declared stable owner by resumeId', async () => {
    const { ctx, ask } = issueContext({
      assignee: '@resume-owner',
    })
    await run(issueAskFactory.build(ctx), { id: 'audit', owner: true, prompt: 'status?' })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'resume', resumeId: 'resume-owner' },
    }))
  })

  it('requires an exact run when a fresh Issue has no stable owner', async () => {
    const { ctx, ask } = issueContext()
    await expect(run(issueAskFactory.build(ctx), {
      id: 'audit', owner: true, prompt: 'status?',
    })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('has no stable Session owner'),
    })
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks the product Session behind one selected run', async () => {
    const { ctx, ask } = issueContext({
      runs: [{ taskId: 'run-abc12345', resumeId: 'resume-run' }],
    })
    await run(issueAskFactory.build(ctx), {
      id: 'audit', runId: 'run-abc12345', prompt: 'what happened?',
    })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'resume', resumeId: 'resume-run' },
    }))
  })

  it('points callers to Issue show when a task is not one of the Issue runs', async () => {
    const { ctx } = issueContext()
    await expect(run(issueAskFactory.build(ctx), {
      id: 'audit', runId: 'run-from-a-follow-up', prompt: 'what happened?',
    })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('alice-workspace issue show --id audit'),
    })
  })
})
