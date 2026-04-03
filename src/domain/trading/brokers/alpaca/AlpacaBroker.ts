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
import { Contract, ContractDescription, ContractDetails, Order, OrderState, UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'
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

  // ---- Contract search ----

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    if (!pattern) return []

    // Alpaca tickers are unique for stocks — pattern is treated as exact ticker match
    const ticker = pattern.toUpperCase()
    const desc = new ContractDescription()
    desc.contract = makeContract(ticker)
    return [desc]
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
      if (!order.totalQuantity.equals(UNSET_DECIMAL)) {
        alpacaOrder.qty = parseFloat(order.totalQuantity.toString())
      } else if (order.cashQty !== UNSET_DOUBLE) {
        alpacaOrder.notional = order.cashQty
      }

      // Prices
      if (order.lmtPrice !== UNSET_DOUBLE) alpacaOrder.limit_price = order.lmtPrice
      if (order.auxPrice !== UNSET_DOUBLE) {
        // auxPrice is stop price for STP, trailing offset for TRAIL
        if (order.orderType === 'TRAIL') {
          alpacaOrder.trail_price = order.auxPrice
        } else {
          alpacaOrder.stop_price = order.auxPrice
        }
      }
      if (order.trailingPercent !== UNSET_DOUBLE) alpacaOrder.trail_percent = order.trailingPercent
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
      if (changes.totalQuantity != null && !changes.totalQuantity.equals(UNSET_DECIMAL)) patch.qty = parseFloat(changes.totalQuantity.toString())
      if (changes.lmtPrice != null && changes.lmtPrice !== UNSET_DOUBLE) patch.limit_price = changes.lmtPrice
      if (changes.auxPrice != null && changes.auxPrice !== UNSET_DOUBLE) patch.stop_price = changes.auxPrice
      if (changes.trailingPercent != null && changes.trailingPercent !== UNSET_DOUBLE) patch.trail = changes.trailingPercent
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
      ).toNumber()

      return {
        netLiquidation: parseFloat(account.equity),
        totalCashValue: parseFloat(account.cash),
        unrealizedPnL,
        buyingPower: parseFloat(account.buying_power),
        dayTradesRemaining: account.daytrade_count != null ? Math.max(0, 3 - account.daytrade_count) : undefined,
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      const raw = await this.client.getPositions() as AlpacaPositionRaw[]

      return raw.map(p => ({
        contract: makeContract(p.symbol),
        side: p.side === 'long' ? 'long' as const : 'short' as const,
        quantity: new Decimal(p.qty),
        avgCost: parseFloat(p.avg_entry_price),
        marketPrice: parseFloat(p.current_price),
        marketValue: Math.abs(parseFloat(p.market_value)),
        unrealizedPnL: parseFloat(p.unrealized_pl),
        realizedPnL: 0,
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
        last: snapshot.LatestTrade.Price,
        bid: snapshot.LatestQuote.BidPrice,
        ask: snapshot.LatestQuote.AskPrice,
        volume: snapshot.DailyBar.Volume,
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
    if (o.limit_price) order.lmtPrice = parseFloat(o.limit_price)
    if (o.stop_price) order.auxPrice = parseFloat(o.stop_price)
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
