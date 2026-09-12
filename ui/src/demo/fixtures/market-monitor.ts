import type { HistoricalBar } from '../../api/market'
import type { MonitorAsset, MonitorSnapshot } from '../../api/market-monitor'

function bars(asset: MonitorAsset, interval: '1D' | '1H'): HistoricalBar[] {
  const count = interval === '1D' ? 150 : 96
  const base = asset === 'BTC' ? 104_000 : 338
  const step = interval === '1D' ? 86400000 : 3600000
  const end = Date.parse(interval === '1D' ? '2026-09-11T00:00:00Z' : '2026-09-12T12:00:00Z')
  return Array.from({ length: count }, (_, index) => {
    const trend = asset === 'BTC' ? index * 95 : index * 0.18
    const wave = Math.sin(index / (interval === '1D' ? 6 : 4)) * base * (interval === '1D' ? 0.018 : 0.004)
    const close = base + trend + wave
    const previous = index ? base + (index - 1) * (asset === 'BTC' ? 95 : 0.18) + Math.sin((index - 1) / (interval === '1D' ? 6 : 4)) * base * (interval === '1D' ? 0.018 : 0.004) : close * 0.998
    const band = close * (interval === '1D' ? 0.009 : 0.002)
    return {
      date: new Date(end - (count - index - 1) * step).toISOString(),
      open: previous,
      high: Math.max(previous, close) + band,
      low: Math.min(previous, close) - band,
      close,
      volume: (asset === 'BTC' ? 32_000 : 88_000_000) * (1 + Math.sin(index / 5) * 0.2),
    }
  })
}

