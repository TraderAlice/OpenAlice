import { EmptyDataError } from '../../core/provider/utils/errors.js'
import { amakeRequest, buildQueryString } from '../../core/provider/utils/helpers.js'
import { fetchTradingViewBars, type FetchTradingViewBarsOptions, type TradingViewBar } from './utils/websocket.js'

export type TradingViewAssetKind = 'equity' | 'crypto' | 'currency'
export type TradingViewSearchType = 'stock' | 'crypto' | 'forex'
export type TradingViewBarInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w'

export const TRADINGVIEW_PROVIDER_ID = 'tradingview'
export const TRADINGVIEW_BAR_CAPABILITY = 'delayed'

export const TRADINGVIEW_INTERVALS: Record<TradingViewBarInterval, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
}

export const TRADINGVIEW_HISTORICAL_INTERVALS = Object.keys(TRADINGVIEW_INTERVALS) as [
  TradingViewBarInterval,
  ...TradingViewBarInterval[],
]

export interface TradingViewFeedSemantics {
  provider: typeof TRADINGVIEW_PROVIDER_ID
  capability: typeof TRADINGVIEW_BAR_CAPABILITY
  coverage: 'tradingview_global' | 'cboe_one'
  volumeQuality: 'exchange_dependent' | 'partial_market'
  isAnonymous: true
  isFreshnessExchangeDependent: true
  supportsInternal3mIntrabars: boolean
}

export interface TradingViewSearchSemantics {
  coverage: 'tradingview_global'
  volumeQuality: 'exchange_dependent'
}

export interface TradingViewHistoricalQuery {
  symbol: string
  interval: TradingViewBarInterval
  start_date?: string | null
  end_date?: string | null
  count?: number
}

export interface TradingViewSearchRow {
  symbol: string
  name: unknown
  aliases: string[]
  exchange: unknown
  listed_exchange: unknown
  provider_id: unknown
  type: unknown
  country?: unknown
  coverage?: TradingViewFeedSemantics['coverage']
  volume_quality?: TradingViewFeedSemantics['volumeQuality']
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const SEARCH_URL = 'https://symbol-search.tradingview.com/symbol_search/v3'
const SEARCH_HEADERS = {
  Origin: 'https://www.tradingview.com',
  'User-Agent': 'Mozilla/5.0',
}

interface TradingViewSearchResponse {
  symbols?: Array<Record<string, unknown>>
}

export function describeTradingViewFeed(
  assetKind: TradingViewAssetKind,
  symbol?: string,
): TradingViewFeedSemantics {
  const isBareEquitySymbol = assetKind === 'equity' && !symbol?.includes(':')
  return {
    provider: TRADINGVIEW_PROVIDER_ID,
    capability: TRADINGVIEW_BAR_CAPABILITY,
    coverage: isBareEquitySymbol ? 'cboe_one' : 'tradingview_global',
    volumeQuality: isBareEquitySymbol ? 'partial_market' : 'exchange_dependent',
    isAnonymous: true,
    isFreshnessExchangeDependent: true,
    supportsInternal3mIntrabars: true,
  }
}

export function describeTradingViewSearchFeed(): TradingViewSearchSemantics {
  return {
    coverage: 'tradingview_global',
    volumeQuality: 'exchange_dependent',
  }
}

export function isValidTradingViewDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function minutesFor(interval: string): number {
  switch (interval) {
    case '1m': return 1
    case '3m': return 3
    case '5m': return 5
    case '15m': return 15
    case '30m': return 30
    case '1h': return 60
    case '4h': return 4 * 60
    case '1d': return 24 * 60
    case '1w': return 7 * 24 * 60
    default: return 1
  }
}

export function estimateTradingViewRange(query: TradingViewHistoricalQuery): number {
  if (query.count != null) return Math.max(1, Math.min(query.count, 10_000))
  const end = query.end_date ? new Date(`${query.end_date}T23:59:59Z`) : new Date()
  const start = query.start_date ? new Date(`${query.start_date}T00:00:00Z`) : null
  if (!start || Number.isNaN(start.getTime())) return query.interval === '1m' ? 5_000 : 1_000
  const elapsedMinutes = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 60_000))
  const raw = Math.ceil(elapsedMinutes / minutesFor(query.interval))
  return Math.max(100, Math.min(raw + 50, 10_000))
}

export function tradingViewEndTimestamp(query: TradingViewHistoricalQuery): number | null {
  if (!query.end_date) return null
  return Math.floor(new Date(`${query.end_date}T23:59:59Z`).getTime() / 1000)
}

