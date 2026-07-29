// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
    workspaces: [{ id: 'ws-1', agents: ['pi', 'claude'] }],
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
    assignee: '@workspace',
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
    expect(screen.queryByText('@workspace')).toBeNull()
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

  it('explains transitional ownership without exposing the raw @new token', () => {
    mocks.useIssues.mockReturnValue({
      data: snapshot([
        issue({
          id: 'first-owner',
          title: 'Assign one durable owner',
          assignee: '@new',
          when: { kind: 'every', every: '1h' },
        }),
      ]),
      error: null,
      loading: false,
    })

    render(<IssuesBoard />)

    expect(screen.getByText('Assign on first run')).toBeTruthy()
    expect(screen.queryByText('@new')).toBeNull()
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
          assignee: '@new',
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
    expect(screen.getAllByText('运行中')).toHaveLength(2)
    expect(screen.getAllByText('每工作日 08:30')).toHaveLength(2)
    expect(screen.getByText('首次运行时指派')).toBeTruthy()
    expect(screen.getByText('claude 覆盖')).toBeTruthy()
    expect(screen.getByLabelText('高优先级')).toBeTruthy()
    expect(screen.getByLabelText('折叠“进行中”议题')).toBeTruthy()
    expect(screen.getByTitle('打开 weekday-scan')).toBeTruthy()
    expect(screen.getByTitle('工作区：market-desk（ws-1）')).toBeTruthy()
  })
})
