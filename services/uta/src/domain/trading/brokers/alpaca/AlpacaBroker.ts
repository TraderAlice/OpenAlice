/**
 * AlpacaBroker — IBroker adapter for Alpaca
 *
 * Direct implementation against @alpacahq/alpaca-trade-api SDK.
 * Supports equities, spot crypto and permission-gated single-leg options trading.
 * Native keys are stock tickers, slash crypto pairs, or OCC option symbols.
 *
 * Takes IBKR Order objects, reads relevant fields, ignores the rest.
 */

import { z } from 'zod'
import { AlpacaData, type OptionFilters, type SnapshotRaw } from './alpaca-data.js'
import Alpaca from '@alpacahq/alpaca-trade-api'
import Decimal from 'decimal.js'
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
  type ExpandContractFilters,
  type ContractExpansion,
} from '../types.js'
import '../../contract-ext.js'
import type {
  AlpacaBrokerConfig,
  AlpacaBrokerRaw,
  AlpacaPositionRaw,
  AlpacaOrderRaw,
  AlpacaSnapshotRaw,
  AlpacaClockRaw,
  AlpacaBarRaw,
} from './alpaca-types.js'
import { makeContract, resolveSymbol, mapAlpacaOrderStatus, makeOrderState, ALPACA_TIMEFRAME } from './alpaca-contracts.js'
import { buildPosition } from '../contract-builder.js'
import { fuzzyRankContracts, type FuzzyRankInput } from '../fuzzy-rank.js'

/** Subset of Alpaca's `/v2/assets` row we actually use for catalog matching. */
interface AlpacaAssetRaw {
  symbol: string
  name?: string
  class?: string         // 'us_equity' | 'crypto'
  exchange?: string
  min_order_size?: string
  min_trade_increment?: string
  price_increment?: string
  tradable?: boolean
  status?: string        // 'active' | 'inactive'
}

/** Map IBKR orderType codes to Alpaca API order type strings. */
function ibkrOrderTypeToAlpaca(orderType: string): string {
  switch (orderType) {
    case 'MKT': return 'market'
    case 'LMT': return 'limit'
    case 'STP': return 'stop'
    case 'STP LMT': return 'stop_limit'
    case 'TRAIL': return 'trailing_stop'
    default: return orderType.toLowerCase()
  }
}

/** Map IBKR TIF codes to Alpaca API time_in_force strings. */
function ibkrTifToAlpaca(tif: string): string {
  switch (tif) {
    case 'DAY': return 'day'
    case 'GTC': return 'gtc'
    case 'IOC': return 'ioc'
    case 'FOK': return 'fok'
    case 'OPG': return 'opg'
    default: return tif.toLowerCase() || 'day'
  }
}

/**
 * Surface Alpaca's response body in failures. The SDK throws axios-shaped
 * errors whose message is just "Request failed with status code 422" — the
 * actual reason ("order is not cancelable", observed live when cancelling
 * during the after-hours pending_new window) lives in response.data and was
 * being dropped, leaving the git record and the UI with an opaque code.
 */
function alpacaErrorMessage(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err)
  const data = (err as { response?: { data?: unknown } })?.response?.data
  if (data && typeof data === 'object') {
    return `${base} — alpaca: ${JSON.stringify(data)}`
  }
  return base
}

/** The free-tier "you can't query the last ~15 min of SIP data" gate — a 403
 *  whose body says exactly that. The signal to retry the same window on IEX. */
function isRecentSipDenied(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status
  return status === 403 && /recent SIP data/i.test(alpacaErrorMessage(err))
}

export class AlpacaBroker implements IBroker {
  // ---- Self-registration ----

  static configSchema = z.object({
    paper: z.boolean().default(true),
    apiKey: z.string().optional(),
    apiSecret: z.string().optional(),
  })

