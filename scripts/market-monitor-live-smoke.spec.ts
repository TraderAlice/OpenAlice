import { describe, expect, it } from 'vitest'
import { isLoopbackHost, parseOptions, validateScanPair, validateSnapshot } from './market-monitor-live-smoke.mjs'

function snapshot(asset = 'BTC') {
  const intraday: Array<Record<string, unknown>> = []
  return {
    asset,
    strategyId: 'evidence-chain-v1',
    fingerprint: 'evidence-a',
    hypothesis: { id: 'balanced-range' },
    metrics: { lastPrice: 100 },
    chart: { daily: Array.from({ length: 20 }, () => ({})), intraday },
    sourceHealth: [
      { id: 'daily-bars', status: 'ok', provider: 'fixture' },
      { id: 'intraday-bars', status: 'unavailable', provider: 'fixture' },
    ],
  }
}

describe('market monitor live acceptance', () => {
  it('defaults to a loopback, read-only acceptance run', () => {
    expect(parseOptions([], {})).toMatchObject({ baseUrl: 'http://127.0.0.1:47331', scan: false, assets: ['BTC', 'TSLA'] })
    expect(isLoopbackHost('::1')).toBe(true)
    expect(() => parseOptions(['--base-url=https://example.com'], {})).toThrow(/allow-remote/)
  })

  it('requires explicit and valid asset selection', () => {
    expect(parseOptions(['--', '--scan', '--asset=tsla'], {})).toMatchObject({ scan: true, assets: ['TSLA'] })
    expect(() => parseOptions(['--asset=ETH'], {})).toThrow(/BTC or TSLA/)
  })

  it('keeps an unavailable hourly source empty', () => {
    expect(() => validateSnapshot('BTC', snapshot())).not.toThrow()
    const invalid = snapshot()
    invalid.chart.intraday.push({})
    expect(() => validateSnapshot('BTC', invalid)).toThrow(/another timeframe/)
  })

  it('rejects duplicate semantic observations and inconsistent receipts', () => {
    const first = { snapshot: snapshot(), stored: true, receipt: { asset: 'BTC', outcome: 'stored' } }
    const duplicate = { snapshot: snapshot(), stored: false, receipt: { asset: 'BTC', outcome: 'duplicate' } }
    expect(() => validateScanPair('BTC', first, duplicate)).not.toThrow()
    expect(() => validateScanPair('BTC', first, { ...duplicate, stored: true, receipt: { asset: 'BTC', outcome: 'stored' } })).toThrow(/duplicate observation/)
  })
})
