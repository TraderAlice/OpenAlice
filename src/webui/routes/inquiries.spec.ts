import { describe, expect, it, vi } from 'vitest'

import { createMemoryInboxStore } from '../../core/inbox-store.js'
import type { HeadlessTaskInquiry, HeadlessTaskRecord } from '../../workspaces/headless-task-registry.js'
import type { WorkspaceService } from '../../workspaces/service.js'
import { createInquiryRoutes } from './inquiries.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

function build(opts: { assignee?: string } = {}) {
  const inboxStore = createMemoryInboxStore()
  const dispatchHeadlessTask = vi.fn(async (
    _meta: unknown,
    _adapter: unknown,
    _prompt: string,
    _timeout?: number,
    _issueId?: string,
    _resumeId?: string,
    _inquiry?: HeadlessTaskInquiry,
    _overrides?: unknown,
    _conversation?: unknown,
    _createdBy?: unknown,
  ) => ({ taskId: 'run-new', resumeId: _resumeId ?? 'resume-new' }))
  const list = vi.fn((_filters: unknown) => [] as HeadlessTaskRecord[])
  const svc = {
    registry: { get: (id: string) => id === 'ws-1' ? { id, tag: 'Research', dir: '/tmp/ws-1' } : undefined },
    resumeRegistry: {
      get: (id: string) => id === 'resume-author' || id === 'resume-owner' || id === 'resume-run'
        ? { resumeId: id, wsId: 'ws-1', agent: 'pi', agentSessionId: `native-${id}` }
        : null,
    },
    provenanceStore: { latest: vi.fn(), append: vi.fn() },
    sessionRegistry: { get: vi.fn() },
    adapters: {
      get: (id: string) => id === 'pi'
        ? { id: 'pi', displayName: 'Pi', capabilities: { headless: true }, composeHeadlessCommand: vi.fn() }
        : undefined,
    },
    config: { launcherRepoRoot: '/tmp/repo' },
    resolveDefaultAgentId: vi.fn(async () => 'pi'),
    dispatchHeadlessTask,
    headlessTasks: { list, get: vi.fn() },
    headlessLogsDir: '/tmp/missing-inquiry-logs',
    issueDetail: vi.fn(async () => ({
      issue: {
        id: 'issue-1', title: 'Issue', body: '', status: 'todo', priority: 'none',
        assignee: opts.assignee ?? 'workspace',
      },
      runs: [{ taskId: 'run-old', resumeId: 'resume-run', wsId: 'ws-1', agent: 'pi', status: 'done', startedAt: 1, resumable: true }],
      inboxReports: [], provenance: [],
    })),
  } as unknown as WorkspaceService
  return { app: createInquiryRoutes({ service: svc, inboxStore }), inboxStore, dispatchHeadlessTask, list }
}

async function json(response: Response) {
  return await response.json() as any
}

