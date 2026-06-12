/**
 * CcxtBroker — IBroker adapter for CCXT exchanges
 *
 * Direct implementation against ccxt unified API.
 * Takes IBKR Order objects, reads relevant fields, ignores the rest.
 * aliceId format: "{exchange}-{encodedSymbol}" (e.g. "bybit-BTC_USDT.USDT").
 */

import { z } from 'zod'
import ccxt from 'ccxt'
import Decimal from 'decimal.js'
import type { Exchange, Order as CcxtOrder } from 'ccxt'
import { Contract, ContractDescription, ContractDetails, Order, OrderState, UNSET_DECIMAL } from '@traderalice/ibkr'
import {
  BrokerError,
  type IBroker,
  type AccountCapabilities,
  type AccountInfo,
  type Position,
  type PlaceOrderResult,
  type OpenOrder,
  type Quote,
  type MarketClock,
  type BrokerConfigField,
  type TpSlParams,
  type Bar,
  type BarParams,
} from '../types.js'
import '../../contract-ext.js'
import { aggregateAccountFromPositions } from '../../position-math.js'
import { buildPosition } from '../contract-builder.js'
import { CCXT_CREDENTIAL_FIELDS, type CcxtBrokerConfig, type CcxtMarket, type FundingRate, type OrderBook, type OrderBookLevel } from './ccxt-types.js'
import { MAX_INIT_RETRIES, INIT_RETRY_BASE_MS } from './ccxt-types.js'
import {
  ccxtTypeToSecType,
  mapOrderStatus,
  makeOrderState,
  marketToContract,
  contractToCcxt,
  CCXT_TIMEFRAME,
} from './ccxt-contracts.js'
import { fuzzyRankContracts } from '../fuzzy-rank.js'
import {
  type CcxtExchangeOverrides,
  exchangeOverrides,
  defaultFetchOrderById,
  defaultCancelOrderById,
  defaultPlaceOrder,
  defaultFetchPositions,
  defaultFetchAllOpenOrders,
} from './overrides.js'

// Treated as cash (1:1 to USD) when computing balances and as ineligible
// for spot-position synthesis. Compared against `coin.toUpperCase()` so
// CCXT's mixed-case codes like 'USDe' normalize correctly.
const STABLECOIN_TO_USD = new Set([
  'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD',
  'FDUSD',  // First Digital USD — Binance's primary post-BUSD stablecoin
  'PYUSD',  // PayPal USD
  'USDE',   // Ethena synthetic USD
  'USDP',   // Paxos USD
])

// Top-level keys CCXT returns alongside per-currency entries in fetchBalance.
// Skipping these prevents us from treating 'free'/'used'/'total' aggregates
// as if they were a coin called "free".
const BALANCE_RESERVED_KEYS = new Set(['free', 'used', 'total', 'info', 'timestamp', 'datetime'])

// Quote currencies tried, in order, when looking for a market to price a
// spot holding. USDT first because it has the densest coverage across
// CCXT exchanges; USDC/USD as fallbacks.
const SPOT_QUOTE_PREFERENCE = ['USDT', 'USDC', 'USD'] as const

/** Normalize stablecoin quote currencies to 'USD' so they don't trigger FX conversion. */
function normalizeQuoteCurrency(quote: string): string {
  return STABLECOIN_TO_USD.has(quote.toUpperCase()) ? 'USD' : quote
}

/** Map IBKR orderType codes to CCXT order type strings. */
function ibkrOrderTypeToCcxt(orderType: string): string {
  switch (orderType) {
    case 'MKT': return 'market'
    case 'LMT': return 'limit'
    default: return orderType.toLowerCase()
  }
}

export interface CcxtBrokerMeta {
  exchange: string  // "bybit", "binance", "okx", etc.
}

export class CcxtBroker implements IBroker<CcxtBrokerMeta> {
  // ---- Self-registration ----

  static configSchema = z.object({
    exchange: z.string(),
    sandbox: z.boolean().default(false),
    demoTrading: z.boolean().default(false),
    options: z.record(z.string(), z.unknown()).optional(),
    // All 10 CCXT standard credential fields, all optional.
    // Each exchange requires its own subset (read via Exchange.requiredCredentials).
    apiKey: z.string().optional(),
    secret: z.string().optional(),
    apiSecret: z.string().optional(), // legacy alias for `secret`
    uid: z.string().optional(),
    accountId: z.string().optional(),
    login: z.string().optional(),
    password: z.string().optional(),
    twofa: z.string().optional(),
    privateKey: z.string().optional(),
    walletAddress: z.string().optional(),
    token: z.string().optional(),
  })

