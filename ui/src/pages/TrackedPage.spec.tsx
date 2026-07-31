// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EntityDetail, EntityListItem } from '../api/entities'
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

const mocks = vi.hoisted(() => ({
  getEntity: vi.fn(),
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
}))

vi.mock('../api', () => ({
  api: {
    entities: {
      get: mocks.getEntity,
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
    selectedName: string
  }) => unknown) => selector({ selectedName: 'stock-vst' }),
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
    entities: [trackedEntity],
    loading: false,
    error: null,
    refreshing: false,
  }
  await i18n.changeLanguage('en')
  mocks.getEntity.mockResolvedValue(detail)
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
