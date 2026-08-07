// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EntityListItem } from '../api/entities'
import type { IssueListItem, IssueSnapshot } from '../api/issues'
import { i18n } from '../i18n'
import { TrackedSidebar } from './TrackedSidebar'

const trackedEntity: EntityListItem = {
  name: 'stock-vst',
  description: 'Vistra',
  type: 'asset',
  createdAt: 1,
  backlinkCount: 1,
}

const trackedIssue: IssueListItem = {
  id: 'power-watch',
  title: 'Power watch',
  status: 'in_progress',
  priority: 'high',
  assignee: '@human',
}

const issueSnapshot: IssueSnapshot = {
  workspaces: [{ wsId: 'workspace-1', tag: 'power', status: 'ok', issues: [trackedIssue] }],
}

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  selectIssue: vi.fn(),
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
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
}))

vi.mock('../live/entities', () => ({
  entitiesLive: {
    useStore: (selector: (state: typeof mocks.entitiesState.current) => unknown) =>
      selector(mocks.entitiesState.current),
  },
}))

vi.mock('../live/tracked-selection', () => ({
  useTrackedSelection: (selector: (state: {
    selectedName: string | null
    selectedIssue: { workspaceId: string; issueId: string } | null
    select: typeof mocks.select
    selectIssue: typeof mocks.selectIssue
  }) => unknown) => selector({
    selectedName: null,
    selectedIssue: null,
    select: mocks.select,
    selectIssue: mocks.selectIssue,
  }),
}))

vi.mock('../hooks/useIssues', () => ({
  useIssues: () => mocks.issuesState.current,
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
  mocks.entitiesState.current = {
    entities: [],
    loading: false,
    error: null,
    refreshing: false,
  }
  mocks.issuesState.current = { data: null, error: null, loading: false }
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('TrackedSidebar collection failure', () => {
  it('reports an unavailable list without duplicating the page recovery action', () => {
    mocks.entitiesState.current = {
      entities: [],
      loading: false,
      error: 'offline',
      refreshing: false,
    }

    render(<TrackedSidebar />)

    expect(screen.getByText('Couldn’t load Tracked')).toBeTruthy()
    expect(screen.queryByText('Nothing tracked yet.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('keeps stale rows available without adding a second warning', () => {
    mocks.entitiesState.current = {
      entities: [trackedEntity],
      loading: false,
      error: 'offline',
      refreshing: false,
    }

    render(<TrackedSidebar />)

    expect(screen.getByText('vst')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('TrackedSidebar navigation', () => {
  it('notifies the page shell after selecting an entity', () => {
    mocks.entitiesState.current = {
      entities: [trackedEntity],
      loading: false,
      error: null,
      refreshing: false,
    }
    const onNavigate = vi.fn()

    render(<TrackedSidebar onNavigate={onNavigate} />)
    mocks.select.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'stockvst1' }))

    expect(mocks.select).toHaveBeenCalledWith('stock-vst')
    expect(mocks.setSidebar).toHaveBeenCalledWith('tracked')
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'tracked',
      params: { entity: 'stock-vst' },
    })
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('shows Workspace-owned Issues as Tracked anchors before opening details', () => {
    mocks.entitiesState.current = {
      entities: [trackedEntity],
      loading: false,
      error: null,
      refreshing: false,
    }
    mocks.issuesState.current = { data: issueSnapshot, error: null, loading: false }
    const onNavigate = vi.fn()

    render(<TrackedSidebar onNavigate={onNavigate} />)
    mocks.selectIssue.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /power.*Power watch/i }))

    expect(mocks.selectIssue).toHaveBeenCalledWith({ workspaceId: 'workspace-1', issueId: 'power-watch' })
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'tracked',
      params: { workspace: 'workspace-1', issue: 'power-watch' },
    })
    expect(mocks.setSidebar).toHaveBeenCalledWith('tracked')
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('restores an Issue selection supplied by the Tracked URL', () => {
    mocks.issuesState.current = { data: issueSnapshot, error: null, loading: false }

    render(
      <TrackedSidebar routeSelection={{ workspace: 'workspace-1', issue: 'power-watch' }} />,
    )

    expect(mocks.selectIssue).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      issueId: 'power-watch',
    })
  })
})
