import { randomUUID } from 'node:crypto'
import type { EquityClientLike } from '../market-data/client/types.js'
import type { BarMeta, BarService, BarsResult, OhlcvBar } from '../market-data/bars/index.js'
import type { INewsProvider } from '../news/types.js'
import type { ReferenceDataService } from '../market-data/reference/types.js'
import { evaluateSnapshots } from './analysis.js'
import {
  createDefaultMarketContextProviderRegistry,
  type MarketContextProviderRegistry,
  type MarketMonitorFetch,
} from './context.js'
import { createMarketMonitorStore, type MarketMonitorStore } from './store.js'
import {
  createMarketMonitorStrategyRegistry,
  type MarketMonitorStrategyRegistry,
} from './strategy.js'
import {
  MARKET_MONITOR_ASSET_CONFIG,
  type MarketContext,
  type MarketContextProviderManifest,
  type MarketMonitorAlert,
  type MarketMonitorAsset,
  type MarketMonitorEvaluation,
  type MarketMonitorReceipt,
  type MarketMonitorScanResult,
  type MarketMonitorSettings,
  type MarketMonitorSnapshot,
  type MarketMonitorStrategyManifest,
  type MarketMonitorTrigger,
  type SourceHealth,
} from './types.js'

export interface MarketMonitorServiceDeps {
  barService: BarService
  equityClient: EquityClientLike
  reference: ReferenceDataService
  newsProvider?: INewsProvider
  store?: MarketMonitorStore
  fetcher?: MarketMonitorFetch
  strategyRegistry?: MarketMonitorStrategyRegistry
  contextProviderRegistry?: MarketContextProviderRegistry
  now?: () => Date
}