export function demoMonitorSnapshot(asset: MonitorAsset, sequence = 0): MonitorSnapshot {
  const daily = bars(asset, '1D')
  const intraday = bars(asset, '1H')
  const last = daily.at(-1)!
  const bullish = asset === 'BTC'
  return {
    id: `demo-${asset.toLowerCase()}-${sequence}`,
    asset,
    capturedAt: new Date(Date.parse('2026-09-12T12:05:00Z') + sequence * 900000).toISOString(),
    trigger: sequence ? 'scheduled' : 'manual',
    strategyId: 'evidence-chain-v1',
    fingerprint: `demo-${asset}-${sequence}`,
    metrics: {
      lastPrice: last.close,
      lastBarAt: last.date,
      change1dPercent: bullish ? 1.34 : -0.62,
      change5dPercent: bullish ? 3.82 : 1.15,
      rangePosition60d: bullish ? 0.82 : 0.56,
      volumeRatio20d: bullish ? 1.42 : 0.94,
      weeklyChangePercent: bullish ? 2.75 : -0.45,
      intraday: { available: true, latestAt: intraday.at(-1)!.date, latestChangePercent: bullish ? 0.36 : -0.18, fourHourChangePercent: bullish ? 0.94 : -0.71, volumeRatio: bullish ? 1.31 : 1.08, abnormal: false, note: 'No abnormal hourly move or volume expansion detected.' },
    },
    hypothesis: bullish ? {
      id: 'demand-control', label: 'Demand has provisional control', bias: 'bullish', confidence: 74,
      summary: 'Price structure and follow-through lean constructive, but the interpretation remains conditional on the next test.',
      confirm: ['Hold above the prior 20-day range.', 'Pullbacks contract in volume and preserve a higher low.', 'Hourly follow-through produces price progress.'],
      invalidate: ['Return inside the range on expanding downside volume.', 'A lower high is followed by a decisive breakdown.'],
      alternatives: ['A false breakout returning to balance.', 'Short covering without durable spot demand.'],
    } : {
      id: 'balanced-range', label: 'Evidence remains balanced', bias: 'neutral', confidence: 56,
      summary: 'Neither side has produced enough structural progress. Directional stories remain provisional.',
      confirm: ['Continue rotating inside the prior 20-day range.', 'Volume expansion produces limited displacement.'],
      invalidate: ['Close outside the range and hold through a subsequent test.', 'Daily and weekly follow-through align.'],
      alternatives: ['Re-accumulation before continuation.', 'Distribution before a downside move.'],
    },
    evidence: [
      { id: 'location', label: 'Location in 60-day range', timeframe: '1D', tone: bullish ? 'positive' : 'neutral', observation: `Close is at ${bullish ? 82 : 56}% of the 60-day range.`, interpretation: 'Location changes how the same price/volume event should be interpreted.', weight: 2 },
      { id: 'structure', label: 'Twenty-day structure', timeframe: '1D', tone: bullish ? 'positive' : 'neutral', observation: bullish ? 'Close is above the prior 20-day high.' : 'Close remains inside the prior 20-day range.', interpretation: bullish ? 'Demand produced structural progress.' : 'The market still needs a confirmed range exit.', weight: 3 },
      { id: 'effort-result', label: 'Effort versus result', timeframe: '1D', tone: bullish ? 'positive' : 'neutral', observation: `${bullish ? 1.42 : 0.94}× volume with ${bullish ? 1.34 : -0.62}% price change.`, interpretation: 'Price displacement is compared with observed trading effort.', weight: 2 },
      { id: 'weekly', label: 'Weekly follow-through', timeframe: '1W', tone: bullish ? 'positive' : 'neutral', observation: `Latest week is ${bullish ? 2.75 : -0.45}% from the previous week.`, interpretation: 'Weekly direction provides context rather than a standalone signal.', weight: 2 },
      { id: 'intraday', label: 'Intraday pulse', timeframe: '1H', tone: bullish ? 'positive' : 'neutral', observation: `Latest hour ${bullish ? 0.36 : -0.18}%; rolling four hours ${bullish ? 0.94 : -0.71}%.`, interpretation: 'No abnormal hourly expansion detected.', weight: 1 },
    ],
    context: asset === 'BTC' ? { fundingRate: 0.00012, openInterest: 812_500_000, annualizedBasisPercent: 5.7, optionOpenInterest: 198_400, putCallOpenInterestRatio: 0.78 } : { marketCap: 1_087_000_000_000, trailingPe: 186.4, forwardPe: 98.6, analystTargetMean: 352.5, shortPercentFloat: 2.74, nextEarningsAt: '2026-10-21', recentNews: [{ title: 'Tesla delivery expectations remain in focus', time: '2026-09-12T09:00:00Z', source: 'Demo Wire' }] },
    sourceHealth: [
      { id: 'daily-bars', label: 'Daily OHLCV', status: 'ok', provider: 'demo/yfinance', asOf: last.date, detail: 'Deterministic attributed demo bars.' },
      { id: 'intraday-bars', label: 'Hourly OHLCV', status: 'ok', provider: 'demo/yfinance', asOf: intraday.at(-1)!.date, detail: 'Deterministic attributed hourly demo bars.' },
      { id: 'context', label: `${asset} context`, status: 'ok', provider: asset === 'BTC' ? 'demo/Deribit' : 'demo/OpenAlice reference', asOf: '2026-09-12T12:00:00Z', detail: 'Static context for UI acceptance; not live.' },
    ],
    chart: {
      daily, intraday,
      dailyMeta: { symbol: asset === 'BTC' ? 'BTC-USD' : 'TSLA', from: daily[0].date, to: last.date, bars: daily.length, source: 'vendor', sourceId: 'demo/yfinance', barId: `demo|${asset}`, provider: 'demo', barCapability: 'delayed' },
      intradayMeta: { symbol: asset === 'BTC' ? 'BTC-USD' : 'TSLA', from: intraday[0].date, to: intraday.at(-1)!.date, bars: intraday.length, source: 'vendor', sourceId: 'demo/yfinance', barId: `demo|${asset}`, provider: 'demo', barCapability: 'delayed' },
    },
  }
}
