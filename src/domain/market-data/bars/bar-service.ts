/**
 * Federated bar layer — service.
 *
 * `getBars(ref, opts)` resolves a bar request to a single source and fetches
 * OHLCV, tagging the result with source metadata. `searchBarSources(query)`
 * surfaces candidate sources for an asset.
 *
 * Phase 0 scope: the vendor branch is fully wired; the UTA branch calls
 * `UTAAccountSDK.getHistorical` (404s until the Phase-1 server route + a
 * per-broker `getHistorical` land). `searchBarSources` is vendor-only here —
 * the UTA search side (and the `ContractSearchResult` wire-shape fix) lands in
 * Phase 1 alongside CCXT. No Phase-0 consumer calls `searchBarSources`.
 */

import type { BarParams, BarInterval, Bar } from '@traderalice/uta-protocol'
import { aggregateSymbolSearch, type AssetClass } from '../aggregate-search.js'
import type {
  BarService,
  BarServiceDeps,
  BarSourceRef,
  BarSourceCandidate,
  GetBarsOpts,
  BarsResult,
  OhlcvBar,
  BarMeta,
  BarCapability,
} from './types.js'
import { formatBarId, parseBarId } from './types.js'

/** Hard ceiling on bars returned by any single fetch (explosion guard). */
const MAX_BARS = 5000

/** Vendor → bar capability (honest-ish defaults; vendors mostly serve delayed). */
const VENDOR_CAPABILITY: Record<string, BarCapability> = {
  yfinance: 'delayed',
  fmp: 'delayed',
}

const BAR_INTERVALS: readonly BarInterval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']

function toBarInterval(interval: string): BarInterval {
  return (BAR_INTERVALS as readonly string[]).includes(interval)
    ? (interval as BarInterval)
    : '1d'
}

/** Map a broker secType to the data-vendor asset class (for candidate display
 *  + later vendor-fallback routing). 'unknown' when it doesn't map cleanly. */
function secTypeToAssetClass(secType: string | undefined): AssetClass | 'unknown' {
  switch ((secType ?? '').toUpperCase()) {
    case 'STK': case 'ETF': case 'WAR': return 'equity'
    case 'CRYPTO': case 'CRYPTO_PERP': return 'crypto'
    case 'CASH': return 'currency'
    case 'FUT': case 'FOP': case 'CMDTY': return 'commodity'
    default: return 'unknown'
  }
}

// ---- window heuristics (legacy behavior-preserving; lifted from tool/analysis.ts) ----

function getCalendarDays(interval: string): number {
  const match = interval.match(/^(\d+)([dwhm])$/)
  if (!match) return 365
  const n = parseInt(match[1], 10)
  switch (match[2]) {
    case 'd': return n * 730
    case 'w': return n * 1825
    case 'h': return n * 90
    case 'm': return n * 30
    default: return 365
  }
}

/** Approximate calendar days per bar — used to size a count-bounded window. */
function perBarDays(interval: string): number {
  const match = interval.match(/^(\d+)([dwhm])$/)
  if (!match) return 1.6
  const n = parseInt(match[1], 10)
  switch (match[2]) {
    case 'd': return n * 1.6
    case 'w': return n * 7.5
    case 'h': return n * 0.2
    case 'm': return n * 0.05
    default: return 1.6
  }
}

function startDateFor(opts: GetBarsOpts): string {
  if (opts.start) return opts.start
  const anchor = opts.asOf ?? opts.end
  const end = anchor ? new Date(anchor) : new Date()
  const days = opts.count != null
    ? Math.max(getCalendarDays(opts.interval), Math.ceil(opts.count * perBarDays(opts.interval)) + 5)
    : getCalendarDays(opts.interval)
  const start = new Date(end)
  start.setDate(start.getDate() - days)
  return start.toISOString().slice(0, 10)
}

// ---- bar shaping ----

function isFullBar(d: Record<string, unknown>): boolean {
  return d.close != null && d.open != null && d.high != null && d.low != null
}

function dateOf(bar: Bar, interval?: string): string {
  // Bar.timestamp is typed Date, but it crosses the Alice↔UTA HTTP wire as an
  // ISO string (JSON has no Date) — normalize either form before formatting.
  const iso = new Date(bar.timestamp).toISOString()
  // A daily/weekly bar is a calendar day, not an instant — render date-only even
  // when a broker stamps it at the session open (e.g. Alpaca's 04:00/05:00 ET,
  // which also flips an hour across DST and looks like a bug). Intraday keeps
  // its time; a UTC-midnight stamp is date-only regardless.
  const daily = interval === '1d' || interval === '1w'
  if (daily || iso.endsWith('T00:00:00.000Z')) return iso.slice(0, 10)
  return iso.slice(0, 19).replace('T', ' ')
}

