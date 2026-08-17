// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EntityDetail, EntityListItem } from '../api/entities'
import type { IssueDetail as IssueDetailData, IssueSnapshot } from '../api/issues'
import { i18n } from '../i18n'
import { TrackedPage } from './TrackedPage'

const trackedEntity: EntityListItem = {
  name: 'stock-vst',
  description: 'Vistra',
  type: 'asset',
  createdAt: 1,
  backlinkCount: 1,
}

const detail: EntityDetail = {
  entity: trackedEntity,
  backlinks: [{
    workspaceId: 'workspace-1',
    workspaceTag: 'power',
    path: 'research/power.md',
  }],
}

const issueSnapshot: IssueSnapshot = {
  workspaces: [{
    wsId: 'workspace-1',
    tag: 'power',
    status: 'ok',
    issues: [{
      id: 'power-watch',
      title: 'Power watch',
      status: 'in_progress',
      priority: 'high',
      assignee: '@human',
    }],
  }],
}

const issueDetail: IssueDetailData = {
  issue: {
    id: 'power-watch',
    title: 'Power watch',
    what: '# Power watch\n\nWatch the power complex and report material changes.',
    status: 'in_progress',
    priority: 'high',
    assignee: '@human',
  },
  runs: [],
}

const mocks = vi.hoisted(() => ({
  getEntity: vi.fn(),
  getGraph: vi.fn(),
  getIssue: vi.fn(),
  selectTracked: vi.fn(),
  selectIssue: vi.fn(),
  navigate: vi.fn(),
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
  refreshEntities: vi.fn(),
  entitiesState: {
    current: {
      entities: [] as EntityListItem[],
      loading: false,
      error: null as string | null,
      refreshing: false,
    },
  },
  issuesState: {
    current: {
      data: null as IssueSnapshot | null,
      error: null as string | null,
      loading: false,
    },
  },
  selectionState: {
    current: {
      selectedName: 'stock-vst' as string | null,
      selectedIssue: null as { workspaceId: string; issueId: string } | null,
    },
  },
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => mocks.navigate,
}))

vi.mock('../api', () => ({
  api: {
    entities: {
      get: mocks.getEntity,
      graph: mocks.getGraph,
    },
    issues: {
      getDetail: mocks.getIssue,
    },
  },
}))

vi.mock('../live/entities', () => ({
  entitiesLive: {
    useStore: (selector: (state: typeof mocks.entitiesState.current) => unknown) =>
      selector(mocks.entitiesState.current),
  },
  refreshEntities: mocks.refreshEntities,
}))

vi.mock('../live/tracked-selection', () => ({
  useTrackedSelection: (selector: (state: {
    selectedName: string | null
    selectedIssue: { workspaceId: string; issueId: string } | null
    select: typeof mocks.selectTracked
    selectIssue: typeof mocks.selectIssue
  }) => unknown) => selector({
    ...mocks.selectionState.current,
    select: mocks.selectTracked,
    selectIssue: mocks.selectIssue,
  }),
}))

vi.mock('../hooks/useIssues', () => ({
  useIssues: () => mocks.issuesState.current,
}))

vi.mock('../components/MarkdownContent', () => ({
  MarkdownContent: ({ text, variant }: { text: string; variant?: string }) => (
    <div data-testid="tracked-markdown" data-variant={variant}>
      {text.split('\n').filter(Boolean).map((line) => <p key={line}>{line}</p>)}
    </div>
  ),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: {
    openOrFocus: typeof mocks.openOrFocus
    setSidebar: typeof mocks.setSidebar
  }) => unknown) => selector({
    openOrFocus: mocks.openOrFocus,
    setSidebar: mocks.setSidebar,
  }),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.entitiesState.current = {
    entities: [trackedEntity],
    loading: false,
    error: null,
    refreshing: false,
  }
  mocks.issuesState.current = { data: null, error: null, loading: false }
  mocks.selectionState.current = { selectedName: 'stock-vst', selectedIssue: null }
  await i18n.changeLanguage('en')
  mocks.getEntity.mockResolvedValue(detail)
  mocks.getGraph.mockResolvedValue({ nodes: [], edges: [] })
  mocks.getIssue.mockResolvedValue(issueDetail)
})