export function formatTradingViewTime(unixSeconds: number): string {
  const iso = new Date(unixSeconds * 1000).toISOString()
  return iso.slice(0, 19).replace('T', ' ')
}

export function isInsideTradingViewDateWindow(date: string, query: TradingViewHistoricalQuery): boolean {
  const day = date.slice(0, 10)
  if (query.start_date && day < query.start_date) return false
  if (query.end_date && day > query.end_date) return false
  return true
}

export function buildTradingViewHistoricalRequest(
  query: TradingViewHistoricalQuery,
  options: { session?: 'regular' | 'extended' } = {},
): FetchTradingViewBarsOptions {
  return {
    symbol: query.symbol,
    interval: TRADINGVIEW_INTERVALS[query.interval],
    range: estimateTradingViewRange(query),
    to: tradingViewEndTimestamp(query),
    session: options.session,
  }
}

export async function fetchTradingViewHistoricalBars(
  query: TradingViewHistoricalQuery,
  options: {
    session?: 'regular' | 'extended'
    fetchBars?: (request: FetchTradingViewBarsOptions) => Promise<TradingViewBar[]>
  } = {},
): Promise<TradingViewBar[]> {
  const fetchBars = options.fetchBars ?? fetchTradingViewBars
  return fetchBars(buildTradingViewHistoricalRequest(query, options))
}

export function mapTradingViewHistoricalBars<TRow>(
  query: TradingViewHistoricalQuery,
  bars: TradingViewBar[],
  options: {
    emptyDataMessage: string
    mapBar: (input: { bar: TradingViewBar; date: string; semantics: TradingViewFeedSemantics }) => unknown
    parse: (row: unknown) => TRow
    assetKind: TradingViewAssetKind
  },
): TRow[] {
  const semantics = describeTradingViewFeed(options.assetKind, query.symbol)
  const out = [...bars]
    .sort((a, b) => a.time - b.time)
    .map((bar) => options.mapBar({ bar, date: formatTradingViewTime(bar.time), semantics }))
    .filter((row) => {
      const date = typeof row === 'object' && row != null && 'date' in row
        ? String(row.date)
        : ''
      return isInsideTradingViewDateWindow(date, query)
    })

  if (out.length === 0) {
    throw new EmptyDataError(options.emptyDataMessage)
  }

  return out.map((row) => options.parse(row))
}

function fullTradingViewSymbol(row: Record<string, unknown>): string {
  const symbol = String(row['symbol'] ?? '').toUpperCase()
  const prefix = typeof row['prefix'] === 'string' ? row['prefix'].toUpperCase() : ''
  const exchange = typeof row['exchange'] === 'string' ? row['exchange'].split(' ')[0].toUpperCase() : ''
  const source = prefix || exchange
  return source ? `${source}:${symbol}` : symbol
}

function baseTradingViewSymbolAlias(row: Record<string, unknown>): string[] {
  return typeof row['symbol'] === 'string' ? [row['symbol'].toUpperCase()] : []
}

export function mapTradingViewSearchRows(
  rows: Record<string, unknown>[],
  assetKind: TradingViewAssetKind,
): TradingViewSearchRow[] {
  const searchSemantics = describeTradingViewSearchFeed()
  return rows
    .map((row) => ({
      symbol: fullTradingViewSymbol(row),
      name: row['description'] ?? null,
      aliases: baseTradingViewSymbolAlias(row),
      exchange: row['exchange'] ?? null,
      listed_exchange: row['source_id'] ?? row['exchange'] ?? null,
      provider_id: row['provider_id'] ?? null,
      country: assetKind === 'equity' ? row['country'] ?? null : undefined,
      type: row['type'] ?? null,
      coverage: assetKind === 'equity' ? searchSemantics.coverage : undefined,
      volume_quality: assetKind === 'equity' ? searchSemantics.volumeQuality : undefined,
    }))
    .filter((row) => row.symbol)
}

export async function searchTradingViewSymbols(
  query: string | null | undefined,
  searchType: TradingViewSearchType,
): Promise<Record<string, unknown>[]> {
  if (!query) return []
  const normalized = query.toUpperCase().replace(/\s+/g, '+')
  const parts = normalized.split(':')
  const [exchange, text] = parts.length === 2 ? parts : ['', normalized]
  const qs = buildQueryString({
    text,
    search_type: searchType,
    exchange: exchange || undefined,
  })
  const data = await amakeRequest<TradingViewSearchResponse>(`${SEARCH_URL}?${qs}`, { headers: SEARCH_HEADERS })
  return data.symbols ?? []
}
