import { afterEach, describe, expect, it, vi } from 'vitest'

import { tradingApi } from './trading'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('tradingApi contract search', () => {
  it('can scope broker contract discovery to the open account', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      count: 0,
      results: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await tradingApi.searchContracts('AAPL', undefined, 'alpaca-paper')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/trading/contracts/search?pattern=AAPL&source=alpaca-paper',
      undefined,
    )
  })
})
