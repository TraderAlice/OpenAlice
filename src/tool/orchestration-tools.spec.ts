import type { Tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import {
  OrchestrationError,
  type OrchestrationManager,
  type OrchestrationMessage,
  type OrchestrationTask,
  type WorkerListItem,
} from '../workspaces/orchestration/index.js'
import {
  orchestrationAskFactory,
  orchestrationCheckFactory,
  orchestrationInboxFactory,
  orchestrationReplyFactory,
  orchestrationSendFactory,
  orchestrationToolFactories,
  orchestrationWorkerDoneFactory,
  orchestrationWorkerListFactory,
  orchestrationWorkerStartFactory,
  orchestrationWorkerStopFactory,
  stripDispatchPrefix,
} from './orchestration-tools.js'

async function run(t: Tool, args: Record<string, unknown> = {}) {
  return t.execute!(args, { toolCallId: 'test-call', messages: [] })
}

function makeTask(over: Partial<OrchestrationTask> = {}): OrchestrationTask {
  return {
    taskId: 'task-1',
    dispatchId: 'disp-1',
    parentResumeId: 'parent-resume',
    parentWorkspaceId: 'ws-parent',
    workerResumeId: 'worker-resume',
    workerWorkspaceId: 'ws-worker',
    workerAgent: 'codex',
    headlessTaskId: 'run-1',
    spec: 'Do the research',
    status: 'running',
    createdAt: 1000,
    updatedAt: 1000,
    replyRoute: {
      workspaceId: 'ws-parent',
      resumeId: 'parent-resume',
      surface: 'headless',
    },
    turnCount: 1,
    ...over,
  }
}

function makeMessage(over: Partial<OrchestrationMessage> = {}): OrchestrationMessage {
  return {
    id: 'msg-1',
    kind: 'question',
    taskId: 'task-1',
    dispatchId: 'disp-1',
    fromResumeId: 'worker-resume',
    toResumeId: 'parent-resume',
    body: 'Should I use daily or hourly bars?',
    status: 'unread',
    createdAt: 1100,
    ...over,
  }
}

function makeMockOrchestration() {
  return {
    getTask: vi.fn<(dispatchId: string) => OrchestrationTask | undefined>(),
    workerStart: vi.fn(),
    workerList: vi.fn(),
    workerStop: vi.fn(),
    send: vi.fn(),
    ask: vi.fn(),
    reply: vi.fn(),
    workerDone: vi.fn(),
    check: vi.fn(),
    inbox: vi.fn(),
  }
}

function makeCtx(over: Partial<WorkspaceToolContext> = {}): WorkspaceToolContext {
  return {
    workspaceId: 'ws-parent',
    workspaceLabel: 'parent',
    inboxStore: {} as never,
    entityStore: {} as never,
    origin: {
      kind: 'headless',
      runId: 'run-parent',
      resumeId: 'parent-resume',
      agent: 'codex',
    },
    ...over,
  }
}

describe('orchestration-tools', () => {
  it('exports all 9 tool factories', () => {
    expect(orchestrationToolFactories.map((f) => f.name)).toEqual([
      'orchestration_worker_start',
      'orchestration_worker_list',
      'orchestration_worker_stop',
      'orchestration_send',
      'orchestration_ask',
      'orchestration_reply',
      'orchestration_worker_done',
      'orchestration_check',
      'orchestration_inbox',
    ])
  })

  it('strips dispatch: prefix case-insensitively', () => {
    expect(stripDispatchPrefix('dispatch:disp-1')).toBe('disp-1')
    expect(stripDispatchPrefix('  DISPATCH:disp-2  ')).toBe('disp-2')
    expect(stripDispatchPrefix('disp-3')).toBe('disp-3')
    expect(stripDispatchPrefix('dispatch:   ')).toBe('')
  })

  describe('orchestration_worker_start', () => {
    it('dispatches a worker with caller attribution and optional overrides', async () => {
      const orch = makeMockOrchestration()
      const task = makeTask()
      orch.workerStart.mockResolvedValue({
        task,
        headlessTaskId: 'run-1',
        workerResumeId: 'worker-resume',
        workerWorkspaceId: 'ws-worker',
        workerWorkspaceTag: 'AutoQuant',
        workerAgent: 'codex',
      })

      const t = orchestrationWorkerStartFactory.build(
        makeCtx({ orchestration: orch as unknown as OrchestrationManager }),
      )
      const res = await run(t, {
        spec: 'Backtest momentum',
        harness: 'autoquant',
        agent: 'codex',
        model: 'gpt-5',
        effort: 'high',
        credential: 'openai-main',
        maxIdleMs: 120_000,
      })

      expect(orch.workerStart).toHaveBeenCalledWith({
        parentResumeId: 'parent-resume',
        parentWorkspaceId: 'ws-parent',
        spec: 'Backtest momentum',
        harness: 'autoquant',
        agent: 'codex',
        model: 'gpt-5',
        effort: 'high',
        credential: 'openai-main',
        maxIdleMs: 120_000,
      })
      expect(res).toMatchObject({
        ok: true,
        taskId: 'task-1',
        dispatchId: 'disp-1',
        status: 'running',
        headlessTaskId: 'run-1',
        workerResumeId: 'worker-resume',
        workerWorkspaceId: 'ws-worker',
        workerWorkspaceTag: 'AutoQuant',
        workerAgent: 'codex',
        next: expect.stringContaining('End your current turn'),
      })
    })

    it('rejects mutually exclusive wsId + harness and credential + credentialSource', async () => {
      const orch = makeMockOrchestration()
      const t = orchestrationWorkerStartFactory.build(
        makeCtx({ orchestration: orch as unknown as OrchestrationManager }),
      )

      await expect(
        run(t, { spec: 'test', wsId: 'ws-1', harness: 'autoquant' }),
      ).resolves.toMatchObject({
        ok: false,
        code: 'invalid_input',
        error: expect.stringContaining('--ws-id or --harness'),
      })

      await expect(
        run(t, { spec: 'test', credential: 'vault-1', credentialSource: 'native' }),
      ).resolves.toMatchObject({
        ok: false,
        code: 'invalid_input',
        error: expect.stringContaining('mutually exclusive'),
      })
      expect(orch.workerStart).not.toHaveBeenCalled()
    })

    it('fails cleanly when orchestration or session identity is unavailable', async () => {
      const noOrch = orchestrationWorkerStartFactory.build(makeCtx())
      await expect(run(noOrch, { spec: 'x' })).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('unavailable'),
      })

      const orch = makeMockOrchestration()
      const noSession = orchestrationWorkerStartFactory.build(
        makeCtx({
          origin: undefined,
          orchestration: orch as unknown as OrchestrationManager,
        }),
      )
      await expect(run(noSession, { spec: 'x' })).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('Session identity'),
      })
    })

    it('propagates OrchestrationError code and message', async () => {
      const orch = makeMockOrchestration()
      orch.workerStart.mockRejectedValue(
        new OrchestrationError('workspace_unavailable', 'AutoQuant not initialized'),
      )
      const t = orchestrationWorkerStartFactory.build(
        makeCtx({ orchestration: orch as unknown as OrchestrationManager }),
      )
      await expect(run(t, { spec: 'x', harness: 'autoquant' })).resolves.toEqual({
        ok: false,
        code: 'workspace_unavailable',
        error: 'AutoQuant not initialized',
      })
    })
  })

  describe('orchestration_worker_list', () => {
    it('scopes to caller parentResumeId by default and strips dispatch: when filtering', async () => {
      const orch = makeMockOrchestration()
      const item: WorkerListItem = {
        task: makeTask({ status: 'waiting_parent' }),
        live: false,
        pendingQuestions: [makeMessage()],
        unreadMessagesForParent: 1,
        queuedMessagesForWorker: 0,
        nextAction: 'Reply to worker question',
      }
      orch.workerList.mockReturnValue([item])

      const t = orchestrationWorkerListFactory.build(
        makeCtx({ orchestration: orch as unknown as OrchestrationManager }),
      )
      const res = await run(t, { status: 'waiting_parent', limit: 10 })

      expect(orch.workerList).toHaveBeenCalledWith({
        parentResumeId: 'parent-resume',
        status: 'waiting_parent',
        limit: 10,
      })
      expect(res).toMatchObject({
        ok: true,
        count: 1,
        workers: [
          expect.objectContaining({
            dispatchId: 'disp-1',
            status: 'waiting_parent',
            unreadMessagesForParent: 1,
            nextAction: 'Reply to worker question',
          }),
        ],
      })

      await run(t, { dispatch: 'dispatch:disp-1' })
      expect(orch.workerList).toHaveBeenLastCalledWith({
        dispatchId: 'disp-1',
        limit: 50,
      })
    })
  })

  describe('orchestration_worker_stop', () => {
    it('stops a dispatch after stripping dispatch: prefix and verifies coordinator ownership', async () => {
      const orch = makeMockOrchestration()
      const task = makeTask()
      orch.getTask.mockReturnValue(task)
      orch.workerStop.mockResolvedValue({
        task: makeTask({ status: 'stopped', stopReason: 'no longer needed' }),
        stoppedExecution: true,
      })

      const t = orchestrationWorkerStopFactory.build(
        makeCtx({ orchestration: orch as unknown as OrchestrationManager }),
      )
      const res = await run(t, { dispatch: 'dispatch:disp-1', reason: 'no longer needed' })

      expect(orch.workerStop).toHaveBeenCalledWith('disp-1', 'no longer needed')
      expect(res).toMatchObject({
        ok: true,
        dispatchId: 'disp-1',
        status: 'stopped',
        stopReason: 'no longer needed',
        stoppedExecution: true,
      })
    })

    it('rejects worker-stop when a different Session tries to stop another coordinator dispatch', async () => {
      const orch = makeMockOrchestration()
      orch.getTask.mockReturnValue(makeTask({ parentResumeId: 'other-parent' }))

      const t = orchestrationWorkerStopFactory.build(
        makeCtx({ orchestration: orch as unknown as OrchestrationManager }),
      )
      await expect(run(t, { dispatch: 'disp-1' })).resolves.toMatchObject({
        ok: false,
        code: 'unauthorized',
      })
      expect(orch.workerStop).not.toHaveBeenCalled()
    })
  })

  describe('orchestration_send', () => {
    it('accepts dispatch:<id> and raw <id>, returning resumed/queued receipts', async () => {
      const orch = makeMockOrchestration()
      orch.send
        .mockResolvedValueOnce({
          task: makeTask({ turnCount: 2 }),
          message: makeMessage({ id: 'msg-send-1', kind: 'send', body: 'Use hourly bars' }),
          mode: 'resumed',
          headlessTaskId: 'run-2',
        })
        .mockResolvedValueOnce({
          task: makeTask({ turnCount: 2 }),
          message: makeMessage({ id: 'msg-send-2', kind: 'send', body: 'Add Sharpe' }),
          mode: 'queued',
        })

      const t = orchestrationSendFactory.build(
        makeCtx({ orchestration: orch as unknown as OrchestrationManager }),
      )

      const resumed = await run(t, {
        to: 'dispatch:disp-1',
        subject: 'Follow-up',
        body: 'Use hourly bars',
      })
      expect(orch.send).toHaveBeenNthCalledWith(1, {
        toDispatchId: 'disp-1',
        fromResumeId: 'parent-resume',
        subject: 'Follow-up',
        body: 'Use hourly bars',
      })
      expect(resumed).toMatchObject({
        ok: true,
        dispatchId: 'disp-1',
        messageId: 'msg-send-1',
        mode: 'resumed',
        headlessTaskId: 'run-2',
      })

      const queued = await run(t, { to: 'disp-1', body: 'Add Sharpe' })
      expect(orch.send).toHaveBeenNthCalledWith(2, {
        toDispatchId: 'disp-1',
        fromResumeId: 'parent-resume',
        body: 'Add Sharpe',
      })
      expect(queued).toMatchObject({
        ok: true,
        mode: 'queued',
        next: expect.stringContaining('queued'),
      })
    })

    it('rejects bare dispatch: target', async () => {
      const orch = makeMockOrchestration()
      const t = orchestrationSendFactory.build(
        makeCtx({ orchestration: orch as unknown as OrchestrationManager }),
      )
      await expect(run(t, { to: 'dispatch:', body: 'hello' })).resolves.toMatchObject({
        ok: false,
        code: 'invalid_input',
      })
      expect(orch.send).not.toHaveBeenCalled()
    })
  })

  describe('orchestration_ask', () => {
    it('attributes the worker caller and forwards dispatch, subject, body', async () => {
      const orch = makeMockOrchestration()
      orch.ask.mockResolvedValue({
        task: makeTask({ status: 'waiting_parent' }),
        message: makeMessage({ id: 'msg-q-1' }),
        wakeResult: 'delivered',
      })

      const t = orchestrationAskFactory.build(
        makeCtx({
          workspaceId: 'ws-worker',
          origin: { kind: 'headless', runId: 'run-1', resumeId: 'worker-resume', agent: 'codex' },
          orchestration: orch as unknown as OrchestrationManager,
        }),
      )
      const res = await run(t, {
        dispatch: 'disp-1',
        subject: 'Bar frequency',
        body: 'Daily or hourly?',
      })

      expect(orch.ask).toHaveBeenCalledWith({
        dispatchId: 'disp-1',
        fromResumeId: 'worker-resume',
        subject: 'Bar frequency',
        body: 'Daily or hourly?',
      })
      expect(res).toMatchObject({
        ok: true,
        dispatchId: 'disp-1',
        messageId: 'msg-q-1',
        status: 'waiting_parent',
        wakeResult: 'delivered',
        next: expect.stringContaining('End your turn immediately'),
      })
    })
  })

  describe('orchestration_reply', () => {
    it('answers a question by message id with coordinator attribution', async () => {
      const orch = makeMockOrchestration()
      orch.reply.mockResolvedValue({
        task: makeTask({ status: 'running', turnCount: 2 }),
        question: makeMessage({ id: 'msg-q-1', status: 'acked' }),
        reply: makeMessage({ id: 'msg-r-1', kind: 'reply', body: 'Use daily' }),
        wakeResult: 'delivered',
      })

      const t = orchestrationReplyFactory.build(
        makeCtx({ orchestration: orch as unknown as OrchestrationManager }),
      )
      const res = await run(t, { id: 'msg-q-1', body: 'Use daily' })

      expect(orch.reply).toHaveBeenCalledWith({
        messageId: 'msg-q-1',
        fromResumeId: 'parent-resume',
        body: 'Use daily',
      })
      expect(res).toMatchObject({
        ok: true,
        questionId: 'msg-q-1',
        replyId: 'msg-r-1',
        status: 'running',
        wakeResult: 'delivered',
      })
    })
  })

  describe('orchestration_worker_done', () => {
    it('normalizes JSON-string --deliverables and repeatable --deliverable entries', async () => {
      const orch = makeMockOrchestration()
      orch.workerDone.mockResolvedValue({
        task: makeTask({
          status: 'done',
          outcome: 'completed',
          summary: 'Backtest complete',
          evidence: 'Sharpe 1.4',
          deliverables: [
            { path: 'projects/p1/research.md', summary: 'Report' },
            { path: 'projects/p1/runs/r1/run.json' },
            { path: 'projects/p1/chart.png', workspaceId: 'ws-worker' },
          ],
        }),
        message: makeMessage({ id: 'msg-done-1', kind: 'worker_done', body: 'Backtest complete' }),
        wakeResult: 'delivered',
      })

      const t = orchestrationWorkerDoneFactory.build(
        makeCtx({
          workspaceId: 'ws-worker',
          origin: { kind: 'headless', runId: 'run-1', resumeId: 'worker-resume', agent: 'codex' },
          orchestration: orch as unknown as OrchestrationManager,
        }),
      )

      const res = await run(t, {
        dispatch: 'dispatch:disp-1',
        outcome: 'completed',
        summary: 'Backtest complete',
        evidence: 'Sharpe 1.4',
        deliverables: JSON.stringify([{ path: 'projects/p1/research.md', summary: 'Report' }]),
        deliverable: [
          'projects/p1/runs/r1/run.json',
          JSON.stringify({ path: 'projects/p1/chart.png', workspaceId: 'ws-worker' }),
        ],
      })

      expect(orch.workerDone).toHaveBeenCalledWith({
        dispatchId: 'disp-1',
        fromResumeId: 'worker-resume',
        outcome: 'completed',
        summary: 'Backtest complete',
        evidence: 'Sharpe 1.4',
        deliverables: [
          { path: 'projects/p1/research.md', summary: 'Report' },
          { path: 'projects/p1/runs/r1/run.json' },
          { path: 'projects/p1/chart.png', workspaceId: 'ws-worker' },
        ],
      })
      expect(res).toMatchObject({
        ok: true,
        dispatchId: 'disp-1',
        messageId: 'msg-done-1',
        status: 'done',
        outcome: 'completed',
        wakeResult: 'delivered',
      })
    })

    it('rejects malformed deliverables JSON without calling manager', async () => {
      const orch = makeMockOrchestration()
      const t = orchestrationWorkerDoneFactory.build(
        makeCtx({
          origin: { kind: 'headless', runId: 'run-1', resumeId: 'worker-resume', agent: 'codex' },
          orchestration: orch as unknown as OrchestrationManager,
        }),
      )

      await expect(
        run(t, {
          dispatch: 'disp-1',
          outcome: 'completed',
          summary: 'Done',
          deliverables: '[{bad json',
        }),
      ).resolves.toMatchObject({
        ok: false,
        code: 'invalid_input',
        error: expect.stringContaining('malformed JSON'),
      })
      expect(orch.workerDone).not.toHaveBeenCalled()
    })
  })

  describe('orchestration_check', () => {
    it('acks pending messages for the calling Session and provides contextual next guidance', async () => {
      const orch = makeMockOrchestration()
      orch.check
        .mockResolvedValueOnce([makeMessage({ id: 'msg-q-9', kind: 'question' })])
        .mockResolvedValueOnce([
          makeMessage({ id: 'msg-esc-1', kind: 'escalation', dispatchId: 'disp-9' }),
        ])
        .mockResolvedValueOnce([])

      const t = orchestrationCheckFactory.build(
        makeCtx({ orchestration: orch as unknown as OrchestrationManager }),
      )

      await expect(run(t)).resolves.toMatchObject({
        ok: true,
        count: 1,
        next: expect.stringContaining('alice orchestration reply --id msg-q-9'),
      })
      await expect(run(t)).resolves.toMatchObject({
        ok: true,
        count: 1,
        next: expect.stringContaining('alice orchestration send --to dispatch:disp-9'),
      })
      await expect(run(t)).resolves.toMatchObject({
        ok: true,
        count: 0,
        next: expect.stringContaining('alice orchestration inbox'),
      })
      expect(orch.check).toHaveBeenCalledWith({ recipientResumeId: 'parent-resume' })
    })
  })

  describe('orchestration_inbox', () => {
    it('filters by dispatch before applying limit and returns read-only history', async () => {
      const orch = makeMockOrchestration()
      const history = [
        makeMessage({ id: 'm3', dispatchId: 'disp-other', status: 'acked', createdAt: 300 }),
        makeMessage({ id: 'm2', dispatchId: 'disp-target', status: 'acked', createdAt: 200 }),
        makeMessage({ id: 'm1', dispatchId: 'disp-target', status: 'acked', createdAt: 100 }),
      ]
      orch.inbox.mockReturnValue(history)

      const t = orchestrationInboxFactory.build(
        makeCtx({ orchestration: orch as unknown as OrchestrationManager }),
      )

      const filtered = await run(t, { dispatch: 'dispatch:disp-target', limit: 1 })
      // Must query unfiltered inbox so limit=1 applies AFTER dispatch filter.
      expect(orch.inbox).toHaveBeenCalledWith({ recipientResumeId: 'parent-resume' })
      expect(filtered).toEqual({
        ok: true,
        count: 1,
        messages: [history[1]],
      })

      orch.inbox.mockClear()
      await run(t, { limit: 15 })
      expect(orch.inbox).toHaveBeenCalledWith({ recipientResumeId: 'parent-resume', limit: 15 })
    })
  })
})
