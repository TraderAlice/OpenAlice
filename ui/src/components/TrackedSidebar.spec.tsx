// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EntityListItem } from '../api/entities'
import { i18n } from '../i18n'
import { TrackedSidebar } from './TrackedSidebar'

const trackedEntity: EntityListItem = {
  name: 'stock-vst',
  description: 'Vistra',
  type: 'asset',
  createdAt: 1,
  backlinkCount: 1,
}

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
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
    select: typeof mocks.select
  }) => unknown) => selector({
    selectedName: null,
    select: mocks.select,
  }),
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
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'tracked', params: {} })
    expect(onNavigate).toHaveBeenCalledOnce()
  })
})
