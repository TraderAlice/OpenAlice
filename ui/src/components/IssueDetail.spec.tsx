// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  IssueDetail as IssueDetailData,
  IssueProvenanceRecord,
} from '../api/issues'
import { IssueActivity, IssueDetail } from './IssueDetail'

const mocks = vi.hoisted(() => ({
  detectWorkspaceCredential: vi.fn().mockResolvedValue({
    configured: true,
    slug: 'longcat-1',
    model: 'LongCat-2.0',
    contextWindow: null,
    wireShape: 'openai-chat',
    reasoningMode: 'optional',
    reasoningDefaultEnabled: true,
  }),
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
  detectWorkspaceCredential: mocks.detectWorkspaceCredential,
  getAgentReadiness: vi.fn().mockResolvedValue({ agents: {} }),
  getWorkspaceSessionDirectory: vi.fn().mockResolvedValue({ sessions: [] }),
}))

vi.mock('./MarkdownWhatEditor', () => ({
  MarkdownWhatEditor: ({ value }: { value: string }) => <div>{value}</div>,
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('IssueActivity provenance identity', () => {
  it('shows Session details before an explicit Open conversation action', async () => {
    const record: IssueProvenanceRecord = {
      id: 'provenance-reconstructed',
      action: 'reconstructed',
      at: Date.now(),
      origin: {
        kind: 'session',
        workspaceId: 'ws-home',
        resumeId: 'resume-open-coral-harbor-j76vuu',
        agent: 'opencode',
      },
    }
    const onOpenSession = vi.fn(async () => {})

    render(
      <IssueActivity
        activity={[{ ...record, kind: 'change' }]}
        onOpenSession={onOpenSession}
        wsId="ws-home"
        issueId="audit"
        ownerResumeId={null}
        assignee="@workspace"
        onPosted={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    fireEvent.click(screen.getByRole('button', {
      name: 'Show Session details for opencode · resume-open-coral-harbor-j76vuu',
    }))
    expect(onOpenSession).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', {
      name: 'Session resume-open-coral-harbor-j76vuu',
    })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', {
      name: 'Session resume-open-coral-harbor-j76vuu',
    })).toBeNull()

    fireEvent.click(screen.getByRole('button', {
      name: 'Show Session details for opencode · resume-open-coral-harbor-j76vuu',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith(expect.objectContaining(record)))
  })
})

describe('IssueDetail property controls', () => {
  it('names every editable property and resolves inherited runtime defaults', async () => {
    render(<IssueDetail wsId="demo-ws-auto-quant" id="morning-scan" />)

    expect(screen.getByRole('combobox', { name: 'Status' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Runtime' })).toBeTruthy()
    const model = screen.getByRole('combobox', { name: 'Run model' }) as HTMLSelectElement
    const effort = screen.getByRole('combobox', { name: 'Run effort' }) as HTMLSelectElement
    await waitFor(() => {
      expect(model.selectedOptions[0]?.textContent).toBe('Default · LongCat-2.0')
      expect(effort.selectedOptions[0]?.textContent).toBe('Default · thinking on')
    })

    fireEvent.change(model, { target: { value: 'custom' } })
    expect(screen.getByRole('textbox', { name: 'Custom run model' })).toBeTruthy()
  })
})
