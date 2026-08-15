// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { OfficeRuntimeSection } from './OfficeRuntimeSection'

const query = vi.fn()

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
    render(<OfficeRuntimeSection />)
    expect(await screen.findByText('@resume-alice')).toBeTruthy()
    expect(screen.getByText(/webpi/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Runs' })).toBeTruthy()
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
    render(<OfficeRuntimeSection />)
    expect(await screen.findByText('workspace_list · completed')).toBeTruthy()
    expect(screen.getByText('Desk is clear.')).toBeTruthy()
    expect(screen.getByText(/1 text · 1 tools/)).toBeTruthy()
  })
})