  // Static base fields. Exchange dropdown options + per-exchange credential fields
  // are fetched dynamically by the frontend (see /api/trading/config/ccxt/* routes).
  static configFields: BrokerConfigField[] = [
    { name: 'exchange', type: 'select', label: 'Exchange', required: true, options: [] },
    { name: 'sandbox', type: 'boolean', label: 'Sandbox Mode', default: false },
    { name: 'demoTrading', type: 'boolean', label: 'Demo Trading', default: false },
  ]

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): CcxtBroker {
    const bc = CcxtBroker.configSchema.parse(config.brokerConfig)
    return new CcxtBroker({
      id: config.id,
      label: config.label,
      // configSchema strips unknown keys, so read keyless off the raw dict.
      keyless: config.brokerConfig.keyless === true,
      exchange: bc.exchange,
      sandbox: bc.sandbox,
      demoTrading: bc.demoTrading,
      options: bc.options,
      apiKey: bc.apiKey,
      // Accept both `secret` (CCXT-native) and legacy `apiSecret`
      secret: bc.secret ?? bc.apiSecret,
      uid: bc.uid,
      accountId: bc.accountId,
      login: bc.login,
      password: bc.password,
      twofa: bc.twofa,
      privateKey: bc.privateKey,
      walletAddress: bc.walletAddress,
      token: bc.token,
    })
  }

  // ---- Instance ----

  readonly id: string
  readonly label: string
  readonly meta: CcxtBrokerMeta

  private exchange: Exchange
  private exchangeName: string
  /** Public-data-only mode — skip credential validation in init(). */
  private keyless: boolean
  private initialized = false
  private overrides: CcxtExchangeOverrides
  // orderId → ccxtSymbol cache (CCXT needs symbol to cancel)
  private orderSymbolCache = new Map<string, string>()
  private warnedOpenOrdersUnsupported = false

  constructor(config: CcxtBrokerConfig) {
    this.exchangeName = config.exchange
    this.keyless = config.keyless ?? false
    this.meta = { exchange: config.exchange }
    this.overrides = exchangeOverrides[config.exchange] ?? {}
    this.id = config.id ?? `${config.exchange}-main`
    this.label = config.label ?? `${config.exchange.charAt(0).toUpperCase() + config.exchange.slice(1)} ${config.sandbox ? 'Testnet' : 'Live'}`

    const exchanges = ccxt as unknown as Record<string, new (opts: Record<string, unknown>) => Exchange>
    const ExchangeClass = exchanges[config.exchange]
    if (!ExchangeClass) {
      throw new BrokerError('CONFIG', `Unknown CCXT exchange: ${config.exchange}`)
    }

    // Pass through all CCXT standard credential fields. CCXT ignores undefined.
    // Do NOT override the exchange's default fetchMarkets.types — each exchange
    // has its own (e.g. bybit: spot/linear/inverse/option, hyperliquid: spot/swap/hip3).
    // The init() wrapper below handles option-skipping uniformly via type filtering.
    const cfgRecord = config as unknown as Record<string, unknown>
    const credentials: Record<string, unknown> = {}
    if (config.options !== undefined) credentials.options = config.options
    for (const field of CCXT_CREDENTIAL_FIELDS) {
      const v = cfgRecord[field]
      if (v !== undefined) credentials[field] = v
    }
    this.exchange = new ExchangeClass(credentials)

    if (config.sandbox) {
      this.exchange.setSandboxMode(true)
    }

    if (config.demoTrading) {
      (this.exchange as unknown as { enableDemoTrading: (enable: boolean) => void }).enableDemoTrading(true)
    }
  }

  // ---- Helpers ----

  private get markets() {
    return this.exchange.markets as unknown as Record<string, CcxtMarket>
  }

  private ensureInit(): void {
    if (!this.initialized) {
      throw new BrokerError('CONFIG', `CcxtBroker[${this.id}] not initialized. Call init() first.`)
    }
  }

  // ---- Lifecycle ----

  async init(): Promise<void> {
    // Keyless (public-data-only) accounts skip credential validation — they
    // only ever call public endpoints (loadMarkets / fetchOHLCV / fetchTicker).
    // Validate credentials per the exchange's own requiredCredentials map otherwise.
    // Hyperliquid needs walletAddress + privateKey; OKX needs apiKey + secret + password; etc.
    if (!this.keyless) try {
      this.exchange.checkRequiredCredentials()
    } catch (err) {
      const required = Object.entries(this.exchange.requiredCredentials ?? {})
        .filter(([, needed]) => needed)
        .map(([k]) => k)
      const missing = required.filter(k => !(this.exchange as unknown as Record<string, unknown>)[k])
      throw new BrokerError(
        'CONFIG',
        `${this.exchangeName} requires credentials: ${required.join(', ')}. Missing: ${missing.join(', ') || 'unknown'}. (${err instanceof Error ? err.message : String(err)})`,
      )
    }

    const origFetchMarkets = this.exchange.fetchMarkets.bind(this.exchange)
    const accountId = this.id

    this.exchange.fetchMarkets = async (params?: Record<string, unknown>) => {
      const ex = this.exchange as unknown as Record<string, unknown>
      const opts = (ex['options'] ?? {}) as Record<string, unknown>
      const fmOpts = (opts['fetchMarkets'] ?? {}) as Record<string, unknown>
      // Use the exchange's own default types (set in its CCXT class describe()).
      // Skip 'option' type — option markets are typically thousands of contracts
      // (Bybit alone has ~10k+) and rarely useful for automated trading.
      const originalTypes = fmOpts['types']
      const allTypes = (originalTypes ?? []) as string[]
      const types = allTypes.length > 0
        ? allTypes.filter(t => t !== 'option')
        : ['spot', 'linear', 'inverse'] // fallback for exchanges that don't declare types

      try {
        const allMarkets: unknown[] = []
        for (const type of types) {
          let lastErr: unknown
          let success = false
          for (let attempt = 1; attempt <= MAX_INIT_RETRIES; attempt++) {
            try {
              fmOpts['types'] = [type]
              const markets = await origFetchMarkets(params)
              allMarkets.push(...markets)
              success = true
              break
            } catch (err) {
              lastErr = err
              if (attempt < MAX_INIT_RETRIES) {
                const delay = INIT_RETRY_BASE_MS * Math.pow(2, attempt - 1)
                const msg = err instanceof Error ? err.message : String(err)
                console.warn(`CcxtBroker[${accountId}]: fetchMarkets(${type}) attempt ${attempt}/${MAX_INIT_RETRIES} failed, retrying in ${delay}ms... (${msg.slice(0, 160)})`)
                await new Promise(r => setTimeout(r, delay))
              }
            }
          }
          if (!success) {
            // A CCXT account is a full-spectrum interface — every market type
            // the exchange supports must load, or the broker refuses to come
            // up. Silently dropping a type (e.g. spot) would understate
            // netLiquidation and hide real holdings, producing wrong snapshots
            // forever until process restart. Whether the user actively trades
            // that type is their decision, not ours.
            const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
            throw new Error(
              `CcxtBroker[${accountId}]: fetchMarkets(${type}) failed after ${MAX_INIT_RETRIES} attempts: ${msg}`,
            )
          }
        }
        return allMarkets as Awaited<ReturnType<Exchange['fetchMarkets']>>
      } finally {
        fmOpts['types'] = originalTypes
      }
    }

    try {
      await this.exchange.loadMarkets()
    } catch (err) {
      throw BrokerError.from(err, 'NETWORK')
    }

    const marketCount = Object.keys(this.exchange.markets).length
    if (marketCount === 0) {
      throw new BrokerError('NETWORK', `CcxtBroker[${this.id}]: failed to load any markets`)
    }
    this.initialized = true
    console.log(`CcxtBroker[${this.id}]: connected (${this.exchangeName}, ${marketCount} markets loaded)`)
  }

  async close(): Promise<void> {
    // CCXT exchanges typically don't need explicit closing
  }

  /**
   * Re-pull the exchange market list. CCXT's `loadMarkets(true)` (the
   * `reload=true` overload) bypasses the cached snapshot it built during
   * init. Call from a cron periodically — newly listed pairs and
   * delistings come along for the ride.
   */
  async refreshCatalog(): Promise<void> {
    this.ensureInit()
    await this.exchange.loadMarkets(true)
    const marketCount = Object.keys(this.exchange.markets).length
    console.log(`CcxtBroker[${this.id}]: catalog refreshed (${marketCount} markets)`)
  }

  // ---- Contract search ----

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    this.ensureInit()
    if (!pattern) return []

    // Eligible candidate set: active markets with both legs of the pair, and
    // quoted in a stablecoin / USD. This is the same filter the strict
    // implementation used; we keep it so a "tesla" fuzzy hit doesn't drag in
    // exotic-quote pairs the user almost certainly doesn't want.
    const candidates: CcxtMarket[] = []
    for (const market of Object.values(this.markets)) {
      if (market.active === false) continue
      if (!market.base || !market.quote) continue
      const quote = market.quote.toUpperCase()
      if (quote !== 'USDT' && quote !== 'USD' && quote !== 'USDC') continue
      candidates.push(market)
    }

    // Pre-sort candidates by the broker's own preference (swap > future >
    // spot > option, USDT > USD > USDC). fuzzyRankContracts is a stable sort
    // and uses the input order as a tiebreaker, so this carries through —
    // exact base matches keep showing up in the familiar derivative-first
    // order, fuzzy hits inherit the same preference.
    const typeOrder: Record<string, number> = { swap: 0, future: 1, spot: 2, option: 3 }
    const quoteOrder: Record<string, number> = { USDT: 0, USD: 1, USDC: 2 }
    candidates.sort((a, b) => {
      const aType = typeOrder[a.type as keyof typeof typeOrder] ?? 99
      const bType = typeOrder[b.type as keyof typeof typeOrder] ?? 99
      if (aType !== bType) return aType - bType
      const aQuote = quoteOrder[(a.quote ?? '').toUpperCase()] ?? 99
      const bQuote = quoteOrder[(b.quote ?? '').toUpperCase()] ?? 99
      return aQuote - bQuote
    })

    // Run candidates through the shared fuzzy ranker. Exact-base hits land in
    // tier 100 (preserves the strict-matcher's behaviour for power users who
    // type "BTC" and expect every BTC market); substring / name hits show up
    // afterward so partial keywords (e.g. "tesl", "popcorn") still surface
    // something useful.
    // Skip CCXT markets that fail strict contract validation (typically
    // dated FUT/OPT entries with missing expiry or multiplier in the
    // exchange's market metadata). One bad market shouldn't drop the
    // entire search; surface a one-line warning so the gap is visible
    // without being noisy.
    const ranked = fuzzyRankContracts(
      candidates.flatMap((m) => {
        try {
          const c = marketToContract(m, this.exchangeName)
          return [{ contract: c, base: m.base, quote: m.quote, name: m.id ?? m.symbol }]
        } catch (err) {
          console.warn(`ccxt[${this.exchangeName}]: skipping market ${m.symbol}: ${err instanceof Error ? err.message : String(err)}`)
          return []
        }
      }),
      pattern,
    )

    // Each ranked hit's Contract carries `localSymbol = market.symbol`
    // (CCXT's wire format), so direct `markets[localSymbol]` lookup is
    // the join key — matches the broker's own primary index.
    const derivativeTypes = new Set<string>()
    for (const desc of ranked) {
      const m = desc.contract.localSymbol ? this.markets[desc.contract.localSymbol] : undefined
      if (!m) continue
      if (m.type === 'future') derivativeTypes.add('FUT')
      if (m.type === 'option') derivativeTypes.add('OPT')
    }
    const derivativeSecTypes: string[] = derivativeTypes.size > 0 ? Array.from(derivativeTypes) : []
    for (const desc of ranked) desc.derivativeSecTypes = derivativeSecTypes

    return ranked
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    this.ensureInit()

    const ccxtSymbol = contractToCcxt(query, this.markets, this.exchangeName)
    if (!ccxtSymbol) return null

    const market = this.markets[ccxtSymbol]
    if (!market) return null

    const details = new ContractDetails()
    details.contract = marketToContract(market, this.exchangeName)
    details.longName = `${market.base}/${market.quote} ${market.type}${market.settle ? ` (${market.settle} settled)` : ''}`
    details.minTick = market.precision?.price ?? 0
    return details
  }

  // ---- Trading operations ----

  async placeOrder(contract: Contract, order: Order, tpsl?: TpSlParams, extraParams?: Record<string, unknown>): Promise<PlaceOrderResult> {
    this.ensureInit()


    const ccxtSymbol = contractToCcxt(contract, this.markets, this.exchangeName)
    if (!ccxtSymbol) {
      return { success: false, error: 'Cannot resolve contract to CCXT symbol' }
    }

    // Use toFixed() to preserve Decimal precision across any scale.
    // toString() would emit scientific notation for small values.
    let size: string | undefined = !order.totalQuantity.equals(UNSET_DECIMAL)
      ? order.totalQuantity.toFixed()
      : undefined

    // cashQty (notional) → size conversion
    if (!size && !order.cashQty.equals(UNSET_DECIMAL) && order.cashQty.gt(0)) {
      const ticker = await this.exchange.fetchTicker(ccxtSymbol)
      const price = !order.lmtPrice.equals(UNSET_DECIMAL)
        ? order.lmtPrice
        : ticker.last != null ? new Decimal(ticker.last) : null
      if (!price || price.isZero()) {
        return { success: false, error: 'Cannot determine price for notional conversion' }
      }
      size = order.cashQty.div(price).toFixed()
    }

    if (!size) {
      return { success: false, error: 'Either totalQuantity or cashQty must be provided' }
    }

    // Attached TP/SL on CCXT venues: REFUSE until a per-exchange override
    // has verified the attach actually reaches the venue. Observed live on
    // okx spot: the unified takeProfit/stopLoss params were accepted by
    // ccxt, silently dropped at the venue mapping, and the entry filled
    // UNPROTECTED — the ledger said "long with a stop", the exchange said
    // "naked long". A missing stop that looks attached is the worst failure
    // mode a trading system has; loud refusal beats silent downgrade
    // (same rule as order-type support). Venue-verified attach
    // implementations land via the overrides registry (fetchAllOpenOrders
    // pattern) — okx needs attachAlgoOrds, bybit its native v5 fields.
    if (tpsl?.takeProfit || tpsl?.stopLoss) {
      const attachOverride = this.overrides.placeOrderWithTpSl
      if (!attachOverride) {
        return {
          success: false,
          error:
            `Attached TP/SL is not verified to reach ${this.exchangeName} through ccxt — refusing rather than ` +
            `risking a silently unprotected position. Place the entry first, then a separate stop/take-profit ` +
            `order, or use a venue with verified attach support.`,
        }
      }
    }

    try {
      const params: Record<string, unknown> = { ...extraParams }

      if (tpsl?.takeProfit) {
        params.takeProfit = { triggerPrice: parseFloat(tpsl.takeProfit.price) }
      }
      if (tpsl?.stopLoss) {
        params.stopLoss = {
          triggerPrice: parseFloat(tpsl.stopLoss.price),
          ...(tpsl.stopLoss.limitPrice && { price: parseFloat(tpsl.stopLoss.limitPrice) }),
        }
      }

      // Conditional orders: ccxt's convention is BASE type (market/limit) +
      // params.triggerPrice — ccxt routes each venue to its algo endpoint.
      // The old lowercase passthrough sent okx a literal ordType "stp"
      // (51000 Parameter error, observed live), which meant the documented
      // "place a separate stop" path didn't work either. TRAIL* stays
      // refused until venue-verified — same rule as attached TP/SL.
      let ccxtOrderType = ibkrOrderTypeToCcxt(order.orderType)
      if (order.orderType === 'STP' || order.orderType === 'STP LMT') {
        if (order.auxPrice.equals(UNSET_DECIMAL)) {
          return { success: false, error: `${order.orderType} requires auxPrice (the stop trigger price).` }
        }
        params.triggerPrice = order.auxPrice.toNumber()
        ccxtOrderType = order.orderType === 'STP' ? 'market' : 'limit'
      } else if (order.orderType === 'TRAIL' || order.orderType === 'TRAIL LIMIT') {
        return {
          success: false,
          error:
            `${order.orderType} is not verified to reach ${this.exchangeName} through ccxt — refusing rather ` +
            `than risking a silently mis-typed order. Use STP / STP LMT, or manage the trail manually.`,
        }
      }
      const side = order.action.toLowerCase() as 'buy' | 'sell'
      // CCXT SDK expects number for price — convert at the wire boundary.
      const refPrice = ccxtOrderType === 'limit' && !order.lmtPrice.equals(UNSET_DECIMAL)
        ? order.lmtPrice.toNumber()
        : undefined

      const attachOverride = this.overrides.placeOrderWithTpSl
      const placeOverride = this.overrides.placeOrder
      const ccxtOrder = (tpsl?.takeProfit || tpsl?.stopLoss) && attachOverride
        // Venue-verified attach path — the gate above guarantees tpsl only
        // gets this far when the exchange has an override for it.
        ? await attachOverride(this.exchange, ccxtSymbol, ccxtOrderType, side, parseFloat(size), refPrice, tpsl, params)
        : placeOverride
          ? await placeOverride(this.exchange, ccxtSymbol, ccxtOrderType, side, parseFloat(size), refPrice, params, defaultPlaceOrder)
          : await defaultPlaceOrder(this.exchange, ccxtSymbol, ccxtOrderType, side, parseFloat(size), refPrice, params)

      // Cache orderId → symbol
      if (ccxtOrder.id) {
        this.orderSymbolCache.set(ccxtOrder.id, ccxtSymbol)
      }

      return {
        success: true,
        orderId: ccxtOrder.id,
        orderState: makeOrderState(ccxtOrder.status),
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async cancelOrder(orderId: string): Promise<PlaceOrderResult> {
    this.ensureInit()

    try {
      const ccxtSymbol = this.orderSymbolCache.get(orderId)
      const cancelOverride = this.overrides.cancelOrderById
      if (cancelOverride) {
        await cancelOverride(this.exchange, orderId, ccxtSymbol, defaultCancelOrderById)
      } else {
        await defaultCancelOrderById(this.exchange, orderId, ccxtSymbol)
      }
      const orderState = new OrderState()
      orderState.status = 'Cancelled'
      return { success: true, orderId, orderState }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult> {
    this.ensureInit()

    try {
      const ccxtSymbol = this.orderSymbolCache.get(orderId)
      if (!ccxtSymbol) {
        return { success: false, error: `Unknown order ${orderId} — cannot resolve symbol for edit` }
      }

      // editOrder requires type and side — fetch the original order to fill in defaults.
      const fetchOverride = this.overrides.fetchOrderById
      const original = fetchOverride
        ? await fetchOverride(this.exchange, orderId, ccxtSymbol, defaultFetchOrderById)
        : await defaultFetchOrderById(this.exchange, orderId, ccxtSymbol)
      const qty = changes.totalQuantity != null && !changes.totalQuantity.equals(UNSET_DECIMAL) ? changes.totalQuantity.toNumber() : original.amount
      const price = changes.lmtPrice != null && !changes.lmtPrice.equals(UNSET_DECIMAL) ? changes.lmtPrice.toNumber() : original.price

      // Extra params for fields that don't fit editOrder's positional arguments
      const params: Record<string, unknown> = {}
      if (changes.auxPrice != null && !changes.auxPrice.equals(UNSET_DECIMAL)) params.stopPrice = changes.auxPrice.toNumber()
      if (changes.trailStopPrice != null && !changes.trailStopPrice.equals(UNSET_DECIMAL)) params.trailStopPrice = changes.trailStopPrice.toNumber()
      if (changes.trailingPercent != null && !changes.trailingPercent.equals(UNSET_DECIMAL)) params.trailingPercent = changes.trailingPercent.toNumber()
      if (changes.tif) params.timeInForce = changes.tif.toLowerCase()

      const result = await this.exchange.editOrder(
        orderId,
        ccxtSymbol,
        changes.orderType ? ibkrOrderTypeToCcxt(changes.orderType) : (original.type ?? 'market'),
        original.side,
        qty,
        price,
        params,
      )

      return {
        success: true,
        orderId: result.id,
        orderState: makeOrderState(result.status),
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult> {
    this.ensureInit()


    const positions = await this.getPositions()
    const markets = this.exchange.markets as Record<string, CcxtMarket>
    const ccxtSymbol = contractToCcxt(contract, markets, this.exchangeName)

    // Resolve both input + each position's contract to CCXT wire format.
    // That's the unambiguous identity per exchange — works whether the input
    // contract carries canonical localSymbol (post-Phase-3 internal flow) or
    // wire-format localSymbol (legacy callers, user-constructed contracts).
    const symbol = contract.symbol?.toUpperCase()
    const pos = positions.find(p => {
      const posWire = contractToCcxt(p.contract, markets, this.exchangeName)
      if (ccxtSymbol && posWire === ccxtSymbol) return true
      // Fallback for inputs we couldn't wire-resolve — match on symbol+secType.
      return symbol && p.contract.symbol === symbol && p.contract.secType === contract.secType
    })

    if (!pos) {
      return { success: false, error: `No open position for ${ccxtSymbol ?? symbol ?? 'unknown'}` }
    }

    const order = new Order()
    order.action = pos.side === 'long' ? 'SELL' : 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = quantity ?? pos.quantity

    return this.placeOrder(pos.contract, order, undefined, { reduceOnly: true })
  }

  // ---- Queries ----

  /**
   * Synthesize spot holdings (BTC/ETH/etc balances) into Position records.
   *
   * CCXT's fetchPositions() only returns derivative positions
   * (SWAP/FUTURES/MARGIN/OPTION); spot assets sit in fetchBalance() as
   * per-currency entries. Without this synthesis, a UTA user holding only
   * spot would see an empty positions list and a netLiquidation that
   * reflects only their stablecoin balance.
   *
   * Treated as long positions priced at the current ticker — consistent
   * with how IBKR exposes equity holdings. avgCost is filled with markPrice
   * as a placeholder; UTA replaces it with a wallet-ledger-derived value
   * (and bootstraps any unaccounted qty via `reconcileBalance` at observed
   * markPrice) — the `avgCostSource: 'wallet'` flag signals this.
   */
  private async fetchSpotHoldings(prefetched?: Awaited<ReturnType<Exchange['fetchBalance']>>): Promise<Position[]> {
    const balance = prefetched ?? await this.exchange.fetchBalance()
    const bal = balance as unknown as Record<string, unknown>

    type Holding = { coin: string; quantity: Decimal; ccxtSymbol: string; market: CcxtMarket }
    const holdings: Holding[] = []

    for (const [coin, entry] of Object.entries(bal)) {
      if (BALANCE_RESERVED_KEYS.has(coin)) continue
      if (STABLECOIN_TO_USD.has(coin.toUpperCase())) continue
      if (typeof entry !== 'object' || entry === null) continue

      const e = entry as Record<string, unknown>
      const free = new Decimal(String(e['free'] ?? 0))
      const used = new Decimal(String(e['used'] ?? 0))
      const quantity = free.plus(used)
      if (quantity.lte(0)) continue

      // Find the most preferred quote market for pricing this holding.
      let resolved: { ccxtSymbol: string; market: CcxtMarket } | null = null
      for (const quote of SPOT_QUOTE_PREFERENCE) {
        const candidate = `${coin}/${quote}`
        const m = this.markets[candidate]
        if (m && m.active !== false && m.type === 'spot') {
          resolved = { ccxtSymbol: candidate, market: m }
          break
        }
      }
      if (!resolved) {
        console.warn(`CcxtBroker[${this.id}]: spot holding ${coin} (${quantity.toString()}) — no <COIN>/USDT|USDC|USD spot market, skipping`)
        continue
      }

      holdings.push({ coin, quantity, ...resolved })
    }

    if (holdings.length === 0) return []

    // Bulk fetch tickers — one HTTP call instead of N. Some exchanges
    // don't support multi-symbol fetchTickers; fall back to per-symbol on
    // failure so we don't lose the entire spot view over an API quirk.
    const symbols = holdings.map(h => h.ccxtSymbol)
    let tickers: Record<string, { last?: number | null }> = {}
    try {
      tickers = await this.exchange.fetchTickers(symbols) as unknown as Record<string, { last?: number | null }>
    } catch {
      for (const s of symbols) {
        try {
          tickers[s] = await this.exchange.fetchTicker(s) as unknown as { last?: number | null }
        } catch {
          // skip — warned per-holding below
        }
      }
    }

    const result: Position[] = []
    for (const h of holdings) {
      const last = tickers[h.ccxtSymbol]?.last
      if (last == null) {
        console.warn(`CcxtBroker[${this.id}]: spot holding ${h.coin} — no ticker for ${h.ccxtSymbol}, skipping`)
        continue
      }
      const markPrice = new Decimal(String(last))
      const marketValue = h.quantity.mul(markPrice)

      result.push(buildPosition({
        contract: marketToContract(h.market, this.exchangeName),
        currency: normalizeQuoteCurrency(h.market.quote ?? 'USDT'),
        side: 'long',
        quantity: h.quantity,
        // Placeholder — UTA will replace via wallet-ledger reconstruction.
        avgCost: markPrice.toString(),
        marketPrice: markPrice.toString(),
        // CCXT pre-computes marketValue per the spot-synthesis path; the
        // upstream API doesn't give us PnL since we have no historical cost,
        // so we explicitly pin both pre-computed values to avoid `buildPosition`
        // re-deriving with avgCost=markPrice (which would yield 0 anyway).
        marketValue: marketValue.toString(),
        unrealizedPnL: '0',
        realizedPnL: '0',
        // CCXT spot has no IBKR-style multiplier — canonical default '1'.
        multiplier: '1',
        avgCostSource: 'wallet',
      }))
    }

    return result
  }

  async getAccount(): Promise<AccountInfo> {
    // Keyless data sources have no account — return a zeroed one rather than
    // calling fetchBalance (which requires credentials). The federation excludes
    // keyless UTAs from equity aggregation, so this never shows as phantom cash.
    if (this.keyless) {
      return { baseCurrency: 'USD', netLiquidation: '0', totalCashValue: '0', unrealizedPnL: '0', realizedPnL: '0', initMarginReq: '0' }
    }
    this.ensureInit()

    try {
      const [balance, rawPositions] = await Promise.all([
        this.exchange.fetchBalance(),
        this.exchange.fetchPositions(),
      ])

      const bal = balance as unknown as Record<string, unknown>

      // Sum every stablecoin entry — not just USDT — into cash. OKX UTA
      // and Binance both quote against multiple stablecoins (USDT, USDC,
      // FDUSD, …) and a user can hold any of them.
      let free = new Decimal(0)
      let used = new Decimal(0)
      for (const [coin, entry] of Object.entries(bal)) {
        if (BALANCE_RESERVED_KEYS.has(coin)) continue
        if (!STABLECOIN_TO_USD.has(coin.toUpperCase())) continue
        if (typeof entry !== 'object' || entry === null) continue
        const e = entry as Record<string, unknown>
        free = free.plus(new Decimal(String(e['free'] ?? 0)))
        used = used.plus(new Decimal(String(e['used'] ?? 0)))
      }

      // Aggregate P&L and market value from derivative positions.
      // We use position-level markPrice (which is fresh from the exchange's
      // websocket feed) rather than balance.total (which is a cached wallet
      // snapshot that may not update between funding/settlement cycles).
      let unrealizedPnL = new Decimal(0)
      let realizedPnL = new Decimal(0)
      const aggregateInputs: Array<{ side: 'long' | 'short'; marketValue: string }> = []
      for (const p of rawPositions) {
        unrealizedPnL = unrealizedPnL.plus(new Decimal(String(p.unrealizedPnl ?? 0)))
        realizedPnL = realizedPnL.plus(new Decimal(String((p as unknown as Record<string, unknown>).realizedPnl ?? 0)))

        const contracts = new Decimal(String(p.contracts ?? 0)).abs()
        const contractSize = new Decimal(String(p.contractSize ?? 1))
        const quantity = contracts.mul(contractSize)
        const markPrice = new Decimal(String(p.markPrice ?? 0))
        const side: 'long' | 'short' = p.side === 'short' ? 'short' : 'long'
        aggregateInputs.push({ side, marketValue: quantity.mul(markPrice).toString() })
      }

      // Fold spot holdings (BTC/ETH/etc balances) into position value.
      // They behave like long positions — capital converted from cash into
      // an asset — so they count toward netLiquidation, not totalCashValue.
      const spotHoldings = await this.fetchSpotHoldings(balance)
      for (const sp of spotHoldings) {
        aggregateInputs.push({ side: 'long', marketValue: sp.marketValue })
      }

      const { netLiquidation } = aggregateAccountFromPositions(free, aggregateInputs)

      return {
        baseCurrency: 'USD',
        netLiquidation: netLiquidation.toString(),
        totalCashValue: free.toString(),
        unrealizedPnL: unrealizedPnL.toString(),
        realizedPnL: realizedPnL.toString(),
        initMarginReq: used.toString(),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getPositions(): Promise<Position[]> {
    if (this.keyless) return []
    this.ensureInit()

    try {
      const fetchOverride = this.overrides.fetchPositions
      const [raw, spotHoldings] = await Promise.all([
        fetchOverride
          ? fetchOverride(this.exchange, defaultFetchPositions)
          : defaultFetchPositions(this.exchange),
        this.fetchSpotHoldings(),
      ])
      const result: Position[] = []

      for (const p of raw) {
        const market = this.markets[p.symbol]
        if (!market) continue

        // Use Decimal arithmetic to avoid IEEE 754 precision loss (e.g. 0.51 → 0.50999...)
        const contracts = new Decimal(String(p.contracts ?? 0)).abs()
        const contractSize = new Decimal(String(p.contractSize ?? 1))
        const quantity = contracts.mul(contractSize)
        if (quantity.isZero()) continue

        const markPrice = new Decimal(String(p.markPrice ?? 0))
        const entryPrice = new Decimal(String(p.entryPrice ?? 0))
        const marketValue = quantity.mul(markPrice)
        const unrealizedPnL = new Decimal(String(p.unrealizedPnl ?? 0))

        result.push(buildPosition({
          contract: marketToContract(market, this.exchangeName),
          currency: normalizeQuoteCurrency(market.quote ?? 'USDT'),
          side: p.side === 'long' ? 'long' : 'short',
          quantity,
          avgCost: entryPrice.toString(),
          marketPrice: markPrice.toString(),
          // CCXT exchange already returns notional and PnL — pass through.
          marketValue: marketValue.toString(),
          unrealizedPnL: unrealizedPnL.toString(),
          realizedPnL: new Decimal(String((p as unknown as Record<string, unknown>).realizedPnl ?? 0)).toString(),
          // contracts × contractSize is folded into `quantity` upstream, so
          // multiplier is canonical 1 here.
          multiplier: '1',
          avgCostSource: 'broker',
        }))
      }

      // Spot holdings carry distinct contract identity (no settle suffix
      // in aliceId), so they coexist with derivative positions on the
      // same underlying — same model as ETF vs futures in IBKR.
      return [...result, ...spotHoldings]
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    if (this.keyless) return []
    this.ensureInit()


    const results: OpenOrder[] = []
    for (const id of orderIds) {
      const order = await this.getOrder(id)
      if (order) results.push(order)
    }
    return results
  }

  async getOrder(orderId: string, symbolHint?: string): Promise<OpenOrder | null> {
    this.ensureInit()

    // CCXT order lookup is symbol-scoped. The in-memory cache covers orders
    // placed by this process; the hint (broker-native localSymbol persisted
    // with the git operation) covers orders placed before a restart.
    const ccxtSymbol = this.orderSymbolCache.get(orderId) ?? symbolHint
    if (!ccxtSymbol) return null

    const fetchOverride = this.overrides.fetchOrderById
    try {
      const order = fetchOverride
        ? await fetchOverride(this.exchange, orderId, ccxtSymbol, defaultFetchOrderById)
        : await defaultFetchOrderById(this.exchange, orderId, ccxtSymbol)
      return this.convertCcxtOrder(order)
    } catch {
      return null
    }
  }

  private convertCcxtOrder(o: CcxtOrder): OpenOrder | null {
    const market = this.markets[o.symbol]
    if (!market) return null

    if (o.id) {
      this.orderSymbolCache.set(o.id, o.symbol)
    }

    const contract = marketToContract(market, this.exchangeName)

    const order = new Order()
    order.action = (o.side ?? 'buy').toUpperCase()
    order.totalQuantity = new Decimal(o.amount ?? 0)
    order.orderType = (o.type ?? 'market').toUpperCase()
    if (o.price != null) order.lmtPrice = new Decimal(o.price)
    // Fill data — without these, a sync that sees the order filled records
    // the transition but loses qty/price, breaking cost-basis downstream.
    if (o.filled != null) order.filledQuantity = new Decimal(o.filled)
    order.orderId = parseInt(o.id, 10) || 0

    const tp = o.takeProfitPrice
    const sl = o.stopLossPrice
    const tpsl: TpSlParams | undefined = (tp != null || sl != null)
      ? {
        ...(tp != null && { takeProfit: { price: String(tp) } }),
        ...(sl != null && { stopLoss: { price: String(sl) } }),
      }
      : undefined

    return {
      contract,
      order,
      orderState: makeOrderState(o.status),
      ...(o.id && { orderId: String(o.id) }),
      ...(o.average != null && { avgFillPrice: String(o.average) }),
      ...(tpsl && { tpsl }),
    }
  }

  /**
   * All open orders on the account — the surface external-order observation
   * diffs against. Venue-dependent: some exchanges can't enumerate open
   * orders without a symbol scope; those degrade to [] with a once-per-
   * instance warning rather than failing the observation pass.
   */
  async getOpenOrders(): Promise<OpenOrder[]> {
    if (this.keyless) return []
    this.ensureInit()
    try {
      const fetchOverride = this.overrides.fetchAllOpenOrders
      const raw = fetchOverride
        ? await fetchOverride(this.exchange, defaultFetchAllOpenOrders)
        : await defaultFetchAllOpenOrders(this.exchange)
      const converted: OpenOrder[] = []
      for (const o of raw) {
        // convertCcxtOrder also seeds the orderId→symbol cache, so an
        // observed external order is immediately syncable.
        const open = this.convertCcxtOrder(o)
        if (open) converted.push(open)
      }
      return converted
    } catch (err) {
      if (!this.warnedOpenOrdersUnsupported) {
        this.warnedOpenOrdersUnsupported = true
        console.warn(
          `CcxtBroker[${this.id}]: fetchOpenOrders unavailable — external-order observation disabled for this account ` +
          `(${err instanceof Error ? err.message : String(err)})`,
        )
      }
      return []
    }
  }

  async getQuote(contract: Contract): Promise<Quote> {
    this.ensureInit()

    const ccxtSymbol = contractToCcxt(contract, this.markets, this.exchangeName)
    if (!ccxtSymbol) throw new BrokerError('EXCHANGE', 'Cannot resolve contract to CCXT symbol')

    try {
      const ticker = await this.exchange.fetchTicker(ccxtSymbol)
      const market = this.markets[ccxtSymbol]

      return {
        contract: market
          ? marketToContract(market, this.exchangeName)
          : contract,
        last: String(ticker.last ?? 0),
        bid: String(ticker.bid ?? 0),
        ask: String(ticker.ask ?? 0),
        volume: String(ticker.baseVolume ?? 0),
        high: ticker.high != null ? String(ticker.high) : undefined,
        low: ticker.low != null ? String(ticker.low) : undefined,
        timestamp: new Date(ticker.timestamp ?? Date.now()),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  /**
   * Historical OHLCV via ccxt `fetchOHLCV`. Free public endpoint on most
   * exchanges (realtime quality, no entitlement tier). Validates the interval
   * against the exchange's actual `timeframes` and loud-refuses if unsupported.
   */
  async getHistorical(contract: Contract, params: BarParams): Promise<Bar[]> {
    this.ensureInit()
    const ccxtSymbol = contractToCcxt(contract, this.markets, this.exchangeName)
    if (!ccxtSymbol) throw new BrokerError('EXCHANGE', 'Cannot resolve contract to CCXT symbol')
    const timeframe = CCXT_TIMEFRAME[params.interval]
    const supported = this.exchange.timeframes as Record<string, unknown> | undefined
    if (supported && !(timeframe in supported)) {
      throw new BrokerError('EXCHANGE', `${this.exchangeName} does not support the ${params.interval} interval`)
    }
    try {
      const since = params.start ? params.start.getTime() : undefined
      const rows = await this.exchange.fetchOHLCV(ccxtSymbol, timeframe, since, params.limit)
      return (rows as number[][]).map(([ts, o, h, l, c, v]) => ({
        timestamp: new Date(ts),
        open: String(o), high: String(h), low: String(l), close: String(c),
        volume: String(v ?? 0),
      }))
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  // ---- Capabilities ----

  /** A crypto exchange's instruments are crypto — period. Even a listed "AAPL"
   *  is a synthetic/custodial token here, not the real equity; secType (spot /
   *  CRYPTO_PERP / FUT / OPT) is the instrument shape, not the asset class. */
  assetClassFor(): 'crypto' {
    return 'crypto'
  }

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['CRYPTO', 'CRYPTO_PERP'],
      supportedOrderTypes: ['MKT', 'LMT'],
      historicalBars: { supported: true, quality: 'realtime' },
    }
  }

  async getMarketClock(): Promise<MarketClock> {
    return {
      isOpen: true,
      timestamp: new Date(),
    }
  }

  // ---- Contract identity ----

  getNativeKey(contract: Contract): string {
    return contract.localSymbol || contract.symbol
  }

  resolveNativeKey(nativeKey: string): Contract {
    // CCXT's nativeKey IS the unified wire symbol (e.g. "BTC/USDT:USDT"),
    // which is also the markets-table key. Direct lookup is the only
    // path needed — no normalization, no reverse-mapping.
    const market = this.markets[nativeKey]
    if (market) return marketToContract(market, this.exchange.id)

    // Last-resort skeletal contract for an unknown nativeKey. Operations
    // that need market metadata (placeOrder / getQuote / closePosition)
    // will fail downstream — that's the loud failure we want rather than
    // a silent half-broken contract.
    const c = new Contract()
    c.localSymbol = nativeKey
    c.symbol = nativeKey.split('/')[0] ?? nativeKey
    return c
  }

  // ---- Provider-specific methods ----

  async getFundingRate(contract: Contract): Promise<FundingRate> {
    this.ensureInit()

    const ccxtSymbol = contractToCcxt(contract, this.markets, this.exchangeName)
    if (!ccxtSymbol) throw new BrokerError('EXCHANGE', 'Cannot resolve contract to CCXT symbol')

    try {
      const funding = await this.exchange.fetchFundingRate(ccxtSymbol)
      const market = this.markets[ccxtSymbol]

      return {
        contract: market
          ? marketToContract(market, this.exchangeName)
          : contract,
        fundingRate: funding.fundingRate ?? 0,
        nextFundingTime: funding.fundingDatetime ? new Date(funding.fundingDatetime) : undefined,
        previousFundingRate: funding.previousFundingRate ?? undefined,
        timestamp: new Date(funding.timestamp ?? Date.now()),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getOrderBook(contract: Contract, limit?: number): Promise<OrderBook> {
    this.ensureInit()

    const ccxtSymbol = contractToCcxt(contract, this.markets, this.exchangeName)
    if (!ccxtSymbol) throw new BrokerError('EXCHANGE', 'Cannot resolve contract to CCXT symbol')

    try {
      const book = await this.exchange.fetchOrderBook(ccxtSymbol, limit)
      const market = this.markets[ccxtSymbol]

      return {
        contract: market
          ? marketToContract(market, this.exchangeName)
          : contract,
        bids: book.bids.map(([p, a]) => [p ?? 0, a ?? 0] as OrderBookLevel),
        asks: book.asks.map(([p, a]) => [p ?? 0, a ?? 0] as OrderBookLevel),
        timestamp: new Date(book.timestamp ?? Date.now()),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }
}
