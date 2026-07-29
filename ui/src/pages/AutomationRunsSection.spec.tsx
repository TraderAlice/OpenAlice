// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HeadlessListSnapshot, HeadlessTaskRecord } from '../api/headless'
import type { Workspace } from '../components/workspace/api'
import { AutomationRunsSection } from './AutomationRunsSection'

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  output: vi.fn(),
  openHeadlessRun: vi.fn(),
  workspaces: [] as unknown[],
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
