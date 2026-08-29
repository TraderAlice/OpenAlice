// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { useInboxSelection } from '../live/inbox-selection'
import { OFFICE_COWORKER_SPRITES } from '../office/coworker-sprites'
import { OfficeRuntimeSection } from './OfficeRuntimeSection'

const query = vi.fn()

function mockJournal(entries: Array<{ type: string } & Record<string, unknown>>) {
  query.mockImplementation(async (opts: { family?: string; page?: number; pageSize?: number } = {}) => {
    const filtered = opts.family === 'inbox'
      ? entries.filter((entry) => entry.type === 'inbox.received')
      : opts.family === 'news'
        ? entries.filter((entry) => entry.type === 'news.ingested')
        : opts.family === 'agent'
          ? entries.filter((entry) => entry.type !== 'inbox.received' && entry.type !== 'news.ingested')
          : entries
    const page = opts.page ?? 1
    const pageSize = opts.pageSize ?? filtered.length
    const offset = (page - 1) * pageSize
    return {
      entries: filtered.slice(offset, offset + pageSize),
      lastSeq: entries.length,
      total: filtered.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    }
  })
}

vi.mock('../api', () => ({
  api: {
    agentRuntime: {
      query: (...args: unknown[]) => query(...args),
    },
  },
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (select: (state: { openOrFocus: () => void }) => unknown) =>
    select({ openOrFocus: vi.fn() }),
}))

