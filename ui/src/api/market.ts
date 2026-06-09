import { fetchJson } from './client'

export type AssetClass = 'equity' | 'crypto' | 'currency' | 'commodity'

export interface SearchResult {
  /** Equity / crypto / currency have `symbol`. Commodity uses `id` (canonical). */
  symbol?: string
  id?: string
  name?: string | null
  assetClass: AssetClass
  // upstream fields pass through (cik, source, currency, exchange, exchange_name, category, …)
  [key: string]: unknown
}

export interface SearchResponse {
  results: SearchResult[]
  count: number
}

export interface HistoricalBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export interface HistoricalResponse {
  results: HistoricalBar[] | null
  provider: string
  error?: string
}

/**
 * Raw OBBject envelope for single-record endpoints (profile, quote, …).
 * The provider schemas are rich and not worth mirroring here — panels pick the
 * fields they display. Keep results loose so we don't drift on every provider
 * schema nudge upstream.
 */
export interface OBBjectResponse<T = Record<string, unknown>> {
  results: T[] | null
  provider: string
  error?: string
}

export type EquityProfile = Record<string, unknown>
export type EquityQuote = Record<string, unknown>
export type FinancialRatios = Record<string, unknown>
export type KeyMetrics = Record<string, unknown>
export type FinancialStatementRow = Record<string, unknown>

function equityEndpoint<T>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<OBBjectResponse<T>> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v))
  return fetchJson(`/api/market-data-v1/equity/${path}?${qs}`)
}

export type RotationPeriod = '1D' | '1W' | '1M' | '3M' | '6M'

/** Mirrors the backend `SectorRotationRow` (domain/analysis/sector-rotation). */
export interface SectorRotationRow {
  symbol: string
  sector: string
  returns: Record<RotationPeriod, number | null>
  rel_strength: Record<RotationPeriod, number | null>
  momentum_acceleration: number | null
  dollar_volume: number | null
  dv_share: number | null
  dv_share_change: number | null
  rvol: number | null
  rotation_score: number | null
  bars: number
}

export interface SectorRotationResult {
  asOf: string
  benchmark: { symbol: string; returns: Record<RotationPeriod, number | null> }
  /** Sorted by rotation_score desc; null-score rows at the bottom. */
  sectors: SectorRotationRow[]
  methodology: string
}

export const marketApi = {
  /** Alice's aggregated heuristic search across all asset classes. */
  async search(query: string, limit = 20): Promise<SearchResponse> {
    const qs = new URLSearchParams({ query, limit: String(limit) })
    return fetchJson(`/api/market/search?${qs}`)
  },

  /** GICS sector rotation table (11 sector ETFs + SPY anchor). */
  async sectorRotation(): Promise<SectorRotationResult> {
    return fetchJson('/api/market/sector-rotation')
  },

  /**
   * Historical OHLCV candles. Provider comes from the server-side default
   * (config.marketData.providers[assetClass]) — UI doesn't pick provider.
   * `assetClass` only decides the URL prefix; `interval` defaults to `1d`.
   */
  async historical(
    assetClass: AssetClass,
    symbol: string,
    opts: { interval?: string; startDate?: string; endDate?: string } = {},
  ): Promise<HistoricalResponse> {
    if (assetClass === 'commodity') {
      throw new Error('commodity historical not supported yet')
    }
    const qs = new URLSearchParams({ symbol })
    qs.set('interval', opts.interval ?? '1d')
    if (opts.startDate) qs.set('start_date', opts.startDate)
    if (opts.endDate) qs.set('end_date', opts.endDate)
    return fetchJson(`/api/market-data-v1/${assetClass}/price/historical?${qs}`)
  },

  /** Equity-specific endpoints — Alice infers provider from config, no ?provider=. */
  equity: {
    profile: (symbol: string) => equityEndpoint<EquityProfile>('profile', { symbol }),
    quote: (symbol: string) => equityEndpoint<EquityQuote>('price/quote', { symbol }),
    metrics: (symbol: string) => equityEndpoint<KeyMetrics>('fundamental/metrics', { symbol }),
    ratios: (symbol: string) => equityEndpoint<FinancialRatios>('fundamental/ratios', { symbol }),
    balance: (symbol: string) => equityEndpoint<FinancialStatementRow>('fundamental/balance', { symbol }),
    income: (symbol: string) => equityEndpoint<FinancialStatementRow>('fundamental/income', { symbol }),
    cashflow: (symbol: string) => equityEndpoint<FinancialStatementRow>('fundamental/cash', { symbol }),
  },
}

// ==================== Federated bars (multi-source K-lines) ====================

export type BarSource = 'vendor' | 'uta'
export type BarCapability = 'realtime' | 'iex' | 'delayed' | 'subscription' | 'free'

/** A selectable K-line source for a symbol — the provider is always explicit
 *  (TradingView-style "symbol · provider"); sources are never normalized away. */
export interface BarSourceCandidate {
  barId: string
  source: BarSource
  sourceId: string
  symbol: string
  name?: string
  assetClass: AssetClass | 'unknown'
  label: string
  barCapability?: BarCapability
}

/** Provenance of the bars currently shown — the explicit "who provided this". */
export interface BarMeta {
  symbol: string
  from: string
  to: string
  bars: number
  source: BarSource
  sourceId: string
  barId: string
  provider: string
  barCapability?: BarCapability
}

export interface BarsResponse {
  results: HistoricalBar[] | null
  meta: BarMeta | null
  error?: string
}

export const barsApi = {
  /** Federated source candidates (barIds across vendors + connected brokers). */
  async searchSources(query: string, limit = 20): Promise<{ candidates: BarSourceCandidate[]; count: number }> {
    const qs = new URLSearchParams({ query, limit: String(limit) })
    return fetchJson(`/api/bars/search?${qs}`)
  },

  /** Bars for an explicit source (barId) or the vendor default (symbol+assetClass). */
  async bars(params: {
    barId?: string
    symbol?: string
    assetClass?: AssetClass
    interval: string
    count?: number
    start?: string
    end?: string
  }): Promise<BarsResponse> {
    const qs = new URLSearchParams({ interval: params.interval })
    if (params.barId) qs.set('barId', params.barId)
    if (params.symbol) qs.set('symbol', params.symbol)
    if (params.assetClass) qs.set('assetClass', params.assetClass)
    if (params.count != null) qs.set('count', String(params.count))
    if (params.start) qs.set('start', params.start)
    if (params.end) qs.set('end', params.end)
    return fetchJson(`/api/bars?${qs}`)
  },
}
