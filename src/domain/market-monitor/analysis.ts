import { createHash } from 'node:crypto'
import type { OhlcvBar } from '../market-data/bars/index.js'
import type {
  EvidenceItem,
  IntradayPulse,
  MarketContext,
  MarketHypothesis,
  MarketMonitorAsset,
  MarketMonitorEvaluation,
  MarketMonitorMetrics,
  MarketMonitorSnapshot,
  SourceHealth,
} from './types.js'

const pct = (latest: number, prior: number): number | null =>
  Number.isFinite(latest) && Number.isFinite(prior) && prior !== 0
    ? ((latest / prior) - 1) * 100
    : null

const rounded = (value: number | null, digits = 2): number | null =>
  value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits))

const significant = (value: number | null | undefined, digits: number): number | null | undefined =>
  value == null || !Number.isFinite(value) ? value : Number(value.toPrecision(digits))

function semanticContext(context: MarketContext): MarketContext {
  return {
    fundingRate: context.fundingRate == null ? context.fundingRate : rounded(context.fundingRate, 5),
    openInterest: significant(context.openInterest, 3),
    annualizedBasisPercent: context.annualizedBasisPercent == null ? context.annualizedBasisPercent : rounded(context.annualizedBasisPercent, 0),
    optionOpenInterest: significant(context.optionOpenInterest, 3),
    putCallOpenInterestRatio: context.putCallOpenInterestRatio == null ? context.putCallOpenInterestRatio : rounded(context.putCallOpenInterestRatio, 2),
    marketCap: significant(context.marketCap, 4),
    trailingPe: context.trailingPe == null ? context.trailingPe : rounded(context.trailingPe, 2),
    forwardPe: context.forwardPe == null ? context.forwardPe : rounded(context.forwardPe, 2),
    analystTargetMean: context.analystTargetMean == null ? context.analystTargetMean : rounded(context.analystTargetMean, 2),
    shortPercentFloat: context.shortPercentFloat == null ? context.shortPercentFloat : rounded(context.shortPercentFloat, 4),
    nextEarningsAt: context.nextEarningsAt,
    recentNews: context.recentNews?.map(({ title, time, source }) => ({ title, time, source })),
  }
}

function sortedBars(bars: OhlcvBar[]): OhlcvBar[] {
  return bars
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
}

function mean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite)
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null
}

function volumeRatio(bars: OhlcvBar[], lookback: number): number | null {
  const latest = bars.at(-1)?.volume
  const prior = bars.slice(-(lookback + 1), -1).map((bar) => bar.volume).filter((value): value is number => value != null && Number.isFinite(value))
  const average = mean(prior)
  return latest != null && average != null && average > 0 ? latest / average : null
}

function rangePosition(bars: OhlcvBar[], lookback: number): number | null {
  const window = bars.slice(-lookback)
  const latest = window.at(-1)
  if (!latest || window.length < 2) return null
  const low = Math.min(...window.map((bar) => bar.low))
  const high = Math.max(...window.map((bar) => bar.high))
  return high === low ? 0.5 : (latest.close - low) / (high - low)
}