beforeEach(async () => {
  query.mockReset()
  useInboxSelection.getState().select(null)
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('OfficeRuntimeSection', () => {
  it('shows the empty occupancy copy', async () => {
    query.mockResolvedValue({ entries: [], lastSeq: 0, total: 0, page: 1, pageSize: 50, totalPages: 1 })
    render(<OfficeRuntimeSection />)
    expect(await screen.findByText(/No occupancy yet/)).toBeTruthy()
  })

  it('renders a started occupancy row', async () => {
    query.mockResolvedValue({
      lastSeq: 1,
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      entries: [{
        seq: 1,
        ts: Date.now(),
        type: 'runtime.started',
        payload: {
          workspaceId: 'desk-a',
          resumeId: 'resume-alice',
          agent: 'pi',
          surface: 'webpi',
          taskId: 'run-1',
          cause: { kind: 'ui' },
        },
      }],
    })
    const actors = new Map([['resume-alice', {
      resumeId: 'resume-alice',
      agent: 'pi',
      label: 'Market Scout',
      assignment: 'Watch the semiconductor desk for a clean entry.',
      secondary: 'pi · g1 · Chat Lab',
      asset: OFFICE_COWORKER_SPRITES.pi,
    }]])
    const { container } = render(<OfficeRuntimeSection actors={actors} />)
    expect((await screen.findAllByText('Market Scout')).length).toBeGreaterThan(0)
    expect(container.textContent).not.toContain('resume-alice')
    expect(screen.getAllByText('#0001').length).toBeGreaterThan(0)
    expect(screen.getByText(/webpi/)).toBeTruthy()
    expect(screen.getByText('Assignment')).toBeTruthy()
    expect(screen.getByText('Watch the semiconductor desk for a clean entry.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Runs' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Task started.*Market Scout.*#0001/i }).getAttribute('aria-pressed'))
      .toBe('true')
    expect(container.querySelector<HTMLElement>('.oa-office-runtime__badge .oa-office-coworker')?.dataset.agent)
      .toBe('pi')
    expect(container.querySelector<HTMLImageElement>('.oa-office-runtime__event-mark')?.src)
      .toContain('/office/log/lifecycle-v1.png')
    expect(screen.getByRole('button', { name: /Task started.*Market Scout.*#0001/i })
      .querySelector<HTMLImageElement>('.oa-office-runtime__cursor')?.src)
      .toContain('/office/hud/journal-cursor-v1.png')
    expect(container.textContent).not.toContain('▶')
  })

  it('renders a headless tool block and completion reply', async () => {
    query.mockResolvedValue({
      lastSeq: 2,
      total: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      entries: [
        {
          seq: 2,
          ts: Date.now(),
          type: 'runtime.stopped',
          payload: {
            workspaceId: 'desk-a',
            resumeId: 'resume-alice',
            agent: 'codex',
            surface: 'headless',
            taskId: 'run-1',
            status: 'done',
            assistantText: 'Desk is clear.',
            metrics: { textBlocks: 1, toolCalls: 1, toolFailures: 0 },
          },
        },
        {
          seq: 1,
          ts: Date.now() - 1000,
          type: 'runtime.turn.tool',
          payload: {
            workspaceId: 'desk-a',
            resumeId: 'resume-alice',
            agent: 'codex',
            surface: 'headless',
            taskId: 'run-1',
            toolId: 't1',
            toolName: 'workspace_list',
            toolStatus: 'completed',
          },
        },
      ],
    })
    const { container } = render(<OfficeRuntimeSection />)
    expect(await screen.findByText('Desk is clear.')).toBeTruthy()
    expect(screen.getByText('Surface')).toBeTruthy()
    expect(screen.getByText('Status')).toBeTruthy()
    expect(screen.getByText('Output')).toBeTruthy()
    expect(screen.getByText('1 text block · 1 tool call')).toBeTruthy()
    expect(screen.queryByText('—')).toBeNull()
    expect(screen.getByText('Complete')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Task complete.*#0002/i }).getAttribute('aria-pressed'))
      .toBe('true')
    expect(Array.from(container.querySelectorAll<HTMLImageElement>('.oa-office-runtime__index button > img:first-child'))
      .map((image) => image.src)).toEqual([
      expect.stringContaining('/office/log/lifecycle-v1.png'),
      expect.stringContaining('/office/log/tool-action-v1.png'),
    ])

    await userEvent.click(screen.getByRole('button', { name: /Tool action.*#0001/i }))
    expect(screen.getByText('workspace_list · completed')).toBeTruthy()
    expect(screen.queryByText('Desk is clear.')).toBeNull()
    expect(screen.getByRole('button', { name: /Tool action.*#0001/i }).getAttribute('aria-pressed'))
      .toBe('true')
    expect(screen.getByRole('button', { name: /Tool action.*#0001/i })
      .querySelector<HTMLImageElement>('.oa-office-runtime__cursor')?.src)
      .toContain('/office/hud/journal-cursor-v1.png')
    expect(container.querySelector<HTMLImageElement>('.oa-office-runtime__badge img')?.src)
      .toContain('/office/log/tool-action-v1.png')

    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByText('Desk is clear.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Task complete.*#0002/i }).getAttribute('aria-pressed'))
      .toBe('true')
  })

  it('presents long agent Markdown as expandable game dialogue', async () => {
    query.mockResolvedValue({
      lastSeq: 1,
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      entries: [{
        seq: 1,
        ts: Date.now(),
        type: 'runtime.stopped',
        payload: {
          resumeId: 'resume-dialogue',
          status: 'done',
          assistantText: [
            '# **Verdict**',
            '',
            '- Use `Layout B` for the loop.',
            '- Keep [history visible](https://example.com/history).',
            '> ~~Discard~~ retire Layout C.',
            ...Array.from({ length: 8 }, () => '- Preserve the action bar after a detailed report.'),
          ].join('\n'),
        },
      }],
    })
    const { container } = render(<OfficeRuntimeSection />)

    await screen.findByRole('button', { name: /Task complete.*#0001/i })
    const detail = container.querySelector('.oa-office-runtime__detail')
    expect(detail?.textContent).toContain([
      'Verdict',
      '• Use Layout B for the loop.',
      '• Keep history visible.',
      'Discard retire Layout C.',
    ].join('\n'))
    expect(detail?.textContent).toContain('• Preserve the action bar after a detailed report.')
    expect(detail?.textContent).not.toMatch(/\*\*|`|\]\(|~~|^#/)
    const toggle = screen.getByRole('button', { name: 'Show full report' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(detail?.getAttribute('data-expanded')).toBeNull()

    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Collapse report' }).getAttribute('aria-expanded'))
      .toBe('true')
    expect(detail?.getAttribute('data-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Collapse report' }).nextElementSibling).toBe(detail)

    await userEvent.click(screen.getByRole('button', { name: 'Collapse report' }))
    expect(screen.getByRole('button', { name: 'Show full report' }).getAttribute('aria-expanded'))
      .toBe('false')
  })

  it('keeps story events while switching between product activity channels', async () => {
    const now = Date.now()
    mockJournal([
        {
          seq: 4,
          ts: now,
          type: 'news.ingested',
          payload: { newsItemId: 8, source: 'Wire', title: 'Market headline' },
        },
        {
          seq: 3,
          ts: now - 1_000,
          type: 'inbox.received',
          payload: { inboxEntryId: 'inbox-3', agent: 'codex', summary: 'Agent report' },
        },
        {
          seq: 2,
          ts: now - 2_000,
          type: 'runtime.turn.tool',
          payload: { resumeId: 'resume-a', toolName: 'workspace_list', toolStatus: 'completed' },
        },
        {
          seq: 1,
          ts: now - 3_000,
          type: 'runtime.started',
          payload: { resumeId: 'resume-a', agent: 'pi', workspaceId: 'chat-a' },
        },
    ])
    render(<OfficeRuntimeSection />)

    const allTab = await screen.findByRole('tab', { name: /All\s*4/ })
    expect(allTab.getAttribute('data-active')).not.toBeNull()
    expect(screen.getByRole('tab', { name: /Agent\s*2/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Inbox\s*1/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /News\s*1/ })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Activity log · All' }).children).toHaveLength(4)

    await userEvent.click(screen.getByRole('tab', { name: /Inbox\s*1/ }))
    expect(screen.getByRole('list', { name: 'Activity log · Inbox' }).children).toHaveLength(1)
    expect(screen.getByText('Agent report')).toBeTruthy()
    expect(screen.queryByText('Market headline')).toBeNull()

    await userEvent.click(screen.getByRole('tab', { name: /News\s*1/ }))
    expect(screen.getByRole('list', { name: 'Activity log · News' }).children).toHaveLength(1)
    expect(screen.getByText('Market headline')).toBeTruthy()

    await userEvent.click(screen.getByRole('tab', { name: /Agent\s*2/ }))
    expect(screen.getByRole('list', { name: 'Activity log · Agent' }).children).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Tool action.*#0002/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /News added/i })).toBeNull()
  })

  it('opens a service channel on its requested event', async () => {
    const now = Date.now()
    mockJournal([
      {
        seq: 9,
        ts: now,
        type: 'inbox.received',
        payload: { inboxEntryId: 'inbox-9', summary: 'Newer dispatch' },
      },
      {
        seq: 7,
        ts: now - 2_000,
        type: 'inbox.received',
        payload: { inboxEntryId: 'inbox-7', summary: 'Requested dispatch' },
      },
      {
        seq: 8,
        ts: now - 1_000,
        type: 'news.ingested',
        payload: { newsItemId: 8, source: 'Wire', title: 'Market headline' },
      },
    ])

    render(<OfficeRuntimeSection initialChannel="inbox" initialSelectedSeq={7} />)

    const inboxTab = await screen.findByRole('tab', { name: /Inbox\s*2/ })
    expect(inboxTab.getAttribute('data-active')).not.toBeNull()
    expect(screen.getByRole('list', { name: 'Activity log · Inbox' }).children).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Inbox received.*#0007/i }).getAttribute('aria-pressed'))
      .toBe('true')
    expect(screen.getByText('Requested dispatch')).toBeTruthy()
    expect(screen.queryByText('Market headline')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Open Inbox' }))
    expect(useInboxSelection.getState().selectedEntryId).toBe('inbox-7')
  })

  it('keeps product events in All when agent activity fills its own page', async () => {
    const now = Date.now()
    const agentEvents = Array.from({ length: 50 }, (_, index) => ({
      seq: 200 - index,
      ts: now - index,
      type: 'runtime.turn.text',
      payload: {
        resumeId: 'resume-busy',
        taskId: 'task-busy',
        text: `Progress ${index + 1}`,
      },
    }))
    mockJournal([
      ...agentEvents,
      {
        seq: 100,
        ts: now - 1_000,
        type: 'inbox.received',
        payload: { inboxEntryId: 'inbox-100', summary: 'Durable handoff arrived' },
      },
      {
        seq: 99,
        ts: now - 2_000,
        type: 'news.ingested',
        payload: { newsItemId: 99, source: 'Wire', title: 'Important market headline' },
      },
    ])
    render(<OfficeRuntimeSection />)

    expect(await screen.findByRole('tab', { name: /All\s*3/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Agent\s*1/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Inbox\s*1/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /News\s*1/ })).toBeTruthy()
    const allLog = screen.getByRole('list', { name: 'Activity log · All' })
    expect(allLog.children).toHaveLength(3)
    expect(screen.getByRole('button', { name: /Inbox received.*#0100/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /News added.*#0099/i })).toBeTruthy()
  })

  it('fills the Agent journal with story beats beyond one chatty task', async () => {
    const now = Date.now()
    const recentProgress = Array.from({ length: 100 }, (_, index) => ({
      seq: 202 - index,
      ts: now - index * 100,
      type: 'runtime.turn.text',
      payload: {
        resumeId: 'resume-chatty',
        taskId: 'task-chatty',
        text: `Progress ${index + 1}`,
      },
    }))
    mockJournal([
      ...recentProgress,
      {
        seq: 2,
        ts: now - 20_000,
        type: 'runtime.stopped',
        payload: { resumeId: 'resume-earlier', taskId: 'task-earlier', status: 'done' },
      },
      {
        seq: 1,
        ts: now - 21_000,
        type: 'runtime.started',
        payload: { resumeId: 'resume-earlier', taskId: 'task-earlier' },
      },
    ])
    render(<OfficeRuntimeSection />)

    expect(await screen.findByRole('tab', { name: /Agent\s*3/ })).toBeTruthy()
    expect(query).toHaveBeenCalledWith({ page: 2, pageSize: 100, family: 'agent' })
    expect(screen.getByRole('button', { name: /Task complete.*#0002/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Task started.*#0001/i })).toBeTruthy()
  })

  it('folds adjacent reports from one task into a selectable activity beat', async () => {
    const now = Date.now()
    mockJournal([
      {
        seq: 5,
        ts: now,
        type: 'runtime.stopped',
        payload: { resumeId: 'resume-a', taskId: 'task-a', status: 'done' },
      },
      {
        seq: 4,
        ts: now - 1_000,
        type: 'runtime.turn.text',
        payload: { resumeId: 'resume-a', taskId: 'task-a', text: 'Latest progress.' },
      },
      {
        seq: 3,
        ts: now - 2_000,
        type: 'runtime.turn.text',
        payload: { resumeId: 'resume-a', taskId: 'task-a', text: 'Earlier progress.' },
      },
      {
        seq: 2,
        ts: now - 3_000,
        type: 'runtime.turn.text',
        payload: { resumeId: 'resume-a', taskId: 'task-a', text: 'First progress.' },
      },
      {
        seq: 1,
        ts: now - 4_000,
        type: 'runtime.started',
        payload: { resumeId: 'resume-a', taskId: 'task-a' },
      },
    ])
    render(<OfficeRuntimeSection />)

    expect(await screen.findByRole('tab', { name: /All\s*3/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Agent\s*3/ })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Activity log · All' }).children).toHaveLength(3)

    const progress = screen.getByRole('button', { name: /Agent report.*3 updates.*#0002–0004/i })
    expect(progress).toBeTruthy()
    await userEvent.click(progress)
    expect(screen.getByText('Latest progress.')).toBeTruthy()
    expect(screen.queryByText('Earlier progress.')).toBeNull()

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: /Task started.*#0001/i }).getAttribute('aria-pressed'))
      .toBe('true')
  })

  it('presents runtime outcomes as player-facing activity language', async () => {
    const now = Date.now()
    mockJournal([
      {
        seq: 6,
        ts: now,
        type: 'runtime.stopped',
        payload: { resumeId: 'resume-a', status: 'failed' },
      },
      {
        seq: 5,
        ts: now - 1,
        type: 'runtime.stopped',
        payload: { resumeId: 'resume-a', status: 'interrupted' },
      },
      {
        seq: 4,
        ts: now - 2,
        type: 'runtime.stopped',
        payload: { resumeId: 'resume-a', status: 'paused' },
      },
      {
        seq: 3,
        ts: now - 3,
        type: 'runtime.rejected',
        payload: { resumeId: 'resume-a' },
      },
      {
        seq: 2,
        ts: now - 4,
        type: 'runtime.spawn_failed',
        payload: { resumeId: 'resume-a' },
      },
      {
        seq: 1,
        ts: now - 5,
        type: 'runtime.turn.text',
        payload: { resumeId: 'resume-a', text: 'A useful update.' },
      },
    ])
    render(<OfficeRuntimeSection />)

    expect(await screen.findByRole('button', { name: /Task failed.*#0006/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Task interrupted.*#0005/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Task paused.*#0004/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Needs attention.*#0003/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Launch failed.*#0002/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Agent report.*#0001/i })).toBeTruthy()
    expect(screen.queryByText(/^stopped$|^text$|^rejected$/i)).toBeNull()
  })

  it('opens the floor snapshot for the selected journal event', async () => {
    const onReplay = vi.fn()
    mockJournal([
      {
        seq: 8,
        ts: Date.now(),
        type: 'runtime.stopped',
        payload: { resumeId: 'resume-a', status: 'done' },
      },
      {
        seq: 7,
        ts: Date.now() - 1,
        type: 'runtime.turn.text',
        payload: { resumeId: 'resume-a', text: 'Earlier report.' },
      },
    ])
    render(<OfficeRuntimeSection onReplay={onReplay} />)

    await userEvent.click(await screen.findByRole('button', { name: /Agent report.*#0007/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Find on floor' }))

    expect(onReplay).toHaveBeenCalledWith({
      seq: 7,
      targetIds: ['operations'],
      label: 'A',
      summary: 'Earlier report.',
      channel: 'all',
    })
  })

  it('returns to the same journal channel after locating an event on the floor', async () => {
    const onReplay = vi.fn()
    mockJournal([{
      seq: 9,
      ts: Date.now(),
      type: 'news.ingested',
      payload: { newsItemId: 9, source: 'Wire', title: 'Market opens' },
    }])
    render(<OfficeRuntimeSection onReplay={onReplay} />)

    await userEvent.click(await screen.findByRole('tab', { name: /News\s*1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Find on floor' }))

    expect(onReplay).toHaveBeenCalledWith({
      seq: 9,
      targetIds: ['news-service'],
      label: 'Wire',
      summary: 'Market opens',
      channel: 'news',
    })
  })

  it('keeps channel navigation available when the selected channel is empty', async () => {
    mockJournal([{
        seq: 1,
        ts: Date.now(),
        type: 'news.ingested',
        payload: { newsItemId: 1, source: 'Wire', title: 'Only headline' },
    }])
    render(<OfficeRuntimeSection />)

    await userEvent.click(await screen.findByRole('tab', { name: /Inbox\s*0/ }))
    expect(screen.getByText('No Inbox activity in this journal page.')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /News\s*1/ })).toBeTruthy()

    await userEvent.click(screen.getByRole('tab', { name: /News\s*1/ }))
    expect(screen.getByText('Only headline')).toBeTruthy()
  })
})
