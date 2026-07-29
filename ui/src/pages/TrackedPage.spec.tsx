// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EntityDetail, EntityListItem } from '../api/entities'
import { i18n } from '../i18n'
import { TrackedPage } from './TrackedPage'

const trackedEntity: EntityListItem = {
  name: 'stock-vst',
  description: 'Vistra',
  type: 'asset',
  createdAt: 1,
  backlinkCount: 0,
}

const detail: EntityDetail = {
  entity: trackedEntity,
  backlinks: [],
}

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  selectedName: 'stock-vst',
}))

vi.mock('../api', () => ({
  api: {
    entities: {
      get: mocks.get,
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
  useTrackedSelection: (selector: (state: { selectedName: string }) => unknown) =>
    selector({ selectedName: mocks.selectedName }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: vi.fn(),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('TrackedPage detail recovery', () => {
  it('surfaces a failed detail request and retries it', async () => {
    mocks.get
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(detail)

    render(<TrackedPage />)

    const error = await screen.findByRole('alert')
    expect(error.textContent).toContain('Couldn’t load stock-vst')
    expect(error.textContent).toContain('temporarily unavailable')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'stock-vst' })).toBeTruthy()
    expect(mocks.get).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
