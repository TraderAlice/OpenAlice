// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

function output(taskId: string, assistantText = 'Run completed with a concise answer.') {
  return {
    taskId,
    status: 'done' as const,
    structured: {
      schemaVersion: 1 as const,
      assistantText,
      blocks: [],
      metrics: { textBlocks: 1, toolCalls: 0, toolFailures: 0 },
      truncated: false,
    },
    stdout: null,
    stderr: null,
  }
}

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  mocks.workspaces = [liveWorkspace]
  mocks.issues = null
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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
  it('presents operational context as one compact summary strip', async () => {
    const current = snapshot([task({ status: 'done' })])
    current.page = { total: 147, hasMore: true, nextCursor: 'run-default' }
    current.summary = { done: 105, needsAttention: 42 }
    mocks.snapshot.mockResolvedValue(current)

    render(<AutomationRunsSection />)

    const summary = await screen.findByTestId('runs-summary')
    expect(summary.className).toContain('divide-x')
    expect(summary.className).toContain('border-y')
    expect(summary.className).not.toContain('grid-cols-3')
    expect(within(summary).getByText('Workers')).toBeTruthy()
    expect(within(summary).getByText('42 attention')).toBeTruthy()
    expect(within(summary).getByText('CLI formats')).toBeTruthy()
    expect(within(summary).getByText('No workers active')).toBeTruthy()
    expect(within(summary).getByText('Showing 1 · 105 completed · 42 need attention')).toBeTruthy()
  })

  it('gives expanded run actions and pagination mobile-sized touch targets', async () => {
    const issueTask = task({
      taskId: 'run-touch-targets',
      status: 'done',
      resumable: true,
      trigger: {
        kind: 'issue',
        workspaceId: liveWorkspace.id,
        issueId: 'daily-risk-scan',
      },
    })
    const current = snapshot([issueTask])
    current.page = { total: 26, hasMore: true, nextCursor: issueTask.taskId }
    mocks.snapshot.mockResolvedValue(current)
    mocks.output.mockResolvedValue(output(issueTask.taskId, ''))

    render(<AutomationRunsSection />)

    fireEvent.click(await screen.findByRole('button', {
      name: 'Run details, done: daily-risk-scan. codex in quant-desk.',
    }))

    expect(screen.getByText('Task instructions').className).toContain('min-h-10')
    expect(screen.getByRole('button', { name: 'Open Issue' }).className).toContain('min-h-10')
    expect(screen.getByRole('button', { name: 'Open as session' }).className).toContain('min-h-10')
    expect((await screen.findByText('Runtime diagnostics')).className).toContain('min-h-10')
    expect(screen.getByTestId('runs-load-more').className).toContain('min-h-10')
  })

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

  it('uses one divided activity list instead of wrapping every run in a card', async () => {
    mocks.snapshot.mockResolvedValue(snapshot([
      task({ taskId: 'run-one' }),
      task({ taskId: 'run-two', prompt: 'Prepare the close summary.' }),
    ]))

    render(<AutomationRunsSection />)

    const list = await screen.findByTestId('runs-list')
    expect(list.className).toContain('divide-y')
    expect(list.className).toContain('border-y')
    for (const article of list.querySelectorAll('article')) {
      expect(article.className).not.toContain('rounded-xl')
      expect(article.className).not.toContain('border border-border')
    }
  })

  it('keeps session-open progress and errors beside the run and prevents duplicate opens', async () => {
    const resumable = task({
      taskId: 'run-open',
      status: 'done',
      resumable: true,
    })
    let rejectOpen: ((reason?: unknown) => void) | undefined
    mocks.snapshot.mockResolvedValue(snapshot([resumable]))
    mocks.output.mockResolvedValue(output(resumable.taskId))
    mocks.openHeadlessRun.mockReturnValue(new Promise((_, reject) => {
      rejectOpen = reject
    }))

    render(<AutomationRunsSection />)
    fireEvent.click(await screen.findByRole('button', { name: /^Run details, done:/ }))

    const openButton = screen.getByRole('button', { name: 'Open as session' })
    fireEvent.click(openButton)
    fireEvent.click(openButton)

    expect(mocks.openHeadlessRun).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Opening…' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => rejectOpen?.(new Error('Session service is unavailable')))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not open this run as a session: Session service is unavailable',
    )
    expect((screen.getByRole('button', { name: 'Open as session' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/Refresh failed/)).toBeNull()
  })

  it('retries a completed run output failure in place', async () => {
    const completed = task({ taskId: 'run-output-retry', status: 'done' })
    mocks.snapshot.mockResolvedValue(snapshot([completed]))
    mocks.output
      .mockRejectedValueOnce(new Error('Structured output is temporarily unavailable'))
      .mockResolvedValueOnce(output(completed.taskId, 'Recovered answer'))

    render(<AutomationRunsSection />)
    fireEvent.click(await screen.findByRole('button', { name: /^Run details, done:/ }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Output unavailable: Structured output is temporarily unavailable',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry output' }))

    expect(await screen.findByText('Recovered answer')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(/Output unavailable/)).toBeNull())
    expect(mocks.output).toHaveBeenCalledTimes(2)
  })

  it('keeps the last successful running output visible when a live poll fails', async () => {
    const intervalCallbacks: Array<() => void> = []
    vi.spyOn(globalThis, 'setInterval').mockImplementation((handler: TimerHandler) => {
      if (typeof handler === 'function') intervalCallbacks.push(handler as () => void)
      return intervalCallbacks.length as unknown as ReturnType<typeof setInterval>
    })
    const running = task({ taskId: 'run-stale-output' })
    mocks.snapshot.mockResolvedValue(snapshot([running]))
    mocks.output
      .mockResolvedValueOnce(output(running.taskId, 'Last known answer'))
      .mockRejectedValueOnce(new Error('Live output connection dropped'))

    render(<AutomationRunsSection />)
    fireEvent.click(await screen.findByRole('button', { name: /^Run details, running:/ }))
    expect(await screen.findByText('Last known answer')).toBeTruthy()

    expect(intervalCallbacks.length).toBeGreaterThanOrEqual(2)
    await act(async () => {
      for (const callback of intervalCallbacks) callback()
      await Promise.resolve()
    })

    expect(await screen.findByText('Last known answer')).toBeTruthy()
    expect((await screen.findByRole('status')).textContent).toContain(
      'Live update paused: Live output connection dropped. Showing the last available output.',
    )
  })
})
