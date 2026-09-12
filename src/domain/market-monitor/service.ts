import { randomUUID } from 'node:crypto'
import type { EquityClientLike } from '../market-data/client/types.js'
import type { BarMeta, BarService, BarsResult, OhlcvBar } from '../market-data/bars/index.js'
import type { INewsProvider } from '../news/types.js'
import type { ReferenceDataService } from '../market-data/reference/types.js'
import { analyzeEvidence, evaluateSnapshots, semanticFingerprint } from './analysis.js'
import { createMarketMonitorStore, type MarketMonitorStore } from './store.js'
import {
  MARKET_MONITOR_ASSET_CONFIG,
  type MarketContext,
  type MarketMonitorAlert,
  type MarketMonitorAsset,
  type MarketMonitorEvaluation,
  type MarketMonitorReceipt,
  type MarketMonitorScanResult,
  type MarketMonitorSettings,
  type MarketMonitorSnapshot,
  type MarketMonitorTrigger,
  type SourceHealth,
} from './types.js'

type FetchLike = typeof fetch

export interface MarketMonitorServiceDeps {
  barService: BarService
  equityClient: EquityClientLike
  reference: ReferenceDataService
  newsProvider?: INewsProvider
  store?: MarketMonitorStore
  fetcher?: FetchLike
  now?: () => Date
}

