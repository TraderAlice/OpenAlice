// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'
import { GLOBAL_ACTIVITY_REFRESH_EVENT } from '../hooks/useGlobalAgentActivity'
import {
  projectOfficeProductActivity,
  useOfficeProductActivity,
} from './useOfficeProductActivity'

const queryRuntime = vi.fn()

vi.mock('../api', () => ({
  api: {
    productActivity: { query: (...args: unknown[]) => queryRuntime(...args) },
  },
}))

function event(
  seq: number,
  type: AgentRuntimeEvent['type'],
  payload: AgentRuntimeEvent['payload'],
): AgentRuntimeEvent {
  return { seq, ts: seq * 1_000, type, payload }
}

const inboxNine = event(9, 'inbox.received', {
  workspaceId: 'chat-1',
  inboxEntryId: 'inbox-9',
  summary: 'Research report',
  agent: 'codex',
  documentCount: 1,
})
const newsEleven = event(11, 'news.ingested', {
  newsItemId: 4, title: 'Latest headline', source: 'Market feed',
})

function queueRefresh(entries: AgentRuntimeEvent[], lastSeq: number) {
  const newest = (matches: (entry: AgentRuntimeEvent) => boolean) => entries
    .filter(matches)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 9)
  queryRuntime
    .mockResolvedValueOnce({
      entries: newest((entry) => entry.type !== 'inbox.received' && entry.type !== 'news.ingested'),
      lastSeq,
    })
    .mockResolvedValueOnce({
      entries: newest((entry) => entry.type === 'inbox.received'),
      lastSeq,
    })
    .mockResolvedValueOnce({
      entries: newest((entry) => entry.type === 'news.ingested'),
      lastSeq,
    })
}

function deferredPage() {
  let resolve!: (value: { entries: AgentRuntimeEvent[]; lastSeq: number }) => void
  const promise = new Promise<{ entries: AgentRuntimeEvent[]; lastSeq: number }>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  queryRuntime.mockReset()
  window.sessionStorage.clear()
})

describe('projectOfficeProductActivity', () => {
  it('keeps the latest Inbox and News facts independently', () => {
    const events: AgentRuntimeEvent[] = [
      event(7, 'news.ingested', {
        newsItemId: 3, title: 'Earlier headline', source: 'Wire',
      }),
      inboxNine,
      newsEleven,
    ]

    expect(projectOfficeProductActivity(events)).toEqual({
      agent: null,
      inbox: {
        seq: 9,
        occurredAt: 9_000,
        detail: 'Research report',
        source: 'codex',
        subject: {
          kind: 'inbox-entry',
          workspaceId: 'chat-1',
          inboxEntryId: 'inbox-9',
          documentCount: 1,
        },
      },
      news: {
        seq: 11,
        occurredAt: 11_000,
        detail: 'Latest headline',
        source: 'Market feed',
      },
    })
  })

  it('distinguishes an Inbox delivery with no documents from an unknown count', () => {
    const zeroDocuments = projectOfficeProductActivity([event(20, 'inbox.received', {
      workspaceId: 'chat-1',
      inboxEntryId: 'inbox-zero',
      summary: 'No attachment handoff',
      documentCount: 0,
    })])
    const unknownDocuments = projectOfficeProductActivity([event(21, 'inbox.received', {
      workspaceId: 'chat-1',
      inboxEntryId: 'inbox-unknown',
      summary: 'Legacy handoff',
    })])

    expect(zeroDocuments.inbox?.subject).toMatchObject({ documentCount: 0 })
    expect(unknownDocuments.inbox?.subject).toMatchObject({ documentCount: null })
  })

  it('projects only low-noise Agent milestones and compacts their detail', () => {
    const events: AgentRuntimeEvent[] = [
      event(12, 'runtime.turn.tool', { agent: 'grok', toolName: 'read_file' }),
      event(13, 'runtime.started', { agent: 'grok', workspaceLabel: 'Office Lab' }),
      event(14, 'runtime.turn.text', { agent: 'grok', text: 'still working' }),
      event(15, 'runtime.turn.error', {
        agent: 'grok',
        workspaceId: 'office-lab',
        resumeId: 'resume-grok-15',
        error: `  Failed\n  after   ${'a'.repeat(190)}  `,
      }),
    ]

    const projection = projectOfficeProductActivity(events)
    expect(projection.agent).toMatchObject({
      seq: 15,
      occurredAt: 15_000,
      source: 'grok',
      eventType: 'runtime.turn.error',
      subject: {
        kind: 'session',
        workspaceId: 'office-lab',
        resumeId: 'resume-grok-15',
      },
    })
    expect(projection.agent?.detail).toHaveLength(180)
    expect(projection.agent?.detail).toBe(`Failed after ${'a'.repeat(166)}…`)
    expect(projection.inbox).toBeNull()
    expect(projection.news).toBeNull()
  })

  it('projects Markdown-rich activity as compact in-world copy', () => {
    const projection = projectOfficeProductActivity([
      event(16, 'runtime.stopped', {
        agent: 'grok',
        status: 'done',
        assistantText: '## Result\n**Recognition** stays with the [agent file](/office) and `callsign`.',
      }),
      event(17, 'inbox.received', {
        inboxEntryId: 'inbox-17',
        summary: '> **Desk note:** read the [handoff](/inbox/17).',
      }),
      event(18, 'news.ingested', {
        newsItemId: 18,
        title: '`NVDA` **results** arrive',
        source: 'Wire',
      }),
    ])

    expect(projection.agent?.detail)
      .toBe('Result Recognition stays with the agent file and callsign.')
    expect(projection.inbox?.detail).toBe('Desk note: read the handoff.')
    expect(projection.news?.detail).toBe('NVDA results arrive')
  })
})

