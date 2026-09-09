/**
 * Hyperliquid-specific overrides for CcxtBroker.
 *
 * Hyperliquid quirks:
 * - No native market orders. CCXT emulates them as IOC limit orders with
 *   a slippage-bounded price (default 5%). To compute the bound, CCXT
 *   requires the caller to pass a reference price even for type='market'.
 *   Server enforces an 80% deviation cap from mark price, so we can't
 *   send an extreme dummy value — we have to fetchTicker first.
 *
 * - CCXT's parsePosition leaves markPrice undefined for hyperliquid (hardcoded
 *   in node_modules/ccxt/js/src/hyperliquid.js, line 3613). Hyperliquid does
 *   return positionValue (mapped to notional by CCXT), so we recover markPrice
 *   from notional / contracts.
 *
 * - Balances live in one of two clearinghouses depending on the wallet's
 *   account-abstraction mode (`userAbstraction` info query):
 *     unifiedAccount / portfolioMargin → everything (USDC collateral, spot
 *       tokens, holds) sits in `spotClearinghouseState`; the perp
 *       `clearinghouseState.marginSummary.accountValue` is a derived mirror
 *       of the same USDC (observed live: identical figure while positions are
 *       open, 0 with none) and must NOT be added on top.
 *     default / disabled / dexAbstraction (Standard) → perp and spot are
 *       separate pools behind separate queries; both are real funds.
 *   CCXT's defaultType is 'swap', so an unscoped fetchBalance() reads only the
 *   perp clearinghouse. ccxt ≥4.5.43 auto-routes `unifiedAccount` to spot but
 *   ignores `portfolioMargin` and never merges the Standard-mode spot pool.
 */

import Decimal from 'decimal.js'
import type { Exchange, Order as CcxtOrder, Position as CcxtPosition } from 'ccxt'
import type { CcxtExchangeOverrides } from '../overrides.js'

/** Values returned by the `userAbstraction` info query. */
export type HyperliquidAbstractionMode = 'unifiedAccount' | 'portfolioMargin' | 'default' | 'disabled' | 'dexAbstraction'

/** Modes whose entire ledger lives in the spot clearinghouse (Hyperliquid docs,
 *  "Account abstraction modes": "unified account and portfolio margin show all
 *  balances and holds in the spot clearinghouse state"). */
const SPOT_LEDGER_MODES: ReadonlySet<string> = new Set<HyperliquidAbstractionMode>(['unifiedAccount', 'portfolioMargin'])

/** Modes with separate perp and spot pools. Unknown modes must fail closed. */
const SPLIT_LEDGER_MODES: ReadonlySet<string> = new Set<HyperliquidAbstractionMode>(['default', 'disabled', 'dexAbstraction'])

/** A wallet's abstraction mode changes only through an explicit user action in
 *  the Hyperliquid UI; re-reading it on every poll would double the request
 *  count of a balance read for no benefit. */
export const ABSTRACTION_MODE_TTL_MS = 5 * 60_000

interface AbstractionCacheEntry { user: string; mode: string; expiresAt: number }
const abstractionModeCache = new WeakMap<Exchange, AbstractionCacheEntry>()

/** Ccxt-internal hyperliquid surface the override relies on (untyped in ccxt's d.ts). */
interface HyperliquidExchangeInternals {
  walletAddress?: string
  publicPostInfo(request: Record<string, unknown>): Promise<unknown>
  handlePublicAddress?(methodName: string, params: Record<string, unknown>): [string, Record<string, unknown>]
}

/** Resolve the address a balance read is about, mirroring ccxt's own
 *  precedence (params.user / subAccountAddress / address → walletAddress). */
function resolveUser(exchange: Exchange, params: Record<string, unknown> | undefined): string | undefined {
  const internals = exchange as unknown as HyperliquidExchangeInternals
  if (typeof internals.handlePublicAddress === 'function') {
    try {
      return internals.handlePublicAddress('fetchBalance', { ...(params ?? {}) })[0]
    } catch {
      return undefined
    }
  }
  const explicit = params?.['user'] ?? params?.['subAccountAddress'] ?? params?.['address']
  if (typeof explicit === 'string' && explicit !== '') return explicit
  return internals.walletAddress || undefined
}

/** Query and cache the mode. A failed query must not become a partial balance. */
export async function fetchAbstractionMode(exchange: Exchange, user: string): Promise<string> {
  const cached = abstractionModeCache.get(exchange)
  if (cached && cached.user === user && cached.expiresAt > Date.now()) return cached.mode
  const raw = await (exchange as unknown as HyperliquidExchangeInternals).publicPostInfo({ type: 'userAbstraction', user })
  const mode = typeof raw === 'string' ? raw.replace(/^"|"$/g, '') : undefined
  if (!mode || (!SPOT_LEDGER_MODES.has(mode) && !SPLIT_LEDGER_MODES.has(mode))) {
    throw new Error('Hyperliquid: cannot determine account abstraction mode; refusing an incomplete balance')
  }
  abstractionModeCache.set(exchange, { user, mode, expiresAt: Date.now() + ABSTRACTION_MODE_TTL_MS })
  return mode
}

/** Drop any cached mode for this exchange (used by tests and reconnects). */
export function resetAbstractionModeCache(exchange: Exchange): void {
  abstractionModeCache.delete(exchange)
}

