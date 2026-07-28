import { describe, it, expect } from 'vitest'
import { createQuantTools } from './quant.js'
import type { BarService } from '@/domain/market-data/bars/index'

const mockSvc = {
  searchBarSources: async (q: string) => [
    { barId: `yfinance|${q}`, source: 'vendor', sourceId: 'yfinance', symbol: q, assetClass: 'equity', label: q, barCapability: 'delayed' },
  ],
  getBars: async () => ({
    bars: [
      { date: '2024-01-01', open: 1, high: 1, low: 1, close: 2, volume: 1 },
      { date: '2024-01-02', open: 1, high: 1, low: 1, close: 4, volume: 1 },
    ],
    meta: { symbol: 'X', from: '2024-01-01', to: '2024-01-02', bars: 2, source: 'vendor', sourceId: 'yfinance', barId: 'yfinance|X' },
  }),
} as unknown as BarService

const ctx = { toolCallId: 't', messages: [] as never, abortSignal: undefined as never }

describe('quant tools wiring', () => {
  it('searchBars returns barId candidates from the bar service', async () => {
    const { searchBars } = createQuantTools({ barService: mockSvc })
    const r = (await searchBars.execute!({ query: 'AAPL' }, ctx)) as { candidates: unknown[]; count: number }
    expect(r.count).toBe(1)
    expect(r.candidates[0]).toMatchObject({ barId: 'yfinance|AAPL', source: 'vendor', barCapability: 'delayed' })
  })

  it('calculateQuant runs a script end-to-end via the bar service', async () => {
    const { calculateQuant } = createQuantTools({ barService: mockSvc })
    const r = (await calculateQuant.execute!({ script: `s = bars("yfinance|X","1d",asset="equity")\ns.close[-1]` }, ctx)) as { value: number }
    expect(r.value).toBe(4)
  })

  it('calculateQuant preserves each interval provenance for a repeated barId', async () => {
    const { calculateQuant } = createQuantTools({ barService: mockSvc })
    const r = (await calculateQuant.execute!({
      script: `h1 = bars("yfinance|X","1h",asset="equity")
h4 = bars("yfinance|X","4h",asset="equity")
{ "1h": h1.close[-1], "4h": h4.close[-1] }`,
      dates: true,
    }, ctx)) as { dataRange: Record<string, { interval?: string }>; dates: Record<string, string[]> }

    expect(Object.keys(r.dataRange)).toEqual(['yfinance|X@1h', 'yfinance|X@4h'])
    expect(r.dataRange['yfinance|X@1h'].interval).toBe('1h')
    expect(r.dataRange['yfinance|X@4h'].interval).toBe('4h')
    expect(Object.keys(r.dates)).toEqual(['yfinance|X@1h', 'yfinance|X@4h'])
  })
})