export interface MarketMonitorService {
  settings(): Promise<MarketMonitorSettings>
  saveSettings(settings: MarketMonitorSettings): Promise<void>
  scan(asset: MarketMonitorAsset, trigger: MarketMonitorTrigger): Promise<MarketMonitorScanResult>
  snapshots(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorSnapshot[]>
  alerts(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorAlert[]>
  receipts(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorReceipt[]>
  evaluation(asset: MarketMonitorAsset): Promise<MarketMonitorEvaluation>
}

function compactBars(bars: OhlcvBar[], max: number): OhlcvBar[] {
  return bars.slice(-max).map(({ date, open, high, low, close, volume }) => ({ date, open, high, low, close, volume }))
}

function numberFrom(row: unknown, keys: string[]): number | null {
  if (!row || typeof row !== 'object') return null
  for (const key of keys) {
    const value = (row as Record<string, unknown>)[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function stringFrom(row: unknown, keys: string[]): string | null {
  if (!row || typeof row !== 'object') return null
  for (const key of keys) {
    const value = (row as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

async function fetchJson(fetcher: FetchLike, url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function loadBars(barService: BarService, asset: MarketMonitorAsset, interval: '1d' | '1h', count: number): Promise<{ result: BarsResult; fallback: boolean }> {
  const config = MARKET_MONITOR_ASSET_CONFIG[asset]
  try {
    return { result: await barService.getBars({ symbol: config.symbol, assetClass: config.assetClass }, { interval, count }), fallback: false }
  } catch (primaryError) {
    try {
      return { result: await barService.getBars({ barId: config.barId, assetClass: config.assetClass }, { interval, count }), fallback: true }
    } catch {
      throw primaryError
    }
  }
}

async function bitcoinContext(fetcher: FetchLike, at: Date): Promise<{ context: MarketContext; health: SourceHealth }> {
  const capturedAt = at.toISOString()
  try {
    const [futureResult, optionResult] = await Promise.allSettled([
      fetchJson(fetcher, 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=future'),
      fetchJson(fetcher, 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option'),
    ])
    if (futureResult.status === 'rejected' && optionResult.status === 'rejected') throw futureResult.reason
    const futureRaw = futureResult.status === 'fulfilled' ? futureResult.value : undefined
    const optionRaw = optionResult.status === 'fulfilled' ? optionResult.value : undefined
    const futures = ((futureRaw as { result?: unknown[] })?.result ?? []) as Array<Record<string, unknown>>
    const options = ((optionRaw as { result?: unknown[] })?.result ?? []) as Array<Record<string, unknown>>
    const perpetual = futures.find((row) => row.instrument_name === 'BTC-PERPETUAL')
    const dated = futures
      .map((row) => ({ row, expiry: Date.parse(String(row.instrument_name ?? '').split('-').at(-1) ?? '') }))
      .filter(({ expiry }) => Number.isFinite(expiry) && expiry > at.getTime() + 3 * 86400000)
      .sort((a, b) => a.expiry - b.expiry)[0]
    const indexPrice = numberFrom(perpetual, ['underlying_price', 'index_price', 'estimated_delivery_price', 'mark_price'])
    const futurePrice = numberFrom(dated?.row, ['mark_price', 'last'])
    const days = dated ? (dated.expiry - at.getTime()) / 86400000 : null
    const basis = indexPrice && futurePrice && days
      ? ((futurePrice / indexPrice) - 1) * (365 / days) * 100
      : null
    let callOi = 0
    let putOi = 0
    for (const row of options) {
      const oi = numberFrom(row, ['open_interest']) ?? 0
      const name = String(row.instrument_name ?? '')
      if (name.endsWith('-C')) callOi += oi
      else if (name.endsWith('-P')) putOi += oi
    }
    return {
      context: {
        fundingRate: numberFrom(perpetual, ['funding_8h', 'current_funding']),
        openInterest: numberFrom(perpetual, ['open_interest']),
        annualizedBasisPercent: basis == null ? null : Number(basis.toFixed(2)),
        optionOpenInterest: callOi + putOi || null,
        putCallOpenInterestRatio: callOi > 0 ? Number((putOi / callOi).toFixed(2)) : null,
      },
      health: { id: 'btc-derivatives', label: 'BTC derivatives context', status: futureResult.status === 'fulfilled' && optionResult.status === 'fulfilled' ? 'ok' : 'degraded', provider: 'Deribit public API', asOf: capturedAt, detail: `Read-only derivatives context loaded${futureResult.status === 'rejected' ? '; futures unavailable' : ''}${optionResult.status === 'rejected' ? '; options unavailable' : ''}.` },
    }
  } catch (error) {
    return {
      context: {},
      health: { id: 'btc-derivatives', label: 'BTC derivatives context', status: 'unavailable', provider: 'Deribit public API', asOf: null, detail: error instanceof Error ? error.message : String(error) },
    }
  }
}

async function teslaContext(deps: Pick<MarketMonitorServiceDeps, 'equityClient' | 'reference' | 'newsProvider'>, now: Date): Promise<{ context: MarketContext; health: SourceHealth[] }> {
  const [metrics, estimates, shares, calendar, news] = await Promise.allSettled([
    deps.equityClient.getKeyMetrics({ symbol: 'TSLA' }),
    deps.equityClient.getEstimateConsensus({ symbol: 'TSLA' }),
    deps.equityClient.getShareStatistics({ symbol: 'TSLA' }),
    deps.reference.calendar({ days: 90 }),
    deps.newsProvider?.getNewsV2({ endTime: now, lookback: '7d', limit: 100 }) ?? Promise.resolve([]),
  ])
  const metric = metrics.status === 'fulfilled' ? metrics.value[0] : undefined
  const estimate = estimates.status === 'fulfilled' ? estimates.value[0] : undefined
  const share = shares.status === 'fulfilled' ? shares.value[0] : undefined
  const earnings = calendar.status === 'fulfilled'
    ? calendar.value.earnings.find((row) => String((row as { symbol?: unknown }).symbol ?? '').toUpperCase() === 'TSLA')
    : undefined
  const newsRows = news.status === 'fulfilled' ? news.value.filter((item) => `${item.title}\n${item.content}`.toUpperCase().includes('TSLA') || `${item.title}\n${item.content}`.toLowerCase().includes('tesla')).slice(-5).reverse() : []
  const context: MarketContext = {
    marketCap: numberFrom(metric, ['market_cap']),
    trailingPe: numberFrom(metric, ['price_to_earnings', 'pe_ratio']),
    forwardPe: numberFrom(metric, ['forward_pe', 'pe_forward']),
    analystTargetMean: numberFrom(estimate, ['target_consensus', 'target_mean', 'target_price']),
    shortPercentFloat: numberFrom(share, ['short_percent_of_float']),
    nextEarningsAt: stringFrom(earnings, ['report_date', 'date']),
    recentNews: newsRows.map((item) => ({ title: item.title, time: item.time.toISOString(), source: item.metadata.source ?? null })),
  }
  const coreOk = [context.marketCap, context.trailingPe, context.forwardPe, context.analystTargetMean, context.shortPercentFloat].some((value) => value != null)
  const calendarOk = calendar.status === 'fulfilled'
  const newsOk = Boolean(deps.newsProvider && news.status === 'fulfilled')
  return { context, health: [
    { id: 'tsla-reference', label: 'TSLA fundamentals and positioning', status: coreOk ? 'ok' : 'unavailable', provider: 'OpenAlice equity providers', asOf: coreOk ? now.toISOString() : null, detail: coreOk ? 'Valuation, analyst and short-interest fields loaded where supported.' : 'Configured equity providers returned no usable context.' },
    { id: 'tsla-calendar-news', label: 'TSLA calendar and news', status: calendarOk && newsOk ? 'ok' : calendarOk || newsOk ? 'degraded' : 'unavailable', provider: 'OpenAlice reference/news', asOf: calendarOk || newsOk ? now.toISOString() : null, detail: `${context.nextEarningsAt ? 'Earnings date available' : 'No earnings date'}; ${context.recentNews?.length ?? 0} recent matching stories${!deps.newsProvider ? '; news collector not configured' : ''}.` },
  ] }
}

export function createMarketMonitorService(deps: MarketMonitorServiceDeps): MarketMonitorService {
  const store = deps.store ?? createMarketMonitorStore()
  const fetcher = deps.fetcher ?? fetch
  const now = deps.now ?? (() => new Date())
  return {
    settings: () => store.settings(),
    saveSettings: (settings) => store.saveSettings(settings),
    async snapshots(asset, limit) {
      const rows = await store.snapshots(asset, limit)
      for (const target of asset ? [asset] : (['BTC', 'TSLA'] as MarketMonitorAsset[])) {
        const index = rows.findLastIndex((row) => row.asset === target)
        if (index < 0) continue
        const chart = await store.latestSeries(target)
        if (chart) rows[index] = { ...rows[index], chart }
      }
      return rows
    },
    alerts: (asset, limit) => store.alerts(asset, limit),
    receipts: (asset, limit) => store.receipts(asset, limit),
    async evaluation(asset) { return evaluateSnapshots(asset, await store.snapshots(asset, 1000)) },
    async scan(asset, trigger) {
      const requestedAt = now().toISOString()
      const receiptBase = { id: randomUUID(), asset, requestedAt, trigger } as const
      try {
        const settings = await store.settings()
        const daily = await loadBars(deps.barService, asset, '1d', 260)
        let intraday: { result: BarsResult; fallback: boolean } | null = null
        let intradayError: unknown
        try { intraday = await loadBars(deps.barService, asset, '1h', 180) } catch (error) { intradayError = error }
        const analysis = analyzeEvidence({
          dailyBars: daily.result.bars, intradayBars: intraday?.result.bars ?? [],
          abnormalMovePercent: settings.abnormalMovePercent,
          abnormalVolumeRatio: settings.abnormalVolumeRatio,
        })
        const sourceHealth: SourceHealth[] = [
          healthFromMeta('daily-bars', 'Daily OHLCV', daily.result.meta, daily.fallback),
          intraday
            ? healthFromMeta('intraday-bars', 'Hourly OHLCV', intraday.result.meta, intraday.fallback)
            : { id: 'intraday-bars', label: 'Hourly OHLCV', status: 'unavailable', provider: 'OpenAlice BarService', asOf: null, detail: intradayError instanceof Error ? intradayError.message : 'Hourly source unavailable.' },
        ]
        let context: MarketContext
        if (asset === 'BTC') {
          const result = await bitcoinContext(fetcher, new Date(requestedAt))
          context = result.context
          sourceHealth.push(result.health)
        } else {
          const result = await teslaContext(deps, now())
          context = result.context
          sourceHealth.push(...result.health)
        }
        const fingerprint = semanticFingerprint({ asset, ...analysis, context, sourceHealth })
        const snapshot: MarketMonitorSnapshot = {
          id: randomUUID(), asset, capturedAt: requestedAt, trigger,
          strategyId: 'evidence-chain-v1', fingerprint, ...analysis, context, sourceHealth,
          chart: {
            daily: compactBars(daily.result.bars, 260), intraday: compactBars(intraday?.result.bars ?? [], 180),
            dailyMeta: daily.result.meta, intradayMeta: intraday?.result.meta ?? null,
          },
        }
        const previous = (await store.snapshots(asset, 1)).at(-1)
        const stored = previous?.fingerprint !== fingerprint
        await store.saveLatestSeries(asset, snapshot.chart)
        if (stored) {
          await store.appendSnapshot({ ...snapshot, chart: { ...snapshot.chart, daily: [], intraday: [] } })
        }
        const alert = stored ? await maybeAlert(store, snapshot, previous, settings) : null
        const receipt: MarketMonitorReceipt = { ...receiptBase, outcome: stored ? 'stored' : 'duplicate', snapshotId: stored ? snapshot.id : previous?.id }
        await store.appendReceipt(receipt)
        return { snapshot, stored, alert, receipt }
      } catch (error) {
        const receipt: MarketMonitorReceipt = { ...receiptBase, outcome: 'failed', error: error instanceof Error ? error.message : String(error) }
        await store.appendReceipt(receipt)
        throw error
      }
    },
  }
}

function healthFromMeta(id: string, label: string, meta: BarMeta, fallback: boolean): SourceHealth {
  const asOf = meta.freshness?.latestRecordAt ?? meta.to ?? null
  const stale = meta.staleTradingDays != null && meta.staleTradingDays > 2
  return {
    id, label, status: stale || fallback ? 'degraded' : 'ok',
    provider: meta.sourceId ?? meta.provider ?? 'OpenAlice BarService', asOf,
    detail: `${fallback ? 'Configured source failed; explicit Yahoo fallback used. ' : ''}${stale ? `${meta.staleTradingDays} weekday(s) behind the request anchor.` : `${meta.bars} attributed bars.`}`,
  }
}

async function maybeAlert(store: MarketMonitorStore, snapshot: MarketMonitorSnapshot, previous: MarketMonitorSnapshot | undefined, settings: MarketMonitorSettings): Promise<MarketMonitorAlert | null> {
  const changed = previous && previous.hypothesis.id !== snapshot.hypothesis.id
  const strong = snapshot.hypothesis.bias !== 'neutral' && snapshot.hypothesis.confidence >= settings.alertConfidence
  const abnormal = snapshot.metrics.intraday.abnormal
  if (!changed && !(strong && abnormal)) return null
  const alerts = await store.alerts(snapshot.asset, 20)
  const fingerprint = `${snapshot.asset}:${snapshot.hypothesis.id}:${snapshot.metrics.intraday.latestAt ?? snapshot.metrics.lastBarAt}`
  if (alerts.some((alert) => alert.fingerprint === fingerprint)) return null
  const alert: MarketMonitorAlert = {
    id: randomUUID(), asset: snapshot.asset, createdAt: snapshot.capturedAt, snapshotId: snapshot.id,
    severity: strong && abnormal ? 'warning' : 'info',
    title: changed ? `${snapshot.asset} evidence state changed` : `${snapshot.asset} abnormal intraday confirmation`,
    message: `${snapshot.hypothesis.label} · ${snapshot.hypothesis.confidence}% confidence. ${snapshot.metrics.intraday.note}`,
    fingerprint,
  }
  await store.appendAlert(alert)
  return alert
}
