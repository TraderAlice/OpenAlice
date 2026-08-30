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
  inboxEntryId: 'inbox-9', summary: 'Research report', agent: 'codex',
})
const newsEleven = event(11, 'news.ingested', {
  newsItemId: 4, title: 'Latest headline', source: 'Market feed',
})

function queueRefresh(entries: AgentRuntimeEvent[], lastSeq: number) {
  const newest = (matches: (entry: AgentRuntimeEvent) => boolean) => entries
    .filter(matches)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 1)
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
        inboxEntryId: 'inbox-9',
      },
      news: {
        seq: 11,
        occurredAt: 11_000,
        detail: 'Latest headline',
        source: 'Market feed',
      },
    })
  })

  it('projects only low-noise Agent milestones and compacts their detail', () => {
    const events: AgentRuntimeEvent[] = [
      event(12, 'runtime.turn.tool', { agent: 'grok', toolName: 'read_file' }),
      event(13, 'runtime.started', { agent: 'grok', workspaceLabel: 'Office Lab' }),
      event(14, 'runtime.turn.text', { agent: 'grok', text: 'still working' }),
      event(15, 'runtime.turn.error', {
        agent: 'grok',
        error: `  Failed\n  after   ${'a'.repeat(190)}  `,
      }),
    ]

    const projection = projectOfficeProductActivity(events)
    expect(projection.agent).toMatchObject({
      seq: 15,
      occurredAt: 15_000,
      source: 'grok',
      eventType: 'runtime.turn.error',
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
  it('baselines existing history, then remembers activity that happened while away', async () => {
    queueRefresh([inboxNine, newsEleven], 11)
    const firstVisit = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(firstVisit.result.current.news?.seq).toBe(11))
    expect(queryRuntime).toHaveBeenCalledWith(expect.objectContaining({
      pageSize: 1,
      types: expect.arrayContaining(['runtime.started', 'runtime.stopped']),
    }))
    expect(queryRuntime).toHaveBeenCalledWith({ page: 1, pageSize: 1, family: 'inbox' })
    expect(queryRuntime).toHaveBeenCalledWith({ page: 1, pageSize: 1, family: 'news' })
    expect(firstVisit.result.current.attention).toEqual({ agent: false, inbox: false, news: false })
    firstVisit.unmount()

    const newsTwelve = event(12, 'news.ingested', {
      newsItemId: 5, title: 'New while away', source: 'Wire',
    })
    queueRefresh([inboxNine, newsEleven, newsTwelve], 12)
    const returnVisit = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(returnVisit.result.current.news?.seq).toBe(12))
    expect(returnVisit.result.current.attention).toEqual({ agent: false, inbox: false, news: true })
    expect(returnVisit.result.current.freshKind).toBeNull()

    act(() => returnVisit.result.current.acknowledge('news'))
    expect(returnVisit.result.current.attention.news).toBe(false)
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
    expect(hook.result.current.freshKind).toBe('inbox')

    act(() => hook.result.current.acknowledge('news'))
    expect(hook.result.current.freshKind).toBe('inbox')

    act(() => hook.result.current.acknowledge('inbox'))
    expect(hook.result.current.attention.inbox).toBe(false)
    expect(hook.result.current.freshKind).toBeNull()
    hook.unmount()
  })

  it('raises and acknowledges Operations Board attention for an Agent milestone', async () => {
    queueRefresh([inboxNine, newsEleven], 11)
    const hook = renderHook(() => useOfficeProductActivity())
    await waitFor(() => expect(hook.result.current.news?.seq).toBe(11))

    const started = event(12, 'runtime.started', {
      agent: 'grok', workspaceLabel: 'Office Lab', surface: 'terminal',
    })
    queueRefresh([started, inboxNine, newsEleven], 12)
    act(() => window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT)))
    await waitFor(() => expect(hook.result.current.agent?.seq).toBe(12))
    expect(hook.result.current.attention.agent).toBe(true)
    expect(hook.result.current.freshKind).toBe('agent')

    act(() => hook.result.current.acknowledge('agent'))
    expect(hook.result.current.attention.agent).toBe(false)
    expect(hook.result.current.freshKind).toBeNull()
    hook.unmount()
  })
})
