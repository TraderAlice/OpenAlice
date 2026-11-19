import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { OrchestrationStore } from './store.js'
import type { OrchestrationReplyRoute } from './types.js'

function telegramRoute(resumeId = 'res-parent', workspaceId = 'ws-desk'): OrchestrationReplyRoute {
  return {
    workspaceId,
    resumeId,
    connectorId: 'telegram',
    issueId: 'desk-1',
    surface: 'connector',
    trigger: {
      kind: 'issue',
      workspaceId,
      issueId: 'desk-1',
      metadata: { kind: 'connector-cron-issue', connectorId: 'telegram' },
    },
  }
}

describe('OrchestrationStore', () => {
  let dir: string
  let filePath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orch-store-'))
    filePath = join(dir, 'orchestration-state.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('persists tasks and messages atomically and reloads cleanly', async () => {
    const store = await OrchestrationStore.load(filePath)
    const task = await store.createTask({
      parentResumeId: 'res-parent',
      parentWorkspaceId: 'ws-desk',
      workerResumeId: 'res-worker-1',
      workerWorkspaceId: 'ws-aq',
      workerAgent: 'codex',
      headlessTaskId: 'run-1',
      spec: 'Run backtest',
      replyRoute: telegramRoute(),
      maxIdleMs: 300_000,
      createdAt: 1000,
    })

    const msg = await store.enqueueMessage({
      kind: 'question',
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      fromResumeId: 'res-worker-1',
      toResumeId: 'res-parent',
      subject: 'Date range',
      body: 'Use 2020-2025 or 2015-2025?',
      createdAt: 1100,
    })

    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { version: number; tasks: unknown[]; messages: unknown[] }
    expect(raw.version).toBe(1)
    expect(raw.tasks).toHaveLength(1)
    expect(raw.messages).toHaveLength(1)

    const reloaded = await OrchestrationStore.load(filePath)
    const loadedTask = reloaded.getTaskByDispatchId(task.dispatchId)
    expect(loadedTask).toEqual(task)
    expect(loadedTask?.replyRoute.connectorId).toBe('telegram')
    expect(loadedTask?.replyRoute.trigger?.metadata?.connectorId).toBe('telegram')

    const loadedMsg = reloaded.getMessage(msg.id)
    expect(loadedMsg).toEqual(msg)
  })

  it('recovers cleanly from missing or corrupt state files', async () => {
    const fresh = await OrchestrationStore.load(filePath)
    expect(fresh.listTasks()).toEqual([])

    await writeFile(filePath, '{not valid json', 'utf8')
    const recovered = await OrchestrationStore.load(filePath)
    expect(recovered.listTasks()).toEqual([])
  })

  it('reconciles zombie running tasks on startup and enqueues lost escalations', async () => {
    const store = await OrchestrationStore.load(filePath)
    const zombie = await store.createTask({
      parentResumeId: 'res-parent',
      parentWorkspaceId: 'ws-desk',
      workerResumeId: 'res-worker-dead',
      workerWorkspaceId: 'ws-aq',
      workerAgent: 'claude',
      headlessTaskId: 'run-dead',
      spec: 'Dead worker',
      replyRoute: telegramRoute(),
      createdAt: 1000,
    })
    const alive = await store.createTask({
      parentResumeId: 'res-parent',
      parentWorkspaceId: 'ws-desk',
      workerResumeId: 'res-worker-alive',
      workerWorkspaceId: 'ws-aq',
      workerAgent: 'codex',
      headlessTaskId: 'run-alive',
      spec: 'Alive worker',
      replyRoute: telegramRoute(),
      createdAt: 1001,
    })
    const waiting = await store.createTask({
      parentResumeId: 'res-parent',
      parentWorkspaceId: 'ws-desk',
      workerResumeId: 'res-worker-wait',
      workerWorkspaceId: 'ws-aq',
      workerAgent: 'codex',
      headlessTaskId: 'run-wait',
      spec: 'Waiting worker',
      replyRoute: telegramRoute(),
      createdAt: 1002,
    })
    await store.updateTask(waiting.dispatchId, (t) => {
      t.status = 'waiting_parent'
    }, 1050)

    const reloaded = await OrchestrationStore.load(filePath)
    const result = await reloaded.reconcileOnStartup(
      (headlessTaskId) => headlessTaskId === 'run-alive',
      5000,
    )

    expect(result.lostTasks.map((t) => t.dispatchId)).toEqual([zombie.dispatchId])
    expect(result.escalations).toHaveLength(1)

    const updatedZombie = reloaded.getTaskByDispatchId(zombie.dispatchId)!
    expect(updatedZombie.status).toBe('failed')
    expect(updatedZombie.outcome).toBe('failed')
    expect(updatedZombie.stopReason).toBe('lost')
    expect(updatedZombie.settledAt).toBe(5000)

    expect(reloaded.getTaskByDispatchId(alive.dispatchId)?.status).toBe('running')
    expect(reloaded.getTaskByDispatchId(waiting.dispatchId)?.status).toBe('waiting_parent')

    const esc = result.escalations[0]!
    expect(esc.kind).toBe('escalation')
    expect(esc.toResumeId).toBe('res-parent')
    expect(esc.status).toBe('unread')
    expect(esc.metadata?.stopReason).toBe('lost')

    // Persisted to disk
    const reloadedAgain = await OrchestrationStore.load(filePath)
    expect(reloadedAgain.getTaskByDispatchId(zombie.dispatchId)?.stopReason).toBe('lost')
    expect(reloadedAgain.pendingMessagesFor('res-parent')).toHaveLength(1)
  })

  it('scopes leases strictly to delivered messageIds and supports TTL expiry', async () => {
    const store = await OrchestrationStore.load(filePath)
    const m1 = await store.enqueueMessage({
      kind: 'worker_done',
      taskId: 'task-1',
      dispatchId: 'dsp-1',
      fromResumeId: 'res-w1',
      toResumeId: 'res-parent',
      body: 'First done',
      createdAt: 1000,
    })
    const m2 = await store.enqueueMessage({
      kind: 'worker_done',
      taskId: 'task-2',
      dispatchId: 'dsp-2',
      fromResumeId: 'res-w2',
      toResumeId: 'res-parent',
      body: 'Second arrived mid-delivery',
      createdAt: 1050,
    })

    // Lease ONLY m1 for 120s
    await store.leaseMessages('res-parent', [m1.id], 120_000, 2000)

    expect(store.getMessage(m1.id)?.status).toBe('leased')
    expect(store.getMessage(m1.id)?.leaseExpiresAt).toBe(122_000)
    expect(store.getMessage(m2.id)?.status).toBe('unread')
    expect(store.hasActiveLease('res-parent', 50_000)).toBe(true)
    expect(store.recipientsWithDeliverableWork(50_000)).toEqual([])

    // Lease expires at 122_000
    expect(store.hasActiveLease('res-parent', 122_000)).toBe(false)
    expect(store.recipientsWithDeliverableWork(122_000)).toEqual(['res-parent'])

    const expired = await store.expireLeases(122_000)
    expect(expired.map((m) => m.id)).toEqual([m1.id])
    expect(store.getMessage(m1.id)?.status).toBe('unread')
    expect(store.deliverableMessagesFor('res-parent', 122_000).map((m) => m.id)).toEqual([
      m1.id,
      m2.id,
    ])
  })

  it('enforces bounded retention while keeping active tasks and unacked messages', async () => {
    const store = await OrchestrationStore.load(filePath, { maxTasks: 3, maxMessages: 3 })

    // Create 2 settled + 2 active tasks -> oldest settled should be pruned when exceeding maxTasks=3
    const t1 = await store.createTask({
      parentResumeId: 'p',
      parentWorkspaceId: 'ws',
      workerResumeId: 'w1',
      workerWorkspaceId: 'ws',
      workerAgent: 'codex',
      spec: 't1',
      replyRoute: telegramRoute('p', 'ws'),
      createdAt: 1,
    })
    await store.updateTask(t1.dispatchId, (t) => { t.status = 'done'; t.settledAt = 2 }, 2)

    const t2 = await store.createTask({
      parentResumeId: 'p',
      parentWorkspaceId: 'ws',
      workerResumeId: 'w2',
      workerWorkspaceId: 'ws',
      workerAgent: 'codex',
      spec: 't2',
      replyRoute: telegramRoute('p', 'ws'),
      createdAt: 3,
    })
    await store.updateTask(t2.dispatchId, (t) => { t.status = 'failed'; t.settledAt = 4 }, 4)

    const t3 = await store.createTask({
      parentResumeId: 'p',
      parentWorkspaceId: 'ws',
      workerResumeId: 'w3',
      workerWorkspaceId: 'ws',
      workerAgent: 'codex',
      spec: 't3',
      replyRoute: telegramRoute('p', 'ws'),
      createdAt: 5,
    })
    const t4 = await store.createTask({
      parentResumeId: 'p',
      parentWorkspaceId: 'ws',
      workerResumeId: 'w4',
      workerWorkspaceId: 'ws',
      workerAgent: 'codex',
      spec: 't4',
      replyRoute: telegramRoute('p', 'ws'),
      createdAt: 6,
    })

    expect(store.getTaskByDispatchId(t1.dispatchId)).toBeUndefined()
    expect(store.getTaskByDispatchId(t2.dispatchId)).toBeDefined()
    expect(store.getTaskByDispatchId(t3.dispatchId)).toBeDefined()
    expect(store.getTaskByDispatchId(t4.dispatchId)).toBeDefined()

    // Messages: 2 acked + 2 unread -> oldest acked pruned
    const m1 = await store.enqueueMessage({
      kind: 'send', taskId: 't', dispatchId: 'd', fromResumeId: 'p', toResumeId: 'w', body: '1', createdAt: 1,
    })
    await store.ackMessageById(m1.id, 2)
    const m2 = await store.enqueueMessage({
      kind: 'send', taskId: 't', dispatchId: 'd', fromResumeId: 'p', toResumeId: 'w', body: '2', createdAt: 3,
    })
    await store.ackMessageById(m2.id, 4)
    const m3 = await store.enqueueMessage({
      kind: 'send', taskId: 't', dispatchId: 'd', fromResumeId: 'p', toResumeId: 'w', body: '3', createdAt: 5,
    })
    const m4 = await store.enqueueMessage({
      kind: 'send', taskId: 't', dispatchId: 'd', fromResumeId: 'p', toResumeId: 'w', body: '4', createdAt: 6,
    })

    expect(store.getMessage(m1.id)).toBeUndefined()
    expect(store.getMessage(m2.id)).toBeDefined()
    expect(store.getMessage(m3.id)).toBeDefined()
    expect(store.getMessage(m4.id)).toBeDefined()
  })
})
