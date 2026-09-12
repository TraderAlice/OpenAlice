import { describe, expect, it, vi } from 'vitest'
import type { BarService, OhlcvBar } from '../market-data/bars/index.js'
import type { EquityClientLike } from '../market-data/client/types.js'
import type { ReferenceDataService } from '../market-data/reference/types.js'
import { createMarketMonitorService } from './service.js'
import type { MarketMonitorStore } from './store.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS, type MarketMonitorAlert, type MarketMonitorReceipt, type MarketMonitorSnapshot } from './types.js'

function bars(count: number, step: number): OhlcvBar[] {
  return Array.from({ length: count }, (_, index) => ({ date: new Date(Date.parse('2026-01-01T00:00:00Z') + index * step).toISOString(), open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 1000 + index }))
}

function memoryStore(): MarketMonitorStore & { data: { snapshots: MarketMonitorSnapshot[]; alerts: MarketMonitorAlert[]; receipts: MarketMonitorReceipt[] } } {
  const data = { snapshots: [] as MarketMonitorSnapshot[], alerts: [] as MarketMonitorAlert[], receipts: [] as MarketMonitorReceipt[] }
  let settings = { ...DEFAULT_MARKET_MONITOR_SETTINGS }
  const series = new Map<string, MarketMonitorSnapshot['chart']>()
  return {
    data,
    settings: async () => settings,
    saveSettings: async (next) => { settings = next },
    snapshots: async (asset, limit = 100) => data.snapshots.filter((row) => !asset || row.asset === asset).slice(-limit),
    appendSnapshot: async (row) => { data.snapshots.push(row) },
    alerts: async (asset, limit = 100) => data.alerts.filter((row) => !asset || row.asset === asset).slice(-limit),
    appendAlert: async (row) => { data.alerts.push(row) },
    receipts: async (asset, limit = 100) => data.receipts.filter((row) => !asset || row.asset === asset).slice(-limit),
    appendReceipt: async (row) => { data.receipts.push(row) },
    latestSeries: async (asset) => series.get(asset) ?? null,
    saveLatestSeries: async (asset, chart) => { series.set(asset, chart) },
  }
}

function dependencies(hourly = true) {
  const daily = bars(90, 86400000)
  const intraday = bars(48, 3600000)
  const barService = { getBars: vi.fn(async (_ref, opts: { interval: string }) => {
    if (opts.interval === '1h' && !hourly) throw new Error('hourly unavailable')
    const rows = opts.interval === '1h' ? intraday : daily
    return { bars: rows, meta: { symbol: 'TSLA', from: rows[0].date, to: rows.at(-1)!.date, bars: rows.length, source: 'vendor' as const, sourceId: 'yfinance', provider: 'yfinance', interval: opts.interval } }
  }) } as unknown as BarService
  const equityClient = {
    getKeyMetrics: vi.fn(async () => [{ market_cap: 1e12, price_to_earnings: 80 }]),
    getEstimateConsensus: vi.fn(async () => [{ target_consensus: 350 }]),
    getShareStatistics: vi.fn(async () => [{ short_percent_of_float: 0.03 }]),
  } as unknown as EquityClientLike
  const reference = { calendar: vi.fn(async () => ({ earnings: [], ipos: [], dividends: [], window: { start: '2026-01-01', end: '2026-04-01' }, meta: { provider: 'test', asOf: '2026-01-01' } })) } as unknown as ReferenceDataService
  return { barService, equityClient, reference }
}

describe('market monitor service', () => {
  it('stores one semantic observation and records duplicate scan receipts', async () => {
    const store = memoryStore()
    const service = createMarketMonitorService({ ...dependencies(), store, now: () => new Date('2026-04-01T00:00:00Z') })
    expect((await service.scan('TSLA', 'manual')).stored).toBe(true)
    expect((await service.scan('TSLA', 'scheduled')).stored).toBe(false)
    expect(store.data.snapshots).toHaveLength(1)
    expect(store.data.snapshots[0].chart.daily).toEqual([])
    expect((await service.snapshots('TSLA', 1))[0].chart.daily).toHaveLength(90)
    expect(store.data.receipts.map((row) => [row.trigger, row.outcome])).toEqual([['manual', 'stored'], ['scheduled', 'duplicate']])
  })

  it('keeps an unavailable hourly source explicit instead of using daily bars', async () => {
    const store = memoryStore()
    const service = createMarketMonitorService({ ...dependencies(false), store, now: () => new Date('2026-04-01T00:00:00Z') })
    const result = await service.scan('TSLA', 'manual')
    expect(result.snapshot.metrics.intraday.available).toBe(false)
    expect(result.snapshot.chart.intraday).toEqual([])
    expect(result.snapshot.sourceHealth.find((source) => source.id === 'intraday-bars')?.status).toBe('unavailable')
  })

  it('retains the last valid BTC context when Deribit is temporarily unavailable', async () => {
    const store = memoryStore()
    let unavailable = false
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (unavailable) throw new Error('temporary derivatives outage')
      const isOption = String(input).includes('kind=option')
      const result = isOption
        ? [{ instrument_name: 'BTC-27SEP26-100000-C', open_interest: 25 }, { instrument_name: 'BTC-27SEP26-100000-P', open_interest: 10 }]
        : [{ instrument_name: 'BTC-PERPETUAL', funding_8h: 0.0001, open_interest: 100_000, mark_price: 90_000 }]
      return new Response(JSON.stringify({ result }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const service = createMarketMonitorService({ ...dependencies(), store, fetcher, now: () => new Date('2026-04-01T00:00:00Z') })
    const first = await service.scan('BTC', 'manual')
    unavailable = true
    const second = await service.scan('BTC', 'scheduled')
    expect(second.snapshot.context).toMatchObject({ fundingRate: first.snapshot.context.fundingRate, openInterest: first.snapshot.context.openInterest })
    expect(second.snapshot.sourceHealth.find((source) => source.id === 'btc-derivatives')).toMatchObject({ status: 'unavailable' })
    expect(second.snapshot.sourceHealth.find((source) => source.id === 'btc-derivatives')?.detail).toContain('Last valid context retained')
  })
})
