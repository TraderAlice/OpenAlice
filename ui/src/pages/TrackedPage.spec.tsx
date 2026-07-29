// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TrackedPage } from './TrackedPage'

const mocks = vi.hoisted(() => ({
  getEntity: vi.fn(),
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
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
    useStore: (selector: (state: {
      entities: Array<{
        name: string
        description: string
        type: 'asset'
        createdAt: number
        backlinkCount: number
      }>
      loading: boolean
    }) => unknown) => selector({
      entities: [{
        name: 'stock-vst',
        description: 'Vistra',
        type: 'asset',
        createdAt: 1,
        backlinkCount: 1,
      }],
      loading: false,
    }),
  },
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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getEntity.mockResolvedValue({
    entity: {
      name: 'stock-vst',
      description: 'Vistra',
      type: 'asset',
      createdAt: 1,
    },
    backlinks: [{
      workspaceId: 'workspace-1',
      workspaceTag: 'power',
      path: 'research/power.md',
    }],
  })
})

afterEach(cleanup)

describe('TrackedPage artifact navigation', () => {
  it('opens a plain-note backlink with Tracked provenance', async () => {
    render(<TrackedPage />)

    const backlink = await screen.findByRole('button', {
      name: /research\/power\.md/,
    })
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