function weeklyCloses(bars: OhlcvBar[]): number[] {
  const groups = new Map<string, OhlcvBar>()
  for (const bar of bars) {
    const date = new Date(`${bar.date.slice(0, 10)}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) continue
    const day = date.getUTCDay() || 7
    date.setUTCDate(date.getUTCDate() - day + 1)
    groups.set(date.toISOString().slice(0, 10), bar)
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date)).map((bar) => bar.close)
}

function intradayPulse(bars: OhlcvBar[], abnormalVolumeRatio: number, abnormalMovePercent: number): IntradayPulse {
  const series = sortedBars(bars)
  if (series.length < 2) {
    return { available: false, latestAt: null, latestChangePercent: null, fourHourChangePercent: null, volumeRatio: null, abnormal: false, note: 'Hourly source unavailable; daily data was not substituted.' }
  }
  const latest = series.at(-1)!
  const change = pct(latest.close, series.at(-2)!.close)
  const fourHour = series.length >= 5 ? pct(latest.close, series.at(-5)!.close) : null
  const ratio = volumeRatio(series, 20)
  const abnormal = Math.abs(change ?? 0) >= abnormalMovePercent || (ratio ?? 0) >= abnormalVolumeRatio
  return {
    available: true,
    latestAt: latest.date,
    latestChangePercent: rounded(change),
    fourHourChangePercent: rounded(fourHour),
    volumeRatio: rounded(ratio),
    abnormal,
    note: abnormal ? 'The latest hourly move or volume is outside the configured normal band.' : 'No abnormal hourly move or volume expansion detected.',
  }
}

export function analyzeEvidence(input: {
  dailyBars: OhlcvBar[]
  intradayBars: OhlcvBar[]
  abnormalVolumeRatio: number
  abnormalMovePercent: number
}): { metrics: MarketMonitorMetrics; evidence: EvidenceItem[]; hypothesis: MarketHypothesis } {
  const daily = sortedBars(input.dailyBars)
  if (daily.length < 20) throw new Error('At least 20 daily bars are required for evidence analysis')
  const latest = daily.at(-1)!
  const change1d = pct(latest.close, daily.at(-2)!.close)
  const change5d = daily.length >= 6 ? pct(latest.close, daily.at(-6)!.close) : null
  const position = rangePosition(daily, 60)
  const dailyVolumeRatio = volumeRatio(daily, 20)
  const weekly = weeklyCloses(daily)
  const weeklyChange = weekly.length >= 2 ? pct(weekly.at(-1)!, weekly.at(-2)!) : null
  const pulse = intradayPulse(input.intradayBars, input.abnormalVolumeRatio, input.abnormalMovePercent)
  const recent20 = daily.slice(-21, -1)
  const priorHigh = Math.max(...recent20.map((bar) => bar.high))
  const priorLow = Math.min(...recent20.map((bar) => bar.low))
  const breakout = latest.close > priorHigh
  const breakdown = latest.close < priorLow
  const highEffort = (dailyVolumeRatio ?? 0) >= input.abnormalVolumeRatio
  const smallResult = Math.abs(change1d ?? 0) < 0.6
  const evidence: EvidenceItem[] = []

  evidence.push({
    id: 'location', label: 'Location in 60-day range', timeframe: '1D',
    tone: position == null ? 'neutral' : position >= 0.72 ? 'positive' : position <= 0.28 ? 'negative' : 'neutral',
    observation: position == null ? 'Range position unavailable.' : `Close is at ${Math.round(position * 100)}% of the 60-day range.`,
    interpretation: 'Location changes how the same price/volume event should be interpreted.', weight: 2,
  })
  evidence.push({
    id: 'structure', label: 'Twenty-day structure', timeframe: '1D',
    tone: breakout ? 'positive' : breakdown ? 'negative' : 'neutral',
    observation: breakout ? 'Close is above the prior 20-day high.' : breakdown ? 'Close is below the prior 20-day low.' : 'Close remains inside the prior 20-day range.',
    interpretation: breakout ? 'Demand produced structural progress.' : breakdown ? 'Supply produced structural progress.' : 'The market still needs a confirmed range exit.', weight: 3,
  })
  evidence.push({
    id: 'effort-result', label: 'Effort versus result', timeframe: '1D',
    tone: highEffort && smallResult ? 'neutral' : (change1d ?? 0) > 0 ? 'positive' : (change1d ?? 0) < 0 ? 'negative' : 'neutral',
    observation: `${rounded(dailyVolumeRatio) ?? '—'}× 20-day volume with ${rounded(change1d) ?? '—'}% price change.`,
    interpretation: highEffort && smallResult ? 'High effort produced little displacement; absorption is possible and requires a test.' : 'Price displacement broadly matches the direction of effort.', weight: highEffort ? 3 : 1,
  })
  evidence.push({
    id: 'weekly', label: 'Weekly follow-through', timeframe: '1W',
    tone: (weeklyChange ?? 0) > 1 ? 'positive' : (weeklyChange ?? 0) < -1 ? 'negative' : 'neutral',
    observation: `Latest calendar-week close is ${rounded(weeklyChange) ?? '—'}% from the previous week.`,
    interpretation: 'Weekly direction provides context; it does not confirm a reversal by itself.', weight: 2,
  })
  evidence.push({
    id: 'intraday', label: 'Intraday pulse', timeframe: '1H',
    tone: !pulse.available ? 'neutral' : (pulse.fourHourChangePercent ?? 0) > 0.8 ? 'positive' : (pulse.fourHourChangePercent ?? 0) < -0.8 ? 'negative' : 'neutral',
    observation: pulse.available ? `Latest hour ${pulse.latestChangePercent ?? '—'}%; rolling four hours ${pulse.fourHourChangePercent ?? '—'}%; volume ${pulse.volumeRatio ?? '—'}×.` : pulse.note,
    interpretation: pulse.available ? pulse.note : 'Intraday confirmation remains unknown rather than inferred from daily candles.', weight: pulse.abnormal ? 2 : 1,
  })

  const score = evidence.reduce((sum, item) => sum + (item.tone === 'positive' ? item.weight : item.tone === 'negative' ? -item.weight : 0), 0)
  const maxScore = evidence.reduce((sum, item) => sum + item.weight, 0)
  const normalized = maxScore ? score / maxScore : 0
  const bias = normalized >= 0.22 ? 'bullish' : normalized <= -0.22 ? 'bearish' : 'neutral'
  const confidence = Math.round(Math.min(88, 50 + Math.abs(normalized) * 45 + (breakout || breakdown ? 5 : 0)))
  const hypothesis: MarketHypothesis = bias === 'bullish' ? {
    id: 'demand-control', label: 'Demand has provisional control', bias, confidence,
    summary: 'Price structure and follow-through lean constructive, but the interpretation remains conditional on the next test.',
    confirm: ['Hold above the prior 20-day range or reclaim it quickly after a test.', 'Pullbacks contract in volume and fail to make meaningful lower lows.', 'Hourly follow-through is supported by price progress, not only leverage or volume.'],
    invalidate: ['Close back inside the broken range with expanding downside volume.', 'A lower high is followed by a decisive 20-day breakdown.', 'Weekly follow-through turns negative while the relative range position deteriorates.'],
    alternatives: ['A false breakout returning to balance.', 'Short covering without durable spot demand.'],
  } : bias === 'bearish' ? {
    id: 'supply-control', label: 'Supply has provisional control', bias, confidence,
    summary: 'Price structure and follow-through lean defensive, but a failed breakdown can still reverse the interpretation.',
    confirm: ['Remain below the prior 20-day range after a weak retest.', 'Down moves expand in price result and volume.', 'Hourly rebounds fail before reclaiming the broken level.'],
    invalidate: ['Rapidly reclaim the prior range and hold it on a quieter retest.', 'Downside volume expands without further price progress, followed by a higher low.', 'Weekly close reverses higher while range position improves.'],
    alternatives: ['A spring-like failed breakdown.', 'Temporary liquidation without persistent supply.'],
  } : {
    id: 'balanced-range', label: 'Evidence remains balanced', bias, confidence,
    summary: 'Neither side has produced enough structural progress. Treat directional stories as hypotheses until price leaves and tests the range.',
    confirm: ['Continue rotating inside the prior 20-day range.', 'Volume expansion repeatedly produces limited net displacement.'],
    invalidate: ['Close outside the range and hold through a subsequent test.', 'Daily and weekly follow-through align with abnormal intraday participation.'],
    alternatives: ['Re-accumulation before an upside continuation.', 'Distribution before a downside continuation.'],
  }

  return {
    metrics: {
      lastPrice: latest.close,
      lastBarAt: latest.date,
      change1dPercent: rounded(change1d), change5dPercent: rounded(change5d),
      rangePosition60d: rounded(position, 4), volumeRatio20d: rounded(dailyVolumeRatio),
      weeklyChangePercent: rounded(weeklyChange), intraday: pulse,
    }, evidence, hypothesis,
  }
}

export function semanticFingerprint(input: {
  asset: MarketMonitorAsset
  metrics: MarketMonitorMetrics
  hypothesis: MarketHypothesis
  context: MarketContext
  sourceHealth: SourceHealth[]
}): string {
  const semantic = {
    asset: input.asset,
    lastBarAt: input.metrics.lastBarAt,
    lastPrice: rounded(input.metrics.lastPrice, 6),
    intradayAt: input.metrics.intraday.latestAt,
    intradayChange: input.metrics.intraday.latestChangePercent,
    hypothesis: input.hypothesis.id,
    confidence: input.hypothesis.confidence,
    // Continuously moving derivatives fields are quantized to decision-scale
    // buckets. A new headline or meaningful positioning/basis change is still
    // semantic; a provider's last decimal ticking between two requests is not.
    context: semanticContext(input.context),
    // Freshness/fetch timestamps and cache mechanics are deliberately absent:
    // the latest attributed candle already anchors market time. Only a real
    // source-state/provider change should create another observation.
    source: input.sourceHealth.map(({ id, status, provider }) => ({ id, status, provider })),
  }
  return createHash('sha256').update(JSON.stringify(semantic)).digest('hex').slice(0, 24)
}

export function evaluateSnapshots(asset: MarketMonitorAsset, snapshots: MarketMonitorSnapshot[]): MarketMonitorEvaluation {
  const ordered = snapshots.slice().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  const rows = ordered.map((snapshot, index) => {
    const next = ordered[index + 1]
    const change = next ? pct(next.metrics.lastPrice, snapshot.metrics.lastPrice) : null
    const correct = change == null || snapshot.hypothesis.bias === 'neutral'
      ? null
      : snapshot.hypothesis.bias === 'bullish' ? change > 0 : change < 0
    return {
      capturedAt: snapshot.capturedAt, hypothesis: snapshot.hypothesis.bias,
      confidence: snapshot.hypothesis.confidence, nextCapturedAt: next?.capturedAt ?? null,
      forwardChangePercent: rounded(change), correct,
    }
  })
  const resolved = rows.filter((row) => row.correct != null)
  const changes = rows.map((row) => row.forwardChangePercent).filter((value): value is number => value != null)
  return {
    asset, samples: rows.length, resolved: resolved.length,
    directionalAccuracy: resolved.length ? rounded(resolved.filter((row) => row.correct).length / resolved.length * 100) : null,
    averageForwardChangePercent: rounded(mean(changes)), rows: rows.slice(-100),
  }
}
