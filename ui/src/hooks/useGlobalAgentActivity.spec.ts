// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'
import type { InboxEntry } from '../api/inbox'
import {
  conversationActivityFilter,
  inboxActivityFilter,
  projectGlobalActivity,
  sonnerTestActivityFilter,
  summarizeAgentActivity,
  useGlobalAgentActivity,
  type GlobalActivityFilter,
} from './useGlobalAgentActivity'

const queryRuntime = vi.fn()
const queryInbox = vi.fn()

vi.mock('../api', () => ({
  api: {
    agentRuntime: { query: (...args: unknown[]) => queryRuntime(...args) },
    inbox: { history: (...args: unknown[]) => queryInbox(...args) },
  },
}))

function event(
  seq: number,
  type: AgentRuntimeEvent['type'],
  payload: Partial<AgentRuntimeEvent['payload']> = {},
  ts = seq * 1_000,
): AgentRuntimeEvent {
  return {
    seq,
    ts,
    type,
    payload: {
      workspaceId: 'chat-1',
      resumeId: 'resume-1',
      agent: 'pi',
      taskId: 'task-1',
      ...payload,
    },
  }
}

function conversationCause() {
  return {
    kind: 'conversation' as const,
    from: {
      kind: 'session' as const,
      workspaceId: 'chat-parent',
      resumeId: 'resume-parent',
      agent: 'codex',
    },
    resolution: 'exact' as const,
  }
}

function inboxEntry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: 'inbox-1',
    ts: 10_000,
    workspaceId: 'chat-1',
    comments: 'Done',
    origin: {
      kind: 'headless',
      agent: 'pi',
      runId: 'task-1',
      resumeId: 'resume-1',
    },
    ...overrides,
  }
}

beforeEach(() => {
  queryRuntime.mockReset()
  queryInbox.mockReset()
})

describe('global activity filters', () => {
  it('surfaces Agent-to-Agent scheduling without exposing ordinary UI, Issue, or tool work', () => {
    const sources = {
      runtimeEvents: [
        event(1, 'runtime.started', { taskId: 'ui', cause: { kind: 'ui' } }),
        event(2, 'runtime.started', {
          taskId: 'issue',
          cause: { kind: 'issue', workspaceId: 'chat-1', issueId: 'daily-close' },
        }),
        event(3, 'runtime.turn.tool', { taskId: 'tool', toolName: 'bash', toolStatus: 'running' }),
        event(6, 'runtime.started', {
          taskId: 'human-follow-up',
          cause: { kind: 'conversation', from: { kind: 'human' } },
        }),
        event(4, 'runtime.started', { taskId: 'conversation', cause: conversationCause() }),
        event(5, 'runtime.turn.tool', {
          taskId: 'conversation',
          toolName: 'bash',
          toolStatus: 'running',
        }),
      ],
      inboxEntries: [],
    }

    expect(conversationActivityFilter.project(sources, 5_000)).toEqual([
      expect.objectContaining({
        id: 'conversation:task:conversation',
        kind: 'conversation',
        taskId: 'conversation',
        revision: 4,
      }),
    ])
  })

  it('removes completed or paused scheduling and retains recent failures as the same signal family', () => {
    const started = event(1, 'runtime.started', { cause: conversationCause() })
    expect(conversationActivityFilter.project({
      runtimeEvents: [started, event(2, 'runtime.stopped', { status: 'paused' })],
      inboxEntries: [],
    }, 2_000)).toEqual([])

    expect(conversationActivityFilter.project({
      runtimeEvents: [started, event(2, 'runtime.stopped', { status: 'failed', error: 'no auth' })],
      inboxEntries: [],
    }, 2_000)).toEqual([
      expect.objectContaining({
        id: 'conversation-failed:task:task-1',
        kind: 'conversation-failed',
        detail: 'no auth',
      }),
    ])
  })

  it('surfaces only recent Agent-originated Inbox deliveries', () => {
    expect(inboxActivityFilter.project({
      runtimeEvents: [],
      inboxEntries: [
        inboxEntry(),
        inboxEntry({ id: 'manual', origin: { kind: 'manual', agent: 'human' } }),
        inboxEntry({ id: 'old', ts: 1_000 }),
        inboxEntry({ id: 'anonymous', origin: undefined }),
      ],
    }, 15_000)).toEqual([
      expect.objectContaining({
        id: 'inbox:inbox-1',
        kind: 'inbox',
        inboxEntryId: 'inbox-1',
      }),
    ])
  })

  it('supports new signal families through filter registration without changing the activity bridge', () => {
    const customFilter: GlobalActivityFilter = {
      id: 'custom',
      project: () => [{
        id: 'custom:1',
        kind: 'inbox',
        workspaceId: 'chat-custom',
        occurredAt: 9_000,
        revision: 1,
      }],
    }
    const signals = projectGlobalActivity(
      { runtimeEvents: [], inboxEntries: [] },
      10_000,
      [customFilter],
    )

    expect(signals.map((signal) => signal.id)).toEqual(['custom:1'])
    expect(summarizeAgentActivity(signals)).toEqual({
      primary: signals[0],
      count: 1,
      hasFailure: false,
    })
  })

  it('projects dedicated Sonner probes without treating ordinary runtime events as UI tests', () => {
    const sources = {
      runtimeEvents: [
        event(1, 'runtime.started', { cause: { kind: 'ui' } }, 9_000),
        event(2, 'dev.sonner_test', {
          workspaceId: '__dev__',
          resumeId: 'sonner-test-2',
          agent: 'Dev Panel',
          testState: 'success',
          message: 'Sonner success test',
        }, 10_000),
      ],
      inboxEntries: [],
    }

    expect(sonnerTestActivityFilter.project(sources, 11_000)).toEqual([
      expect.objectContaining({
        id: 'sonner-test:2',
        kind: 'sonner-test-success',
        detail: 'Sonner success test',
      }),
    ])
  })
})

describe('useGlobalAgentActivity', () => {
  it('combines incremental runtime events with Inbox deliveries and preserves data on partial failure', async () => {
    const now = Date.now()
    queryRuntime
      .mockResolvedValueOnce({
        entries: [event(2, 'runtime.started', { cause: conversationCause() }, now)],
        lastSeq: 2,
      })
      .mockResolvedValueOnce({
        entries: [event(3, 'runtime.turn.tool', { toolName: 'bash', toolStatus: 'running' }, now + 1_000)],
        lastSeq: 3,
      })
      .mockRejectedValueOnce(new Error('runtime offline'))
    queryInbox
      .mockResolvedValueOnce({ entries: [inboxEntry({ ts: now })], hasMore: false })
      .mockResolvedValueOnce({ entries: [inboxEntry({ ts: now })], hasMore: false })
      .mockResolvedValueOnce({ entries: [inboxEntry({ ts: now })], hasMore: false })

    const { result, unmount } = renderHook(() => useGlobalAgentActivity())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(queryRuntime).toHaveBeenCalledWith({ page: 1, pageSize: 100 })
    expect(queryInbox).toHaveBeenCalledWith({ limit: 25 })
    expect(result.current.signals.map((signal) => signal.kind).sort()).toEqual(['conversation', 'inbox'])

    await act(async () => {
      await result.current.refresh()
    })
    expect(queryRuntime).toHaveBeenLastCalledWith({ afterSeq: 2, limit: 100 })
    expect(result.current.signals.find((signal) => signal.kind === 'conversation')?.revision).toBe(2)

    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.error).toBe('runtime offline')
    expect(result.current.signals).toHaveLength(2)
    unmount()
  })
})
