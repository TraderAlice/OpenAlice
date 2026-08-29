import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { createOfficeRoutes } from './office.js'

function directory(
  id: string,
  tag: string,
  sessions: {
    resumeId: string
    agent: string
    lifecycle?: string
    presence?: string
    updatedAt?: number
  }[],
) {
  return {
    workspace: { id, tag },
    sessions: sessions.map((session) => ({
      createdAt: session.updatedAt ?? Date.now(),
      updatedAt: session.updatedAt ?? Date.now(),
      lifecycle: session.lifecycle ?? 'active',
      resumable: true,
      active: false,
      ...session,
    })),
  }
}

describe('GET /api/office/floor', () => {
  it('returns every office when workspaceId is omitted', async () => {
    const app = new Hono().route('/', createOfficeRoutes({
      registry: {
        list: () => [
          { id: 'quant-1', tag: 'auto-quant', template: 'auto-quant-v2' },
          { id: 'chat-1', tag: 'chat', template: 'chat' },
        ],
        get: (id: string) => id === 'chat-1'
          ? { id, tag: 'chat', template: 'chat' }
          : id === 'quant-1' ? { id, tag: 'auto-quant', template: 'auto-quant-v2' } : undefined,
      },
      sessionDirectory: vi.fn(async (id: string) => id === 'chat-1'
        ? directory('chat-1', 'chat', [{ resumeId: 'resume-alice', agent: 'codex', lifecycle: 'active' }])
        : directory('quant-1', 'auto-quant', [])),
      sessionRegistry: { findByResumeId: vi.fn(() => ({ id: 'codex-1', name: 'c1', resumeId: 'resume-alice', title: 'Desk mate' })) },
      agentRuntimeLog: {
        lastSeq: () => 0,
        firstSeq: () => 0,
        projectionEvents: () => [],
        read: vi.fn(async () => []),
      },
      provenanceStore: { list: vi.fn(() => []) },
    } as never))
    const res = await app.request('/floor')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      config: {
        harnessMinimumVisibleGroups: Record<string, number>
      }
      offices: {
        workspace: { id: string; harness: string }
        sleeping: boolean
        employees: unknown[]
      }[]
    }
    expect(body.offices.map((office) => office.workspace.id)).toEqual(['chat-1', 'quant-1'])
    expect(body.offices[0]?.employees).toHaveLength(1)
    expect(body.offices[0]?.sleeping).toBe(false)
    expect(body.offices[1]?.sleeping).toBe(true)
    expect(body.offices.map((office) => office.workspace.harness)).toEqual(['chat', 'auto-quant'])
    expect(body.config.harnessMinimumVisibleGroups).toEqual({
      chat: 1,
      'auto-quant': 1,
      prediction: 1,
      other: 0,
    })
  })

  it('returns 404 for an unknown office filter', async () => {
    const app = new Hono().route('/', createOfficeRoutes({
      registry: { list: () => [], get: vi.fn() },
      sessionDirectory: vi.fn(async () => null),
      provenanceStore: { list: vi.fn(() => []) },
      agentRuntimeLog: {
        lastSeq: () => 0,
        firstSeq: () => 0,
        projectionEvents: () => [],
        read: vi.fn(async () => []),
      },
    } as never))
    const res = await app.request('/floor?workspaceId=missing')
    expect(res.status).toBe(404)
  })

  it('projects active employees and hangs drawers; asOfSeq replays mood', async () => {
    const now = 50_000
    const read = vi.fn(async () => [
      {
        seq: 1,
        ts: now - 20_000,
        type: 'runtime.started',
        payload: { workspaceId: 'office-1', resumeId: 'resume-alice', agent: 'codex', surface: 'headless' },
      },
      {
        seq: 2,
        ts: now - 10_000,
        type: 'runtime.turn.tool',
        payload: {
          workspaceId: 'office-1',
          resumeId: 'resume-alice',
          agent: 'codex',
          toolName: 'workspace_list',
          toolStatus: 'running',
        },
      },
      {
        seq: 3,
        ts: now,
        type: 'runtime.stopped',
        payload: { workspaceId: 'office-1', resumeId: 'resume-alice', agent: 'codex', status: 'done' },
      },
    ])
    const app = new Hono().route('/', createOfficeRoutes({
      registry: {
        list: () => [{ id: 'office-1', tag: 'chat', template: 'chat' }],
        get: (id: string) => id === 'office-1' ? { id, tag: 'chat', template: 'chat' } : undefined,
      },
      sessionDirectory: vi.fn(async () => directory('office-1', 'chat', [
        { resumeId: 'resume-alice', agent: 'codex', lifecycle: 'active' },
        { resumeId: 'resume-archived', agent: 'pi', lifecycle: 'active', presence: 'archived' },
      ])),
      sessionRegistry: {
        findByResumeId: vi.fn((_ws: string, resumeId: string) => resumeId === 'resume-alice'
          ? { id: 'codex-1', name: 'c1', resumeId, title: 'Desk mate' }
          : undefined),
      },
      agentRuntimeLog: {
        lastSeq: () => 3,
        firstSeq: () => 1,
        projectionEvents: () => [{
          seq: 3,
          ts: now,
          type: 'runtime.stopped',
          payload: {
            workspaceId: 'office-1',
            resumeId: 'resume-alice',
            agent: 'codex',
            surface: 'headless',
            status: 'done',
          },
        }],
        read,
      },
      provenanceStore: {
        list: vi.fn(() => [
          {
            id: 'prov-1',
            action: 'created',
            at: now,
            origin: { kind: 'session', workspaceId: 'office-1', resumeId: 'resume-alice', agent: 'codex' },
            artifact: { kind: 'report', workspaceId: 'office-1', path: 'docs/note.md' },
          },
        ]),
      },
    } as never))

    const live = await (await app.request('/floor')).json() as {
      offices: { employees: { resumeId: string; mood: string; drawers: { label: string }[] }[] }[]
      lastSeq: number
    }
    expect(live.lastSeq).toBe(3)
    expect(live.offices).toHaveLength(1)
    expect(live.offices[0]?.employees).toHaveLength(1)
    expect(live.offices[0]?.employees[0]).toMatchObject({
      resumeId: 'resume-alice',
      drawers: [expect.objectContaining({ label: 'note.md' })],
    })
    expect(read).not.toHaveBeenCalled()

    const replay = await (await app.request('/floor?asOfSeq=2')).json() as {
      offices: { employees: { mood: string; bubble: { name?: string } | null }[] }[]
      asOfSeq: number
    }
    expect(replay.asOfSeq).toBe(2)
    expect(replay.offices[0]?.employees[0]).toMatchObject({
      mood: 'working',
      bubble: { kind: 'tool', name: 'workspace_list' },
    })
    expect(read).toHaveBeenCalledTimes(1)
  })
})
