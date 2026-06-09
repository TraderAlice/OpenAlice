/**
 * Federated bar layer — types.
 *
 * The bar layer is the *operational* identity namespace for K-lines (vs the
 * *reference* namespace — fundamentals/macro — which stays provider-first in
 * OpenTypeBB). A bar source is identified by a `barId`:
 *
 *   barId = "{sourceId}|{nativeSymbol}"
 *
 * For UTA/broker sources this EQUALS the contract's `aliceId`
 * ("{utaId}|{nativeKey}"). For vendor sources it is "{vendorId}|{symbol}"
 * (e.g. "yfinance|AAPL"). There is NO cross-source normalization — the same
 * asset from N sources yields N distinct barIds; redundancy is the feature.
 *
 * Kept market-data-native (OhlcvBar/BarMeta) so `domain/market-data` carries
 * no dependency on `domain/analysis`; the analysis tool bridges to its own
 * structurally-identical `OhlcvData`/`DataSourceMeta` for free.
 */

import type { Bar, BarParams, ContractSearchHit } from '@traderalice/uta-protocol'
import type { AssetClass, MarketSearchDeps } from '../aggregate-search.js'
import type {
  EquityClientLike,
  CryptoClientLike,
  CurrencyClientLike,
  CommodityClientLike,
} from '../client/types.js'

// ==================== barId ====================

export interface BarRef {
  sourceId: string
  nativeSymbol: string
}

/** Split a barId on the FIRST `|` (nativeKey may itself contain separators). */
export function parseBarId(barId: string): BarRef | null {
  const idx = barId.indexOf('|')
  if (idx <= 0) return null
  return { sourceId: barId.slice(0, idx), nativeSymbol: barId.slice(idx + 1) }
}

export function formatBarId(sourceId: string, nativeSymbol: string): string {
  return `${sourceId}|${nativeSymbol}`
}

// ==================== data shapes ====================

/** OHLCV bar — structurally identical to `analysis/indicator` `OhlcvData`. */
export interface OhlcvBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  [key: string]: unknown
}

export type BarSourceKind = 'vendor' | 'uta'
export type BarCapability = 'free' | 'delayed' | 'subscription' | 'iex' | 'realtime'

/** Data-source metadata — structurally a superset of `DataSourceMeta`. */
export interface BarMeta {
  symbol: string
  from: string
  to: string
  bars: number
  source?: BarSourceKind
  sourceId?: string
  barId?: string
  provider?: string
  barCapability?: BarCapability
}

export interface BarSourceCandidate {
  barId: string
  source: BarSourceKind
  sourceId: string
  symbol: string
  /** Human-readable asset name (vendor results) — for the search list. */
  name?: string
  assetClass: AssetClass | 'unknown'
  label: string
  barCapability?: BarCapability
}

export interface BarsResult {
  bars: OhlcvBar[]
  meta: BarMeta
}

// ==================== service contract ====================

/** Window options. Supply a bounding pair; a hard max-bars cap always applies. */
export interface GetBarsOpts {
  interval: string
  /** Number of most-recent bars (anchored to `asOf`/`end`, default now). */
  count?: number
  /** Explicit lower bound (YYYY-MM-DD). */
  start?: string
  /** Explicit upper bound (YYYY-MM-DD); also the count anchor. */
  end?: string
  /** Point-in-time anchor for `count` (alias of `end`; default now). */
  asOf?: string
}

/**
 * A getBars reference: either a vendor-default request keyed by
 * `{symbol, assetClass}`, or an explicit `barId` (assetClass optional — only
 * needed to route a *vendor* barId to the right client; UTA barIds don't need it).
 */
export type BarSourceRef =
  | { symbol: string; assetClass: AssetClass }
  | { barId: string; assetClass?: AssetClass }

export interface BarService {
  searchBarSources(query: string, opts?: { limit?: number }): Promise<BarSourceCandidate[]>
  getBars(ref: BarSourceRef, opts: GetBarsOpts): Promise<BarsResult>
}

// ==================== deps (structural — no services/ import) ====================

/** Minimal broker-bar account surface (UTAAccountSDK satisfies it structurally). */
export interface UtaBarAccount {
  getHistorical(query: { aliceId?: string }, params: BarParams): Promise<Bar[]>
}

/** Minimal broker-bar gateway (UTAManagerSDK satisfies it structurally). */
export interface UtaBarGateway {
  has(id: string): Promise<boolean>
  get(id: string): Promise<UtaBarAccount | undefined>
  /** Flat contract-search hits across all accounts (for searchBarSources). */
  searchContracts(pattern: string): Promise<ContractSearchHit[]>
}

export interface BarServiceDeps {
  marketSearch: MarketSearchDeps
  equityClient: EquityClientLike
  cryptoClient: CryptoClientLike
  currencyClient: CurrencyClientLike
  commodityClient: CommodityClientLike
  utaManager: UtaBarGateway
  /** Configured default provider per asset class — the `provider` we report. */
  vendorProviders: Record<AssetClass, string>
}
