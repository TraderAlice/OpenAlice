import type { EquityClientLike } from '../market-data/client/types.js'
import type { ReferenceDataService } from '../market-data/reference/types.js'
import type { INewsProvider } from '../news/types.js'
import type {
  MarketContext,
  MarketContextProviderManifest,
  MarketMonitorAsset,
  SourceHealth,
} from './types.js'

export type MarketMonitorFetch = typeof fetch

export interface MarketContextProviderResult {
  context: MarketContext
  health: SourceHealth[]
}

export interface MarketContextProvider {
  manifest: MarketContextProviderManifest
  load(input: { asset: MarketMonitorAsset; at: Date }): Promise<MarketContextProviderResult>
}

export interface MarketContextProviderDeps {
  equityClient: EquityClientLike
  reference: ReferenceDataService
  newsProvider?: INewsProvider
  fetcher?: MarketMonitorFetch
}

export class MarketContextProviderRegistry {
  private readonly providers: MarketContextProvider[]
  private readonly byId = new Map<string, MarketContextProvider>()

  constructor(providers: MarketContextProvider[]) {
    this.providers = [...providers]
    for (const provider of providers) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider.manifest.id)) {
        throw new Error(`Invalid market context provider id: ${provider.manifest.id}`)
      }
      if (this.byId.has(provider.manifest.id)) throw new Error(`Duplicate market context provider: ${provider.manifest.id}`)
      this.byId.set(provider.manifest.id, provider)
    }
  }

  forAsset(asset: MarketMonitorAsset): MarketContextProvider[] {
    const providers = this.providers.filter((provider) => provider.manifest.assets.includes(asset))
    if (!providers.length) throw new Error(`No market context provider registered for ${asset}`)
    return providers
  }

  list(): MarketContextProviderManifest[] {
    return this.providers.map(({ manifest }) => ({ ...manifest, assets: [...manifest.assets] }))
  }
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

async function fetchJson(fetcher: MarketMonitorFetch, url: string): Promise<unknown> {
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

async function bitcoinContext(fetcher: MarketMonitorFetch, at: Date): Promise<MarketContextProviderResult> {
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
      health: [{ id: 'btc-derivatives', label: 'BTC derivatives context', status: futureResult.status === 'fulfilled' && optionResult.status === 'fulfilled' ? 'ok' : 'degraded', provider: 'Deribit public API', asOf: capturedAt, detail: `Read-only derivatives context loaded${futureResult.status === 'rejected' ? '; futures unavailable' : ''}${optionResult.status === 'rejected' ? '; options unavailable' : ''}.` }],
    }
  } catch (error) {
    return {
      context: {},
      health: [{ id: 'btc-derivatives', label: 'BTC derivatives context', status: 'unavailable', provider: 'Deribit public API', asOf: null, detail: error instanceof Error ? error.message : String(error) }],
    }
  }
}

async function teslaContext(deps: Pick<MarketContextProviderDeps, 'equityClient' | 'reference' | 'newsProvider'>, at: Date): Promise<MarketContextProviderResult> {
  const [metrics, estimates, shares, calendar, news] = await Promise.allSettled([
    deps.equityClient.getKeyMetrics({ symbol: 'TSLA' }),
    deps.equityClient.getEstimateConsensus({ symbol: 'TSLA' }),
    deps.equityClient.getShareStatistics({ symbol: 'TSLA' }),
    deps.reference.calendar({ days: 90 }),
    deps.newsProvider?.getNewsV2({ endTime: at, lookback: '7d', limit: 100 }) ?? Promise.resolve([]),
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
    { id: 'tsla-reference', label: 'TSLA fundamentals and positioning', status: coreOk ? 'ok' : 'unavailable', provider: 'OpenAlice equity providers', asOf: coreOk ? at.toISOString() : null, detail: coreOk ? 'Valuation, analyst and short-interest fields loaded where supported.' : 'Configured equity providers returned no usable context.' },
    { id: 'tsla-calendar-news', label: 'TSLA calendar and news', status: calendarOk && newsOk ? 'ok' : calendarOk || newsOk ? 'degraded' : 'unavailable', provider: 'OpenAlice reference/news', asOf: calendarOk || newsOk ? at.toISOString() : null, detail: `${context.nextEarningsAt ? 'Earnings date available' : 'No earnings date'}; ${context.recentNews?.length ?? 0} recent matching stories${!deps.newsProvider ? '; news collector not configured' : ''}.` },
  ] }
}

export function createDefaultMarketContextProviderRegistry(deps: MarketContextProviderDeps): MarketContextProviderRegistry {
  const fetcher = deps.fetcher ?? fetch
  return new MarketContextProviderRegistry([
    {
      manifest: { id: 'deribit-btc-v1', label: 'BTC derivatives', assets: ['BTC'], description: 'Deribit public futures, perpetual and options summaries.' },
      load: ({ at }) => bitcoinContext(fetcher, at),
    },
    {
      manifest: { id: 'openalice-tsla-v1', label: 'TSLA reference', assets: ['TSLA'], description: 'Configured OpenAlice fundamentals, estimates, calendar and news providers.' },
      load: ({ at }) => teslaContext(deps, at),
    },
  ])
}
