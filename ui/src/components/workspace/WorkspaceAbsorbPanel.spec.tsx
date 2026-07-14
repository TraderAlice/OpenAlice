import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyWorkspaceAbsorb,
  getWorkspaceAbsorbPlan,
  type Workspace,
  type WorkspaceAbsorbPlan,
} from './api'
import { WorkspaceAbsorbPanel } from './WorkspaceAbsorbPanel'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getWorkspaceAbsorbPlan: vi.fn(),
  applyWorkspaceAbsorb: vi.fn(),
}))

const target = workspace('target-workspace', 'target-desk')
const source = workspace('source-workspace', 'source-desk')

const plan: WorkspaceAbsorbPlan = {
  source: { id: source.id, tag: source.tag },
  target: { id: target.id, tag: target.tag },
  importRoot: 'imports/source-desk-kspace',
  planDigest: 'absorb-preview-1',
  blocked: false,
  blockers: [],
  activity: {
    source: { busy: false, sessions: [], headless: [] },
    target: { busy: false, sessions: [], headless: [] },
  },
  sourceInventory: {
    sessions: 2,
    resumeIds: 2,
    openIssues: ['review-thesis'],
    scheduledIssues: ['daily-scan'],
    dirtyFiles: 3,
  },
  files: [
    {
      path: 'research/new.md', status: 'ready', operation: 'add',
      sourcePreview: 'new', targetPreview: null,
      sourceTruncated: false, targetTruncated: false,
      sourceSize: 3, targetSize: null, canUseSource: true,
      keepBothPath: 'imports/source-desk-kspace/research/new.md',
    },
    {
      path: 'research/watchlist.md', status: 'conflict', operation: 'choose',
      sourcePreview: 'source watchlist', targetPreview: 'target watchlist',
      sourceTruncated: false, targetTruncated: false,
      sourceSize: 16, targetSize: 16, canUseSource: true,
      keepBothPath: 'imports/source-desk-kspace/research/watchlist.md',
    },
  ],
  summary: { ready: 1, duplicates: 0, conflicts: 1, excluded: 9, bytes: 19 },
}

beforeEach(() => {
  vi.mocked(getWorkspaceAbsorbPlan).mockResolvedValue(plan)
  vi.mocked(applyWorkspaceAbsorb).mockResolvedValue({
    sourceWorkspaceId: source.id,
    targetWorkspaceId: target.id,
    commit: 'abc12345deadbeef',
    changedPaths: ['research/new.md', plan.files[1]!.keepBothPath],
    skippedPaths: [],
    departedDir: `/departed/${source.id}`,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkspaceAbsorbPanel', () => {
  it('makes direction and retirement explicit and defaults collisions to keep both', async () => {
    render(<WorkspaceAbsorbPanel target={target} workspaces={[target, source]} onWorkspaceChanged={vi.fn()} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Workspace to absorb'), { target: { value: source.id } })

    expect(await screen.findByText('What retires with source-desk')).toBeTruthy()
    expect(screen.getByText(/2 Session records.*1 schedule stopped/)).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Keep both' }).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('button', { name: 'Absorb and archive source' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('applies the reviewed digest and shows the durable audit result', async () => {
    const onWorkspaceChanged = vi.fn()
    render(<WorkspaceAbsorbPanel target={target} workspaces={[target, source]} onWorkspaceChanged={onWorkspaceChanged} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Workspace to absorb'), { target: { value: source.id } })
    await screen.findByText('Paths that need a decision')
    fireEvent.click(screen.getByRole('button', { name: 'Absorb and archive source' }))

    await waitFor(() => expect(applyWorkspaceAbsorb).toHaveBeenCalledWith(
      target.id,
      source.id,
      plan.planDigest,
      { 'research/watchlist.md': 'both' },
    ))
    expect(await screen.findByText('Workspace absorbed')).toBeTruthy()
    expect(screen.getByText('abc12345deadbeef')).toBeTruthy()
    expect(onWorkspaceChanged).toHaveBeenCalled()
  })

  it('names the exact live Session instead of showing a generic blocker', async () => {
    vi.mocked(getWorkspaceAbsorbPlan).mockResolvedValue({
      ...plan,
      blocked: true,
      blockers: ['source_active_sessions'],
      activity: {
        ...plan.activity,
        source: {
          busy: true,
          sessions: [{
            sessionId: 'pi-live', resumeId: 'resume-live', name: 'p3', agent: 'pi',
            surface: 'webpi', startedAt: 1,
          }],
          headless: [],
        },
      },
    })
    render(<WorkspaceAbsorbPanel target={target} workspaces={[target, source]} onWorkspaceChanged={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Workspace to absorb'), { target: { value: source.id } })

    expect(await screen.findByText(/source-desk: p3 \(pi, webpi\)/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Absorb and archive source' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

function workspace(id: string, tag: string): Workspace {
  return {
    id,
    tag,
    dir: `/workspaces/${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    template: 'chat',
    agents: ['pi'],
    sessions: [],
  }
}