afterEach(cleanup)

describe('TrackedPage artifact navigation', () => {
  it('opens a plain-note backlink with Tracked provenance', async () => {
    render(<TrackedPage />)

    const backlink = await screen.findByRole('button', {
      name: /research\/power\.md/,
    })
    expect(backlink.className).toContain('min-h-10')
    expect(within(backlink).getByText('research/power.md').className).toContain('break-all')
    expect(within(backlink).getAllByText('power')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'stock-vst' }).className).toContain('break-words')
    fireEvent.click(backlink)

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'file-viewer',
      params: {
        wsId: 'workspace-1',
        path: 'research/power.md',
        source: 'tracked',
        returnTrackedName: 'stock-vst',
      },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('tracked')
  })
})

describe('TrackedPage detail recovery', () => {
  it('surfaces a failed detail request and retries it', async () => {
    mocks.getEntity
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(detail)

    render(<TrackedPage />)

    const error = await screen.findByRole('alert')
    expect(error.textContent).toContain('Couldn’t load stock-vst')
    expect(error.textContent).toContain('temporarily unavailable')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'stock-vst' })).toBeTruthy()
    expect(mocks.getEntity).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('TrackedPage Issue anchors', () => {
  it('shows a lightweight Issue summary and defers the full surface to Details', async () => {
    mocks.issuesState.current = { data: issueSnapshot, error: null, loading: false }
    mocks.selectionState.current = {
      selectedName: null,
      selectedIssue: { workspaceId: 'workspace-1', issueId: 'power-watch' },
    }

    render(<TrackedPage />)

    expect(await screen.findByRole('heading', { name: 'Power watch' })).toBeTruthy()
    expect(screen.getByText('Watch the power complex and report material changes.')).toBeTruthy()
    expect(screen.getAllByText('Power watch')).toHaveLength(1)
    expect(screen.getByText('power')).toBeTruthy()
    expect(screen.getByTestId('tracked-markdown').getAttribute('data-variant')).toBe('reading')
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))

    expect(mocks.getIssue).toHaveBeenCalledWith('workspace-1', 'power-watch')
    expect(mocks.navigate).toHaveBeenCalledWith('/issues/workspace-1/power-watch')
  })

  it('keeps an Issue selection inside Graph mode until Details is opened', async () => {
    window.localStorage.setItem('openalice.tracked.view-mode.v1', 'graph')
    mocks.issuesState.current = { data: issueSnapshot, error: null, loading: false }
    mocks.selectionState.current = {
      selectedName: null,
      selectedIssue: { workspaceId: 'workspace-1', issueId: 'power-watch' },
    }

    render(<TrackedPage />)

    expect(await screen.findByRole('button', { name: /Power watch/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Graph' }).getAttribute('aria-pressed')).toBe('true')
    expect(mocks.getIssue).not.toHaveBeenCalled()
    expect(screen.getByText('Issue · power')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open details' }))
    expect(mocks.navigate).toHaveBeenCalledWith('/issues/workspace-1/power-watch')
  })
})

describe('TrackedPage collection recovery', () => {
  it('distinguishes an unavailable list from a genuinely empty watchlist', () => {
    mocks.entitiesState.current = {
      entities: [],
      loading: false,
      error: 'offline',
      refreshing: false,
    }

    render(<TrackedPage />)

    const error = screen.getByRole('alert')
    expect(error.textContent).toContain('Couldn’t load Tracked')
    expect(error.textContent).toContain('Nothing has been removed')
    expect(screen.queryByText('Nothing tracked yet.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.refreshEntities).toHaveBeenCalledTimes(1)
  })

  it('keeps stale entities visible while reporting a failed refresh', async () => {
    mocks.entitiesState.current = {
      entities: [trackedEntity],
      loading: false,
      error: 'offline',
      refreshing: false,
    }

    render(<TrackedPage />)

    expect(await screen.findByRole('heading', { name: 'stock-vst' })).toBeTruthy()
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('showing the last known tracked items')
    fireEvent.click(within(status).getByRole('button', { name: 'Retry' }))
    expect(mocks.refreshEntities).toHaveBeenCalledTimes(1)
  })
})
