// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import type { AgentActivitySignal, GlobalAgentActivityData } from '../hooks/useGlobalAgentActivity'
import { ActivityToasts } from './ActivityToasts'

const useActivity = vi.fn<() => GlobalAgentActivityData>()

vi.mock('../hooks/useGlobalAgentActivity', async (importOriginal) => {
  const original = await importOriginal<typeof import('../hooks/useGlobalAgentActivity')>()
  return { ...original, useGlobalAgentActivity: () => useActivity() }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { agent?: string }) => `${key}:${values?.agent ?? ''}`,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}))

function signal(overrides: Partial<AgentActivitySignal> = {}): AgentActivitySignal {
  return {
    id: 'conversation:task:task-1',
    kind: 'conversation',
    workspaceId: 'chat-1',
    agent: 'pi',
    resumeId: 'resume-1',
    taskId: 'task-1',
    occurredAt: 1_000,
    revision: 1,
    ...overrides,
  }
}

function data(signals: AgentActivitySignal[]): GlobalAgentActivityData {
  return {
    signals,
    summary: {
      primary: signals[0] ?? null,
      count: signals.length,
      hasFailure: signals.some(({ kind }) => kind === 'conversation-failed'),
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useActivity.mockReturnValue(data([]))
})

describe('ActivityToasts', () => {
  it('keeps one loading toast per Agent request and dismisses it on completion', async () => {
    useActivity.mockReturnValue(data([signal()]))
    const view = render(<ActivityToasts />)

    await waitFor(() => expect(toast.loading).toHaveBeenCalledWith(
      'activityToast.conversationRunning:pi',
      expect.objectContaining({ id: 'openalice-activity:task:task-1' }),
    ))

    view.rerender(<ActivityToasts />)
    expect(toast.loading).toHaveBeenCalledTimes(1)

    useActivity.mockReturnValue(data([]))
    view.rerender(<ActivityToasts />)
    await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith(
      'openalice-activity:task:task-1',
    ))
  })

  it('updates a running Agent request in place when it fails', async () => {
    useActivity.mockReturnValue(data([signal()]))
    const view = render(<ActivityToasts />)
    await waitFor(() => expect(toast.loading).toHaveBeenCalledTimes(1))

    useActivity.mockReturnValue(data([signal({
      id: 'conversation-failed:task:task-1',
      kind: 'conversation-failed',
      revision: 2,
    })]))
    view.rerender(<ActivityToasts />)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'activityToast.conversationFailed:pi',
      expect.objectContaining({ id: 'openalice-activity:task:task-1' }),
    ))
    expect(toast.dismiss).not.toHaveBeenCalled()
  })

  it('announces an Agent-originated Inbox delivery once', async () => {
    useActivity.mockReturnValue(data([signal({
      id: 'inbox:entry-1',
      kind: 'inbox',
      inboxEntryId: 'entry-1',
    })]))
    const view = render(<ActivityToasts />)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      'activityToast.inboxDelivered:pi',
      expect.objectContaining({ id: 'openalice-activity:inbox:entry-1' }),
    ))
    view.rerender(<ActivityToasts />)
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('renders a dedicated Sonner test signal through the production bridge', async () => {
    useActivity.mockReturnValue(data([signal({
      id: 'sonner-test:42',
      kind: 'sonner-test-success',
      workspaceId: '__dev__',
      agent: 'Dev Panel',
      taskId: undefined,
      resumeId: undefined,
      detail: 'Sonner success test',
      revision: 42,
    })]))
    render(<ActivityToasts />)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      'Sonner success test',
      expect.objectContaining({ id: 'openalice-activity:sonner-test:42' }),
    ))
  })
})
