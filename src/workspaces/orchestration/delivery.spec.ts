import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_LEASE_MS,
  OrchestrationDelivery,
  formatCompactPointer,
  formatInlineWake,
} from './delivery.js'
import { OrchestrationStore } from './store.js'
import type { OrchestrationReplyRoute } from './types.js'

function telegramRoute(resumeId = 'res-parent', workspaceId = 'ws-desk'): OrchestrationReplyRoute {
  return {
    workspaceId,
    resumeId,
    connectorId: 'telegram',
    issueId: 'tg-desk',
    surface: 'connector',
    trigger: {
      kind: 'issue',
      workspaceId,
      issueId: 'tg-desk',
      metadata: { kind: 'connector-cron-issue', connectorId: 'telegram' },
    },
  }
}

describe('OrchestrationDelivery', () => {
  let dir: string
  let store: OrchestrationStore
  let nowMs: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orch-delivery-'))
    store = await OrchestrationStore.load(join(dir, 'orchestration-state.json'))
    nowMs = 1_000_000
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('delivers structured inline prompt on Web under threshold and compact pointer when oversized', async () => {
    const task = await store.createTask({
      parentResumeId: 'res-parent',
      parentWorkspaceId: 'ws-desk',
      workerResumeId: 'res-worker',
      workerWorkspaceId: 'ws-aq',
      workerAgent: 'codex',
      headlessTaskId: 'run-1',
      spec: 'Analyze factor',
      replyRoute: { workspaceId: 'ws-desk', resumeId: 'res-parent', surface: 'web' },
      createdAt: nowMs,
    })

    const q = await store.enqueueMessage({
      kind: 'question',
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      fromResumeId: 'res-worker',
      toResumeId: 'res-parent',
      subject: 'Confirm benchmark',
      body: 'Should we benchmark against SPY?',
      createdAt: nowMs,
    })

    const deliveredPrompts: string[] = []
    const delivery = new OrchestrationDelivery({
      store,
      deliverToWeb: async (_resumeId, prompt) => {
        deliveredPrompts.push(prompt)
        return 'delivered'
      },
      deliverToPty: async () => 'absent',
      inlineThresholdChars: 500,
      now: () => nowMs,
    })

    expect(await delivery.tryDeliver('res-parent')).toBe('delivered')
    expect(deliveredPrompts).toHaveLength(1)
    expect(deliveredPrompts[0]).toContain('Should we benchmark against SPY?')
    expect(deliveredPrompts[0]).toContain(`alice orchestration reply --id ${q.id} --body`)

    // Ack and enqueue an oversized message (> 500 chars)
    await store.ackMessages('res-parent', undefined, nowMs)
    await store.enqueueMessage({
      kind: 'worker_done',
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      fromResumeId: 'res-worker',
      toResumeId: 'res-parent',
      body: 'X'.repeat(600),
      metadata: { outcome: 'completed' },
      createdAt: nowMs + 10,
    })

    expect(await delivery.tryDeliver('res-parent')).toBe('delivered')
    expect(deliveredPrompts).toHaveLength(2)
    expect(deliveredPrompts[1]).toContain('alice orchestration check')
    expect(deliveredPrompts[1]).not.toContain('X'.repeat(100))
  })

  it('always delivers compact pointer on PTY even for short messages', async () => {
    const task = await store.createTask({
      parentResumeId: 'res-parent',
      parentWorkspaceId: 'ws-desk',
      workerResumeId: 'res-worker',
      workerWorkspaceId: 'ws-aq',
      workerAgent: 'codex',
      headlessTaskId: 'run-1',
      spec: 'Quick check',
      replyRoute: { workspaceId: 'ws-desk', resumeId: 'res-parent', surface: 'pty' },
      createdAt: nowMs,
    })
    await store.enqueueMessage({
      kind: 'worker_done',
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      fromResumeId: 'res-worker',
      toResumeId: 'res-parent',
      body: 'Short summary',
      metadata: { outcome: 'completed' },
      createdAt: nowMs,
    })

    const ptyPrompts: string[] = []
    const delivery = new OrchestrationDelivery({
      store,
      deliverToWeb: async () => 'absent',
      deliverToPty: async (_resumeId, pointer) => {
        ptyPrompts.push(pointer)
        return 'delivered'
      },
      now: () => nowMs,
    })

    expect(await delivery.tryDeliver('res-parent')).toBe('delivered')
    expect(ptyPrompts).toHaveLength(1)
    expect(ptyPrompts[0]).toContain('alice orchestration check')
    expect(ptyPrompts[0]).not.toContain('Short summary')
  })

  it('preserves immutable Telegram ReplyRoute when waking parent headlessly and isolates worker routes', async () => {
    const tgRoute = telegramRoute('res-parent', 'ws-desk')
    const task = await store.createTask({
      parentResumeId: 'res-parent',
      parentWorkspaceId: 'ws-desk',
      workerResumeId: 'res-worker',
      workerWorkspaceId: 'ws-aq',
      workerAgent: 'codex',
      headlessTaskId: 'run-1',
      spec: 'Backtest',
      replyRoute: tgRoute,
      createdAt: nowMs,
    })

    await store.enqueueMessage({
      kind: 'worker_done',
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      fromResumeId: 'res-worker',
      toResumeId: 'res-parent',
      body: 'Sharpe 1.92',
      metadata: { outcome: 'completed', evidence: 'pytest 12/12 passed' },
      createdAt: nowMs,
    })

    await store.enqueueMessage({
      kind: 'send',
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      fromResumeId: 'res-parent',
      toResumeId: 'res-worker',
      body: 'Also test 2022 drawdown',
      createdAt: nowMs + 5,
    })

    const headlessCalls: Array<{
      resumeId: string
      prompt: string
      route: OrchestrationReplyRoute | undefined
    }> = []

    const delivery = new OrchestrationDelivery({
      store,
      deliverToWeb: async () => 'absent',
      deliverToPty: async () => 'absent',
      deliverToHeadless: async (resumeId, prompt, route) => {
        headlessCalls.push({ resumeId, prompt, route })
        return { status: 'delivered', headlessTaskId: `run-wake-${headlessCalls.length}` }
      },
      now: () => nowMs,
    })

    expect(await delivery.tryDeliver('res-parent')).toBe('delivered')
    expect(headlessCalls[0]?.resumeId).toBe('res-parent')
    expect(headlessCalls[0]?.route).toEqual(tgRoute)
    expect(headlessCalls[0]?.prompt).toContain('Sharpe 1.92')
    expect(headlessCalls[0]?.prompt).toContain('pytest 12/12 passed')

    // Worker wake MUST NOT inherit parent's Telegram trigger/connectorId
    expect(await delivery.tryDeliver('res-worker')).toBe('delivered')
    expect(headlessCalls[1]?.resumeId).toBe('res-worker')
    expect(headlessCalls[1]?.route).toEqual({
      workspaceId: 'ws-aq',
      resumeId: 'res-worker',
      surface: 'headless',
    })
    expect(headlessCalls[1]?.route?.connectorId).toBeUndefined()
    expect(headlessCalls[1]?.route?.trigger).toBeUndefined()
  })

  it('uses finite leases scoped to exact messageIds and retries automatically after expiry on tick()', async () => {
    const m1 = await store.enqueueMessage({
      kind: 'escalation',
      taskId: 'task-1',
      dispatchId: 'dsp-1',
      fromResumeId: 'res-worker',
      toResumeId: 'res-parent',
      body: 'Worker exited without calling worker-done',
      metadata: { stopReason: 'stopped_without_done' },
      createdAt: nowMs,
    })

    let concurrentMsgId: string | undefined
    const deliveries: string[] = []
    const delivery = new OrchestrationDelivery({
      store,
      deliverToWeb: async (_resumeId, prompt) => {
        // Simulate a concurrent message arriving mid-delivery on first attempt
        if (deliveries.length === 0) {
          const m2 = await store.enqueueMessage({
            kind: 'worker_done',
            taskId: 'task-2',
            dispatchId: 'dsp-2',
            fromResumeId: 'res-worker-2',
            toResumeId: 'res-parent',
            body: 'Concurrent result',
            metadata: { outcome: 'completed' },
            createdAt: nowMs + 1,
          })
          concurrentMsgId = m2.id
        }
        deliveries.push(prompt)
        return 'delivered'
      },
      deliverToPty: async () => 'absent',
      leaseMs: DEFAULT_LEASE_MS,
      now: () => nowMs,
    })

    expect(await delivery.tryDeliver('res-parent')).toBe('delivered')
    expect(store.getMessage(m1.id)?.status).toBe('leased')
    expect(store.getMessage(concurrentMsgId!)?.status).toBe('unread')

    // While lease is active, duplicate wake coalesces to 'leased'
    nowMs += 30_000
    expect(await delivery.tryDeliver('res-parent')).toBe('leased')
    expect(deliveries).toHaveLength(1)

    // Once lease expires (120s), tick() releases lease and retries BOTH m1 and m2
    nowMs += 90_000
    const summary = await delivery.tick(nowMs)
    expect(summary.expiredLeaseCount).toBe(1)
    expect(summary.deliveredRecipients).toEqual(['res-parent'])
    expect(deliveries).toHaveLength(2)
    expect(deliveries[1]).toContain('stopped_without_done')
    expect(deliveries[1]).toContain('Concurrent result')
  })

  it('parks on thrown errors or busy surfaces and retries on onSessionSettled / tick()', async () => {
    await store.enqueueMessage({
      kind: 'worker_done',
      taskId: 'task-1',
      dispatchId: 'dsp-1',
      fromResumeId: 'res-worker',
      toResumeId: 'res-parent',
      body: 'Done!',
      metadata: { outcome: 'completed' },
      createdAt: nowMs,
    })

    const warn = vi.fn()
    let mode: 'throw' | 'busy' | 'ok' = 'throw'
    const delivery = new OrchestrationDelivery({
      store,
      deliverToWeb: async () => 'absent',
      deliverToPty: async () => 'absent',
      deliverToHeadless: async () => {
        if (mode === 'throw') throw new Error('HeadlessCapacityError')
        if (mode === 'busy') return 'busy'
        return 'delivered'
      },
      warn,
      now: () => nowMs,
    })

    expect(await delivery.tryDeliver('res-parent')).toBe('parked')
    expect(warn).toHaveBeenCalledTimes(1)

    mode = 'busy'
    await delivery.onSessionSettled('res-parent')
    expect(store.pendingMessagesFor('res-parent')[0]?.status).toBe('unread')

    mode = 'ok'
    await delivery.onSessionSettled('res-parent')
    expect(store.pendingMessagesFor('res-parent')[0]?.status).toBe('leased')
  })

  it('detects stalled running tasks past maxIdleMs on tick(), stops worker, and delivers escalation', async () => {
    const task = await store.createTask({
      parentResumeId: 'res-parent',
      parentWorkspaceId: 'ws-desk',
      workerResumeId: 'res-worker',
      workerWorkspaceId: 'ws-aq',
      workerAgent: 'codex',
      headlessTaskId: 'run-stuck',
      spec: 'Long job',
      replyRoute: telegramRoute(),
      maxIdleMs: 60_000,
      createdAt: nowMs,
    })
    // Queue a stale worker-bound message before stall; tick must NOT deliver it
    const staleSend = await store.enqueueMessage({
      kind: 'send',
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      fromResumeId: 'res-parent',
      toResumeId: 'res-worker',
      body: 'Stale queued message',
      createdAt: nowMs + 1000,
    })

    const stopStalledWorker = vi.fn(async () => {})
    const deliveredTo: string[] = []
    const receivedPrompts: string[] = []
    const delivery = new OrchestrationDelivery({
      store,
      deliverToWeb: async () => 'absent',
      deliverToPty: async () => 'absent',
      deliverToHeadless: async (resumeId, prompt) => {
        if (resumeId === 'res-worker') return 'busy'
        deliveredTo.push(resumeId)
        receivedPrompts.push(prompt)
        return 'delivered'
      },
      stopStalledWorker,
      now: () => nowMs,
    })

    // Before threshold: no stall
    nowMs += 30_000
    const before = await delivery.tick(nowMs)
    expect(before.stalledDispatchIds).toEqual([])
    expect(stopStalledWorker).not.toHaveBeenCalled()

    // Past maxIdleMs: marked failed (stalled), worker stopped, stale worker msg acked, only parent escalated
    nowMs += 30_000
    const after = await delivery.tick(nowMs)
    expect(after.stalledDispatchIds).toEqual([task.dispatchId])
    expect(after.deliveredRecipients).toEqual(['res-parent'])
    expect(deliveredTo).toEqual(['res-parent'])
    expect(store.getMessage(staleSend.id)?.status).toBe('acked')
    expect(stopStalledWorker).toHaveBeenCalledTimes(1)
    expect(store.getTaskByDispatchId(task.dispatchId)?.status).toBe('failed')
    expect(store.getTaskByDispatchId(task.dispatchId)?.stopReason).toBe('stalled')
    expect(receivedPrompts[0]).toContain('Stop Reason: stalled')
    expect(receivedPrompts[0]).toContain(`alice orchestration send --to dispatch:${task.dispatchId}`)
  })

  it('formats inline wake and compact pointer helpers cleanly for all message kinds', () => {
    const inline = formatInlineWake([
      {
        id: 'msg-1',
        kind: 'question',
        taskId: 'task-1',
        dispatchId: 'dsp-1',
        fromResumeId: 'w1',
        toResumeId: 'p1',
        body: 'Which dataset?',
        status: 'unread',
        createdAt: 1,
      },
      {
        id: 'msg-2',
        kind: 'escalation',
        taskId: 'task-2',
        dispatchId: 'dsp-2',
        fromResumeId: 'w2',
        toResumeId: 'p1',
        body: 'Exited early',
        metadata: { stopReason: 'stopped_without_done', assistantPreview: 'partial output' },
        status: 'unread',
        createdAt: 2,
      },
      {
        id: 'msg-3',
        kind: 'worker_done',
        taskId: 'task-3',
        dispatchId: 'dsp-3',
        fromResumeId: 'w3',
        toResumeId: 'p1',
        body: 'Report ready',
        metadata: {
          outcome: 'completed',
          evidence: 'all tests green',
          deliverables: [{ path: 'reports/out.md', workspaceId: 'ws-aq', summary: 'Final report' }],
        },
        status: 'unread',
        createdAt: 3,
      },
    ])

    expect(inline).toContain('alice orchestration reply --id msg-1 --body')
    expect(inline).toContain('alice orchestration send --to dispatch:dsp-2')
    expect(inline).toContain('partial output')
    expect(inline).toContain('reports/out.md')

    const pointer = formatCompactPointer(
      [
        {
          id: 'msg-1',
          kind: 'question',
          taskId: 'task-1',
          dispatchId: 'dsp-1',
          fromResumeId: 'w1',
          toResumeId: 'p1',
          body: 'q',
          status: 'unread',
          createdAt: 1,
        },
      ],
      'p1',
    )
    expect(pointer).toBe(
      'You have 1 pending orchestration message (question). Run `alice orchestration check` to read and acknowledge.',
    )
  })

  it('drains re-entrant tryDeliver calls without stranding unread work', async () => {
    await store.enqueueMessage({
      kind: 'worker_done',
      taskId: 'task-1',
      dispatchId: 'dsp-1',
      fromResumeId: 'w1',
      toResumeId: 'res-parent',
      body: 'First',
      createdAt: nowMs,
    })

    let releaseFirst!: () => void
    const firstBlocking = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let attempts = 0
    const delivery = new OrchestrationDelivery({
      store,
      deliverToWeb: async () => {
        attempts += 1
        if (attempts === 1) {
          await firstBlocking
          return 'busy'
        }
        return 'delivered'
      },
      deliverToPty: async () => 'absent',
      now: () => nowMs,
    })

    const p1 = delivery.tryDeliver('res-parent')
    const p2 = delivery.tryDeliver('res-parent')
    expect(await p2).toBe('parked')

    releaseFirst()
    expect(await p1).toBe('delivered')
    expect(attempts).toBe(2)
    expect(store.pendingMessagesFor('res-parent')[0]?.status).toBe('leased')
  })
})
