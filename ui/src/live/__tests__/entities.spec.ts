// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EntityListItem } from '../../api/entities'
import { entitiesLive, refreshEntities } from '../entities'

const mocks = vi.hoisted(() => ({
  listEntities: vi.fn(),
}))

vi.mock('../../api', () => ({
  api: {
    entities: {
      list: mocks.listEntities,
    },
  },
}))

const entity: EntityListItem = {
  name: 'stock-vst',
  description: 'Vistra',
  type: 'asset',
  createdAt: 1,
  backlinkCount: 1,
}

let unsubscribe: (() => void) | null = null

afterEach(() => {
  unsubscribe?.()
  unsubscribe = null
  vi.clearAllMocks()
})

describe('entitiesLive refresh recovery', () => {
  it('reports initial failure, clears it after retry, and preserves stale entities on later failure', async () => {
    mocks.listEntities
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ entities: [entity] })
      .mockRejectedValueOnce(new Error('offline again'))

    unsubscribe = entitiesLive.subscribe(() => undefined)

    await vi.waitFor(() => {
      expect(entitiesLive.getState()).toMatchObject({
        entities: [],
        loading: false,
        error: 'offline',
        refreshing: false,
      })
    })

    refreshEntities()
    expect(entitiesLive.getState().refreshing).toBe(true)
    await vi.waitFor(() => {
      expect(entitiesLive.getState()).toMatchObject({
        entities: [entity],
        loading: false,
        error: null,
        refreshing: false,
      })
    })

    refreshEntities()
    await vi.waitFor(() => {
      expect(entitiesLive.getState()).toMatchObject({
        entities: [entity],
        loading: false,
        error: 'offline again',
        refreshing: false,
      })
    })
  })
})