describe('useOfficeProductActivity', () => {
  it('publishes Agent authority while a slow News journal page is still loading', async () => {
    const completed = event(13, 'runtime.stopped', {
      agent: 'grok',
      workspaceId: 'office-lab',
      resumeId: 'resume-grok-13',
      status: 'done',
      assistantText: 'Report ready.',
    })
    const slowNews = deferredPage()
    window.sessionStorage.setItem('openalice:office-product-activity:ack:agent', '0')
    queryRuntime
      .mockResolvedValueOnce({ entries: [completed], lastSeq: 13 })
      .mockResolvedValueOnce({ entries: [], lastSeq: 13 })
      .mockReturnValueOnce(slowNews.promise)

    const hook = renderHook(() => useOfficeProductActivity())

    await waitFor(() => expect(hook.result.current.agentSourceStatus).toBe('ready'))
    expect(hook.result.current.agent?.seq).toBe(13)
    expect(hook.result.current.attention.agent).toBe(true)
    expect(hook.result.current.sourceStatus).toBe('loading')
    expect(hook.result.current.news).toBeNull()

    await act(async () => {
      slowNews.resolve({ entries: [newsEleven], lastSeq: 13 })
      await slowNews.promise
    })
    await waitFor(() => expect(hook.result.current.sourceStatus).toBe('ready'))
    expect(hook.result.current.news?.seq).toBe(11)
    hook.unmount()
  })

  it('keeps Agent authority ready when the ambient News journal query fails', async () => {
    const completed = event(13, 'runtime.stopped', {
      agent: 'grok',
      workspaceId: 'office-lab',
      resumeId: 'resume-grok-13',
      status: 'done',
      assistantText: 'Report ready.',
    })
    window.sessionStorage.setItem('openalice:office-product-activity:ack:agent', '0')
    queryRuntime
      .mockResolvedValueOnce({ entries: [completed], lastSeq: 13 })
      .mockResolvedValueOnce({ entries: [], lastSeq: 13 })
      .mockRejectedValueOnce(new Error('news unavailable'))

    const hook = renderHook(() => useOfficeProductActivity())

    await waitFor(() => expect(hook.result.current.sourceStatus).toBe('error'))
    expect(hook.result.current.agentSourceStatus).toBe('ready')
    expect(hook.result.current.agent?.seq).toBe(13)
    expect(hook.result.current.attention.agent).toBe(true)
    expect(hook.result.current.news).toBeNull()
    hook.unmount()
  })

  it('baselines existing history, then remembers activity that happened while away', async () => {
    queueRefresh([inboxNine, newsEleven], 11)
    const firstVisit = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(firstVisit.result.current.news?.seq).toBe(11))
    expect(queryRuntime).toHaveBeenCalledWith(expect.objectContaining({
      pageSize: 9,
      types: expect.arrayContaining(['runtime.stopped', 'runtime.turn.error']),
    }))
    expect(queryRuntime).toHaveBeenCalledWith({ page: 1, pageSize: 9, family: 'inbox' })
    expect(queryRuntime).toHaveBeenCalledWith({ page: 1, pageSize: 9, family: 'news' })
    expect(firstVisit.result.current.attention).toEqual({ agent: false, inbox: false, news: false })
    expect(firstVisit.result.current.pending).toEqual({ agent: 0, inbox: 0, news: 0 })
    firstVisit.unmount()

    const newsTwelve = event(12, 'news.ingested', {
      newsItemId: 5, title: 'New while away', source: 'Wire',
    })
    queueRefresh([inboxNine, newsEleven, newsTwelve], 12)
    const returnVisit = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(returnVisit.result.current.news?.seq).toBe(12))
    expect(returnVisit.result.current.attention).toEqual({ agent: false, inbox: false, news: true })
    expect(returnVisit.result.current.pending).toEqual({ agent: 0, inbox: 0, news: 1 })
    expect(returnVisit.result.current.freshKind).toBeNull()

    act(() => returnVisit.result.current.acknowledgeThrough('news', 12))
    expect(returnVisit.result.current.attention.news).toBe(false)
    expect(returnVisit.result.current.pending.news).toBe(0)
    returnVisit.unmount()

    queueRefresh([inboxNine, newsEleven, newsTwelve], 12)
    const acknowledgedVisit = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(acknowledgedVisit.result.current.news?.seq).toBe(12))
    expect(acknowledgedVisit.result.current.attention.news).toBe(false)
    acknowledgedVisit.unmount()
  })

  it('animates live activity while keeping it pending until acknowledged', async () => {
    queueRefresh([inboxNine, newsEleven], 11)
    const hook = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(hook.result.current.news?.seq).toBe(11))

    const inboxTwelve = event(12, 'inbox.received', {
      inboxEntryId: 'inbox-12', summary: 'Live delivery', agent: 'pi',
    })
    queueRefresh([inboxNine, inboxTwelve, newsEleven], 12)
    act(() => window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT)))
    await waitFor(() => expect(hook.result.current.inbox?.seq).toBe(12))
    expect(hook.result.current.attention.inbox).toBe(true)
    expect(hook.result.current.pending.inbox).toBe(1)
    expect(hook.result.current.freshKind).toBe('inbox')

    act(() => hook.result.current.acknowledgeThrough('news', 11))
    expect(hook.result.current.freshKind).toBe('inbox')

    act(() => hook.result.current.acknowledgeThrough('inbox', 12))
    expect(hook.result.current.attention.inbox).toBe(false)
    expect(hook.result.current.pending.inbox).toBe(0)
    expect(hook.result.current.freshKind).toBeNull()
    hook.unmount()
  })

  it('counts several unseen product events up to a compact landmark cap', async () => {
    queueRefresh([newsEleven], 11)
    const hook = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(hook.result.current.news?.seq).toBe(11))

    const newNews = Array.from({ length: 11 }, (_, index) => event(12 + index, 'news.ingested', {
      newsItemId: 12 + index,
      title: `Headline ${index + 1}`,
      source: 'Wire',
    }))
    queueRefresh([newsEleven, ...newNews], 22)
    act(() => window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT)))

    await waitFor(() => expect(hook.result.current.news?.seq).toBe(22))
    expect(hook.result.current.attention.news).toBe(true)
    expect(hook.result.current.pending.news).toBe(9)

    act(() => hook.result.current.acknowledgeThrough('news', 22))
    expect(hook.result.current.attention.news).toBe(false)
    expect(hook.result.current.pending.news).toBe(0)
    hook.unmount()
  })

  it('keeps routine Agent starts ambient and raises review duty for a result', async () => {
    queueRefresh([inboxNine, newsEleven], 11)
    const hook = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(hook.result.current.news?.seq).toBe(11))

    const started = event(12, 'runtime.started', {
      agent: 'grok', workspaceLabel: 'Office Lab', surface: 'terminal',
    })
    queueRefresh([started, inboxNine, newsEleven], 12)
    act(() => window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT)))
    await waitFor(() => expect(hook.result.current.news?.seq).toBe(11))
    expect(hook.result.current.agent).toBeNull()
    expect(hook.result.current.attention.agent).toBe(false)

    const completed = event(13, 'runtime.stopped', {
      agent: 'grok', workspaceLabel: 'Office Lab', status: 'done', assistantText: 'Report ready.',
    })
    queueRefresh([completed, started, inboxNine, newsEleven], 13)
    act(() => window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT)))
    await waitFor(() => expect(hook.result.current.agent?.seq).toBe(13))
    expect(hook.result.current.attention.agent).toBe(true)
    expect(hook.result.current.freshKind).toBe('agent')

    act(() => hook.result.current.acknowledgeThrough('agent', 13))
    expect(hook.result.current.attention.agent).toBe(false)
    expect(hook.result.current.freshKind).toBeNull()
    hook.unmount()
  })

  it('acknowledges only the captured batch and preserves activity that arrived while reviewing', async () => {
    queueRefresh([newsEleven], 11)
    const hook = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(hook.result.current.news?.seq).toBe(11))

    const newsTwelve = event(12, 'news.ingested', { title: 'First duty', source: 'Wire' })
    queueRefresh([newsEleven, newsTwelve], 12)
    act(() => window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT)))
    await waitFor(() => expect(hook.result.current.pending.news).toBe(1))

    const newsThirteen = event(13, 'news.ingested', { title: 'Arrived during review', source: 'Wire' })
    queueRefresh([newsEleven, newsTwelve, newsThirteen], 13)
    act(() => window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT)))
    await waitFor(() => expect(hook.result.current.pending.news).toBe(2))

    act(() => hook.result.current.acknowledgeThrough('news', 12))
    expect(hook.result.current.attention.news).toBe(true)
    expect(hook.result.current.pending.news).toBe(1)
    expect(hook.result.current.news?.seq).toBe(13)
    hook.unmount()
  })

  it('keeps Inbox delivery B pending across remount after acknowledging captured delivery A', async () => {
    queueRefresh([inboxNine, newsEleven], 11)
    const hook = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(hook.result.current.inbox?.seq).toBe(9))

    const inboxA = event(12, 'inbox.received', {
      workspaceId: 'chat-1',
      inboxEntryId: 'inbox-a',
      summary: 'Captured delivery A',
      documentCount: 1,
    })
    queueRefresh([inboxNine, inboxA, newsEleven], 12)
    act(() => window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT)))
    await waitFor(() => expect(hook.result.current.pending.inbox).toBe(1))

    const inboxB = event(13, 'inbox.received', {
      workspaceId: 'chat-1',
      inboxEntryId: 'inbox-b',
      summary: 'Arrived during review B',
      documentCount: 1,
    })
    queueRefresh([inboxNine, inboxA, inboxB, newsEleven], 13)
    act(() => window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT)))
    await waitFor(() => expect(hook.result.current.pending.inbox).toBe(2))

    act(() => hook.result.current.acknowledgeThrough('inbox', 12))
    expect(hook.result.current.attention.inbox).toBe(true)
    expect(hook.result.current.pending.inbox).toBe(1)
    expect(hook.result.current.inbox?.seq).toBe(13)
    hook.unmount()

    queueRefresh([inboxNine, inboxA, inboxB, newsEleven], 13)
    const remounted = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(remounted.result.current.inbox?.seq).toBe(13))
    expect(remounted.result.current.attention.inbox).toBe(true)
    expect(remounted.result.current.pending.inbox).toBe(1)
    remounted.unmount()
  })

  it('ignores an older refresh that resolves after a newer activity snapshot', async () => {
    queueRefresh([newsEleven], 11)
    const hook = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(hook.result.current.news?.seq).toBe(11))

    const newsTwelve = event(12, 'news.ingested', { title: 'Older snapshot', source: 'Wire' })
    const newsThirteen = event(13, 'news.ingested', { title: 'Newer snapshot', source: 'Wire' })
    const older = [deferredPage(), deferredPage(), deferredPage()]
    const newer = [deferredPage(), deferredPage(), deferredPage()]
    const pendingPages = [...older, ...newer]
    let call = 0
    queryRuntime.mockImplementation(() => pendingPages[call++].promise)

    act(() => window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT)))
    act(() => window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT)))

    await act(async () => {
      newer[0].resolve({ entries: [], lastSeq: 13 })
      newer[1].resolve({ entries: [], lastSeq: 13 })
      newer[2].resolve({ entries: [newsThirteen, newsTwelve, newsEleven], lastSeq: 13 })
      await Promise.resolve()
    })
    await waitFor(() => expect(hook.result.current.news?.seq).toBe(13))
    expect(hook.result.current.pending.news).toBe(2)

    await act(async () => {
      older[0].resolve({ entries: [], lastSeq: 12 })
      older[1].resolve({ entries: [], lastSeq: 12 })
      older[2].resolve({ entries: [newsTwelve, newsEleven], lastSeq: 12 })
      await Promise.resolve()
    })
    expect(hook.result.current.news?.seq).toBe(13)
    expect(hook.result.current.pending.news).toBe(2)
    hook.unmount()
  })
})
