import { describe, expect, it } from 'vitest'
import type { OhlcvBar } from '../market-data/bars/index.js'
import { analyzeEvidence, evaluateSnapshots, semanticFingerprint } from './analysis.js'
import type { MarketMonitorSnapshot } from './types.js'

function series(count: number, intervalMs: number, direction = 1): OhlcvBar[] {
  const start = Date.parse('2026-01-01T00:00:00Z')
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + direction * index * 0.8 + Math.sin(index / 5)
    return { date: new Date(start + index * intervalMs).toISOString(), open: close - direction * 0.3, high: close + 0.7, low: close - 0.8, close, volume: 1000 + index * 4 }
  })
}

describe('market evidence analysis', () => {
  it('keeps daily, weekly and hourly evidence explicit', () => {
    const result = analyzeEvidence({ dailyBars: series(90, 86400000), intradayBars: series(48, 3600000), abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5 })
    expect(result.metrics.lastPrice).toBeGreaterThan(100)
    expect(result.metrics.intraday.available).toBe(true)
    expect(result.evidence.map((item) => item.timeframe)).toEqual(expect.arrayContaining(['1D', '1W', '1H']))
    expect(result.hypothesis.confirm.length).toBeGreaterThan(0)
    expect(result.hypothesis.invalidate.length).toBeGreaterThan(0)
  })

  it('does not substitute daily candles when hourly data is absent', () => {
    const result = analyzeEvidence({ dailyBars: series(90, 86400000), intradayBars: [], abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5 })
    expect(result.metrics.intraday).toMatchObject({ available: false, latestAt: null, abnormal: false })
    expect(result.evidence.find((item) => item.id === 'intraday')?.observation).toContain('not substituted')
  })

  it('fingerprints semantic state rather than request mechanics', () => {
    const analysis = analyzeEvidence({ dailyBars: series(90, 86400000), intradayBars: series(48, 3600000), abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5 })
    const base = { asset: 'BTC' as const, ...analysis, context: { fundingRate: 0.01 }, sourceHealth: [{ id: 'bars', label: 'Bars', status: 'ok' as const, provider: 'demo', asOf: analysis.metrics.lastBarAt, detail: 'cache miss' }] }
    const a = semanticFingerprint(base)
    const b = semanticFingerprint({ ...base, sourceHealth: [{ ...base.sourceHealth[0], detail: 'cache hit', asOf: '2026-12-31T00:00:00Z' }] })
    expect(a).toBe(b)
  })

  it('buckets continuously moving derivatives fields at decision scale', () => {
    const analysis = analyzeEvidence({ dailyBars: series(90, 86400000), intradayBars: series(48, 3600000), abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5 })
    const base = {
      asset: 'BTC' as const, ...analysis,
      context: { fundingRate: 0.00012341, openInterest: 100_010, annualizedBasisPercent: 4.21, optionOpenInterest: 50_001, putCallOpenInterestRatio: 0.751 },
      sourceHealth: [],
    }
    expect(semanticFingerprint(base)).toBe(semanticFingerprint({
      ...base,
      context: { fundingRate: 0.00012349, openInterest: 100_020, annualizedBasisPercent: 4.27, optionOpenInterest: 50_002, putCallOpenInterestRatio: 0.752 },
    }))
    expect(semanticFingerprint(base)).not.toBe(semanticFingerprint({
      ...base,
      context: { ...base.context, openInterest: 102_000 },
    }))
  })

  it('evaluates only resolved directional hypotheses', () => {
    const make = (price: number, bias: 'bullish' | 'bearish' | 'neutral', capturedAt: string): MarketMonitorSnapshot => ({
      id: capturedAt, asset: 'BTC', capturedAt, trigger: 'manual', strategyId: 'evidence-chain-v1', fingerprint: capturedAt,
      metrics: { lastPrice: price, lastBarAt: capturedAt, change1dPercent: null, change5dPercent: null, rangePosition60d: null, volumeRatio20d: null, weeklyChangePercent: null, intraday: { available: false, latestAt: null, latestChangePercent: null, fourHourChangePercent: null, volumeRatio: null, abnormal: false, note: '' } },
      hypothesis: { id: bias === 'bullish' ? 'demand-control' : bias === 'bearish' ? 'supply-control' : 'balanced-range', label: bias, bias, confidence: 70, summary: '', confirm: [], invalidate: [], alternatives: [] },
      evidence: [], context: {}, sourceHealth: [], chart: { daily: [], intraday: [], dailyMeta: { symbol: 'BTC', from: '', to: '', bars: 0 }, intradayMeta: null },
    })
    const result = evaluateSnapshots('BTC', [make(100, 'bullish', '2026-01-01'), make(110, 'neutral', '2026-01-02')])
    expect(result.resolved).toBe(1)
    expect(result.directionalAccuracy).toBe(100)
  })
})
