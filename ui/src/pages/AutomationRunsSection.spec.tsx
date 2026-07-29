// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HeadlessListSnapshot, HeadlessTaskRecord } from '../api/headless'
import type { Workspace } from '../components/workspace/api'
import { AutomationRunsSection } from './AutomationRunsSection'

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  output: vi.fn(),
  openHeadlessRun: vi.fn(),
  openOrFocus: vi.fn(),
  workspaces: [] as unknown[],
  issues: null as import('../api/issues').IssueSnapshot | null,
}))

vi.mock('../api', () => ({
  api: {
    headless: {
      snapshot: mocks.snapshot,
      output: mocks.output,
    },
  },
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: mocks.workspaces,
    openHeadlessRun: mocks.openHeadlessRun,
  }),
}))

vi.mock('../hooks/useIssues', () => ({
  useIssues: () => ({ data: mocks.issues, error: null, loading: mocks.issues === null }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (
    selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown,
  ) => selector({ openOrFocus: mocks.openOrFocus }),
}))

const liveWorkspace: Workspace = {
  id: 'ws-live-internal-id',
  tag: 'quant-desk',
  displayName: 'Quant research',
  dir: '/tmp/quant-desk',
  createdAt: '2026-07-29T00:00:00.000Z',
  template: 'chat',
  agents: ['codex'],
  sessions: [],
}

function task(overrides: Partial<HeadlessTaskRecord>): HeadlessTaskRecord {
  return {
    taskId: 'run-default',
    resumeId: 'resume-default',
    resumable: false,
    wsId: liveWorkspace.id,
    agent: 'codex',
    prompt: 'Review the latest market snapshot.',
    status: 'running',
    startedAt: Date.now() - 1_000,
    ...overrides,
  }
}

function snapshot(tasks: HeadlessTaskRecord[]): HeadlessListSnapshot {
  return {
    tasks,
    page: { total: tasks.length, hasMore: false, nextCursor: null },
    summary: { done: 0, needsAttention: 0 },
    capacity: {
      running: tasks.filter((item) => item.status === 'running').length,
      limit: 8,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.workspaces = [liveWorkspace]
  mocks.issues = null
})

afterEach(cleanup)

describe('AutomationRunsSection workspace identity', () => {
  it('shows the current Workspace tag instead of its internal id', async () => {
    mocks.snapshot.mockResolvedValue(snapshot([task({})]))

    render(<AutomationRunsSection />)

    expect(await screen.findByText('quant-desk')).toBeTruthy()
    expect(screen.queryByText(liveWorkspace.id)).toBeNull()
    expect(screen.getByTitle('Quant research (quant-desk)')).toBeTruthy()
  })

  it('keeps the full stored id when the Workspace no longer exists', async () => {
    const departedId = 'ws-departed-full-internal-id'
    mocks.snapshot.mockResolvedValue(snapshot([
      task({ taskId: 'run-departed', wsId: departedId }),
    ]))

    render(<AutomationRunsSection />)

    expect(await screen.findByText(departedId)).toBeTruthy()
    expect(screen.getByTitle(departedId).className).toContain('font-mono')
  })

  it('uses the owning Issue as the primary run identity and links back to it', async () => {
    mocks.issues = {
      workspaces: [{
        wsId: liveWorkspace.id,
        tag: liveWorkspace.tag,
        status: 'ok',
        issues: [{
          id: 'daily-risk-scan',
          title: 'Daily portfolio risk scan',
          status: 'todo',
          priority: 'high',
          assignee: '@workspace',
        }],
      }],
    }
    mocks.snapshot.mockResolvedValue(snapshot([
      task({
        taskId: 'run-issue',
        prompt: 'Inspect every live position and report only material changes.',
        trigger: {
          kind: 'issue',
          workspaceId: liveWorkspace.id,
          issueId: 'daily-risk-scan',
        },
      }),
    ]))

    render(<AutomationRunsSection />)

    const issueTitle = await screen.findByText('Daily portfolio risk scan')
    expect(screen.getByText('Issue')).toBeTruthy()
    expect(screen.getByText('Inspect every live position and report only material changes.')).toBeTruthy()
    expect(screen.getByRole('button', {
      name: 'Run details, running: Daily portfolio risk scan. codex in quant-desk.',
    })).toBeTruthy()

    const article = issueTitle.closest('article')
    expect(article).toBeTruthy()
    fireEvent.click(within(article as HTMLElement).getAllByRole('button')[0]!)
    fireEvent.click(within(article as HTMLElement).getByRole('button', { name: 'Open Issue' }))

    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'issue-detail',
      params: { wsId: liveWorkspace.id, id: 'daily-risk-scan' },
    })
  })

  it('falls back to the stable Issue id when the Issue is no longer in the board', async () => {
    mocks.issues = { workspaces: [] }
    mocks.snapshot.mockResolvedValue(snapshot([
      task({
        taskId: 'run-departed-issue',
        trigger: {
          kind: 'issue',
          workspaceId: liveWorkspace.id,
          issueId: 'departed-daily-scan',
        },
      }),
    ]))

    render(<AutomationRunsSection />)

    expect((await screen.findByText('departed-daily-scan')).className).toContain('font-mono')
  })

  it('identifies an Issue comment follow-up as a reply to its owning Issue', async () => {
    mocks.issues = {
      workspaces: [{
        wsId: liveWorkspace.id,
        tag: liveWorkspace.tag,
        status: 'ok',
        issues: [{
          id: 'daily-risk-scan',
          title: 'Daily portfolio risk scan',
          status: 'todo',
          priority: 'high',
          assignee: '@workspace',
        }],
      }],
    }
    mocks.snapshot.mockResolvedValue(snapshot([
      task({
        taskId: 'run-issue-reply',
        prompt: 'Reconstruct the Issue context and answer the new comment.',
        inquiry: {
          subject: {
            kind: 'issue',
            workspaceId: liveWorkspace.id,
            issueId: 'daily-risk-scan',
            relation: 'owner',
            commentId: 'comment-1',
          },
          question: 'What changed?',
          resolution: { mode: 'reconstructed', reason: 'non-session-origin' },
        },
      }),
    ]))

    render(<AutomationRunsSection />)

    expect(await screen.findByText('Daily portfolio risk scan')).toBeTruthy()
    expect(screen.getByText('Reply')).toBeTruthy()
  })
})

