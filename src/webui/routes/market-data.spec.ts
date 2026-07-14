import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineContext } from '../../core/types.js'
import { createMarketDataRoutes } from './config.js'

const { listVendors } = vi.hoisted(() => ({
  listVendors: vi.fn(),
}))

vi.mock('../../domain/market-data/vendors.js', () => ({
  listMarketVendors: listVendors,
}))

describe('market-data routes', () => {
  beforeEach(() => {
    listVendors.mockReset()
  })

  it('serves the self-described provider vendor catalog', async () => {
    const vendors = [{
      id: 'tradingview',
      name: 'TradingView Free',
      enabled: false,
      alwaysOn: false,
      keyless: true,
      coverage: 'Global chart feed',
      howToUse: 'Use qualified symbols',
    }]
    listVendors.mockResolvedValue(vendors)
    const bbEngine = {} as EngineContext['bbEngine']

    const response = await createMarketDataRoutes({ bbEngine } as EngineContext).request('/vendors')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ vendors })
    expect(listVendors).toHaveBeenCalledWith(bbEngine)
  })
})
