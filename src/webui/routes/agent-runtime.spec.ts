import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { AgentRuntimeLog } from '../../workspaces/agent-runtime-log.js'
import { createAgentRuntimeLogRoutes } from './agent-runtime.js'

describe('GET /api/agent-runtime', () => {
  it('pages newest first and exposes lastSeq', async () => {
    const log = await AgentRuntimeLog.open(
      `${process.env.TMPDIR ?? '/tmp'}/agent-runtime-route-${Date.now()}.jsonl`,
      { warn() { /* test */ } },
    )
    await log.record('session.born', { workspaceId: 'desk', resumeId: 'resume-a', agent: 'pi' })
    await log.record('runtime.started', {
      workspaceId: 'desk',
      resumeId: 'resume-a',
      agent: 'pi',
      surface: 'headless',
      cause: { kind: 'http' },
    })
    const app = new Hono().route('/', createAgentRuntimeLogRoutes({
      agentRuntimeLog: log,
    } as never))
    const res = await app.request('/?page=1&pageSize=1')
    expect(res.status).toBe(200)
    const body = await res.json() as { entries: { type: string }[]; lastSeq: number; total: number }
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0]?.type).toBe('runtime.started')
    expect(body.lastSeq).toBe(2)
    expect(body.total).toBe(2)
  })

  it('replays afterSeq in chronological order', async () => {
    const log = {
      lastSeq: () => 3,
      read: vi.fn(async () => [
        { seq: 2, ts: 2, type: 'runtime.started', payload: { workspaceId: 'desk', resumeId: 'r', agent: 'pi' } },
      ]),
    }
    const app = new Hono().route('/', createAgentRuntimeLogRoutes({
      agentRuntimeLog: log,
    } as never))
    const res = await app.request('/?afterSeq=1&limit=10')
    expect(res.status).toBe(200)
    expect(log.read).toHaveBeenCalledWith({ afterSeq: 1, limit: 10 })
    const body = await res.json() as { lastSeq: number }
    expect(body.lastSeq).toBe(3)
  })

  it('records a Sonner probe through the same runtime journal', async () => {
    const record = vi.fn(async (type, payload) => ({ seq: 7, ts: 1, type, payload }))
    const app = new Hono().route('/', createAgentRuntimeLogRoutes({
      agentRuntimeLog: { record },
    } as never))

    const res = await app.request('/sonner-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'success' }),
    })

    expect(res.status).toBe(201)
    expect(record).toHaveBeenCalledWith('dev.sonner_test', expect.objectContaining({
      agent: 'Dev Panel',
      testState: 'success',
    }))
  })
})