describe('AutomationRunsSection run controls', () => {
  it('gives long task instructions a concise accessible name without hiding the visible prompt', async () => {
    const omittedTail = 'TAIL_MARKER_THAT_MUST_NOT_BE_READ_FOR_EVERY_RUN'
    const prompt = `Review the latest market snapshot and summarize material changes. ${'Include supporting detail. '.repeat(12)}${omittedTail}`
    mocks.snapshot.mockResolvedValue(snapshot([task({ prompt })]))

    render(<AutomationRunsSection />)

    const control = await screen.findByRole('button', { name: /^Run details, running:/ })
    const accessibleName = control.getAttribute('aria-label')
    expect(accessibleName).toContain('Review the latest market snapshot')
    expect(accessibleName).toContain('codex in quant-desk')
    expect(accessibleName).not.toContain(omittedTail)
    expect(accessibleName?.length).toBeLessThan(160)
    expect(screen.getByText(prompt)).toBeTruthy()

    control.focus()
    await userEvent.keyboard('{Enter}')
    expect(control.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Task instructions')).toBeTruthy()
  })

  it('labels an empty stored prompt without exposing a blank control', async () => {
    mocks.snapshot.mockResolvedValue(snapshot([task({ prompt: '' })]))

    render(<AutomationRunsSection />)

    expect(await screen.findByRole('button', {
      name: 'Run details, running: Untitled task. codex in quant-desk.',
    })).toBeTruthy()
  })
})