export interface MarketMonitorService {
  settings(): Promise<MarketMonitorSettings>
  saveSettings(settings: MarketMonitorSettings): Promise<void>
  scan(asset: MarketMonitorAsset, trigger: MarketMonitorTrigger): Promise<MarketMonitorScanResult>
  snapshots(asset?: MarketMonitorAsset, limit?: number, strategyId?: string): Promise<MarketMonitorSnapshot[]>
  alerts(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorAlert[]>
  receipts(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorReceipt[]>
  evaluation(asset: MarketMonitorAsset): Promise<MarketMonitorEvaluation>
  strategies(): MarketMonitorStrategyManifest[]
  contextProviders(): MarketContextProviderManifest[]
}

function compactBars(bars: OhlcvBar[], max: number): OhlcvBar[] {
  return bars.slice(-max).map(({ date, open, high, low, close, volume }) => ({ date, open, high, low, close, volume }))
}

function retainPreviousContext(current: MarketContext, previous: MarketContext | undefined): { context: MarketContext; retained: boolean } {
  if (!previous) return { context: current, retained: false }
  const merged: MarketContext = { ...previous, ...current }
  let retained = false
  const numeric = [
    'fundingRate', 'openInterest', 'annualizedBasisPercent', 'optionOpenInterest',
    'putCallOpenInterestRatio', 'marketCap', 'trailingPe', 'forwardPe',
    'analystTargetMean', 'shortPercentFloat',
  ] as const
  for (const key of numeric) {
    if (current[key] == null && previous[key] != null) {
      merged[key] = previous[key]
      retained = true
    }
  }
  if (current.nextEarningsAt == null && previous.nextEarningsAt != null) {
    merged.nextEarningsAt = previous.nextEarningsAt
    retained = true
  }
  if (!current.recentNews?.length && previous.recentNews?.length) {
    merged.recentNews = previous.recentNews
    retained = true
  }
  return { context: merged, retained }
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

export function createMarketMonitorService(deps: MarketMonitorServiceDeps): MarketMonitorService {
  const store = deps.store ?? createMarketMonitorStore()
  const now = deps.now ?? (() => new Date())
  const strategyRegistry = deps.strategyRegistry ?? createMarketMonitorStrategyRegistry()
  const contextProviderRegistry = deps.contextProviderRegistry ?? createDefaultMarketContextProviderRegistry({
    equityClient: deps.equityClient,
    reference: deps.reference,
    ...(deps.newsProvider ? { newsProvider: deps.newsProvider } : {}),
    ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
  })
  const loadSettings = async (): Promise<MarketMonitorSettings> => {
    const settings = await store.settings()
    return strategyRegistry.has(settings.strategyId)
      ? settings
      : { ...settings, strategyId: strategyRegistry.list()[0]!.id }
  }
  return {
    settings: loadSettings,
    async saveSettings(settings) {
      strategyRegistry.get(settings.strategyId)
      await store.saveSettings(settings)
    },
    strategies: () => strategyRegistry.list(),
    contextProviders: () => contextProviderRegistry.list(),
    async snapshots(asset, limit, strategyId) {
      if (strategyId) strategyRegistry.get(strategyId)
      const boundedLimit = Math.max(1, Math.min(1000, limit ?? 100))
      const candidates = await store.snapshots(asset, strategyId ? 1000 : boundedLimit)
      const rows = candidates
        .filter((row) => !strategyId || row.strategyId === strategyId)
        .slice(-boundedLimit)
      const latestBySeries = new Map<string, number>()
      rows.forEach((row, index) => latestBySeries.set(`${row.asset}:${row.strategyId}`, index))
      for (const index of latestBySeries.values()) {
        const row = rows[index]!
        const chart = await store.latestSeries(row.asset, row.strategyId)
        if (chart) rows[index] = { ...row, chart }
      }
      return rows
    },
    alerts: (asset, limit) => store.alerts(asset, limit),
    receipts: (asset, limit) => store.receipts(asset, limit),
    async evaluation(asset) {
      const settings = await loadSettings()
      const rows = (await store.snapshots(asset, 1000)).filter((row) => row.strategyId === settings.strategyId)
      return evaluateSnapshots(asset, rows)
    },
    async scan(asset, trigger) {
      const requestedAt = now().toISOString()
      const receiptBase = { id: randomUUID(), asset, requestedAt, trigger } as const
      try {
        const settings = await loadSettings()
        const strategy = strategyRegistry.get(settings.strategyId)
        const daily = await loadBars(deps.barService, asset, '1d', 260)
        let intraday: { result: BarsResult; fallback: boolean } | null = null
        let intradayError: unknown
        try { intraday = await loadBars(deps.barService, asset, '1h', 180) } catch (error) { intradayError = error }
        const analysis = strategy.analyze({
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
        const previous = (await store.snapshots(asset, 1000)).filter((row) => row.strategyId === strategy.manifest.id).at(-1)
        const previousCapturedAt = previous?.capturedAt ?? 'an earlier scan'
        const providers = contextProviderRegistry.forAsset(asset)
        const contextResults = await Promise.all(providers.map(async (provider) => {
          try {
            return await provider.load({ asset, at: new Date(requestedAt) })
          } catch (error) {
            return {
              context: {},
              health: [{
                id: `context-provider:${provider.manifest.id}`,
                label: provider.manifest.label,
                status: 'unavailable' as const,
                provider: provider.manifest.id,
                asOf: null,
                detail: error instanceof Error ? error.message : String(error),
              }],
            }
          }
        }))
        const contextResult = {
          context: Object.assign({}, ...contextResults.map((result) => result.context)) as MarketContext,
          health: contextResults.flatMap((result) => result.health),
        }
        const fallback = contextResult.health.some((source) => source.status !== 'ok')
          ? retainPreviousContext(contextResult.context, previous?.context)
          : { context: contextResult.context, retained: false }
        const context: MarketContext = fallback.context
        sourceHealth.push(...contextResult.health.map((source) => fallback.retained && source.status !== 'ok'
          ? { ...source, detail: `${source.detail} Last valid fields retained from ${previousCapturedAt}.` }
          : source))
        const fingerprint = strategy.fingerprint({ asset, ...analysis, context, sourceHealth })
        const snapshot: MarketMonitorSnapshot = {
          id: randomUUID(), asset, capturedAt: requestedAt, trigger,
          strategyId: strategy.manifest.id, fingerprint, ...analysis, context, sourceHealth,
          chart: {
            daily: compactBars(daily.result.bars, 260), intraday: compactBars(intraday?.result.bars ?? [], 180),
            dailyMeta: daily.result.meta, intradayMeta: intraday?.result.meta ?? null,
          },
        }
        const stored = previous?.fingerprint !== fingerprint
        await store.saveLatestSeries(asset, snapshot.chart, snapshot.strategyId)
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