describe('business inquiry routes', () => {
  it('asks an Inbox sender by exact resumeId and persists its business subject', async () => {
    const { app, inboxStore, dispatchHeadlessTask } = build()
    const entry = await inboxStore.append({
      workspaceId: 'ws-1', comments: 'report',
      origin: { kind: 'headless', runId: 'run-source', resumeId: 'resume-author', agent: 'pi' },
    })
    const response = await app.request(`/inbox/${entry.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Why?' }),
    })
    expect(response.status).toBe(202)
    expect((await json(response)).resolution.mode).toBe('exact')
    expect(dispatchHeadlessTask).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'Why?', undefined, undefined, 'resume-author',
      expect.objectContaining({
        subject: { kind: 'inbox', entryId: entry.id },
        question: 'Why?',
        resolution: { mode: 'exact' },
      }),
      undefined,
      expect.objectContaining({
        source: { kind: 'human' },
        originalPrompt: 'Why?',
        deliveredPrompt: 'Why?',
        promptMode: 'plain',
      }),
      undefined,
    )
  })

  it('stamps conversation birth for an unattributed Inbox reconstruction', async () => {
    const { app, inboxStore, dispatchHeadlessTask } = build()
    const entry = await inboxStore.append({ workspaceId: 'ws-1', comments: 'manual note' })
    await app.request(`/inbox/${entry.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Recover context' }),
    })
    expect(dispatchHeadlessTask.mock.calls[0]?.[9]).toMatchObject({
      kind: 'conversation',
      caller: { kind: 'human' },
      reason: 'missing-origin',
      subject: { kind: 'inbox', entryId: entry.id },
    })
  })

  it('keeps reconstruction provenance without changing an unattributed Inbox prompt by default', async () => {
    const { app, inboxStore, dispatchHeadlessTask } = build()
    const entry = await inboxStore.append({ workspaceId: 'ws-1', comments: 'manual note' })
    const response = await app.request(`/inbox/${entry.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Recover context' }),
    })
    expect(response.status).toBe(202)
    expect((await json(response)).resolution.mode).toBe('reconstructed')
    expect(dispatchHeadlessTask.mock.calls[0]?.[2]).toBe('Recover context')
    expect(dispatchHeadlessTask.mock.calls[0]?.[5]).toBeUndefined()
    expect(dispatchHeadlessTask.mock.calls[0]?.[6]?.resolution).toMatchObject({ mode: 'reconstructed' })
  })

  it('adds reconstruction guidance when the UI request explicitly opts in', async () => {
    const { app, inboxStore, dispatchHeadlessTask } = build()
    const entry = await inboxStore.append({ workspaceId: 'ws-1', comments: 'manual note' })
    const response = await app.request(`/inbox/${entry.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Recover context', reconstruct: true }),
    })
    expect(response.status).toBe(202)
    expect(dispatchHeadlessTask.mock.calls[0]?.[2]).toContain('fresh worker reconstructing')
    expect(dispatchHeadlessTask.mock.calls[0]?.[8]).toMatchObject({
      source: { kind: 'human' },
      originalPrompt: 'Recover context',
      promptMode: 'reconstruction',
    })
  })

  it('rejects Ask owner for a Workspace-owned Issue', async () => {
    const { app } = build({ assignee: '@new-each-run' })
    const response = await app.request('/issues/ws-1/issue-1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Status?', relation: 'owner' }),
    })
    expect(response.status).toBe(409)
    expect((await json(response)).error).toBe('no_stable_owner')
  })

  it('asks the fixed Issue owner and one selected run by their resumeIds', async () => {
    const { app, dispatchHeadlessTask } = build({ assignee: '@resume-owner' })
    const owner = await app.request('/issues/ws-1/issue-1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Owner?', relation: 'owner' }),
    })
    expect(owner.status).toBe(202)
    const run = await app.request('/issues/ws-1/issue-1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Run?', relation: 'run', runId: 'run-old' }),
    })
    expect(run.status).toBe(202)
    expect(dispatchHeadlessTask.mock.calls[0]?.[5]).toBe('resume-owner')
    expect(dispatchHeadlessTask.mock.calls[0]?.[6]?.subject).toMatchObject({ relation: 'owner' })
    expect(dispatchHeadlessTask.mock.calls[1]?.[5]).toBe('resume-run')
    expect(dispatchHeadlessTask.mock.calls[1]?.[6]?.subject).toMatchObject({ relation: 'run', runId: 'run-old' })
  })

  it('projects compact turn progress on inquiry history', async () => {
    const { app, list } = build()
    const progress = {
      updatedAt: 2,
      assistantText: null,
      blocks: [{ type: 'tool' as const, id: 't1', name: 'Read', status: 'running' as const }],
      metrics: { textBlocks: 0, toolCalls: 1, toolFailures: 0 },
    }
    list.mockReturnValue([{
      taskId: 'run-ask',
      resumeId: 'resume-author',
      wsId: 'ws-1',
      agent: 'pi',
      prompt: 'Why?',
      status: 'running',
      startedAt: 1,
      inquiry: {
        subject: { kind: 'inbox', entryId: 'entry-1' },
        question: 'Why?',
        resolution: { mode: 'exact' },
      },
      progress,
    }])
    const body = await json(await app.request('/inbox/entry-1'))
    expect(body.inquiries).toEqual([expect.objectContaining({
      taskId: 'run-ask',
      assistantText: null,
      progress,
    })])
  })

  it('lists inquiry history by business object', async () => {
    const { app, list } = build()
    expect((await app.request('/inbox/entry-1')).status).toBe(200)
    expect(list).toHaveBeenCalledWith({ inquiry: { kind: 'inbox', entryId: 'entry-1' }, limit: 50 })
    expect((await app.request('/issues/ws-1/issue-1')).status).toBe(200)
    expect(list).toHaveBeenCalledWith({
      inquiry: { kind: 'issue', workspaceId: 'ws-1', issueId: 'issue-1' },
      limit: 50,
    })
  })
})
