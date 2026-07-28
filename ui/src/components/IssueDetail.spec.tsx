// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { IssueDetail as IssueDetailData } from '../api/issues'
import { IssueDetail } from './IssueDetail'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  openAgentConfig: vi.fn(),
  openHeadlessRun: vi.fn(),
}))

const scheduledIssue: IssueDetailData = {
  issue: {
    id: 'morning-scan',
    title: 'Morning movers scan',
    what: 'Scan the market and publish a brief.',
    status: 'in_progress',
    priority: 'high',
    assignee: '@workspace',
    agent: 'codex',
    when: {
      kind: 'cron',
      cron: '30 8 * * 1-5',
      timezone: 'America/New_York',
    },
  },
  runs: [],
  comments: [],
  activity: [],
  inboxReports: [],
}

vi.mock('../hooks/useIssueDetail', () => ({
  useIssueDetail: () => ({
    data: scheduledIssue,
    error: null,
    loading: false,
    mutate: mocks.mutate,
  }),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    agents: [
      { id: 'codex', displayName: 'Codex', kind: 'agent', installed: true },
      { id: 'pi', displayName: 'Pi', kind: 'agent', installed: true },
    ],
    defaultAgent: 'pi',
    issueDefaultAgent: null,
    workspaces: [{ id: 'demo-ws-auto-quant', agents: ['codex', 'pi'] }],
    openAgentConfig: mocks.openAgentConfig,
    openHeadlessRun: mocks.openHeadlessRun,
  }),
}))

vi.mock('./workspace/api', () => ({
  getAgentReadiness: vi.fn().mockResolvedValue({ agents: {} }),
  getWorkspaceSessionDirectory: vi.fn().mockResolvedValue({ sessions: [] }),
}))

vi.mock('./MarkdownWhatEditor', () => ({
  MarkdownWhatEditor: ({ value }: { value: string }) => <div>{value}</div>,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('IssueDetail property controls', () => {
  it('names every editable property in the work-item rail', () => {
    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)

    expect(screen.getByRole('combobox', { name: 'Status' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Runtime' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Run model' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Run effort' })).toBeTruthy()
  })
})