// Top-level keys CCXT returns alongside per-currency entries in fetchBalance.
const BALANCE_RESERVED_KEYS = new Set(['free', 'used', 'total', 'info', 'timestamp', 'datetime', 'debt'])

type BalanceEntry = { free?: unknown; used?: unknown; total?: unknown }

function toDecimal(value: unknown): Decimal {
  if (value === undefined || value === null || value === '') return new Decimal(0)
  const d = new Decimal(String(value))
  return d.isNaN() ? new Decimal(0) : d
}

/**
 * Merge two ccxt balance structures whose currencies are DISTINCT pools
 * (Standard-mode perp + spot). Per-currency free/used/total add; the top-level
 * free/used/total maps are rebuilt; `info` keeps both raw responses so
 * diagnostics can still see which clearinghouse said what.
 */
export function mergeBalanceLedgers(
  perp: Record<string, unknown>,
  spot: Record<string, unknown>,
): Record<string, unknown> {
  const byCoin = new Map<string, { free: Decimal; used: Decimal; total: Decimal }>()
  for (const ledger of [perp, spot]) {
    for (const [coin, entry] of Object.entries(ledger)) {
      if (BALANCE_RESERVED_KEYS.has(coin)) continue
      if (typeof entry !== 'object' || entry === null) continue
      const e = entry as BalanceEntry
      const acc = byCoin.get(coin) ?? { free: new Decimal(0), used: new Decimal(0), total: new Decimal(0) }
      acc.free = acc.free.plus(toDecimal(e.free))
      acc.used = acc.used.plus(toDecimal(e.used))
      acc.total = acc.total.plus(toDecimal(e.total))
      byCoin.set(coin, acc)
    }
  }

  const free: Record<string, number> = {}
  const used: Record<string, number> = {}
  const total: Record<string, number> = {}
  const merged: Record<string, unknown> = {
    info: { perp: perp['info'], spot: spot['info'] },
    timestamp: perp['timestamp'] ?? spot['timestamp'],
    datetime: perp['datetime'] ?? spot['datetime'],
  }
  for (const [coin, acc] of byCoin) {
    free[coin] = acc.free.toNumber()
    used[coin] = acc.used.toNumber()
    total[coin] = acc.total.toNumber()
    merged[coin] = { free: free[coin], used: used[coin], total: total[coin] }
  }
  merged['free'] = free
  merged['used'] = used
  merged['total'] = total
  return merged
}

export const hyperliquidOverrides: CcxtExchangeOverrides = {
  /**
   * Route an unscoped balance read to the clearinghouse(s) that actually hold
   * the wallet's funds. An explicit `type` in params is honored as-is — the
   * caller already knows which ledger it wants.
   */
  async fetchBalance(exchange: Exchange, params, defaultImpl): Promise<Record<string, unknown>> {
    if (params?.['type'] !== undefined) return await defaultImpl(exchange, params)

    const user = resolveUser(exchange, params)
    if (!user) throw new Error('Hyperliquid: balance read requires a wallet address')
    const mode = await fetchAbstractionMode(exchange, user)
    // CCXT caches unified routing independently, and it overrides type: swap.
    // We own routing here: force physical pools and bypass that stale cache.
    const routedParams = { ...(params ?? {}), enableUnifiedMargin: false }

    if (mode !== undefined && SPOT_LEDGER_MODES.has(mode)) {
      return await defaultImpl(exchange, { ...routedParams, type: 'spot' })
    }
    if (mode !== undefined && SPLIT_LEDGER_MODES.has(mode)) {
      // Both pools are authoritative; a partial read would hide real funds
      // behind a plausible number, so either failure propagates.
      const [perp, spot] = await Promise.all([
        defaultImpl(exchange, { ...routedParams, type: 'swap' }),
        defaultImpl(exchange, { ...routedParams, type: 'spot' }),
      ])
      return mergeBalanceLedgers(perp, spot)
    }
    throw new Error('Hyperliquid: unsupported account abstraction mode')
  },

  /** Inject a fetched ticker price for market orders, then delegate to default. */
  async placeOrder(
    exchange: Exchange,
    symbol: string,
    type: string,
    side: 'buy' | 'sell',
    amount: number,
    price: number | undefined,
    params: Record<string, unknown>,
    defaultImpl,
  ): Promise<CcxtOrder> {
    let refPrice = price
    if (type === 'market' && refPrice === undefined) {
      const ticker = await exchange.fetchTicker(symbol)
      refPrice = ticker.last ?? ticker.close ?? undefined
      if (refPrice === undefined) {
        throw new Error(`hyperliquid: cannot fetch reference price for market order on ${symbol}`)
      }
    }
    return await defaultImpl(exchange, symbol, type, side, amount, refPrice, params)
  },

  /** Recover markPrice that CCXT's parsePosition omits, by inverting notional / contracts. */
  async fetchPositions(exchange: Exchange, defaultImpl): Promise<CcxtPosition[]> {
    const raw = await defaultImpl(exchange)
    return raw.map(p => {
      if (p.markPrice == null && p.notional != null && p.contracts != null && p.contracts !== 0) {
        const recovered = Math.abs(p.notional) / Math.abs(p.contracts)
        return { ...p, markPrice: recovered }
      }
      return p
    })
  },
}
