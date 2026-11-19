import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { validateExecutionOrigin, type ExecutionOrigin } from '../session-execution-manager.js'
import { SessionTakeovers } from '../session-takeover.js'
import type { WorkspaceMeta } from '../workspace-registry.js'

import { OrchestrationDelivery } from './delivery.js'
import { OrchestrationManager, type WorkerDispatchRequest } from './manager.js'
import { OrchestrationStore } from './store.js'
import { OrchestrationError, type OrchestrationReplyRoute } from './types.js'

function makeWorkspace(id: string, tag: string, template = 'autoquant'): WorkspaceMeta {
  return {
    id,
    tag,
    dir: `/tmp/${id}`,
    template,
    createdAt: '2026-11-19T00:00:00.000Z',
  }
}

describe('OrchestrationManager', () => {
  let dir: string
  let store: OrchestrationStore
  let nowMs: number
  let runningSessions: Set<string>
  let dispatchSeq: number
  let headlessWakes: Array<{
    resumeId: string
    prompt: string
    route: OrchestrationReplyRoute | undefined
    origin: ExecutionOrigin
  }>
  let dispatchRequests: WorkerDispatchRequest[]
  let stopCalls: Array<{ resumeId: string; reason: string }>
  let manager: OrchestrationManager
  let delivery: OrchestrationDelivery
  let capturedParentRoute: OrchestrationReplyRoute

  const wsDesk = makeWorkspace('ws-desk', 'desk', 'chat')
  const wsAutoQuant = makeWorkspace('ws-aq', 'autoquant-main', 'autoquant')
  const workspaces = new Map<string, WorkspaceMeta>([
    [wsDesk.id, wsDesk],
    [wsAutoQuant.id, wsAutoQuant],
  ])

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orch-manager-'))
    store = await OrchestrationStore.load(join(dir, 'orchestration-state.json'))
    nowMs = 2_000_000
    runningSessions = new Set<string>()
    dispatchSeq = 0
    headlessWakes = []
    dispatchRequests = []
    stopCalls = []

    capturedParentRoute = {
      workspaceId: wsDesk.id,
      resumeId: 'res-parent',
      connectorId: 'telegram',
      issueId: 'tg-desk-1',
      surface: 'connector',
      trigger: {
        kind: 'issue',
        workspaceId: wsDesk.id,
        issueId: 'tg-desk-1',
        metadata: { kind: 'connector-cron-issue', connectorId: 'telegram' },
      },
    }

    delivery = new OrchestrationDelivery({
      store,
      deliverToWeb: async () => 'absent',
      deliverToPty: async () => 'absent',
      deliverToHeadless: async (resumeId, prompt, route) => {
        if (runningSessions.has(resumeId)) return 'busy'
        dispatchSeq += 1
        const headlessTaskId = `run-wake-${dispatchSeq}`
        const origin = validateExecutionOrigin({
          kind: 'system',
          entry: 'orchestration-wake',
          workspaceId: route?.workspaceId ?? wsDesk.id,
          ...(route?.connectorId ? { connectorId: route.connectorId } : {}),
          ...(route?.issueId ? { issueId: route.issueId } : {}),
        })
        headlessWakes.push({ resumeId, prompt, route, origin })
        if (resumeId.startsWith('res-worker')) {
          runningSessions.add(resumeId)
        }
        return { status: 'delivered', headlessTaskId }
      },
      now: () => nowMs,
    })

    manager = new OrchestrationManager({
      store,
      delivery,
      resolveWorkspace: (id) => workspaces.get(id),
      resolveHarnessWorkspace: async (harness) =>
        harness === 'autoquant' ? wsAutoQuant : harness === 'chat' ? wsDesk : undefined,
      captureReplyRoute: async (parentResumeId, parentWorkspaceId) => ({
        ...capturedParentRoute,
        resumeId: parentResumeId,
        workspaceId: parentWorkspaceId,
      }),
      dispatchWorker: async (request) => {
        dispatchRequests.push(request)
        dispatchSeq += 1
        const workerResumeId = `res-worker-${dispatchSeq}`
        const headlessTaskId = `run-start-${dispatchSeq}`
        runningSessions.add(workerResumeId)
        return {
          taskId: headlessTaskId,
          resumeId: workerResumeId,
          agent: request.agent ?? 'codex',
        }
      },
      stopWorkerExecution: async (resumeId, reason) => {
        stopCalls.push({ resumeId, reason })
        const existed = runningSessions.delete(resumeId)
        return existed
      },
      isSessionRunning: (resumeId) => runningSessions.has(resumeId),
      now: () => nowMs,
    })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('starts a worker with harness resolution, runtime overrides, Orca preamble, and immutable Telegram ReplyRoute', async () => {
    const started = await manager.workerStart({
      parentResumeId: 'res-parent',
      parentWorkspaceId: wsDesk.id,
      harness: 'autoquant',
      spec: 'Backtest momentum factor on SPY',
      agent: 'claude',
      model: 'claude-sonnet-4-6',
      effort: 'high',
      credential: 'anthropic-prod',
      maxIdleMs: 120_000,
    })

    expect(started.workerWorkspaceId).toBe(wsAutoQuant.id)
    expect(started.workerAgent).toBe('claude')
    expect(started.task.status).toBe('running')
    expect(started.task.turnCount).toBe(1)
    expect(started.task.replyRoute.connectorId).toBe('telegram')
    expect(started.task.replyRoute.trigger?.issueId).toBe('tg-desk-1')

    expect(dispatchRequests).toHaveLength(1)
    const req = dispatchRequests[0]!
    expect(req.selection).toEqual({
      credentialSlug: 'anthropic-prod',
      model: 'claude-sonnet-4-6',
      reasoningEffort: 'high',
    })
    expect(req.prompt).toContain(`Task ID: ${started.task.taskId}`)
    expect(req.prompt).toContain(`Dispatch ID: ${started.task.dispatchId}`)
    expect(req.prompt).toContain(`alice orchestration ask --dispatch ${started.task.dispatchId}`)
    expect(req.prompt).toContain(`alice orchestration worker-done --dispatch ${started.task.dispatchId}`)
    expect(req.prompt).toContain('Backtest momentum factor on SPY')
  })

  it('completes a full ask -> reply -> worker-done round-trip without spurious escalations', async () => {
    const started = await manager.workerStart({
      parentResumeId: 'res-parent',
      parentWorkspaceId: wsDesk.id,
      workspaceId: wsAutoQuant.id,
      spec: 'Run factor sweep',
    })

    // Mutate external captured route after workerStart to prove ReplyRoute is immutable
    capturedParentRoute = { workspaceId: wsDesk.id, resumeId: 'res-parent', surface: 'headless' }

    // 1. Worker asks parent
    const asked = await manager.ask({
      dispatchId: started.task.dispatchId,
      fromResumeId: started.workerResumeId,
      subject: 'Universe',
      body: 'Include QQQ in addition to SPY?',
    })
    expect(asked.task.status).toBe('waiting_parent')
    expect(asked.message.kind).toBe('question')
    expect(asked.wakeResult).toBe('delivered')

    // Parent woke with original immutable Telegram ReplyRoute!
    expect(headlessWakes).toHaveLength(1)
    expect(headlessWakes[0]?.resumeId).toBe('res-parent')
    expect(headlessWakes[0]?.route?.connectorId).toBe('telegram')
    expect(headlessWakes[0]?.prompt).toContain(`alice orchestration reply --id ${asked.message.id}`)

    // 2. Worker ends turn 1 while waiting_parent -> NO escalation
    runningSessions.delete(started.workerResumeId)
    await manager.onWorkerHeadlessSettled({
      headlessTaskId: started.headlessTaskId,
      workerResumeId: started.workerResumeId,
      status: 'done',
      assistantPreview: 'Waiting for coordinator reply.',
    })
    expect(manager.getTask(started.task.dispatchId)?.status).toBe('waiting_parent')
    expect(headlessWakes).toHaveLength(1)

    // workerList shows pending question and reply action hint
    const listed = manager.workerList({ parentResumeId: 'res-parent' })
    expect(listed).toHaveLength(1)
    expect(listed[0]?.pendingQuestions).toHaveLength(1)
    expect(listed[0]?.nextAction).toContain(`alice orchestration reply --id ${asked.message.id}`)

    // 3. Parent replies -> acks question, transitions task back to running, resumes worker immediately
    const replied = await manager.reply({
      messageId: asked.message.id,
      fromResumeId: 'res-parent',
      body: 'Yes, include both SPY and QQQ.',
    })
    expect(replied.question.status).toBe('acked')
    expect(replied.reply.kind).toBe('reply')
    expect(replied.reply.replyToMessageId).toBe(asked.message.id)
    expect(replied.wakeResult).toBe('delivered')
    expect(replied.task.status).toBe('running')
    expect(replied.task.turnCount).toBe(2)
    expect(replied.task.headlessTaskId).toBe('run-wake-3')

    // Double reply is rejected
    await expect(
      manager.reply({
        messageId: asked.message.id,
        fromResumeId: 'res-parent',
        body: 'Duplicate reply',
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' })

    // 4. Worker finishes turn 2 via workerDone
    const done = await manager.workerDone({
      dispatchId: started.task.dispatchId,
      fromResumeId: started.workerResumeId,
      outcome: 'completed',
      summary: 'SPY + QQQ sweep finished with Sharpe 1.85.',
      evidence: 'runs/sweep-42.json',
      deliverables: [{ path: 'runs/sweep-42.json', workspaceId: wsAutoQuant.id }],
    })
    expect(done.task.status).toBe('done')
    expect(done.task.outcome).toBe('completed')
    expect(done.wakeResult).toBe('delivered')
    expect(headlessWakes.at(-1)?.resumeId).toBe('res-parent')
    expect(headlessWakes.at(-1)?.route?.connectorId).toBe('telegram')
    expect(headlessWakes.at(-1)?.prompt).toContain('SPY + QQQ sweep finished')

    // Turn 2 exits cleanly -> no escalation
    runningSessions.delete(started.workerResumeId)
    await manager.onWorkerHeadlessSettled({
      headlessTaskId: replied.task.headlessTaskId!,
      workerResumeId: started.workerResumeId,
      status: 'done',
      assistantPreview: 'Done.',
    })
    expect(manager.getTask(started.task.dispatchId)?.status).toBe('done')

    // Parent check acks pending worker_done; inbox preserves audit trail
    const checked = await manager.check({ recipientResumeId: 'res-parent' })
    expect(checked.map((m) => m.kind)).toEqual(['worker_done'])
    expect(await manager.check({ recipientResumeId: 'res-parent' })).toEqual([])

    const history = manager.inbox({ recipientResumeId: 'res-parent' })
    expect(history).toHaveLength(2)
    expect(history.every((m) => m.status === 'acked')).toBe(true)
  })

  it('queues send() while worker is running and drains on settle; resumes immediately when idle', async () => {
    const started = await manager.workerStart({
      parentResumeId: 'res-parent',
      parentWorkspaceId: wsDesk.id,
      workspaceId: wsAutoQuant.id,
      spec: 'Initial pass',
    })

    // Send while worker is actively running -> queued
    const queued = await manager.send({
      toDispatchId: started.task.dispatchId,
      fromResumeId: 'res-parent',
      subject: 'Extra check',
      body: 'Also compute Sortino ratio.',
    })
    expect(queued.mode).toBe('queued')
    expect(queued.message.status).toBe('unread')
    expect(headlessWakes).toHaveLength(0)

    // Worker calls worker-done for turn 1, then its headless process exits
    await manager.workerDone({
      dispatchId: started.task.dispatchId,
      fromResumeId: started.workerResumeId,
      outcome: 'completed',
      summary: 'Initial pass done.',
    })
    await manager.check({ recipientResumeId: 'res-parent' })

    runningSessions.delete(started.workerResumeId)
    await manager.onWorkerHeadlessSettled({
      headlessTaskId: started.headlessTaskId,
      workerResumeId: started.workerResumeId,
      status: 'done',
      assistantPreview: 'Finished initial pass.',
    })

    // Queued send automatically drained and resumed the worker for turn 2!
    const afterDrain = manager.getTask(started.task.dispatchId)!
    expect(afterDrain.status).toBe('running')
    expect(afterDrain.turnCount).toBe(2)
    expect(headlessWakes.at(-1)?.resumeId).toBe(started.workerResumeId)
    expect(headlessWakes.at(-1)?.prompt).toContain('Also compute Sortino ratio.')

    // Finish turn 2 so worker is completely idle/done
    await manager.workerDone({
      dispatchId: started.task.dispatchId,
      fromResumeId: started.workerResumeId,
      outcome: 'completed',
      summary: 'Sortino 2.4 computed.',
    })
    runningSessions.delete(started.workerResumeId)
    await manager.onWorkerHeadlessSettled({
      headlessTaskId: afterDrain.headlessTaskId!,
      workerResumeId: started.workerResumeId,
      status: 'done',
    })
    expect(manager.getTask(started.task.dispatchId)?.status).toBe('done')

    // Now send while worker is idle/done -> resumes immediately as turn 3!
    const resumed = await manager.send({
      toDispatchId: started.task.dispatchId,
      fromResumeId: 'res-parent',
      body: 'Export results to CSV.',
    })
    expect(resumed.mode).toBe('resumed')
    expect(resumed.task.status).toBe('running')
    expect(resumed.task.turnCount).toBe(3)
    expect(resumed.headlessTaskId).toBeDefined()
    expect(headlessWakes.at(-1)?.resumeId).toBe(started.workerResumeId)
    expect(headlessWakes.at(-1)?.prompt).toContain('Export results to CSV.')
  })

  it('enforces strict Orca guard: emits stopped_without_done escalation if worker exits without worker-done or ask', async () => {
    const started = await manager.workerStart({
      parentResumeId: 'res-parent',
      parentWorkspaceId: wsDesk.id,
      workspaceId: wsAutoQuant.id,
      spec: 'Audit ledger',
    })

    // Worker exits normally with plain text, never calling ask or worker-done
    runningSessions.delete(started.workerResumeId)
    await manager.onWorkerHeadlessSettled({
      headlessTaskId: started.headlessTaskId,
      workerResumeId: started.workerResumeId,
      status: 'done',
      assistantPreview: 'I looked at the ledger and everything seems okay.',
    })

    const task = manager.getTask(started.task.dispatchId)!
    expect(task.status).toBe('failed')
    expect(task.stopReason).toBe('stopped_without_done')

    expect(headlessWakes).toHaveLength(1)
    expect(headlessWakes[0]?.resumeId).toBe('res-parent')
    expect(headlessWakes[0]?.route?.connectorId).toBe('telegram')
    expect(headlessWakes[0]?.prompt).toContain('Stop Reason: stopped_without_done')
    expect(headlessWakes[0]?.prompt).toContain('I looked at the ledger')
    expect(headlessWakes[0]?.prompt).toContain(`alice orchestration send --to dispatch:${started.task.dispatchId}`)

    // Parent can still recover by sending a follow-up to the failed dispatch
    const followUp = await manager.send({
      toDispatchId: started.task.dispatchId,
      fromResumeId: 'res-parent',
      body: 'Please submit your findings via alice orchestration worker-done.',
    })
    expect(followUp.mode).toBe('resumed')
    expect(followUp.task.status).toBe('running')
    expect(followUp.task.turnCount).toBe(2)
  })

  it('workerStop marks task stopped before stopping execution so interrupted settlement does not escalate', async () => {
    const started = await manager.workerStart({
      parentResumeId: 'res-parent',
      parentWorkspaceId: wsDesk.id,
      workspaceId: wsAutoQuant.id,
      spec: 'Long search',
    })

    const stopped = await manager.workerStop(started.task.dispatchId, 'superseded')
    expect(stopped.task.status).toBe('stopped')
    expect(stopped.task.stopReason).toBe('superseded')
    expect(stopped.stoppedExecution).toBe(true)
    expect(stopCalls).toEqual([{ resumeId: started.workerResumeId, reason: 'superseded' }])

    // Resulting interrupted settlement is silent (no escalation)
    await manager.onWorkerHeadlessSettled({
      headlessTaskId: started.headlessTaskId,
      workerResumeId: started.workerResumeId,
      status: 'interrupted',
      error: 'superseded',
    })
    expect(headlessWakes).toHaveLength(0)
    expect(manager.getTask(started.task.dispatchId)?.status).toBe('stopped')
  })

  it('never triggers SessionTakeovers self-takeover error when waking parent headlessly', async () => {
    const takeovers = await SessionTakeovers.open(
      join(dir, 'takeovers.json'),
      () => undefined,
      async () => true,
    )
    try {
      const started = await manager.workerStart({
        parentResumeId: 'res-parent',
        parentWorkspaceId: wsDesk.id,
        workspaceId: wsAutoQuant.id,
        spec: 'Check takeover safety',
      })
      await manager.workerDone({
        dispatchId: started.task.dispatchId,
        fromResumeId: started.workerResumeId,
        outcome: 'completed',
        summary: 'All clear',
      })

      expect(headlessWakes).toHaveLength(1)
      const wake = headlessWakes[0]!
      // Critical invariant: origin.resumeId MUST NOT equal target resumeId
      expect(wake.origin.resumeId).toBeUndefined()

      // Actually acquire takeover against real SessionTakeovers — must succeed cleanly!
      const release = await takeovers.acquire(
        { workspaceId: wsDesk.id, recordId: 'rec-parent', resumeId: 'res-parent' },
        wake.origin,
        60,
      )
      release()
    } finally {
      await takeovers.close()
    }
  })

  it('validates authorization and conflicting inputs cleanly', async () => {
    await expect(
      manager.workerStart({
        parentResumeId: 'res-parent',
        parentWorkspaceId: wsDesk.id,
        spec: 'Bad creds',
        credential: 'vault-slug',
        credentialSource: 'native',
      }),
    ).rejects.toBeInstanceOf(OrchestrationError)

    const started = await manager.workerStart({
      parentResumeId: 'res-parent',
      parentWorkspaceId: wsDesk.id,
      spec: 'Valid task',
    })

    await expect(
      manager.ask({
        dispatchId: started.task.dispatchId,
        fromResumeId: 'res-impostor',
        body: 'Who am I?',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' })

    const asked = await manager.ask({
      dispatchId: started.task.dispatchId,
      fromResumeId: started.workerResumeId,
      body: 'Need approval',
    })
    await expect(
      manager.reply({
        messageId: asked.message.id,
        fromResumeId: 'res-not-parent',
        body: 'Denied',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('maps workerDone failed -> failed and inconclusive -> done', async () => {
    const first = await manager.workerStart({
      parentResumeId: 'res-parent',
      parentWorkspaceId: wsDesk.id,
      spec: 'Job A',
    })
    const failedRes = await manager.workerDone({
      dispatchId: first.task.dispatchId,
      fromResumeId: first.workerResumeId,
      outcome: 'failed',
      summary: 'Data feed unavailable.',
      evidence: 'HTTP 503',
    })
    expect(failedRes.task.status).toBe('failed')
    expect(failedRes.task.outcome).toBe('failed')

    const second = await manager.workerStart({
      parentResumeId: 'res-parent',
      parentWorkspaceId: wsDesk.id,
      spec: 'Job B',
    })
    const incRes = await manager.workerDone({
      dispatchId: second.task.dispatchId,
      fromResumeId: second.workerResumeId,
      outcome: 'inconclusive',
      summary: 'Sample size too small.',
    })
    expect(incRes.task.status).toBe('done')
    expect(incRes.task.outcome).toBe('inconclusive')
  })

  it('handles fast reply() while worker ask turn is still active without false stopped_without_done escalation', async () => {
    const started = await manager.workerStart({
      parentResumeId: 'res-parent',
      parentWorkspaceId: wsDesk.id,
      workspaceId: wsAutoQuant.id,
      spec: 'Check parameters',
    })

    // Worker calls ask while turn 1 is still running (`runningSessions` still has worker)
    const asked = await manager.ask({
      dispatchId: started.task.dispatchId,
      fromResumeId: started.workerResumeId,
      body: 'Use weekly or daily rebalance?',
    })
    expect(asked.task.status).toBe('waiting_parent')
    expect(headlessWakes).toHaveLength(1) // parent woken

    // Parent replies IMMEDIATELY before worker turn 1 exits -> worker is still busy -> parked
    const replied = await manager.reply({
      messageId: asked.message.id,
      fromResumeId: 'res-parent',
      body: 'Use daily rebalance.',
    })
    expect(replied.wakeResult).toBe('parked')
    expect(replied.question.status).toBe('acked')
    expect(replied.reply.status).toBe('unread')
    // Must stay `waiting_parent` until turn 2 actually launches
    expect(replied.task.status).toBe('waiting_parent')
    expect(replied.task.turnCount).toBe(1)

    // Now worker turn 1 finishes cleanly -> NO escalation, queued reply drains into turn 2!
    runningSessions.delete(started.workerResumeId)
    await manager.onWorkerHeadlessSettled({
      headlessTaskId: started.headlessTaskId,
      workerResumeId: started.workerResumeId,
      status: 'done',
      assistantPreview: 'Asked coordinator and waiting.',
    })

    const resumed = manager.getTask(started.task.dispatchId)!
    expect(resumed.status).toBe('running')
    expect(resumed.turnCount).toBe(2)
    expect(resumed.headlessTaskId).not.toBe(started.headlessTaskId)
    expect(resumed.stopReason).toBeUndefined()
    // No escalation message was enqueued for parent
    expect(
      manager.inbox({ recipientResumeId: 'res-parent' }).filter((m) => m.kind === 'escalation'),
    ).toHaveLength(0)
    // Worker received the reply inline on turn 2
    expect(headlessWakes.at(-1)?.resumeId).toBe(started.workerResumeId)
    expect(headlessWakes.at(-1)?.prompt).toContain('Use daily rebalance.')
  })

  it('workerStop with a queued send keeps worker stopped across settle and tick, while a fresh later send still resumes', async () => {
    const started = await manager.workerStart({
      parentResumeId: 'res-parent',
      parentWorkspaceId: wsDesk.id,
      workspaceId: wsAutoQuant.id,
      spec: 'Long scan',
    })

    // Queue a send while worker is running
    const queued = await manager.send({
      toDispatchId: started.task.dispatchId,
      fromResumeId: 'res-parent',
      body: 'Stale instruction before stop',
    })
    expect(queued.mode).toBe('queued')

    // Coordinator explicitly stops the worker
    const stopped = await manager.workerStop(started.task.dispatchId, 'canceled_by_user')
    expect(stopped.task.status).toBe('stopped')
    expect(store.getMessage(queued.message.id)?.status).toBe('acked')

    // Worker process finishes interrupting
    await manager.onWorkerHeadlessSettled({
      headlessTaskId: started.headlessTaskId,
      workerResumeId: started.workerResumeId,
      status: 'interrupted',
      error: 'canceled_by_user',
    })
    expect(manager.getTask(started.task.dispatchId)?.status).toBe('stopped')
    expect(headlessWakes).toHaveLength(0)

    // Watchdog tick also must NOT resurrect the stopped worker
    nowMs += 60_000
    const tickRes = await manager.tick(nowMs)
    expect(tickRes.deliveredRecipients).toEqual([])
    expect(manager.getTask(started.task.dispatchId)?.status).toBe('stopped')
    expect(headlessWakes).toHaveLength(0)

    // A NEW explicit send after stop still resumes normally
    const revived = await manager.send({
      toDispatchId: started.task.dispatchId,
      fromResumeId: 'res-parent',
      body: 'Resume with narrowed scope',
    })
    expect(revived.mode).toBe('resumed')
    expect(revived.task.status).toBe('running')
    expect(revived.task.turnCount).toBe(2)
    expect(headlessWakes.at(-1)?.prompt).toContain('Resume with narrowed scope')
  })
})
