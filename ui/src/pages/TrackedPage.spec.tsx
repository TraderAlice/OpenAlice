// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    useStore: (selector: (state: { entities: EntityListItem[]; loading: boolean }) => unknown) =>
      selector({ entities: [trackedEntity], loading: false }),
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

beforeEach(async () => {
  vi.clearAllMocks()
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