  static configFields: BrokerConfigField[] = [
    { name: 'paper', type: 'boolean', label: 'Paper Trading', default: true, description: 'When enabled, orders are routed to Alpaca\'s paper trading environment.' },
    { name: 'apiKey', type: 'password', label: 'API Key', required: true, sensitive: true },
    { name: 'apiSecret', type: 'password', label: 'Secret Key', required: true, sensitive: true },
  ]

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): AlpacaBroker {
    const bc = AlpacaBroker.configSchema.parse(config.brokerConfig)
    return new AlpacaBroker({
      id: config.id,
      label: config.label,
      apiKey: bc.apiKey ?? '',
      secretKey: bc.apiSecret ?? '',
      paper: bc.paper,
    })
  }

  // ---- Instance ----

  readonly brokerEngine = 'alpaca'
  readonly id: string
  readonly label: string

  private client!: InstanceType<typeof Alpaca>
  private readonly config: AlpacaBrokerConfig
  /**
   * Local cache of Alpaca's tradeable asset list. Pulled at connect-time and
   * (eventually) refreshed by a 6h cron in main.ts. Empty array (rather than
   * null) means "we tried and got nothing" — null means "haven't tried yet".
   */
  private catalog: AlpacaAssetRaw[] | null = null
  /** symbol → asset, derived from `catalog` for O(1) name/exchange joins on
   *  position & order rows (issue #340). Rebuilt whenever the catalog loads. */
  private catalogBySymbol: Map<string, AlpacaAssetRaw> | null = null
  /** Venue permissions, populated at connect and refreshed on account reads/writes. */
  private optionsTradingLevel = 0

  constructor(config: AlpacaBrokerConfig) {
    this.config = config
    this.id = config.id ?? (config.paper ? 'alpaca-paper' : 'alpaca-live')
    this.label = config.label ?? (config.paper ? 'Alpaca Paper' : 'Alpaca Live')
  }

  // ---- Lifecycle ----

  private static readonly MAX_INIT_RETRIES = 5
  private static readonly MAX_AUTH_RETRIES = 2
  private static readonly INIT_RETRY_BASE_MS = 1000

  async init(): Promise<void> {
    if (!this.config.apiKey || !this.config.secretKey) {
      throw new BrokerError(
        'CONFIG',
        `No API credentials configured. Set apiKey and apiSecret in accounts.json to enable this account.`,
      )
    }

    this.client = new Alpaca({
      keyId: this.config.apiKey,
      secretKey: this.config.secretKey,
      paper: this.config.paper,
    })

    let lastErr: unknown
    for (let attempt = 1; attempt <= AlpacaBroker.MAX_INIT_RETRIES; attempt++) {
      try {
        const account = await this.client.getAccount() as AlpacaBrokerRaw
        this.optionsTradingLevel = account.options_trading_level ?? 0
        console.log(
          `AlpacaBroker[${this.id}]: connected (paper=${this.config.paper}, equity=$${parseFloat(account.equity).toFixed(2)})`,
        )
        // Pull the asset catalog opportunistically — failure here is
        // non-fatal because searchContracts can fall back to echoing the
        // ticker, and the 6h cron will retry. Still log so the user knows.
        this.refreshCatalog().catch((err) => {
          console.warn(`AlpacaBroker[${this.id}]: initial catalog load failed:`, err instanceof Error ? err.message : err)
        })
        return
      } catch (err) {
        lastErr = err
        const isAuthError = err instanceof Error &&
          /40[13]|forbidden|unauthorized/i.test(err.message)
        if (isAuthError && attempt >= AlpacaBroker.MAX_AUTH_RETRIES) {
          throw new BrokerError(
            'AUTH',
            `Authentication failed — verify your Alpaca API key and secret are correct.`,
          )
        }
        if (attempt < AlpacaBroker.MAX_INIT_RETRIES) {
          const delay = AlpacaBroker.INIT_RETRY_BASE_MS * 2 ** (attempt - 1)
          console.warn(`AlpacaBroker[${this.id}]: init attempt ${attempt}/${AlpacaBroker.MAX_INIT_RETRIES} failed, retrying in ${delay}ms...`)
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }
    throw lastErr
  }

  async close(): Promise<void> {
    // Alpaca SDK has no explicit close
  }

  // ---- Contract search (EnumeratingCatalog model) ----

  /**
   * Pull Alpaca's full active asset list and atomically replace the local
   * cache. Failure preserves the previous cache (better stale than empty).
   *
   * Called once at init() and periodically by main.ts's 6h cron.
   */
  async refreshCatalog(): Promise<void> {
    try {
      const raw = await (this.client as unknown as {
        getAssets: (opts?: { status?: string }) => Promise<AlpacaAssetRaw[]>
      }).getAssets({ status: 'active' })
      // Filter to tradable assets only — there's no point surfacing a
      // contract the broker won't accept orders for.
      const next = (raw ?? []).filter((a) => a.tradable !== false)
      this.catalog = next
      this.catalogBySymbol = new Map(next.map((a) => [a.symbol, a]))
      console.log(`AlpacaBroker[${this.id}]: catalog loaded (${next.length} active tradable assets)`)
    } catch (err) {
      // Re-throw so the caller (init / cron) can decide whether to log or
      // swallow. We don't clobber `this.catalog` on failure.
      throw err
    }
  }

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    if (!pattern) return []

    // Catalog hasn't loaded yet (init still running, or first load failed).
    // Fall back to a single echo so the broker isn't dead in the water —
    // this is the pre-catalog behaviour, kept as a safety net.
    if (this.catalog == null) {
      const desc = new ContractDescription()
      desc.contract = makeContract(pattern.toUpperCase())
      return [desc]
    }

    const entries: FuzzyRankInput[] = this.catalog.map((a) => {
      const c = makeContract(a.symbol, a.class)
      // Stash the asset name in `description` so panels that render it
      // (e.g. TradeableContractsPanel) can show "Teucrium Commodity Trust"
      // alongside the ticker.
      if (a.name) c.description = a.name
      if (a.exchange) c.primaryExchange = a.exchange
      return { contract: c, name: a.name }
    })
    return fuzzyRankContracts(entries, pattern).map(desc => {
      desc.derivativeSecTypes = desc.contract.secType === 'STK' ? ['OPT'] : []
      return desc
    })
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    const symbol = resolveSymbol(query)
    if (!symbol) return null

    const details = new ContractDetails()
    details.contract = this.contractFor(symbol)
    details.validExchanges = 'SMART,NYSE,NASDAQ,ARCA'
    details.orderTypes = 'MKT,LMT,STP,STP LMT,TRAIL'
    details.stockType = details.contract.secType === 'STK' ? 'COMMON' : ''
    if (details.contract.secType === 'CRYPTO') {
      details.validExchanges = 'ALPACA'
      details.orderTypes = 'MKT,LMT,STP LMT'
      const asset = this.catalogBySymbol?.get(symbol)
      if (asset?.price_increment) details.minTick = Number(asset.price_increment)
      if (asset?.min_order_size) details.minSize = new Decimal(asset.min_order_size)
      if (asset?.min_trade_increment) details.sizeIncrement = new Decimal(asset.min_trade_increment)
    } else if (details.contract.secType === 'OPT') {
      details.orderTypes = this.optionsTradingLevel > 0 ? 'MKT,LMT,STP,STP LMT' : ''
      details.minSize = new Decimal(1)
      details.sizeIncrement = new Decimal(1)
    }
    return details
  }

  /** Validate only fields this adapter can faithfully send. Alpaca remains the
   * authority for strategy approval, collateral and opening/closing exposure. */
  private validateOptionOrder(order: Partial<Order>, tpsl?: TpSlParams, amendment = false): string | undefined {
    if ((!amendment || order.orderType) && !['MKT', 'LMT', 'STP', 'STP LMT'].includes(order.orderType ?? '')) return 'Alpaca single-leg options support MKT, LMT, STP and STP LMT only.'
    if ((!amendment || order.tif) && !['DAY', 'GTC'].includes(order.tif ?? 'DAY')) return 'Alpaca options require DAY or GTC time in force.'
    if (order.parentId || order.ocaGroup || order.goodTillDate || (order.trailStopPrice != null && !order.trailStopPrice.equals(UNSET_DECIMAL))) return 'Alpaca options do not support parent/OCA, GTD or trailing-stop fields.'
    const qty = order.totalQuantity
    if ((!amendment || (qty != null && !qty.equals(UNSET_DECIMAL))) && (!qty || qty.equals(UNSET_DECIMAL) || !qty.isFinite() || !qty.isInteger() || qty.lte(0))) return 'Alpaca options require a positive whole number of contracts.'
    if (order.cashQty != null && !order.cashQty.equals(UNSET_DECIMAL)) return 'Alpaca options do not support cash-notional orders.'
    if (tpsl || order.outsideRth || (order.trailingPercent != null && !order.trailingPercent.equals(UNSET_DECIMAL))) return 'Alpaca options do not support attached TP/SL, trailing or extended-hours orders.'
  }

  private async optionPermissionError(): Promise<string | undefined> {
    const account = await this.client.getAccount() as AlpacaBrokerRaw
    this.optionsTradingLevel = account.options_trading_level ?? 0
    if (this.optionsTradingLevel < 1) return `Alpaca options trading is disabled for this account (options_trading_level=${this.optionsTradingLevel}). Enable options approval in Alpaca.`
    if (account.trading_blocked || account.account_blocked) return 'Alpaca reports that this account is blocked for trading.'
  }

  // ---- Trading operations ----

  async placeOrder(contract: Contract, order: Order, tpsl?: TpSlParams): Promise<PlaceOrderResult> {
    const symbol = this.canonicalSymbol(contract)
    if (!symbol) {
      return { success: false, error: 'Cannot resolve contract to Alpaca symbol' }
    }

    if (this.contractFor(symbol).secType === 'OPT') {
      const error = this.validateOptionOrder(order, tpsl)
      if (error) return { success: false, error }
    }
    if (this.contractFor(symbol).secType === 'CRYPTO') {
      if (!['MKT', 'LMT', 'STP LMT'].includes(order.orderType)) return { success: false, error: 'Alpaca crypto supports MKT, LMT and STP LMT only.' }
      if (!['GTC', 'IOC'].includes(order.tif)) return { success: false, error: 'Alpaca crypto requires GTC or IOC time in force.' }
      if (tpsl || order.outsideRth) return { success: false, error: 'Alpaca crypto does not support attached TP/SL or extended-hours flags.' }
    }

    try {
      if (this.contractFor(symbol).secType === 'OPT') {
        const error = await this.optionPermissionError()
        if (error) return { success: false, error }
      }
      const alpacaOrder: Record<string, unknown> = {
        symbol,
        side: order.action.toLowerCase(), // BUY → buy, SELL → sell
        type: ibkrOrderTypeToAlpaca(order.orderType),
        time_in_force: ibkrTifToAlpaca(order.tif),
      }

      // Quantity: totalQuantity or cashQty (notional)
      // Alpaca REST accepts numeric strings — preferred over .toNumber()
      // to avoid IEEE 754 noise for satoshi-scale values.
      if (!order.totalQuantity.equals(UNSET_DECIMAL)) {
        alpacaOrder.qty = order.totalQuantity.toFixed()
      } else if (!order.cashQty.equals(UNSET_DECIMAL)) {
        alpacaOrder.notional = order.cashQty.toFixed()
      }

      // Prices
      if (!order.lmtPrice.equals(UNSET_DECIMAL)) alpacaOrder.limit_price = order.lmtPrice.toFixed()
      if (!order.auxPrice.equals(UNSET_DECIMAL)) {
        // auxPrice is stop price for STP, trailing offset for TRAIL
        if (order.orderType === 'TRAIL') {
          alpacaOrder.trail_price = order.auxPrice.toFixed()
        } else {
          alpacaOrder.stop_price = order.auxPrice.toFixed()
        }
      }
      if (!order.trailingPercent.equals(UNSET_DECIMAL)) alpacaOrder.trail_percent = order.trailingPercent.toFixed()
      if (order.outsideRth) alpacaOrder.extended_hours = true

      // Attached exit legs (TPSL). Alpaca's `bracket` class REQUIRES both
      // take_profit AND stop_loss — a single leg under `bracket` is rejected
      // 422 ("bracket orders require take_profit.limit_price"). When only one
      // leg is present, `oto` (one-triggers-other) is the correct class, which
      // accepts either leg alone. So: two legs → bracket, one leg → oto.
      if (tpsl?.takeProfit || tpsl?.stopLoss) {
        alpacaOrder.order_class = (tpsl.takeProfit && tpsl.stopLoss) ? 'bracket' : 'oto'
        if (tpsl.takeProfit) {
          alpacaOrder.take_profit = { limit_price: parseFloat(tpsl.takeProfit.price) }
        }
        if (tpsl.stopLoss) {
          alpacaOrder.stop_loss = {
            stop_price: parseFloat(tpsl.stopLoss.price),
            ...(tpsl.stopLoss.limitPrice && { limit_price: parseFloat(tpsl.stopLoss.limitPrice) }),
          }
        }
      }

      const result = await this.client.createOrder(alpacaOrder) as AlpacaOrderRaw
      // Bracket legs: surface child order ids so the ledger tracks them from
      // birth. The held stop leg never appears in the open-orders listing
      // (Alpaca keeps it 'held' while the TP works), so place-time is the
      // ONLY moment Alice can learn it exists.
      const legs = (result.legs ?? [])
        .filter((l) => l.id)
        .map((l) => ({
          orderId: l.id,
          kind: (l.stop_price ? 'stopLoss' : 'takeProfit') as 'stopLoss' | 'takeProfit',
        }))
      return {
        success: true,
        orderId: result.id,
        orderState: makeOrderState(result.status),
        ...(legs.length > 0 ? { legs } : {}),
      }
    } catch (err) {
      return { success: false, error: alpacaErrorMessage(err) }
    }
  }

  async modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult> {
    try {
      const existing = await this.client.getOrder(orderId) as AlpacaOrderRaw
      const contract = this.contractFor(existing.symbol, existing.asset_class)
      if (contract.secType === 'OPT') {
        const error = this.validateOptionOrder(changes, undefined, true)
        if (error) return { success: false, error }
        if (changes.orderType && ibkrOrderTypeToAlpaca(changes.orderType) !== existing.type) return { success: false, error: 'Alpaca cannot replace the order type; cancel and submit a new order.' }
        const permissionError = await this.optionPermissionError()
        if (permissionError) return { success: false, error: permissionError }
      }
      if (contract.secType === 'CRYPTO') {
        if (changes.tif && !['GTC', 'IOC'].includes(changes.tif)) return { success: false, error: 'Alpaca crypto requires GTC or IOC time in force.' }
        if (changes.trailingPercent != null && !changes.trailingPercent.equals(UNSET_DECIMAL)) return { success: false, error: 'Alpaca crypto does not support trailing orders.' }
      }
      const patch: Record<string, unknown> = {}
      if (changes.totalQuantity != null && !changes.totalQuantity.equals(UNSET_DECIMAL)) patch.qty = changes.totalQuantity.toFixed()
      if (changes.lmtPrice != null && !changes.lmtPrice.equals(UNSET_DECIMAL)) patch.limit_price = changes.lmtPrice.toFixed()
      if (changes.auxPrice != null && !changes.auxPrice.equals(UNSET_DECIMAL)) patch.stop_price = changes.auxPrice.toFixed()
      if (changes.trailingPercent != null && !changes.trailingPercent.equals(UNSET_DECIMAL)) patch.trail = changes.trailingPercent.toFixed()
      if (changes.tif) patch.time_in_force = ibkrTifToAlpaca(changes.tif)

      const result = await this.client.replaceOrder(orderId, patch) as AlpacaOrderRaw

      return {
        success: true,
        orderId: result.id,
        orderState: makeOrderState(result.status),
      }
    } catch (err) {
      return { success: false, error: alpacaErrorMessage(err) }
    }
  }

  async cancelOrder(orderId: string): Promise<PlaceOrderResult> {
    try {
      await this.client.cancelOrder(orderId)
      const orderState = new OrderState()
      orderState.status = 'Cancelled'
      return { success: true, orderId, orderState }
    } catch (err) {
      return { success: false, error: alpacaErrorMessage(err) }
    }
  }

  async closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult> {
    const symbol = this.canonicalSymbol(contract)
    if (!symbol) {
      return { success: false, error: 'Cannot resolve contract to Alpaca symbol' }
    }

    // Partial close → reverse market order
    if (quantity != null) {
      const positions = await this.getPositions()
      const pos = positions.find(p => this.getNativeKey(p.contract) === symbol)
      if (!pos) return { success: false, error: `No position for ${symbol}` }
      if (!quantity.isFinite() || quantity.lte(0) || quantity.gt(new Decimal(pos.quantity).abs())) return { success: false, error: 'Close quantity must be positive and cannot exceed the position.' }

      const order = new Order()
      order.action = pos.side === 'long' ? 'SELL' : 'BUY'
      order.orderType = 'MKT'
      order.totalQuantity = quantity
      order.tif = pos.contract.secType === 'CRYPTO' ? 'GTC' : 'DAY'

      return this.placeOrder(contract, order)
    }

    // Positions API uses compact crypto symbols (BTCUSD), unlike data/orders
    // which use BTC/USD. Even percent-encoded slash paths return 404.
    try {
      const result = await this.client.closePosition(this.contractFor(symbol).secType === 'CRYPTO' ? symbol.replace('/', '') : symbol) as AlpacaOrderRaw
      return {
        success: true,
        orderId: result.id,
        orderState: makeOrderState(result.status),
      }
    } catch (err) {
      return { success: false, error: alpacaErrorMessage(err) }
    }
  }

  // ---- Queries ----

  async getAccount(): Promise<AccountInfo> {
    try {
      const [account, positions] = await Promise.all([
        this.client.getAccount() as Promise<AlpacaBrokerRaw>,
        this.client.getPositions() as Promise<AlpacaPositionRaw[]>,
      ])

      this.optionsTradingLevel = account.options_trading_level ?? 0

      // Alpaca account API doesn't provide unrealizedPnL — aggregate from positions with Decimal
      const unrealizedPnL = positions.reduce(
        (sum, p) => sum.plus(new Decimal(p.unrealized_pl)),
        new Decimal(0),
      )

      return {
        baseCurrency: 'USD',
        netLiquidation: new Decimal(account.equity).toString(),
        totalCashValue: new Decimal(account.cash).toString(),
        unrealizedPnL: unrealizedPnL.toString(),
        buyingPower: new Decimal(account.buying_power).toString(),
        dayTradesRemaining: account.daytrade_count != null ? Math.max(0, 3 - account.daytrade_count) : undefined,
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  /**
   * Build a contract for `symbol`, enriched from the cached asset catalog with
   * the instrument long-name (`description`) + primary listing exchange so
   * position / order / trade rows can render them (issue #340). Falls back to a
   * bare contract before the catalog has loaded.
   */
  private canonicalSymbol(contract: Contract): string | null {
    const symbol = resolveSymbol(contract)
    return symbol ? resolveSymbol(this.contractFor(symbol, contract.secType === 'CRYPTO' ? 'crypto' : undefined)) : null
  }

  private contractFor(symbol: string, assetClass?: string): Contract {
    const asset = this.catalogBySymbol?.get(symbol) ?? this.catalog?.find(a => a.class === 'crypto' && a.symbol.replace('/', '') === symbol)
    const contract = makeContract(asset?.symbol ?? symbol, assetClass ?? asset?.class)
    if (asset?.name) contract.description = asset.name
    if (asset?.exchange) contract.primaryExchange = asset.exchange
    return contract
  }

  async getPositions(): Promise<Position[]> {
    try {
      const raw = await this.client.getPositions() as AlpacaPositionRaw[]

      return raw.map(p => buildPosition({
        contract: this.contractFor(p.symbol, p.asset_class),
        currency: 'USD',
        side: p.side === 'long' ? 'long' as const : 'short' as const,
        // UTA carries direction in side; Alpaca encodes shorts in qty too.
        quantity: new Decimal(p.qty).abs(),
        avgCost: new Decimal(p.avg_entry_price).toString(),
        marketPrice: new Decimal(p.current_price).toString(),
        // Pass-through: Alpaca's API already provides multiplier-applied
        // numbers. Don't re-derive (would re-do the math from scratch and
        // could disagree with their server in edge cases).
        marketValue: new Decimal(p.market_value).abs().toString(),
        unrealizedPnL: new Decimal(p.unrealized_pl).toString(),
        realizedPnL: '0',
        multiplier: this.contractFor(p.symbol, p.asset_class).multiplier || '1',
      }))
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    const results: OpenOrder[] = []
    for (const id of orderIds) {
      const order = await this.getOrder(id)
      if (order) results.push(order)
    }
    return results
  }

  async getOrder(orderId: string): Promise<OpenOrder | null> {
    try {
      const raw = await this.client.getOrder(orderId) as AlpacaOrderRaw
      return this.mapOpenOrder(raw)
    } catch {
      return null
    }
  }

  /** All open orders on the account — external-order observation surface. */
  async getOpenOrders(): Promise<OpenOrder[]> {
    try {
      const query = { status: 'open' } as Parameters<typeof this.client.getOrders>[0]
      const raw = await this.client.getOrders(query) as AlpacaOrderRaw[]
      return raw.map((o) => this.mapOpenOrder(o))
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getQuote(contract: Contract): Promise<Quote> {
    const symbol = this.canonicalSymbol(contract)
    if (!symbol) throw new BrokerError('EXCHANGE', 'Cannot resolve contract to Alpaca symbol')

    try {
      const resolved = this.contractFor(symbol)
      if (resolved.secType === 'CRYPTO') {
        const result = await this.data.read<{ snapshots: Record<string, SnapshotRaw> }>(
          '/v1beta3/crypto/us/snapshots', { symbols: resolved.symbol },
        )
        const snapshot = result.snapshots?.[resolved.symbol]
        if (!snapshot?.latestTrade || !snapshot.latestQuote) {
          throw new Error(`No complete Alpaca crypto snapshot for ${resolved.symbol}`)
        }
        return {
          contract: resolved,
          last: String(snapshot.latestTrade.p),
          bid: String(snapshot.latestQuote.bp),
          ask: String(snapshot.latestQuote.ap),
          volume: String(snapshot.dailyBar?.v ?? 0),
          ...(snapshot.dailyBar && { high: String(snapshot.dailyBar.h), low: String(snapshot.dailyBar.l) }),
          timestamp: new Date(snapshot.latestQuote.t),
        }
      }
      if (resolved.secType === 'OPT') {
        throw new BrokerError('CONFIG', 'Use option-chain snapshots with explicit feed metadata for Alpaca options.')
      }
      const snapshot = await this.client.getSnapshot(symbol) as AlpacaSnapshotRaw

      return {
        contract: this.contractFor(symbol),
        last: String(snapshot.LatestTrade.Price),
        bid: String(snapshot.LatestQuote.BidPrice),
        ask: String(snapshot.LatestQuote.AskPrice),
        volume: String(snapshot.DailyBar.Volume),
        timestamp: new Date(snapshot.LatestTrade.Timestamp),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  /**
   * Historical OHLCV via Alpaca's market-data v2 `getBarsV2` (an async
   * generator — drained into an array). `adjustment:'all'` gives split/dividend
   * -adjusted bars. Free-tier accounts get the IEX feed (partial tape), hence
   * capability quality 'iex'; full SIP needs a paid data subscription.
   */
  async getHistorical(contract: Contract, params: BarParams): Promise<Bar[]> {
    const symbol = this.canonicalSymbol(contract)
    if (!symbol) throw new BrokerError('EXCHANGE', 'Cannot resolve contract to Alpaca symbol')
    const resolved = this.contractFor(symbol)
    if (resolved.secType === 'CRYPTO') return this.cryptoHistory(resolved.symbol, params)
    if (resolved.secType === 'OPT') throw new BrokerError('CONFIG', 'Alpaca option history is not enabled; use option-chain snapshots.')
    const timeframe = ALPACA_TIMEFRAME[params.interval]
    const limit = params.limit == null ? undefined : Math.max(1, Math.floor(params.limit))
    const baseOpts: Record<string, unknown> = { timeframe, adjustment: 'all' }
    if (params.start) baseOpts.start = params.start.toISOString()
    if (params.end) baseOpts.end = params.end.toISOString()
    // Alpaca applies limit to the FIRST rows after start. For a bounded Alice
    // request, drain the window and tail-slice locally so BarParams.limit keeps
    // its "most recent N" contract. Preserve the direct limit-only call shape
    // for callers that provide no explicit bounds.
    if (limit && !params.start && !params.end) baseOpts.limit = limit

    const drain = async (feed: 'sip' | 'iex'): Promise<Bar[]> => {
      const bars: Bar[] = []
      const gen = this.client.getBarsV2(symbol, { ...baseOpts, feed }) as AsyncGenerator<AlpacaBarRaw>
      for await (const b of gen) {
        bars.push({
          timestamp: new Date(b.Timestamp),
          open: String(b.OpenPrice),
          high: String(b.HighPrice),
          low: String(b.LowPrice),
          close: String(b.ClosePrice),
          volume: String(b.Volume),
        })
      }
      return bars
    }

    try {
      let bars: Bar[]
      // SIP = the full consolidated tape (the right feed for history/backtest —
      // real volume, real closes). The free tier can't query the last ~15 min of
      // SIP, so a window that reaches "now" 403s; fall back to IEX (free
      // real-time, but only IEX's ~2-3% of the tape) for that case so a recent
      // request degrades to thinner data instead of dying. (Alpaca's OWN data
      // endpoint serves both feeds; this never touches a third-party vendor.)
      try {
        bars = await drain('sip')
      } catch (err) {
        if (isRecentSipDenied(err)) {
          console.warn(
            `AlpacaBroker[${this.id}]: SIP denied recent data for ${symbol} (${timeframe}) — falling back to IEX (thinner tape). Free tier can't query the last ~15min of SIP.`,
          )
          bars = await drain('iex')
        } else {
          throw err
        }
      }
      return limit == null ? bars : bars.slice(-limit)
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  // ---- Capabilities ----

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['STK', 'CRYPTO', ...(this.optionsTradingLevel > 0 ? ['OPT'] : [])],
      supportedOrderTypes: ['MKT', 'LMT', 'STP', 'STP LMT', 'TRAIL'],
      historicalBars: { supported: true, quality: 'iex', qualityBySecType: { CRYPTO: 'realtime' } },
    }
  }

  async getMarketClock(): Promise<MarketClock> {
    try {
      const clock = await this.client.getClock() as AlpacaClockRaw
      return {
        isOpen: clock.is_open,
        nextOpen: new Date(clock.next_open),
        nextClose: new Date(clock.next_close),
        timestamp: new Date(clock.timestamp),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }


  // ---- Contract identity ----

  getNativeKey(contract: Contract): string {
    return resolveSymbol(contract) ?? contract.symbol
  }

  resolveNativeKey(nativeKey: string): Contract {
    return this.contractFor(nativeKey)
  }

  private get data(): AlpacaData {
    return new AlpacaData(this.config)
  }

  async getOptionContracts(underlying: string, filters: OptionFilters = {}) {
    return this.data.optionContracts(underlying, filters)
  }
  async getOptionChain(underlying: string, filters: OptionFilters = {}) {
    return this.data.optionSnapshots(underlying, filters)
  }

  async expandContract(nativeKey: string, filters: ExpandContractFilters = {}): Promise<ContractExpansion> {
    if (this.contractFor(nativeKey).secType !== 'STK' || (filters.secType && filters.secType !== 'OPT')) throw new Error('Alpaca expands stock option contracts only.')
    if (!filters.expiry || !/^\d{8}$/.test(filters.expiry)) throw new Error('Alpaca option expansion requires expiry YYYYMMDD. Use option-contracts for paginated expiration discovery.')
    const rows = []
    const seenTokens = new Set<string>()
    let pageToken: string | undefined
    do {
      const page = await this.getOptionContracts(nativeKey, { expiration: filters.expiry?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
        right: filters.right === 'C' ? 'call' : filters.right === 'P' ? 'put' : undefined,
        strikeMin: filters.strikeMin, strikeMax: filters.strikeMax, limit: 1000, pageToken })
      rows.push(...page.contracts)
      pageToken = page.nextPageToken ?? undefined
      if (pageToken && seenTokens.has(pageToken)) throw new Error('Alpaca repeated an option pagination token.')
      if (pageToken) seenTokens.add(pageToken)
    } while (pageToken)
    return { kind: 'contracts', total: rows.length, contracts: rows.slice(0, Math.min(filters.limit ?? 60, 200)).map(row => {
      const contract = makeContract(row.symbol, 'us_option')
      contract.multiplier = row.multiplier ?? row.size
      return contract
    }), hint: 'Single-leg options trading requires Alpaca account approval; quantities are whole contracts and prices are per unit of the underlying. Use option-chain for feed-labelled snapshots and option-contracts for open interest with observation dates.' }
  }

  async getOrderBook(contract: Contract, limit = 20): Promise<Record<string, unknown>> {
    const resolved = this.contractFor(this.canonicalSymbol(contract) ?? '')
    if (resolved.secType !== 'CRYPTO') throw new Error('Alpaca order books are available for crypto only.')
    const result = await this.data.read<{ orderbooks: Record<string, { t: string; b: { p: number; s: number }[]; a: { p: number; s: number }[] }> }>('/v1beta3/crypto/us/latest/orderbooks', { symbols: resolved.symbol })
    const book = result.orderbooks?.[resolved.symbol]
    if (!book) throw new Error(`No Alpaca order book for ${resolved.symbol}`)
    return { symbol: resolved.symbol, timestamp: book.t, bids: book.b.slice(0, limit).map(l => [String(l.p), String(l.s)]), asks: book.a.slice(0, limit).map(l => [String(l.p), String(l.s)]) }
  }

  private async cryptoHistory(symbol: string, params: BarParams): Promise<Bar[]> {
    type RawBar = { t: string; o: number; h: number; l: number; c: number; v: number }
    const rows: RawBar[] = []
    let pageToken: string | undefined
    // Descending pagination selects the most recent N bars, not the first N
    // after start. Always return chronological data to UTA/BarService.
    const count = params.limit == null ? undefined : Math.max(1, Math.floor(params.limit))
    const intervalMs = ({ '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000 })[params.interval]
    const start = params.start ?? new Date((params.end?.getTime() ?? Date.now()) - intervalMs * (count ?? 1000) * 2)
    const seenTokens = new Set<string>()
    do {
      const page = await this.data.read<{ bars: Record<string, RawBar[]>; next_page_token?: string | null }>('/v1beta3/crypto/us/bars', {
        symbols: symbol, timeframe: ALPACA_TIMEFRAME[params.interval], start: start.toISOString(), end: params.end?.toISOString(),
        sort: 'desc', limit: Math.min(count == null ? 10000 : count - rows.length, 10000), page_token: pageToken,
      })
      rows.push(...(page.bars?.[symbol] ?? []))
      pageToken = page.next_page_token ?? undefined
      if (pageToken && seenTokens.has(pageToken)) throw new Error('Alpaca repeated a bars pagination token.')
      if (pageToken) seenTokens.add(pageToken)
    } while (pageToken && (count == null || rows.length < count))
    return rows.slice(0, count).sort((a, b) => a.t.localeCompare(b.t)).map(b => ({ timestamp: new Date(b.t), open: String(b.o), high: String(b.h), low: String(b.l), close: String(b.c), volume: String(b.v) }))
  }

  // ---- Internal ----

  private mapOpenOrder(o: AlpacaOrderRaw): OpenOrder {
    const contract = this.contractFor(o.symbol, o.asset_class)

    const order = new Order()
    order.action = o.side.toUpperCase() // buy → BUY
    order.totalQuantity = o.qty != null ? new Decimal(o.qty) : UNSET_DECIMAL
    if (o.notional != null) order.cashQty = new Decimal(o.notional)
    order.orderType = ({ market: 'MKT', limit: 'LMT', stop: 'STP', stop_limit: 'STP LMT', trailing_stop: 'TRAIL' } as Record<string, string>)[o.type] ?? o.type.toUpperCase()
    if (o.limit_price) order.lmtPrice = new Decimal(o.limit_price)
    if (o.stop_price) order.auxPrice = new Decimal(o.stop_price)
    if (o.time_in_force) order.tif = o.time_in_force.toUpperCase()
    if (o.extended_hours) order.outsideRth = true
    // Fill data — sync reads these to record execution qty/price into git.
    if (o.filled_qty != null) order.filledQuantity = new Decimal(o.filled_qty)
    // Alpaca order IDs are UUIDs — IBKR's orderId field is number, so leave at default 0.
    // The real string ID is preserved through PlaceOrderResult.orderId and getOrder(string).
    order.orderId = 0

    const tpsl = this.extractTpSl(o)
    return {
      contract,
      order,
      orderState: makeOrderState(o.status, o.reject_reason ?? undefined),
      ...(o.id && { orderId: o.id }),
      ...(o.filled_avg_price != null && { avgFillPrice: o.filled_avg_price }),
      ...(tpsl && { tpsl }),
    }
  }

  private extractTpSl(o: AlpacaOrderRaw): TpSlParams | undefined {
    if (o.order_class !== 'bracket' || !o.legs?.length) return undefined
    let takeProfit: TpSlParams['takeProfit']
    let stopLoss: TpSlParams['stopLoss']
    for (const leg of o.legs) {
      if (leg.limit_price && !leg.stop_price) {
        takeProfit = { price: leg.limit_price }
      } else if (leg.stop_price) {
        stopLoss = {
          price: leg.stop_price,
          ...(leg.limit_price && { limitPrice: leg.limit_price }),
        }
      }
    }
    if (!takeProfit && !stopLoss) return undefined
    return { takeProfit, stopLoss }
  }
}
