/**
 * AlpacaBroker — IBroker adapter for Alpaca
 *
 * Direct implementation against @alpacahq/alpaca-trade-api SDK.
 * Supports US equities (STK). Contract resolution uses Alpaca's ticker
 * as nativeId — unambiguous for stocks, extensible when options arrive.
 *
 * Takes IBKR Order objects, reads relevant fields, ignores the rest.
 */

import { z } from 'zod'
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
} from '../types.js'
import '../../contract-ext.js'
import type {
  AlpacaBrokerConfig,
  AlpacaBrokerRaw,
  AlpacaPositionRaw,
  AlpacaOrderRaw,
  AlpacaSnapshotRaw,
  AlpacaClockRaw,
} from './alpaca-types.js'
import { makeContract, resolveSymbol, mapAlpacaOrderStatus, makeOrderState } from './alpaca-contracts.js'
import { buildPosition } from '../contract-builder.js'
import { fuzzyRankContracts, type FuzzyRankInput } from '../fuzzy-rank.js'

/** Subset of Alpaca's `/v2/assets` row we actually use for catalog matching. */
interface AlpacaAssetRaw {
  symbol: string
  name?: string
  class?: string         // 'us_equity' | 'crypto'
  exchange?: string
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
      const c = makeContract(a.symbol)
      // Stash the asset name in `description` so panels that render it
      // (e.g. TradeableContractsPanel) can show "Teucrium Commodity Trust"
      // alongside the ticker.
      if (a.name) c.description = a.name
      if (a.exchange) c.primaryExchange = a.exchange
      return { contract: c, name: a.name }
    })
    return fuzzyRankContracts(entries, pattern)
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    const symbol = resolveSymbol(query)
    if (!symbol) return null

    const details = new ContractDetails()
    details.contract = makeContract(symbol)
    details.validExchanges = 'SMART,NYSE,NASDAQ,ARCA'
    details.orderTypes = 'MKT,LMT,STP,STP LMT,TRAIL'
    details.stockType = 'COMMON'
    return details
  }

  // ---- Trading operations ----

  async placeOrder(contract: Contract, order: Order, tpsl?: TpSlParams): Promise<PlaceOrderResult> {
    const symbol = resolveSymbol(contract)
    if (!symbol) {
      return { success: false, error: 'Cannot resolve contract to Alpaca symbol' }
    }

    try {
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

      // Bracket order (TPSL)
      if (tpsl?.takeProfit || tpsl?.stopLoss) {
        alpacaOrder.order_class = 'bracket'
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
      return {
        success: true,
        orderId: result.id,
        orderState: makeOrderState(result.status),
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult> {
    try {
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
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async cancelOrder(orderId: string): Promise<PlaceOrderResult> {
    try {
      await this.client.cancelOrder(orderId)
      const orderState = new OrderState()
      orderState.status = 'Cancelled'
      return { success: true, orderId, orderState }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult> {
    const symbol = resolveSymbol(contract)
    if (!symbol) {
      return { success: false, error: 'Cannot resolve contract to Alpaca symbol' }
    }

    // Partial close → reverse market order
    if (quantity != null) {
      const positions = await this.getPositions()
      const pos = positions.find(p => p.contract.symbol === symbol)
      if (!pos) return { success: false, error: `No position for ${symbol}` }

      const order = new Order()
      order.action = pos.side === 'long' ? 'SELL' : 'BUY'
      order.orderType = 'MKT'
      order.totalQuantity = quantity
      order.tif = 'DAY'

      return this.placeOrder(contract, order)
    }

    // Full close → native Alpaca API
    try {
      const result = await this.client.closePosition(symbol) as AlpacaOrderRaw
      return {
        success: true,
        orderId: result.id,
        orderState: makeOrderState(result.status),
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ---- Queries ----

  async getAccount(): Promise<AccountInfo> {
    try {
      const [account, positions] = await Promise.all([
        this.client.getAccount() as Promise<AlpacaBrokerRaw>,
        this.client.getPositions() as Promise<AlpacaPositionRaw[]>,
      ])

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

  async getPositions(): Promise<Position[]> {
    try {
      const raw = await this.client.getPositions() as AlpacaPositionRaw[]

      return raw.map(p => buildPosition({
        contract: makeContract(p.symbol),
        currency: 'USD',
        side: p.side === 'long' ? 'long' as const : 'short' as const,
        quantity: new Decimal(p.qty),
        avgCost: new Decimal(p.avg_entry_price).toString(),
        marketPrice: new Decimal(p.current_price).toString(),
        // Pass-through: Alpaca's API already provides multiplier-applied
        // numbers. Don't re-derive (would re-do the math from scratch and
        // could disagree with their server in edge cases).
        marketValue: new Decimal(p.market_value).abs().toString(),
        unrealizedPnL: new Decimal(p.unrealized_pl).toString(),
        realizedPnL: '0',
        // Alpaca is STK-only — canonical multiplier is always '1'.
        multiplier: '1',
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

  async getQuote(contract: Contract): Promise<Quote> {
    const symbol = resolveSymbol(contract)
    if (!symbol) throw new BrokerError('EXCHANGE', 'Cannot resolve contract to Alpaca symbol')

    try {
      const snapshot = await this.client.getSnapshot(symbol) as AlpacaSnapshotRaw

      return {
        contract: makeContract(symbol),
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

  // ---- Capabilities ----

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['STK'],
      supportedOrderTypes: ['MKT', 'LMT', 'STP', 'STP LMT', 'TRAIL'],
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
    return contract.symbol
  }

  resolveNativeKey(nativeKey: string): Contract {
    return makeContract(nativeKey)
  }

  // ---- Internal ----

  private mapOpenOrder(o: AlpacaOrderRaw): OpenOrder {
    const contract = makeContract(o.symbol)

    const order = new Order()
    order.action = o.side.toUpperCase() // buy → BUY
    order.totalQuantity = new Decimal(o.qty ?? o.notional ?? '0')
    order.orderType = (o.type ?? 'market').toUpperCase()
    if (o.limit_price) order.lmtPrice = new Decimal(o.limit_price)
    if (o.stop_price) order.auxPrice = new Decimal(o.stop_price)
    if (o.time_in_force) order.tif = o.time_in_force.toUpperCase()
    if (o.extended_hours) order.outsideRth = true
    // Alpaca order IDs are UUIDs — IBKR's orderId field is number, so leave at default 0.
    // The real string ID is preserved through PlaceOrderResult.orderId and getOrder(string).
    order.orderId = 0

    const tpsl = this.extractTpSl(o)
    return {
      contract,
      order,
      orderState: makeOrderState(o.status, o.reject_reason ?? undefined),
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
