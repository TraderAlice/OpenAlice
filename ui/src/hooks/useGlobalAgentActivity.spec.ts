// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'
import {
  conversationActivityFilter,
  inboxActivityFilter,
  newsActivityFilter,
  projectGlobalActivity,
  sonnerTestActivityFilter,
  summarizeAgentActivity,
  useGlobalAgentActivity,
  type GlobalActivityFilter,
} from './useGlobalAgentActivity'

const queryRuntime = vi.fn()

vi.mock('../api', () => ({
  api: {
    productActivity: { query: (...args: unknown[]) => queryRuntime(...args) },
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

beforeEach(() => {
  queryRuntime.mockReset()
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
    }, 2_000)).toEqual([])

    expect(conversationActivityFilter.project({
      runtimeEvents: [started, event(2, 'runtime.stopped', { status: 'failed', error: 'no auth' })],
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
      runtimeEvents: [
        event(10, 'inbox.received', {
          workspaceId: 'chat-1', inboxEntryId: 'inbox-1', agent: 'pi',
          originKind: 'headless', resumeId: 'resume-1', taskId: 'task-1',
        }, 10_000),
        event(11, 'inbox.received', {
          inboxEntryId: 'manual', agent: 'human', originKind: 'manual',
        }, 10_000),
        event(12, 'inbox.received', { inboxEntryId: 'old', agent: 'pi' }, 1_000),
        event(13, 'inbox.received', { inboxEntryId: 'anonymous', agent: undefined }, 10_000),
      ],
    }, 15_000)).toEqual([
      expect.objectContaining({
        id: 'inbox:inbox-1',
        kind: 'inbox',
        inboxEntryId: 'inbox-1',
      }),
    ])
  })

  it('projects each recently ingested News item as its own activity fact', () => {
    expect(newsActivityFilter.project({
      runtimeEvents: [event(20, 'news.ingested', {
        workspaceId: undefined,
        resumeId: undefined,
        agent: undefined,
        newsItemId: 42,
        title: 'Markets reopen after holiday',
        source: 'Reuters',
      }, 10_000)],
    }, 11_000)).toEqual([
      expect.objectContaining({
        id: 'news:42',
        kind: 'news',
        detail: 'Markets reopen after holiday',
        source: 'Reuters',
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
      { runtimeEvents: [] },
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
  it('combines incremental product activity events and preserves data on failure', async () => {
    const now = Date.now()
    queryRuntime
      .mockResolvedValueOnce({
        entries: [
          event(2, 'runtime.started', { cause: conversationCause() }, now),
          event(4, 'inbox.received', {
            inboxEntryId: 'inbox-1', agent: 'pi', originKind: 'headless',
          }, now),
        ],
        lastSeq: 4,
      })
      .mockResolvedValueOnce({
        entries: [event(3, 'runtime.turn.tool', { toolName: 'bash', toolStatus: 'running' }, now + 1_000)],
        lastSeq: 3,
      })
      .mockRejectedValueOnce(new Error('runtime offline'))
    const { result, unmount } = renderHook(() => useGlobalAgentActivity())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(queryRuntime).toHaveBeenCalledWith({ page: 1, pageSize: 100 })
    expect(result.current.signals.map((signal) => signal.kind).sort()).toEqual(['conversation', 'inbox'])

    await act(async () => {
      await result.current.refresh()
    })
    expect(queryRuntime).toHaveBeenLastCalledWith({ afterSeq: 4, limit: 100 })
    expect(result.current.signals.find((signal) => signal.kind === 'conversation')?.revision).toBe(2)

    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.error).toBe('runtime offline')
    expect(result.current.signals).toHaveLength(2)
    unmount()
  })
})
