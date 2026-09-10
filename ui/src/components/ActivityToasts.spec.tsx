// @vitest-environment jsdom

import { StrictMode } from 'react'
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
    info: vi.fn(),
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
  it('silences the initial snapshot across effect replay, then announces a new revision', () => {
    const initial = Array.from({ length: 250 }, (_, index) => signal({
      id: `news:${index + 1}`, kind: 'news', revision: index + 1,
    }))
    useActivity.mockReturnValue(data([...initial, signal({ revision: 251 })]))
    const view = render(<StrictMode><ActivityToasts /></StrictMode>)
    view.rerender(<StrictMode><ActivityToasts /></StrictMode>)
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.loading).not.toHaveBeenCalled()

    useActivity.mockReturnValue(data([...initial, signal({
      kind: 'conversation-failed', revision: 252,
    })]))
    view.rerender(<StrictMode><ActivityToasts /></StrictMode>)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('waits through loading and an initial failure before establishing the baseline', () => {
    useActivity.mockReturnValue({ ...data([]), loading: true })
    const view = render(<ActivityToasts />)
    useActivity.mockReturnValue({ ...data([]), error: 'Unavailable' })
    view.rerender(<ActivityToasts />)
    useActivity.mockReturnValue(data([signal()]))
    view.rerender(<ActivityToasts />)
    expect(toast.loading).not.toHaveBeenCalled()

    useActivity.mockReturnValue(data([signal(), signal({ taskId: 'task-2', revision: 2 })]))
    view.rerender(<ActivityToasts />)
    expect(toast.loading).toHaveBeenCalledTimes(1)
    expect(toast.loading).toHaveBeenCalledWith(
      expect.any(String), expect.objectContaining({ id: 'openalice-activity:task:task-2' }),
    )
  })

  it('keeps one loading toast per Agent request and dismisses it on completion', async () => {
    const view = render(<ActivityToasts />)
    useActivity.mockReturnValue(data([signal()]))
    view.rerender(<ActivityToasts />)

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
    const view = render(<ActivityToasts />)
    useActivity.mockReturnValue(data([signal()]))
    view.rerender(<ActivityToasts />)
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
    const view = render(<ActivityToasts />)
    useActivity.mockReturnValue(data([signal({
      id: 'inbox:entry-1',
      kind: 'inbox',
      inboxEntryId: 'entry-1',
    })]))
    view.rerender(<ActivityToasts />)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      'activityToast.inboxDelivered:pi',
      expect.objectContaining({ id: 'openalice-activity:inbox:entry-1' }),
    ))
    view.rerender(<ActivityToasts />)
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('renders a dedicated Sonner test signal through the production bridge', async () => {
    const view = render(<ActivityToasts />)
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
    view.rerender(<ActivityToasts />)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      'Sonner success test',
      expect.objectContaining({ id: 'openalice-activity:sonner-test:42' }),
    ))
  })

  it('announces each News activity with its source and headline', async () => {
    const view = render(<ActivityToasts />)
    useActivity.mockReturnValue(data([signal({
      id: 'news:42',
      kind: 'news',
      workspaceId: undefined,
      agent: undefined,
      resumeId: undefined,
      taskId: undefined,
      newsItemId: 42,
      source: 'Reuters',
      detail: 'Markets reopen after holiday',
      revision: 42,
    })]))
    view.rerender(<ActivityToasts />)

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(
      'activityToast.newsIngested:',
      expect.objectContaining({
        id: 'openalice-activity:news:42',
        description: 'Markets reopen after holiday',
      }),
    ))
  })
})
