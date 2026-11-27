import { describe, expect, it, vi } from 'vitest'

import { createDispatchRoutes } from './dispatch.js'
import type { WorkspaceService } from '../../workspaces/service.js'

describe('GET /api/dispatch', () => {
  const BASE = 1_700_000_000_000
  const FROM = BASE - 3_600_000
  const TO = BASE

  function buildServiceFixture() {
    const activeChat = {
      id: 'ws-chat',
      tag: 'chat-main',
      dir: '',
      createdAt: '2026-10-01T00:00:00.000Z',
      template: 'chat',
    }
    const activeQuant = {
      id: 'ws-quant',
      tag: 'quant-desk',
      dir: '',
      createdAt: '2026-10-02T00:00:00.000Z',
      template: 'auto-quant-v2',
    }
    const standbyQuantId = 'ws-quant-standby'

    const headlessTasks = [
      // Scheduled issue run in active quant workspace
      {
        taskId: 'run-sched-1',
        resumeId: 'res-sched-1',
        wsId: 'ws-quant',
        agent: 'claude',
        model: 'claude-sonnet-4-6',
        prompt: 'Run morning scan',
        status: 'done',
        startedAt: BASE - 1_800_000,
        finishedAt: BASE - 1_700_000,
        durationMs: 100_000,
        agentSessionId: 'native-secret-session-1',
        trigger: {
          kind: 'issue',
          workspaceId: 'ws-quant',
          issueId: 'morning-scan',
        },
        output: {
          hasAssistantReply: true,
          assistantPreview: 'Morning scan finished',
          blockCount: 2,
          toolCalls: 4,
          toolFailures: 0,
        },
      },
      // Worker run launched via orchestration from active chat coordinator
      {
        taskId: 'run-worker-1',
        resumeId: 'res-worker-1',
        wsId: 'ws-quant',
        agent: 'codex',
        prompt: 'Backtest volatility surface',
        status: 'done',
        startedAt: BASE - 1_500_000,
        finishedAt: BASE - 1_200_000,
        durationMs: 300_000,
        agentSessionId: 'native-secret-session-2',
        output: {
          hasAssistantReply: true,
          assistantPreview: 'Delivered volatility report',
          blockCount: 3,
          toolCalls: 6,
          toolFailures: 1,
        },
      },
      // Cross-workspace conversation target in active chat
      {
        taskId: 'run-conv-1',
        resumeId: 'res-conv-target',
        wsId: 'ws-chat',
        agent: 'claude',
        prompt: '[Context injected] Summarize quant memo',
        status: 'done',
        startedAt: BASE - 900_000,
        finishedAt: BASE - 850_000,
        durationMs: 50_000,
        agentSessionId: 'native-secret-session-3',
      },
      // Standby workspace run — MUST be excluded
      {
        taskId: 'run-dead-1',
        resumeId: 'res-dead-1',
        wsId: standbyQuantId,
        agent: 'claude',
        prompt: 'Should never appear',
        status: 'done',
        startedAt: BASE - 1_000_000,
        finishedAt: BASE - 950_000,
        durationMs: 50_000,
        agentSessionId: 'native-secret-dead',
      },
    ]

    const orchestrationTasks = [
      {
        taskId: 'task-1',
        dispatchId: 'dsp-1',
        parentResumeId: 'res-chat-coord',
        parentWorkspaceId: 'ws-chat',
        workerResumeId: 'res-worker-1',
        workerWorkspaceId: 'ws-quant',
        workerAgent: 'codex',
        headlessTaskId: 'run-worker-1',
        spec: 'Backtest volatility surface and write report',
        status: 'done',
        createdAt: BASE - 1_510_000,
        updatedAt: BASE - 1_200_000,
        settledAt: BASE - 1_200_000,
        outcome: 'completed',
        summary: 'Report written',
        deliverables: [{ path: 'reports/vol-surface.md', summary: 'Vol surface memo' }],
        replyRoute: { workspaceId: 'ws-chat', resumeId: 'res-chat-coord' },
        turnCount: 2,
      },
      // Orchestration touching standby workspace — MUST be excluded
      {
        taskId: 'task-dead',
        dispatchId: 'dsp-dead',
        parentResumeId: 'res-chat-coord',
        parentWorkspaceId: 'ws-chat',
        workerResumeId: 'res-dead-1',
        workerWorkspaceId: standbyQuantId,
        workerAgent: 'claude',
        headlessTaskId: 'run-dead-1',
        spec: 'Dead task',
        status: 'done',
        createdAt: BASE - 1_000_000,
        updatedAt: BASE - 950_000,
        settledAt: BASE - 950_000,
        replyRoute: { workspaceId: 'ws-chat', resumeId: 'res-chat-coord' },
        turnCount: 1,
      },
    ]

    const orchestrationMessages = [
      {
        id: 'msg-q1',
        kind: 'question',
        taskId: 'task-1',
        dispatchId: 'dsp-1',
        fromResumeId: 'res-worker-1',
        toResumeId: 'res-chat-coord',
        subject: 'Need strike range',
        body: 'Should I include deep OTM strikes?',
        status: 'acked',
        createdAt: BASE - 1_400_000,
        ackedAt: BASE - 1_350_000,
      },
      {
        id: 'msg-r1',
        kind: 'reply',
        taskId: 'task-1',
        dispatchId: 'dsp-1',
        fromResumeId: 'res-chat-coord',
        toResumeId: 'res-worker-1',
        body: 'Yes, include 10-delta wings.',
        status: 'acked',
        createdAt: BASE - 1_340_000,
        ackedAt: BASE - 1_330_000,
      },
      {
        id: 'msg-dead',
        kind: 'worker_done',
        taskId: 'task-dead',
        dispatchId: 'dsp-dead',
        fromResumeId: 'res-dead-1',
        toResumeId: 'res-chat-coord',
        body: 'Dead message',
        status: 'unread',
        createdAt: BASE - 950_000,
      },
    ]

    const svc = {
      listActiveWorkspaces: vi.fn(async () => [activeQuant, activeChat]),
      issuesSnapshot: vi.fn(async () => ({
        workspaces: [
          {
            wsId: 'ws-quant',
            tag: 'quant-desk',
            status: 'ok',
            issues: [
              {
                id: 'morning-scan',
                title: 'Morning Market Scan',
                status: 'todo',
                priority: 'high',
                assignee: '@new-each-run',
              },
            ],
          },
          {
            wsId: standbyQuantId,
            tag: 'standby-desk',
            status: 'ok',
            issues: [{ id: 'dead-issue', title: 'Dead Issue', status: 'todo', priority: 'low', assignee: '@new-each-run' }],
          },
        ],
        duplicateNames: [],
      })),
      scheduleSnapshot: vi.fn(async () => ({
        workspaces: [
          {
            wsId: 'ws-quant',
            tag: 'quant-desk',
            status: 'ok',
            tasks: [
              {
                id: 'morning-scan',
                issue: 'Morning Market Scan',
                when: { kind: 'every', every: '30m' },
                what: 'Run morning scan',
                assignee: '@new-each-run',
                enabled: true,
                lastFiredAtMs: BASE - 1_800_000,
                nextDueAtMs: BASE + 300_000,
              },
            ],
          },
          {
            wsId: standbyQuantId,
            tag: 'standby-desk',
            status: 'ok',
            tasks: [
              {
                id: 'dead-issue',
                issue: 'Dead Issue',
                when: { kind: 'every', every: '15m' },
                what: 'Nope',
                assignee: '@new-each-run',
                enabled: true,
                lastFiredAtMs: BASE - 500_000,
                nextDueAtMs: BASE + 100_000,
              },
            ],
          },
        ],
      })),
      headlessTasks: {
        list: vi.fn(() => headlessTasks),
      },
      orchestration: {
        listTasks: vi.fn(() => orchestrationTasks),
        listMessages: vi.fn(() => orchestrationMessages),
      },
      agentConversationLog: {
        queryWindow: vi.fn(async () => [
          {
            taskId: 'run-conv-1',
            dispatchedAt: BASE - 900_000,
            completedAt: BASE - 850_000,
            status: 'done',
            source: {
              kind: 'session',
              workspaceId: 'ws-quant',
              resumeId: 'res-sched-1',
              agent: 'claude',
            },
            target: {
              workspaceId: 'ws-chat',
              resumeId: 'res-conv-target',
              agent: 'claude',
            },
            requestedTarget: { kind: 'workspace', workspaceId: 'ws-chat' },
            resolution: { mode: 'exact' },
            prompt: {
              original: 'Summarize quant memo',
              delivered: '[Context injected] Summarize quant memo',
              mode: 'plain',
            },
            assistantText: 'Summary ready',
            durationMs: 50_000,
          },
        ]),
      },
      activityJournal: {
        query: vi.fn(async () => ({
          entries: [
            {
              seq: 1,
              ts: BASE - 1_600_000,
              type: 'runtime.started',
              payload: {
                workspaceId: 'ws-chat',
                resumeId: 'res-chat-coord',
                agent: 'claude',
                sessionRecordId: 'sess-rec-1',
                surface: 'webpi',
              },
            },
            {
              seq: 2,
              ts: BASE - 1_100_000,
              type: 'runtime.stopped',
              payload: {
                workspaceId: 'ws-chat',
                resumeId: 'res-chat-coord',
                agent: 'claude',
                sessionRecordId: 'sess-rec-1',
                surface: 'webpi',
                status: 'done',
              },
            },
          ],
          total: 2,
          page: 1,
          pageSize: 500,
          totalPages: 1,
        })),
      },
      inboxStore: {
        read: vi.fn(async () => ({
          entries: [
            {
              id: 'inbox-1',
              ts: BASE - 1_710_000,
              workspaceId: 'ws-quant',
              body: '# Morning Scan Ready\nSee [[reports/morning.md]]',
              origin: {
                kind: 'headless',
                runId: 'run-sched-1',
                resumeId: 'res-sched-1',
                issueId: 'morning-scan',
                agent: 'claude',
              },
            },
            {
              id: 'inbox-dead',
              ts: BASE - 960_000,
              workspaceId: standbyQuantId,
              body: '# Should never appear',
            },
          ],
          hasMore: false,
          unreadCount: 1,
        })),
      },
      provenanceStore: {
        list: vi.fn(() => [
          {
            id: 'prov-1',
            artifact: { kind: 'report', workspaceId: 'ws-quant', path: 'reports/morning.md' },
            action: 'created',
            origin: {
              kind: 'session',
              workspaceId: 'ws-quant',
              resumeId: 'res-sched-1',
              agent: 'claude',
              execution: { kind: 'headless', taskId: 'run-sched-1' },
            },
            at: BASE - 1_720_000,
          },
          {
            id: 'prov-dead',
            artifact: { kind: 'report', workspaceId: standbyQuantId, path: 'reports/dead.md' },
            action: 'created',
            origin: { kind: 'human' },
            at: BASE - 960_000,
          },
        ]),
      },
      resumeRegistry: {
        get: vi.fn((resumeId: string) => {
          if (resumeId === 'res-chat-coord') return { wsId: 'ws-chat', displayName: 'Quant Coordinator' }
          if (resumeId === 'res-worker-1') return { wsId: 'ws-quant', displayName: 'Vol Worker' }
          return undefined
        }),
      },
    } as unknown as WorkspaceService

    return svc
  }

  it('projects active-only lanes, spans, causal edges, schedules, and artifacts without leaking native session ids', async () => {
    const svc = buildServiceFixture()
    const app = createDispatchRoutes(svc)

    const res = await app.request(`/?from=${FROM}&to=${TO}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const serialized = JSON.stringify(body)

    // Native session ids never cross the boundary.
    expect(serialized).not.toContain('agentSessionId')
    expect(serialized).not.toContain('native-secret')

    // Standby workspaces and their runs/edges/artifacts are completely excluded.
    expect(serialized).not.toContain('ws-quant-standby')
    expect(serialized).not.toContain('run-dead-1')
    expect(serialized).not.toContain('dsp-dead')
    expect(serialized).not.toContain('inbox-dead')
    expect(serialized).not.toContain('prov-dead')

    // Lanes sorted cleanly (chat before auto-quant).
    expect(body.lanes.map((lane: { workspaceId: string }) => lane.workspaceId)).toEqual([
      'ws-chat',
      'ws-quant',
    ])

    // Spans include scheduled run, orchestration worker, cross-ws conversation, and interactive session.
    const spanIds = body.spans.map((span: { id: string }) => span.id)
    expect(spanIds).toEqual(
      expect.arrayContaining(['run-sched-1', 'run-worker-1', 'run-conv-1', 'int-1']),
    )
    const schedSpan = body.spans.find((s: { id: string }) => s.id === 'run-sched-1')
    expect(schedSpan.trigger).toEqual({
      kind: 'scheduled-issue',
      workspaceId: 'ws-quant',
      issueId: 'morning-scan',
      issueTitle: 'Morning Market Scan',
    })
    const convSpan = body.spans.find((s: { id: string }) => s.id === 'run-conv-1')
    expect(convSpan.originalPrompt).toBe('Summarize quant memo')
    expect(convSpan.prompt).toBe('[Context injected] Summarize quant memo')

    // Edges include dispatch, question, reply, and cross-workspace conversation.
    expect(body.edges.map((e: { kind: string }) => e.kind)).toEqual([
      'dispatch',
      'question',
      'reply',
      'conversation',
    ])

    // Artifacts include inbox push, provenance report, and synthesized worker deliverable.
    expect(body.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'inbox',
          entryId: 'inbox-1',
          workspaceId: 'ws-quant',
          runId: 'run-sched-1',
        }),
        expect.objectContaining({
          kind: 'report',
          workspaceId: 'ws-quant',
          path: 'reports/morning.md',
          runId: 'run-sched-1',
        }),
        expect.objectContaining({
          kind: 'report',
          workspaceId: 'ws-quant',
          path: 'reports/vol-surface.md',
          action: 'delivered',
          runId: 'run-worker-1',
        }),
      ]),
    )

    // Schedule markers include only active workspace schedules.
    expect(body.scheduleMarkers).toHaveLength(1)
    expect(body.scheduleMarkers[0].issueId).toBe('morning-scan')
  })

  it('excludes stale unclosed conversations outside [from, to] when not running', async () => {
    const svc = buildServiceFixture()
    const origQueryWindow = svc.agentConversationLog.queryWindow as ReturnType<typeof vi.fn>
    const staleDispatchedAt = FROM - 86_400_000
    origQueryWindow.mockImplementationOnce(async () => [
      {
        taskId: 'run-stale-orphan',
        dispatchedAt: staleDispatchedAt,
        status: 'running',
        source: {
          kind: 'session',
          workspaceId: 'ws-chat',
          resumeId: 'res-chat-coord',
          agent: 'claude',
        },
        target: {
          workspaceId: 'ws-quant',
          resumeId: 'res-sched-1',
          agent: 'claude',
        },
        requestedTarget: { kind: 'workspace', workspaceId: 'ws-quant' },
        resolution: { mode: 'exact' },
        prompt: { original: 'Old crashed call', delivered: 'Old crashed call', mode: 'plain' },
        assistantText: null,
      },
    ])
    const app = createDispatchRoutes(svc)
    const res = await app.request(`/?from=${FROM}&to=${TO}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.edges.some((e: { id: string }) => e.id === 'conv-run-stale-orphan')).toBe(false)
  })

  it('pins Commander at lanes[0] with scheduled-report wakes, Commander->Worker dispatches, and Commander->Inbox pushes while excluding standby workspaces', async () => {
    const baseSvc = buildServiceFixture()
    const standbyQuantId = 'ws-quant-standby'

    const svcWithCommander = {
      ...baseSvc,
      commanderWorkspace: {
        id: 'commander',
        tag: 'Commander',
        dir: '',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      getCommanderPointer: vi.fn(async () => ({
        version: 1 as const,
        resumeId: 'res-commander',
        createdAt: BASE - 7_200_000,
        updatedAt: BASE - 1_200_000,
      })),
      sessionRegistry: {
        listFor: vi.fn((wsId: string) =>
          wsId === 'commander'
            ? [{ id: 'sess-cmd', resumeId: 'res-commander', label: 'Global Commander' }]
            : [],
        ),
        findByResumeId: vi.fn(() => undefined),
      },
      headlessTasks: {
        list: vi.fn(() => [
          ...baseSvc.headlessTasks.list(),
          {
            taskId: 'run-cmd-wake-1',
            resumeId: 'res-commander',
            wsId: 'commander',
            agent: 'claude',
            model: 'claude-sonnet-4-6',
            prompt: 'You have 1 pending schedule report. Run alice conversation check.',
            status: 'done',
            startedAt: BASE - 1_690_000,
            finishedAt: BASE - 1_640_000,
            durationMs: 50_000,
            agentSessionId: 'native-secret-cmd-1',
            output: {
              hasAssistantReply: true,
              assistantPreview: 'Dispatched follow-up worker and notified Inbox.',
              blockCount: 2,
              toolCalls: 3,
              toolFailures: 0,
            },
          },
          {
            taskId: 'run-cmd-worker-1',
            resumeId: 'res-cmd-worker-1',
            wsId: 'ws-quant',
            agent: 'codex',
            prompt: 'Investigate morning scan spread widening',
            status: 'done',
            startedAt: BASE - 1_630_000,
            finishedAt: BASE - 1_550_000,
            durationMs: 80_000,
            agentSessionId: 'native-secret-cmd-worker',
            output: {
              hasAssistantReply: true,
              assistantPreview: 'Spread widening traced to ETF rebalance.',
              blockCount: 2,
              toolCalls: 4,
              toolFailures: 0,
            },
          },
        ]),
      },
      orchestration: {
        listTasks: vi.fn(() => [
          ...baseSvc.orchestration.listTasks(),
          {
            taskId: 'task-cmd-1',
            dispatchId: 'dsp-cmd-1',
            parentResumeId: 'res-commander',
            parentWorkspaceId: 'commander',
            workerResumeId: 'res-cmd-worker-1',
            workerWorkspaceId: 'ws-quant',
            workerAgent: 'codex',
            headlessTaskId: 'run-cmd-worker-1',
            spec: 'Investigate spread widening from Morning Market Scan',
            status: 'done',
            createdAt: BASE - 1_635_000,
            updatedAt: BASE - 1_550_000,
            settledAt: BASE - 1_550_000,
            outcome: 'completed',
            summary: 'ETF rebalance explained spread move',
            replyRoute: { workspaceId: 'commander', resumeId: 'res-commander' },
            turnCount: 1,
          },
          // Commander -> standby workspace MUST be excluded
          {
            taskId: 'task-cmd-standby',
            dispatchId: 'dsp-cmd-standby',
            parentResumeId: 'res-commander',
            parentWorkspaceId: 'commander',
            workerResumeId: 'res-dead-1',
            workerWorkspaceId: standbyQuantId,
            workerAgent: 'claude',
            spec: 'Should be excluded',
            status: 'done',
            createdAt: BASE - 1_620_000,
            updatedAt: BASE - 1_600_000,
            settledAt: BASE - 1_600_000,
            replyRoute: { workspaceId: 'commander', resumeId: 'res-commander' },
            turnCount: 1,
          },
        ]),
        listMessages: vi.fn(() => [
          ...baseSvc.orchestration.listMessages({}),
          {
            id: 'msg-cmd-done-1',
            kind: 'worker_done',
            taskId: 'task-cmd-1',
            dispatchId: 'dsp-cmd-1',
            fromResumeId: 'res-cmd-worker-1',
            toResumeId: 'res-commander',
            body: 'Investigation complete.',
            status: 'acked',
            createdAt: BASE - 1_550_000,
            ackedAt: BASE - 1_540_000,
          },
        ]),
      },
      commanderMailbox: {
        listRecent: vi.fn(() => [
          {
            id: 'mail-run-sched-1',
            recipientResumeId: 'res-commander',
            recipientWorkspaceId: 'commander',
            taskId: 'run-sched-1',
            childResumeId: 'res-sched-1',
            childWorkspaceId: 'ws-quant',
            childAgent: 'claude',
            taskStatus: 'done',
            assistantPreview: 'Morning scan detected 2.1 sigma spread widening.',
            durationMs: 100_000,
            createdAt: BASE - 1_695_000,
            status: 'acked',
            notifiedAt: BASE - 1_694_000,
            ackedAt: BASE - 1_685_000,
            reportSource: {
              kind: 'scheduled-issue',
              workspaceId: 'ws-quant',
              workspaceTag: 'quant-desk',
              issueId: 'morning-scan',
              issueTitle: 'Morning Market Scan',
              fire: 'schedule',
            },
          },
          // Standby workspace report MUST be excluded
          {
            id: 'mail-run-dead-1',
            recipientResumeId: 'res-commander',
            recipientWorkspaceId: 'commander',
            taskId: 'run-dead-1',
            childResumeId: 'res-dead-1',
            childWorkspaceId: standbyQuantId,
            childAgent: 'claude',
            taskStatus: 'done',
            assistantPreview: 'Standby noise',
            createdAt: BASE - 950_000,
            status: 'unread',
            reportSource: {
              kind: 'scheduled-issue',
              workspaceId: standbyQuantId,
              issueId: 'dead-issue',
              issueTitle: 'Dead Issue',
            },
          },
        ]),
      },
      inboxStore: {
        read: vi.fn(async () => ({
          entries: [
            {
              id: 'inbox-cmd-1',
              ts: BASE - 1_530_000,
              workspaceId: 'commander',
              body: '# Spread Alert Escalation\nMorning scan & quant worker confirmed ETF rebalance.',
              origin: {
                kind: 'headless',
                runId: 'run-cmd-wake-1',
                resumeId: 'res-commander',
                agent: 'claude',
              },
            },
          ],
          hasMore: false,
          unreadCount: 1,
        })),
      },
      resumeRegistry: {
        get: vi.fn((resumeId: string) => {
          if (resumeId === 'res-commander') return { wsId: 'commander', displayName: 'Commander' }
          return baseSvc.resumeRegistry.get(resumeId)
        }),
      },
    } as unknown as WorkspaceService

    const app = createDispatchRoutes(svcWithCommander)
    const res = await app.request(`/?from=${FROM}&to=${TO}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const serialized = JSON.stringify(body)

    expect(serialized).not.toContain('native-secret')
    expect(serialized).not.toContain(standbyQuantId)
    expect(serialized).not.toContain('dsp-cmd-standby')
    expect(serialized).not.toContain('mail-run-dead-1')

    // Commander control-plane lane pinned at index 0
    expect(body.lanes[0]).toEqual({
      workspaceId: 'commander',
      tag: 'Commander',
      label: 'Commander',
      template: 'commander',
      templateKind: 'commander',
    })
    expect(body.lanes.map((lane: { workspaceId: string }) => lane.workspaceId)).toEqual([
      'commander',
      'ws-chat',
      'ws-quant',
    ])

    // Commander headless wake span + worker span triggered by Commander orchestration
    expect(body.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'run-cmd-wake-1',
          workspaceId: 'commander',
          resumeId: 'res-commander',
        }),
        expect.objectContaining({
          id: 'run-cmd-worker-1',
          workspaceId: 'ws-quant',
          trigger: expect.objectContaining({
            kind: 'orchestration',
            dispatchId: 'dsp-cmd-1',
            parentWorkspaceId: 'commander',
            parentResumeId: 'res-commander',
          }),
        }),
      ]),
    )

    // Scheduled Thread -> Commander report edge + Commander -> Worker dispatch + Worker -> Commander done
    expect(body.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'report-mail-run-sched-1',
          kind: 'conversation',
          messageKind: 'scheduled_report',
          fromWorkspaceId: 'ws-quant',
          toWorkspaceId: 'commander',
          toResumeId: 'res-commander',
          taskId: 'run-sched-1',
          summary: 'Morning Market Scan (done)',
          deliveryStatus: 'acked',
        }),
        expect.objectContaining({
          id: 'dsp-dsp-cmd-1',
          kind: 'dispatch',
          fromWorkspaceId: 'commander',
          toWorkspaceId: 'ws-quant',
        }),
        expect.objectContaining({
          id: 'msg-cmd-done-1',
          kind: 'worker_done',
          fromWorkspaceId: 'ws-quant',
          toWorkspaceId: 'commander',
        }),
      ]),
    )

    // Commander -> Inbox artifact included
    expect(body.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'inbox-inbox-cmd-1',
          kind: 'inbox',
          workspaceId: 'commander',
          title: 'Spread Alert Escalation',
          runId: 'run-cmd-wake-1',
        }),
      ]),
    )
  })

  it('pins initialized Commander at lanes[0] even during a quiet window and supports pendingFor fallback', async () => {
    const baseSvc = buildServiceFixture()
    const quietSvc = {
      ...baseSvc,
      getCommanderPointer: vi.fn(async () => ({
        version: 1 as const,
        resumeId: 'res-commander-quiet',
        createdAt: BASE - 86_400_000,
        updatedAt: BASE - 86_400_000,
      })),
      headlessTasks: { list: vi.fn(() => []) },
      orchestration: { listTasks: vi.fn(() => []), listMessages: vi.fn(() => []) },
      agentConversationLog: { queryWindow: vi.fn(async () => []) },
      activityJournal: {
        query: vi.fn(async () => ({ entries: [], total: 0, page: 1, pageSize: 500, totalPages: 1 })),
      },
      inboxStore: { read: vi.fn(async () => ({ entries: [], hasMore: false, unreadCount: 0 })) },
      provenanceStore: { list: vi.fn(() => []) },
      commanderMailbox: {
        pendingFor: vi.fn((resumeId: string) =>
          resumeId === 'res-commander-quiet'
            ? [
                {
                  id: 'mail-pending-1',
                  recipientResumeId: 'res-commander-quiet',
                  recipientWorkspaceId: 'commander',
                  taskId: 'run-pending-1',
                  childResumeId: 'res-sched-pending',
                  childWorkspaceId: 'ws-quant',
                  childAgent: 'claude',
                  taskStatus: 'failed',
                  assistantPreview: null,
                  error: 'Data feed timeout',
                  createdAt: BASE - 120_000,
                  status: 'unread',
                  reportSource: {
                    kind: 'scheduled-issue',
                    workspaceId: 'ws-quant',
                    issueId: 'morning-scan',
                    issueTitle: 'Morning Market Scan',
                  },
                },
              ]
            : [],
        ),
      },
    } as unknown as WorkspaceService

    const app = createDispatchRoutes(quietSvc)
    const res = await app.request(`/?from=${FROM}&to=${TO}`)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.lanes[0]).toEqual(
      expect.objectContaining({
        workspaceId: 'commander',
        templateKind: 'commander',
      }),
    )
    expect(body.edges).toEqual([
      expect.objectContaining({
        id: 'report-mail-pending-1',
        kind: 'conversation',
        messageKind: 'scheduled_report',
        fromWorkspaceId: 'ws-quant',
        toWorkspaceId: 'commander',
        outcome: 'failed',
        deliveryStatus: 'unread',
        summary: 'Morning Market Scan (failed)',
      }),
    ])
  })

  it('rejects invalid from/to query timestamps with 400', async () => {
    const app = createDispatchRoutes(buildServiceFixture())
    const res = await app.request('/?from=abc')
    expect(res.status).toBe(400)
  })
})