function barToOhlcv(bar: Bar, interval?: string): OhlcvBar {
  return {
    date: dateOf(bar, interval),
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: bar.volume === '' || bar.volume == null ? null : Number(bar.volume),
  }
}

function buildMeta(symbol: string, bars: OhlcvBar[], extra: Partial<BarMeta>): BarMeta {
  return {
    symbol,
    from: bars.length > 0 ? bars[0].date : '',
    to: bars.length > 0 ? bars[bars.length - 1].date : '',
    bars: bars.length,
    ...extra,
  }
}

/** Trading-day gap between two YYYY-MM-DD dates (Mon–Fri; holidays ignored, so
 *  a holiday inflates the gap by ≤1 — acceptable for a staleness signal). */
function tradingDaysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00Z`)
  const b = new Date(`${toISO}T00:00:00Z`)
  if (!(b.getTime() > a.getTime())) return 0
  let days = 0
  const d = new Date(a)
  while (d.getTime() < b.getTime()) {
    d.setUTCDate(d.getUTCDate() + 1)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) days++
  }
  return days
}

/** Freshness contract — did the data actually reach the requested point-in-time?
 *  Anchor = explicit end/asOf, else today. The point is to make a delayed source
 *  that silently stopped a day behind "now" LOUD, not to mask it as current. */
function computeFreshness(
  lastBarDate: string,
  opts: GetBarsOpts,
  now: () => Date,
): Pick<BarMeta, 'asOf' | 'isLatestActual' | 'staleTradingDays'> {
  if (!lastBarDate) return {}
  const anchor = (opts.end ?? opts.asOf ?? now().toISOString().slice(0, 10)).slice(0, 10)
  const gap = tradingDaysBetween(lastBarDate.slice(0, 10), anchor)
  return { asOf: anchor, isLatestActual: gap === 0, staleTradingDays: gap }
}

/** Sort ascending, cap to MAX_BARS (keep most-recent), then truncate to `count`. */
function finalize(data: OhlcvBar[], count?: number): OhlcvBar[] {
  data.sort((a, b) => a.date.localeCompare(b.date))
  let out = data
  if (out.length > MAX_BARS) {
    console.warn(`[bar-service] result ${out.length} bars exceeds MAX_BARS=${MAX_BARS}; keeping most recent`)
    out = out.slice(-MAX_BARS)
  }
  if (count != null && out.length > count) out = out.slice(-count)
  return out
}

export function createBarService(deps: BarServiceDeps): BarService {
  // -------- vendor fetch --------
  async function getVendorBars(
    provider: string,
    assetClass: AssetClass,
    symbol: string,
    opts: GetBarsOpts,
  ): Promise<BarsResult> {
    const start_date = startDateFor(opts)
    // Upper bound: the provider applies end_date (OpenTypeBB models support it);
    // we also post-filter defensively in case a provider ignores it.
    const end_date = opts.end
    const p = (extra?: Record<string, unknown>) => ({ symbol, start_date, provider, ...(end_date ? { end_date } : {}), ...extra })
    let raw: Array<Record<string, unknown>>
    switch (assetClass) {
      case 'equity':
        raw = await deps.equityClient.getHistorical(p({ interval: opts.interval }))
        break
      case 'crypto':
        raw = await deps.cryptoClient.getHistorical(p({ interval: opts.interval }))
        break
      case 'currency':
        raw = await deps.currencyClient.getHistorical(p({ interval: opts.interval }))
        break
      case 'commodity':
        raw = await deps.commodityClient.getSpotPrices(p())
        break
    }
    let bars = raw.filter(isFullBar) as OhlcvBar[]
    if (end_date) bars = bars.filter((b) => b.date.slice(0, 10) <= end_date)
    const filtered = finalize(bars, opts.count)
    return {
      bars: filtered,
      meta: buildMeta(symbol, filtered, {
        source: 'vendor',
        sourceId: provider,
        barId: formatBarId(provider, symbol),
        provider,
        barCapability: VENDOR_CAPABILITY[provider],
        ...computeFreshness(filtered[filtered.length - 1]?.date ?? '', opts, () => new Date()),
      }),
    }
  }

  // -------- uta (broker) fetch --------
  async function getUtaBars(sourceId: string, barId: string, opts: GetBarsOpts): Promise<BarsResult> {
    const acct = await deps.utaManager.get(sourceId)
    if (!acct) throw new Error(`UTA source "${sourceId}" not found for barId "${barId}"`)
    // Mirror the vendor branch: a count-only request becomes a START WINDOW we
    // over-fetch and then tail-slice (finalize keeps the most-recent `count`).
    // We deliberately do NOT forward `count` as the broker's `limit`. Alpaca's
    // getBarsV2 — and any API that anchors `limit` to a default *start* and
    // returns the FIRST N bars ascending — would otherwise collapse a count-only
    // request to the in-progress session: a single daily bar timestamped at the
    // premarket open, or just the first minutes of an intraday series, instead
    // of the most recent N. (Reproduced 2026-06-25 against alpaca paper: `1d
    // count=60` → 1 bar timestamped 04:00; `1m count=50` → 08:00–08:49.)
    const start = opts.start ?? (opts.count != null ? startDateFor(opts) : undefined)
    const params: BarParams = {
      interval: toBarInterval(opts.interval),
      start: start ? new Date(start) : undefined,
      end: (opts.end ?? opts.asOf) ? new Date((opts.end ?? opts.asOf)!) : undefined,
    }
    const wireBars = await acct.getHistorical({ aliceId: barId }, params)
    const bars = finalize(wireBars.map((b) => barToOhlcv(b, params.interval)), opts.count)
    const symbol = parseBarId(barId)?.nativeSymbol ?? barId
    return {
      bars,
      meta: buildMeta(symbol, bars, {
        source: 'uta',
        sourceId,
        barId,
        barCapability: 'realtime',
        ...computeFreshness(bars[bars.length - 1]?.date ?? '', opts, () => new Date()),
      }),
    }
  }

  return {
    async searchBarSources(query, opts) {
      const limit = opts?.limit ?? 20
      // Federate vendor (OpenTypeBB) + broker (UTA) search. allSettled so one
      // side failing (e.g. no UTA configured) doesn't kill the other. Flat
      // candidates, no cross-source dedup — redundancy is the feature.
      const [vendorRes, utaRes] = await Promise.allSettled([
        aggregateSymbolSearch(deps.marketSearch, query, limit),
        deps.utaManager.searchContracts(query),
      ])
      const out: BarSourceCandidate[] = []

      if (vendorRes.status === 'fulfilled') {
        for (const r of vendorRes.value) {
          const symbol = String(r.symbol ?? r.id ?? '')
          const provider = deps.vendorProviders[r.assetClass]
          const cap = VENDOR_CAPABILITY[provider]
          const base = r.name ? `${symbol} · ${r.name} (${provider})` : `${symbol} (${provider})`
          out.push({
            barId: formatBarId(provider, symbol),
            source: 'vendor',
            sourceId: provider,
            symbol,
            name: r.name ?? undefined,
            assetClass: r.assetClass,
            // Surface freshness IN the label, not just the structured barCapability
            // field, so the agent can't miss that a vendor source is delayed even
            // when it deliberately falls back to one (yfinance/fmp are EOD-delayed).
            label: cap ? `${base} · ${cap}` : base,
            barCapability: cap,
          })
        }
      }

      if (utaRes.status === 'fulfilled') {
        for (const hit of utaRes.value) {
          const barId = hit.contract.aliceId
          if (!barId) continue // need the operational identity to fetch later
          const symbol = hit.contract.symbol || hit.contract.localSymbol || ''
          out.push({
            barId,
            source: 'uta',
            sourceId: hit.source,
            symbol,
            // Venue-decided asset class is authoritative; secType is only a
            // broker-blind fallback (and wrong for e.g. a CCXT dated future).
            assetClass: hit.assetClass ?? secTypeToAssetClass(hit.contract.secType),
            label: (symbol ? `${symbol} (${hit.source})` : barId) + ' · realtime',
            barCapability: 'realtime',
          })
        }
      }

      // Order by freshness so the agent's default pick is the freshest source:
      // broker bars (realtime) float above delayed vendors (yfinance/fmp). The
      // list stays fully redundant — this is only the suggested ordering; every
      // candidate is still returned. (Array.sort is stable → within-source order
      // is preserved.)
      const FRESHNESS_RANK: Record<BarCapability, number> = {
        realtime: 0, iex: 1, subscription: 2, delayed: 3, free: 4,
      }
      out.sort(
        (a, b) =>
          (a.barCapability ? FRESHNESS_RANK[a.barCapability] : 5) -
          (b.barCapability ? FRESHNESS_RANK[b.barCapability] : 5),
      )
      return out
    },

    async getBars(ref, opts) {
      if ('symbol' in ref) {
        const provider = deps.vendorProviders[ref.assetClass]
        return getVendorBars(provider, ref.assetClass, ref.symbol, opts)
      }
      // barId form
      const parsed = parseBarId(ref.barId)
      if (!parsed) throw new Error(`Invalid barId "${ref.barId}" (expected "sourceId|nativeSymbol")`)
      const isUta = await deps.utaManager.has(parsed.sourceId)
      if (isUta) return getUtaBars(parsed.sourceId, ref.barId, opts)
      // vendor barId — needs an assetClass to route to the right client
      if (!ref.assetClass) {
        throw new Error(
          `Vendor barId "${ref.barId}" needs an assetClass to route. Pass { barId, assetClass } or use { symbol, assetClass }.`,
        )
      }
      return getVendorBars(parsed.sourceId, ref.assetClass, parsed.nativeSymbol, opts)
    },
  }
}
