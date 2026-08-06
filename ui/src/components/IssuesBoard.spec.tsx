// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueListItem, IssueSnapshot } from '../api/issues'
import { i18n } from '../i18n'
import { IssuesBoard } from './IssuesBoard'

const mocks = vi.hoisted(() => ({
  useIssues: vi.fn(),
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
}))

vi.mock('../hooks/useIssues', () => ({
  useIssues: () => mocks.useIssues(),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    agents: [
      { id: 'pi', displayName: 'Pi', kind: 'agent' },
      { id: 'claude', displayName: 'Claude Code', kind: 'agent' },
    ],
    defaultAgent: 'pi',
    issueDefaultAgent: null,
    workspaces: [{ id: 'ws-1' }],
  }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: unknown) => unknown) => selector({
    openOrFocus: mocks.openOrFocus,
    setSidebar: mocks.setSidebar,
  }),
}))

function issue(overrides: Partial<IssueListItem>): IssueListItem {
  return {
    id: 'issue-id',
    title: 'Issue title',
    status: 'todo',
    priority: 'none',
    assignee: '@new-each-run',
    ...overrides,
  }
}

function snapshot(issues: IssueListItem[]): IssueSnapshot {
  return {
    workspaces: [{ wsId: 'ws-1', tag: 'market-desk', status: 'ok', issues }],
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  mocks.useIssues.mockReturnValue({
    data: snapshot([]),
    error: null,
    loading: false,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('IssuesBoard', () => {
  it('puts work identity first and hides default execution metadata', () => {
    mocks.useIssues.mockReturnValue({
      data: snapshot([
        issue({
          id: 'daily-close-scan',
          title: '收盘扫描',
          priority: 'medium',
          agent: 'pi',
          when: { kind: 'cron', cron: '0 5 * * 1-5' },
          automationHealth: { state: 'healthy', message: 'Latest scheduled run completed.' },
        }),
      ]),
      error: null,
      loading: false,
    })

    render(<IssuesBoard />)

    expect(screen.getByText('收盘扫描')).toBeTruthy()
    expect(screen.getByText('#daily-close-scan')).toBeTruthy()
    expect(screen.getByText('market-desk')).toBeTruthy()
    expect(screen.queryByText('@new-each-run')).toBeNull()
    expect(screen.queryByText('pi override')).toBeNull()

    const rowText = screen.getByTitle('Open daily-close-scan').textContent ?? ''
    expect(rowText.indexOf('收盘扫描')).toBeLessThan(rowText.indexOf('Healthy'))
    expect(rowText.indexOf('Healthy')).toBeLessThan(rowText.indexOf('market-desk'))
  })

  it('orders operational failures first and exposes only meaningful exceptions', () => {
    mocks.useIssues.mockReturnValue({
      data: snapshot([
        issue({
          id: 'healthy-high',
          title: 'Healthy high-priority work',
          priority: 'high',
          when: { kind: 'every', every: '1h' },
          automationHealth: { state: 'healthy', message: 'Latest scheduled run completed.' },
        }),
        issue({
          id: 'failed-low',
          title: 'Failed scheduled work',
          priority: 'low',
          assignee: '@resume-calm-market-desk-a1b2c3',
          agent: 'claude',
          when: { kind: 'every', every: '1h' },
          automationHealth: { state: 'failed', message: 'Latest scheduled run failed.' },
        }),
      ]),
      error: null,
      loading: false,
    })

    render(<IssuesBoard />)

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('Failed scheduled work')
    expect(screen.getByText('@resume-calm-market-desk-a1b2c3')).toBeTruthy()
    expect(screen.getByText('claude override')).toBeTruthy()
  })

  it('explains transitional ownership without exposing the raw @new-then-resume token', () => {
    mocks.useIssues.mockReturnValue({
      data: snapshot([
        issue({
          id: 'first-owner',
          title: 'Assign one durable owner',
          assignee: '@new-then-resume',
          when: { kind: 'every', every: '1h' },
        }),
      ]),
      error: null,
      loading: false,
    })

    render(<IssuesBoard />)

    expect(screen.getByText('Assign on first run')).toBeTruthy()
    expect(screen.queryByText('@new-then-resume')).toBeNull()
  })

  it('localizes board chrome, schedule health, and accessible metadata', async () => {
    await i18n.changeLanguage('zh')
    mocks.useIssues.mockReturnValue({
      data: snapshot([
        issue({
          id: 'weekday-scan',
          title: '工作日扫描',
          status: 'in_progress',
          priority: 'high',
          assignee: '@new-then-resume',
          agent: 'claude',
          when: { kind: 'cron', cron: '30 8 * * 1-5' },
          automationHealth: { state: 'running', message: 'Run is active.' },
        }),
      ]),
      error: null,
      loading: false,
    })

    render(<IssuesBoard />)

    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getAllByText('运行中')).toHaveLength(1)
    expect(screen.getAllByText('每工作日 08:30')).toHaveLength(1)
    expect(screen.getByText('首次运行时指派')).toBeTruthy()
    expect(screen.getByText('claude 覆盖')).toBeTruthy()
    expect(screen.getByLabelText('高优先级')).toBeTruthy()
    expect(screen.getByLabelText('折叠“进行中”议题')).toBeTruthy()
    expect(screen.getByTitle('打开 weekday-scan')).toBeTruthy()
    expect(screen.getByTitle('工作区：market-desk（ws-1）')).toBeTruthy()
  })

  it('uses one flat ledger and renders automation metadata only once per Issue', () => {
    mocks.useIssues.mockReturnValue({
      data: snapshot([
        issue({
          id: 'scan-once',
          title: 'Render one operational summary',
          priority: 'high',
          when: { kind: 'every', every: '1h' },
          nextDueAtMs: Date.now() + 60_000,
          automationHealth: { state: 'healthy', message: 'Latest scheduled run completed.' },
        }),
      ]),
      error: null,
      loading: false,
    })

    render(<IssuesBoard />)

    const board = screen.getByTestId('issues-board')
    const group = screen.getByTestId('issue-status-group-todo')
    expect(board.className).toContain('max-w-[1240px]')
    expect(group.className).toContain('border-y')
    expect(group.className).not.toContain('rounded-lg')
    expect(screen.getAllByTestId('issue-automation-summary')).toHaveLength(1)
    expect(screen.getAllByText('Healthy')).toHaveLength(1)
    expect(screen.getAllByText('Every 1h')).toHaveLength(1)

    const priority = screen.getByLabelText('High priority')
    expect(priority.querySelectorAll('.bg-muted-foreground\\/80')).toHaveLength(3)
  })

  it('keeps status disclosure and whole-row keyboard navigation intact', async () => {
    const user = userEvent.setup()
    mocks.useIssues.mockReturnValue({
      data: snapshot([issue({ id: 'keyboard-issue', title: 'Keyboard issue' })]),
      error: null,
      loading: false,
    })

    render(<IssuesBoard />)

    const groupToggle = screen.getByRole('button', { name: 'Collapse Todo issues' })
    expect(groupToggle.getAttribute('aria-controls')).toBe('issues-status-todo')
    expect(groupToggle.getAttribute('aria-expanded')).toBe('true')

    await user.click(groupToggle)
    expect(groupToggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Keyboard issue')).toBeNull()

    await user.click(groupToggle)
    const row = screen.getByTitle('Open keyboard-issue')
    row.focus()
    await user.keyboard('{Enter}')

    expect(mocks.setSidebar).toHaveBeenCalledWith('issue')
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'issue-detail',
      params: { wsId: 'ws-1', id: 'keyboard-issue' },
    })
  })

  it('keeps terminal Issues readable and openable without fading the whole row', async () => {
    const user = userEvent.setup()
    mocks.useIssues.mockReturnValue({
      data: snapshot([issue({
        id: 'completed-issue',
        title: 'Completed issue',
        status: 'done',
      })]),
      error: null,
      loading: false,
    })

    render(<IssuesBoard />)

    const row = screen.getByTitle('Open completed-issue')
    expect(row.className).not.toContain('opacity-60')
    await user.click(row)
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'issue-detail',
      params: { wsId: 'ws-1', id: 'completed-issue' },
    })
  })
})
