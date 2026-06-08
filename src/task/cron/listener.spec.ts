import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createEventLog, type EventLog } from '../../core/event-log.js'
import { createListenerRegistry, type ListenerRegistry } from '../../core/listener-registry.js'
import {
  createCronListener,
  type CronListener,
  type WorkspaceServiceBox,
  type CronDispatchLogger,
} from './listener.js'
import type { CronFirePayload } from './engine.js'
import type { WorkspaceService } from '../../workspaces/service.js'

function tempPath(ext: string): string {
  return join(tmpdir(), `cron-listener-test-${randomUUID()}.${ext}`)
}

// ==================== Fake WorkspaceService ====================
//
// The listener uses a narrow slice: registry.get(id) → meta, resolveAdapter,
// dispatchHeadlessTask. We fake exactly that and record dispatch calls.

interface DispatchCall {
  wsId: string
  adapterId: string
  prompt: string
  timeoutMs: number
}

function makeService(opts: {
  workspaces: Record<string, { id: string; tag: string; agents: string[] }>
  headless?: boolean
  dispatch?: () => Promise<{ taskId: string }>
}): { svc: WorkspaceService; calls: DispatchCall[] } {
  const calls: DispatchCall[] = []
  const headless = opts.headless ?? true
  const svc = {
    registry: { get: (id: string) => opts.workspaces[id] },
    resolveAdapter: (meta: { agents: string[] }, agentId?: string) => ({
      id: agentId ?? meta.agents[0] ?? 'claude',
      capabilities: { headless },
    }),
    dispatchHeadlessTask: async (
      meta: { id: string },
      adapter: { id: string },
      prompt: string,
      timeoutMs: number,
    ) => {
      calls.push({ wsId: meta.id, adapterId: adapter.id, prompt, timeoutMs })
      return opts.dispatch ? opts.dispatch() : { taskId: 'task-1' }
    },
  } as unknown as WorkspaceService
  return { svc, calls }
}

function captureLogger(): { logger: CronDispatchLogger; errors: string[]; infos: string[] } {
  const errors: string[] = []
  const infos: string[] = []
  return {
    logger: { info: (m) => infos.push(m), warn: () => {}, error: (m) => errors.push(m) },
    errors,
    infos,
  }
}

describe('cron listener → headless dispatch', () => {
  let eventLog: EventLog
  let registry: ListenerRegistry
  let cronListener: CronListener
  let ref: WorkspaceServiceBox
  let cap: ReturnType<typeof captureLogger>

  async function fire(payload: CronFirePayload): Promise<void> {
    await eventLog.append('cron.fire', payload)
  }

  beforeEach(async () => {
    eventLog = await createEventLog({ logPath: tempPath('jsonl') })
    registry = createListenerRegistry(eventLog)
    await registry.start()
    ref = { current: null }
    cap = captureLogger()
    cronListener = createCronListener({ registry, workspaceServiceRef: ref, logger: cap.logger })
    await cronListener.start()
  })

  afterEach(async () => {
    cronListener.stop()
    await registry.stop()
    await eventLog._resetForTest()
  })

  it('dispatches a headless run for a job targeting a workspace + agent', async () => {
    const { svc, calls } = makeService({
      workspaces: { 'ws-1': { id: 'ws-1', tag: 'research', agents: ['claude', 'codex'] } },
    })
    ref.current = svc

    await fire({ jobId: 'j1', jobName: 'morning-scan', payload: 'Scan the market', workspaceId: 'ws-1', agent: 'codex' })

    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ wsId: 'ws-1', adapterId: 'codex', prompt: 'Scan the market' })
    expect(calls[0].timeoutMs).toBeGreaterThan(0)
  })

  it('defaults to the workspace default agent when none is named', async () => {
    const { svc, calls } = makeService({
      workspaces: { 'ws-1': { id: 'ws-1', tag: 'research', agents: ['pi', 'claude'] } },
    })
    ref.current = svc

    await fire({ jobId: 'j1', jobName: 'scan', payload: 'go', workspaceId: 'ws-1' })

    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].adapterId).toBe('pi')
  })

  it('loud-skips a job with no target workspace', async () => {
    const { svc, calls } = makeService({ workspaces: {} })
    ref.current = svc

    await fire({ jobId: 'j1', jobName: 'legacy', payload: 'go' })

    await vi.waitFor(() => expect(cap.errors.some((e) => e.includes('no target workspace'))).toBe(true))
    expect(calls).toHaveLength(0)
  })

  it('loud-skips when the workspace service is not ready yet', async () => {
    ref.current = null // plugin not booted
    await fire({ jobId: 'j1', jobName: 'early', payload: 'go', workspaceId: 'ws-1', agent: 'claude' })
    await vi.waitFor(() => expect(cap.errors.some((e) => e.includes('not ready'))).toBe(true))
  })

  it('loud-skips an unknown target workspace', async () => {
    const { svc, calls } = makeService({ workspaces: {} })
    ref.current = svc
    await fire({ jobId: 'j1', jobName: 'gone', payload: 'go', workspaceId: 'deleted-ws', agent: 'claude' })
    await vi.waitFor(() => expect(cap.errors.some((e) => e.includes('unknown workspace'))).toBe(true))
    expect(calls).toHaveLength(0)
  })

  it('loud-skips when the named agent is not enabled on the workspace', async () => {
    const { svc, calls } = makeService({
      workspaces: { 'ws-1': { id: 'ws-1', tag: 'research', agents: ['claude'] } },
    })
    ref.current = svc
    await fire({ jobId: 'j1', jobName: 'bad-agent', payload: 'go', workspaceId: 'ws-1', agent: 'codex' })
    await vi.waitFor(() => expect(cap.errors.some((e) => e.includes('not enabled'))).toBe(true))
    expect(calls).toHaveLength(0)
  })

  it('loud-logs a dispatch failure (e.g. capacity) without throwing', async () => {
    const { svc } = makeService({
      workspaces: { 'ws-1': { id: 'ws-1', tag: 'research', agents: ['claude'] } },
      dispatch: async () => { throw new Error('headless capacity reached') },
    })
    ref.current = svc
    await fire({ jobId: 'j1', jobName: 'busy', payload: 'go', workspaceId: 'ws-1', agent: 'claude' })
    await vi.waitFor(() => expect(cap.errors.some((e) => e.includes('dispatch failed'))).toBe(true))
  })

  it('drops internal __*__ job names without dispatching', async () => {
    const { svc, calls } = makeService({
      workspaces: { 'ws-1': { id: 'ws-1', tag: 'research', agents: ['claude'] } },
    })
    ref.current = svc
    await fire({ jobId: 'snap', jobName: '__snapshot__', payload: '', workspaceId: 'ws-1' })
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toHaveLength(0)
    expect(cap.errors).toHaveLength(0)
  })

  it('does not react to other event types', async () => {
    const { svc, calls } = makeService({
      workspaces: { 'ws-1': { id: 'ws-1', tag: 'research', agents: ['claude'] } },
    })
    ref.current = svc
    await eventLog.append('message.received' as never, { channel: 'web', to: 'x', prompt: 'p' })
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toHaveLength(0)
  })

  it('stops dispatching after registry.stop()', async () => {
    const { svc, calls } = makeService({
      workspaces: { 'ws-1': { id: 'ws-1', tag: 'research', agents: ['claude'] } },
    })
    ref.current = svc
    await registry.stop()
    await fire({ jobId: 'j1', jobName: 'after-stop', payload: 'go', workspaceId: 'ws-1', agent: 'claude' })
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toHaveLength(0)
  })
})
