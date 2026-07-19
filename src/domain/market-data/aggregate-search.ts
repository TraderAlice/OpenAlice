/**
 * Aggregate Symbol Search
 *
 * Cross-asset-class heuristic search that respects Alice's per-asset-class
 * provider config. Used both by the AI tool (marketSearchForResearch) and the
 * HTTP route (/api/market/search) — both surfaces must return the same thing.
 *
 * equity    — SymbolIndex (SEC/TMX local cache, regex, zero-latency)
 * commodity — CommodityCatalog (canonical catalog, ~25 items)
 * crypto    — cryptoClient.search on yfinance (online fuzzy)
 * currency  — currencyClient.search on yfinance (online fuzzy, XXXUSD filter)
 */
import type { SymbolIndex } from './equity/symbol-index.js'
import type { CommodityCatalog } from './commodity/commodity-catalog.js'
import type { CryptoClientLike, CurrencyClientLike, EquityClientLike } from './client/types.js'

export type AssetClass = 'equity' | 'crypto' | 'currency' | 'commodity'

export interface MarketSearchDeps {
  symbolIndex: SymbolIndex
  /** Equity vendors to fan search across — [primary, ...extraVendors]. The
   *  first is the default (yfinance) that also backs the local SEC index;
   *  the rest are user-opted incremental vendors (e.g. eastmoney).
   *
   *  A function form is resolved per call so a vendor the agent just enabled
   *  (via setMarketVendor → market-data.json) is picked up on the next search
   *  with no restart. A plain array is still accepted (tests, static wiring). */
  equityVendors: string[] | (() => string[] | Promise<string[]>)
  equityClient: EquityClientLike
  cryptoClient: CryptoClientLike
  currencyClient: CurrencyClientLike
  commodityCatalog: CommodityCatalog
}

export interface MarketSearchResult {
  /** Equity / crypto / currency have a symbol; commodity uses `id` instead (canonical). */
  symbol?: string
  id?: string
  name?: string | null
  assetClass: AssetClass
  /** Which vendor produced this hit — drives the barId's sourceId so getBars
   *  routes back to the same vendor. Absent for crypto/currency/commodity
   *  (they fall back to the configured per-asset provider). */
  sourceId?: string
  [key: string]: unknown
}

/**
 * Score a result against the query. Higher is better.
 * Tiers:
 *   100  exact match on symbol, id, or name (case-insensitive)
 *    90  exact match on a commodity alias (e.g. "xau" → gold)
 *    80  symbol/id starts with the query
 *    70  name starts with the query (at a word boundary)
 *    50  name contains the query as a whole word
 *    30  name contains the query as a substring
 *    10  fallback — matched upstream but nothing we can explain
 */
function matchScore(query: string, r: MarketSearchResult): number {
  const q = query.toLowerCase()
  const sym = String(r.symbol ?? r.id ?? '').toLowerCase()
  const name = String(r.name ?? '').toLowerCase()
  const aliases = Array.isArray(r.aliases) ? (r.aliases as string[]).map((a) => a.toLowerCase()) : []

  if (sym === q || name === q) return 100
  if (aliases.includes(q)) return 90
  if (sym && sym.startsWith(q)) return 80
  // Name starts with query only counts as a strong match when the match
  // ends at a word boundary — otherwise "gold" would rank "goldman" above
  // "SPDR gold trust".
  if (name.startsWith(q) && (name.length === q.length || !/[a-z0-9]/i.test(name[q.length]))) return 70
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(name)) return 50
  if (name.includes(q)) return 30
  return 10
}

export async function aggregateSymbolSearch(
  deps: MarketSearchDeps,
  query: string,
  limit = 20,
): Promise<MarketSearchResult[]> {
  const q = query.trim()
  if (!q) return []
  const boundedLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 20))

  const equityVendors = typeof deps.equityVendors === 'function'
    ? await deps.equityVendors()
    : deps.equityVendors
  const primaryEquity = equityVendors[0] ?? 'yfinance'

  // Local SEC index — US-only, zero-latency, authoritative for US tickers.
  // Attributed to the primary equity vendor (its symbols feed that provider).
  const equityResults = deps.symbolIndex
    .search(q, boundedLimit)
    .map((r) => ({ ...r, assetClass: 'equity' as const, sourceId: primaryEquity }))

  const commodityResults = deps.commodityCatalog
    .search(q, boundedLimit)
    .map((r) => ({ ...r, assetClass: 'commodity' as const }))

  // Online searches, concurrent: crypto + currency on yfinance; equity fanned
  // out over EVERY enabled vendor (default yfinance + user-opted extras like
  // eastmoney). Each equity vendor lives in its own symbol namespace — yfinance
  // returns Yahoo tickers (600519.SS), eastmoney returns secids (1.600519) for
  // CN names yfinance can't match — so all are kept as redundant candidates.
  const [coreSettled, equitySettled] = await Promise.all([
    Promise.allSettled([
      deps.cryptoClient.search({ query: q, provider: 'yfinance' }),
      deps.currencyClient.search({ query: q, provider: 'yfinance' }),
    ]),
    Promise.allSettled(
      equityVendors.map((v) =>
        deps.equityClient
          .search({ query: q, provider: v, is_symbol: false })
          .then((rows) => ({ vendor: v, rows })),
      ),
    ),
  ])
  const [cryptoSettled, currencySettled] = coreSettled

  const cryptoResults = (cryptoSettled.status === 'fulfilled' ? cryptoSettled.value : []).map(
    (r) => ({ ...r, assetClass: 'crypto' as const }),
  )

  const currencyResults = (currencySettled.status === 'fulfilled' ? currencySettled.value : [])
    .filter((r) => {
      const sym = (r as Record<string, unknown>).symbol as string | undefined
      return sym?.endsWith('USD')
    })
    .map((r) => ({ ...r, assetClass: 'currency' as const }))

  // Merge equity online hits, de-duped WITHIN each vendor's namespace by
  // `vendor|symbol` (the SEC index already seeded the primary vendor's keys, so
  // a US name doesn't double up). Cross-vendor redundancy is intentional —
  // 600519.SS (yfinance) and 1.600519 (eastmoney) are different sources.
  const seenEquity = new Set(
    equityResults.map((r) => `${r.sourceId}|${String((r as Record<string, unknown>).symbol ?? '').toUpperCase()}`),
  )
  const equityOnlineResults: MarketSearchResult[] = []
  for (const settled of equitySettled) {
    if (settled.status !== 'fulfilled') continue
    const { vendor, rows } = settled.value
    for (const r of rows) {
      const sym = String((r as Record<string, unknown>).symbol ?? '')
      const key = `${vendor}|${sym.toUpperCase()}`
      if (!sym || seenEquity.has(key)) continue
      seenEquity.add(key)
      equityOnlineResults.push({ ...r, symbol: sym, assetClass: 'equity', sourceId: vendor })
    }
  }

  const all: MarketSearchResult[] = [
    ...equityResults,
    ...equityOnlineResults,
    ...cryptoResults,
    ...currencyResults,
    ...commodityResults,
  ]

  // Stable sort by match quality descending; ties keep upstream order.
  return all
    .map((r, i) => ({ r, i, s: matchScore(q, r) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r)
    .slice(0, boundedLimit)
}
