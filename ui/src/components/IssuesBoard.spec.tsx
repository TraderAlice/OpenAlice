// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueListItem, IssueSnapshot } from '../api/issues'
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

beforeEach(() => {
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
})
