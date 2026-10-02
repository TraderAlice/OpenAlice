// @vitest-environment jsdom
import { StrictMode } from 'react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentActivitySignal, GlobalAgentActivityData } from '../hooks/useGlobalAgentActivity'
import { NotificationQueue } from '../lib/notifications/queue'
import { ActivityToasts } from './ActivityToasts'

const useActivity = vi.fn<() => GlobalAgentActivityData>()
const show = vi.fn()
const hide = vi.fn()
let queue: NotificationQueue
vi.mock('./Toast', () => ({ useNotifications: () => queue }))
vi.mock('../contexts/workspaces-context', () => ({ useWorkspaces: () => ({ workspaces: [{
  id: 'chat-1', sessions: [{ id: 'session-1', resumeId: 'resume-1', agent: 'pi', name: 'p1', title: 'Daily market review', displayName: 'Market analyst' }],
}] }) }))
vi.mock('../hooks/useGlobalAgentActivity', async importOriginal => ({
  ...await importOriginal<typeof import('../hooks/useGlobalAgentActivity')>(), useGlobalAgentActivity: () => useActivity(),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: { agent?: string }) => `${key}:${values?.agent ?? ''}` }) }))

function signal(overrides: Partial<AgentActivitySignal> = {}): AgentActivitySignal {
  return { id: 'conversation:task:task-1', kind: 'conversation', workspaceId: 'chat-1', agent: 'pi', resumeId: 'resume-1', taskId: 'task-1', occurredAt: 1_000, revision: 1, ...overrides }
}
function data(signals: AgentActivitySignal[]): GlobalAgentActivityData {
  return { signals, summary: { primary: signals[0] ?? null, count: signals.length, hasFailure: signals.some(s => s.kind === 'conversation-failed') }, loading: false, error: null, refresh: vi.fn() }
}
beforeEach(() => { show.mockReset(); hide.mockReset(); queue = new NotificationQueue({ show, hide }); useActivity.mockReturnValue(data([])) })

describe('activity bubble projection', () => {
  it('silences the initial snapshot across StrictMode replay and initial read errors', () => {
    useActivity.mockReturnValue({ ...data([]), loading: true })
    const view = render(<StrictMode><ActivityToasts /></StrictMode>)
    useActivity.mockReturnValue({ ...data([]), error: 'Offline' }); view.rerender(<StrictMode><ActivityToasts /></StrictMode>)
    useActivity.mockReturnValue(data([signal()])); view.rerender(<StrictMode><ActivityToasts /></StrictMode>)
    expect(show).not.toHaveBeenCalled()
    useActivity.mockReturnValue(data([signal({ kind: 'conversation-failed', revision: 2, detail: 'No auth' })])); view.rerender(<StrictMode><ActivityToasts /></StrictMode>)
    expect(show.mock.lastCall?.[1]).toMatchObject({ status: 'error', description: 'No auth' })
  })
  it('updates one running bubble to completion in place and does not replay', () => {
    const view = render(<ActivityToasts />)
    useActivity.mockReturnValue(data([signal()])); view.rerender(<ActivityToasts />)
    const id = show.mock.lastCall?.[0]
    useActivity.mockReturnValue(data([signal({ kind: 'conversation-completed', revision: 2 })])); view.rerender(<ActivityToasts />)
    expect(show.mock.lastCall?.[0]).toBe(id)
    expect(show.mock.lastCall?.[1]).toMatchObject({ status: 'success', duration: 4_000 })
    view.rerender(<ActivityToasts />)
    expect(show).toHaveBeenCalledTimes(2)
    expect(hide).not.toHaveBeenCalled()
  })
  it('keeps interruption/pause neutral and rejection amber', () => {
    const view = render(<ActivityToasts />)
    useActivity.mockReturnValue(data([signal({ kind: 'conversation-paused' })])); view.rerender(<ActivityToasts />)
    expect(show.mock.lastCall?.[1].status).toBe('neutral')
    useActivity.mockReturnValue(data([signal({ kind: 'conversation-failed', failureKind: 'rejected', revision: 2 })])); view.rerender(<ActivityToasts />)
    expect(show.mock.lastCall?.[1]).toMatchObject({ status: 'warning', duration: 8_000 })
  })
  it('correlates Inbox with running/completed requests without a second completion bubble', () => {
    const view = render(<ActivityToasts />)
    useActivity.mockReturnValue(data([signal()])); view.rerender(<ActivityToasts />)
    const id = show.mock.lastCall?.[0]
    useActivity.mockReturnValue(data([signal({ kind: 'inbox', id: 'inbox:1', revision: 2, detail: 'Report ready' }), signal({ kind: 'conversation-completed', revision: 3 })])); view.rerender(<ActivityToasts />)
    expect(show).toHaveBeenCalledTimes(2)
    expect(show.mock.lastCall?.[0]).toBe(id)
    expect(show.mock.lastCall?.[1]).toMatchObject({ title: 'activityToast.inboxDelivered:Market analyst', description: 'Report ready' })
  })
  it('does not turn a failure into success because its error report reaches Inbox', () => {
    const view = render(<ActivityToasts />)
    useActivity.mockReturnValue(data([signal({ kind: 'conversation-failed', detail: 'Failed', revision: 1 }), signal({ id: 'inbox:1', kind: 'inbox', revision: 2 })])); view.rerender(<ActivityToasts />)
    expect(show.mock.calls.map(call => call[1].status)).toEqual(['error', 'success'])
    expect(show.mock.calls[0][0]).not.toBe(show.mock.calls[1][0])
  })
  it('groups new articles and atomically replaces the latest image/headline/id; large replay stays silent', () => {
    const view = render(<ActivityToasts />)
    const articles = Array.from({ length: 250 }, (_, index) => signal({ id: `news:${index}`, kind: 'news', taskId: undefined, source: 'Reuters', newsItemId: index, revision: index + 1, detail: `Headline ${index}`, image: index === 249 ? '/latest.jpg' : undefined }))
    useActivity.mockReturnValue(data(articles)); view.rerender(<ActivityToasts />)
    expect(show.mock.lastCall?.[1]).toMatchObject({ count: 250, articleId: 249, description: 'Headline 249', image: '/latest.jpg' })
    const calls = show.mock.calls.length
    useActivity.mockReturnValue(data([...articles])); view.rerender(<ActivityToasts />)
    expect(show).toHaveBeenCalledTimes(calls)
  })
})
