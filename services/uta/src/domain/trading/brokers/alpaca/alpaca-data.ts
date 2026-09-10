import type { AlpacaBrokerConfig } from './alpaca-types.js'

export type { OptionResearchFilters as OptionFilters } from '@traderalice/uta-protocol'
import type { OptionResearchFilters as OptionFilters } from '@traderalice/uta-protocol'

export interface OptionContractRaw {
  symbol: string
  underlying_symbol: string
  expiration_date: string
  type: 'call' | 'put'
  strike_price: string
  size: string
  multiplier?: string
  status: string
  tradable: boolean
  open_interest?: string | null
  open_interest_date?: string | null
  close_price?: string | null
  close_price_date?: string | null
}

export interface SnapshotRaw {
  dailyBar?: { v: number; h: number; l: number; t: string }
  latestTrade?: { p: number; t: string; s?: number }
  latestQuote?: { bp: number; ap: number; bs?: number; as?: number; t: string }
  impliedVolatility?: number
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number }
}

/** SDK v3 predates current crypto/options endpoints. Keep authenticated reads
 * in the broker pack; callers cannot choose an arbitrary credential destination. */
export class AlpacaData {
  constructor(private readonly config: AlpacaBrokerConfig) {}

  async read<T>(path: string, query: Record<string, string | number | undefined> = {}, trading = false): Promise<T> {
    const origin = trading
      ? (this.config.paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets')
      : 'https://data.alpaca.markets'
    const url = new URL(path, origin)
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value))
    const response = await fetch(url, {
      headers: { 'APCA-API-KEY-ID': this.config.apiKey, 'APCA-API-SECRET-KEY': this.config.secretKey },
      signal: AbortSignal.timeout(30_000), redirect: 'error',
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Alpaca ${response.status} ${path}: ${body.slice(0, 1000)}`)
    }
    return await response.json() as T
  }

  optionQuery(filters: OptionFilters) {
    return {
      expiration_date: filters.expiration,
      expiration_date_gte: filters.expirationFrom,
      expiration_date_lte: filters.expirationTo,
      type: filters.right, strike_price_gte: filters.strikeMin, strike_price_lte: filters.strikeMax,
      limit: filters.limit ?? 100, page_token: filters.pageToken,
    }
  }

  async optionContracts(underlying: string, filters: OptionFilters = {}) {
    const result = await this.read<{ option_contracts: OptionContractRaw[]; next_page_token?: string | null }>(
      '/v2/options/contracts', {
        underlying_symbols: underlying, status: 'active', ...this.optionQuery(filters),
        // Override Alpaca's implicit next-weekend cutoff. Omitted upper bound
        // must allow later expirations instead of silently hiding the chain.
        expiration_date_lte: filters.expirationTo ?? filters.expiration ?? '2099-12-31',
      }, true)
    return { contracts: result.option_contracts ?? [], nextPageToken: result.next_page_token ?? null,
      metadata: { retrievedAt: new Date().toISOString(), openInterest: 'Daily observation; use open_interest_date per contract.' } }
  }

  async optionSnapshots(underlying: string, filters: OptionFilters = {}) {
    const feed = filters.feed ?? 'indicative'
    const result = await this.read<{ snapshots: Record<string, SnapshotRaw>; next_page_token?: string | null }>(
      `/v1beta1/options/snapshots/${encodeURIComponent(underlying)}`, { ...this.optionQuery(filters), feed })
    return { snapshots: result.snapshots ?? {}, nextPageToken: result.next_page_token ?? null,
      metadata: {
        feed, retrievedAt: new Date().toISOString(),
        indicative: feed === 'indicative', possiblyDelayed: feed === 'indicative',
        note: feed === 'indicative' ? 'Trades are delayed and quotes are modified. Not executable OPRA quotes. Use each trade/quote timestamp; delay is not inferred from retrieval time.' : 'OPRA subscription required. Use each trade/quote timestamp.',
      } }
  }
}
