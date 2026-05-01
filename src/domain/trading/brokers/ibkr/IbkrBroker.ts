/**
 * IbkrBroker — IBroker adapter for Interactive Brokers TWS/Gateway.
 *
 * Bridges the callback-based @traderalice/ibkr SDK to the Promise-based
 * IBroker interface via RequestBridge.
 *
 * Key differences from Alpaca/CCXT brokers:
 * - Single TCP socket with reqId multiplexing (not REST)
 * - No API key — auth handled by TWS/Gateway GUI login
 * - IBKR Contract/Order types ARE our native types — zero translation
 * - Order IDs are numeric, assigned by TWS (nextValidId)
 */

import { z } from 'zod'
import Decimal from 'decimal.js'
import {
  EClient,
  Contract,
  Order,
  OrderCancel,
  OrderState,
  type ContractDescription,
  type ContractDetails,
} from '@traderalice/ibkr'
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
import { RequestBridge } from './request-bridge.js'
import { resolveSymbol } from './ibkr-contracts.js'
import type { IbkrBrokerConfig } from './ibkr-types.js'

export class IbkrBroker implements IBroker {
  // ---- Self-registration ----

  static configSchema = z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().default(7497),
    clientId: z.number().int().default(0),
    accountId: z.string().optional(),
    paper: z.boolean().default(true),
  })

  static configFields: BrokerConfigField[] = [
    { name: 'host', type: 'text', label: 'Host', default: '127.0.0.1', placeholder: '127.0.0.1' },
    { name: 'port', type: 'number', label: 'Port', default: 7497 },
    { name: 'clientId', type: 'number', label: 'Client ID', default: 0 },
    { name: 'accountId', type: 'text', label: 'Account ID', placeholder: 'Auto-detected from TWS' },
    { name: 'paper', type: 'boolean', label: 'Paper Trading', default: true, description: 'Authentication is handled by TWS/Gateway login — no API keys needed.' },
  ]

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): IbkrBroker {
    const bc = IbkrBroker.configSchema.parse(config.brokerConfig)
    return new IbkrBroker({
      id: config.id,
      label: config.label,
      host: bc.host,
      port: bc.port,
      clientId: bc.clientId,
      accountId: bc.accountId,
    })
  }

  // ---- Instance ----

  readonly id: string
  readonly label: string

  private bridge: RequestBridge
  private client: EClient
  private readonly config: IbkrBrokerConfig
  private accountId: string | null = null

  constructor(config: IbkrBrokerConfig) {
    this.config = config
    this.id = config.id ?? 'ibkr'
    this.label = config.label ?? 'Interactive Brokers'
    this.bridge = new RequestBridge()
    this.client = new EClient(this.bridge)
  }

  // ==================== Lifecycle ====================

  async init(): Promise<void> {
    // Idempotent — skip if already connected (e.g. UTA re-wrapping a shared broker)
    if (this.client.isConnected()) return

    const host = this.config.host ?? '127.0.0.1'
    const port = this.config.port ?? 7497
    const clientId = this.config.clientId ?? 0

    try {
      await this.bridge.waitForConnect(this.client, host, port, clientId)
    } catch (err) {
      throw BrokerError.from(err, 'NETWORK')
    }

    // Resolve account ID
    this.accountId = this.config.accountId ?? this.bridge.getAccountId()
    if (!this.accountId) {
      throw new BrokerError('CONFIG', 'No account detected from TWS/Gateway. Set accountId in config for multi-account setups.')
    }

    // Start persistent account subscription and wait for first download
    try {
      this.bridge.startAccountSubscription(this.accountId)
      await this.bridge.waitForAccountReady()
      console.log(`IbkrBroker[${this.id}]: connected (account=${this.accountId}, host=${host}:${port}, clientId=${clientId})`)
    } catch (err) {
      throw BrokerError.from(err, 'NETWORK')
    }
  }

  async close(): Promise<void> {
    this.bridge.stopAccountSubscription()
    this.client.disconnect()
  }

  // ==================== Contract search ====================

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    if (!pattern) return []
    const reqId = this.bridge.allocReqId()
    const promise = this.bridge.request<ContractDescription[]>(reqId)
    this.client.reqMatchingSymbols(reqId, pattern)
    return promise
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    if (!query.exchange) query.exchange = 'SMART'
    if (!query.currency) query.currency = 'USD'

    const reqId = this.bridge.allocReqId()
    const promise = this.bridge.requestCollector<ContractDetails>(reqId)
    this.client.reqContractDetails(reqId, query)
    const results = await promise
    return results[0] ?? null
  }

  // ==================== Trading operations ====================

  async placeOrder(contract: Contract, order: Order, _tpsl?: TpSlParams): Promise<PlaceOrderResult> {
    // TWS requires exchange and currency on the contract. Upstream layers
    // (staging, AI tools) typically only populate symbol + secType.
    // Default to SMART routing. Currency defaults to USD — non-USD markets
    // (LSE/GBP, TSE/JPY) and forex (CASH secType) will need the caller
    // to specify currency explicitly.
    if (!contract.exchange) contract.exchange = 'SMART'
    if (!contract.currency) contract.currency = 'USD'

    try {
      const orderId = this.bridge.getNextOrderId()
      const promise = this.bridge.requestOrder(orderId)
      this.client.placeOrder(orderId, contract, order)
      const result = await promise
      return {
        success: true,
        orderId: String(orderId),
        orderState: result.orderState,
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult> {
    try {
      // IBKR modifies orders by re-calling placeOrder with the same orderId
      const original = await this.getOrder(orderId)
      if (!original) {
        return { success: false, error: `Order ${orderId} not found` }
      }

      // Merge changes into the original order
      const mergedOrder = original.order
      if (changes.totalQuantity != null) mergedOrder.totalQuantity = changes.totalQuantity
      if (changes.lmtPrice != null) mergedOrder.lmtPrice = changes.lmtPrice
      if (changes.auxPrice != null) mergedOrder.auxPrice = changes.auxPrice
      if (changes.tif) mergedOrder.tif = changes.tif
      if (changes.orderType) mergedOrder.orderType = changes.orderType
      if (changes.trailingPercent != null) mergedOrder.trailingPercent = changes.trailingPercent
      if (changes.trailStopPrice != null) mergedOrder.trailStopPrice = changes.trailStopPrice

      const numericId = parseInt(orderId, 10)
      const promise = this.bridge.requestOrder(numericId)
      this.client.placeOrder(numericId, original.contract, mergedOrder)
      const result = await promise

      return {
        success: true,
        orderId,
        orderState: result.orderState,
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async cancelOrder(orderId: string, orderCancel?: OrderCancel): Promise<PlaceOrderResult> {
    try {
      const numericId = parseInt(orderId, 10)
      const promise = this.bridge.requestOrder(numericId)
      this.client.cancelOrder(numericId, orderCancel ?? new OrderCancel())
      await promise

      const os = new OrderState()
      os.status = 'Cancelled'
      return { success: true, orderId, orderState: os }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult> {
    const symbol = resolveSymbol(contract)

    // Find current position to determine side
    const positions = await this.getPositions()
    const pos = positions.find(p =>
      (contract.conId && p.contract.conId === contract.conId) ||
      (symbol && resolveSymbol(p.contract) === symbol),
    )
    if (!pos) {
      return { success: false, error: `No position for ${symbol ?? `conId=${contract.conId}`}` }
    }

    // Use the position's contract (has conId etc.) but route via SMART
    const closeContract = pos.contract
    closeContract.exchange = 'SMART'
    const order = new Order()
    order.action = pos.side === 'long' ? 'SELL' : 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = quantity ?? pos.quantity
    order.tif = 'DAY'

    return this.placeOrder(closeContract, order)
  }

  // ==================== Queries ====================

  /**
   * Get account summary.
   *
   * Data source: reqAccountUpdates → accountDownloadEnd callback.
   *
   * netLiquidation is reconstructed from cash + Σ(position.marketValue)
   * because TWS's account-level NetLiquidation tag is cached server-side
   * and refreshes less frequently than position-level data.
   *
   * Note: position marketPrice comes from updatePortfolio() callbacks,
   * which TWS stops pushing after ~20:00 ET (see README.md "TWS Market
   * Data Channels"). During overnight hours, the reconstructed netLiq
   * will be stale even though Blue Ocean ATS prices may be moving.
   */
  async getAccount(): Promise<AccountInfo> {
    const download = this.bridge.getAccountCache()
    if (!download) throw new BrokerError('NETWORK', 'Account data not yet available')

    const totalCashValue = new Decimal(download.values.get('TotalCashValue') ?? '0')
    let totalMarketValue = new Decimal(0)
    let positionUnrealizedPnL = new Decimal(0)
    for (const pos of download.positions) {
      totalMarketValue = totalMarketValue.plus(pos.marketValue)
      positionUnrealizedPnL = positionUnrealizedPnL.plus(pos.unrealizedPnL)
    }

    const netLiquidation = download.positions.length > 0
      ? totalCashValue.plus(totalMarketValue)
      : new Decimal(download.values.get('NetLiquidation') ?? '0')

    const unrealizedPnL = download.positions.length > 0
      ? positionUnrealizedPnL
      : new Decimal(download.values.get('UnrealizedPnL') ?? '0')

    return {
      baseCurrency: download.values.get('BaseCurrency') ?? 'USD',
      netLiquidation: netLiquidation.toString(),
      totalCashValue: totalCashValue.toString(),
      unrealizedPnL: unrealizedPnL.toString(),
      realizedPnL: new Decimal(download.values.get('RealizedPnL') ?? '0').toString(),
      buyingPower: new Decimal(download.values.get('BuyingPower') ?? '0').toString(),
      initMarginReq: new Decimal(download.values.get('InitMarginReq') ?? '0').toString(),
      maintMarginReq: new Decimal(download.values.get('MaintMarginReq') ?? '0').toString(),
      dayTradesRemaining: parseInt(download.values.get('DayTradesRemaining') ?? '0', 10),
    }
  }

  /**
   * Get current positions with market prices.
   *
   * Data source: reqAccountUpdates → updatePortfolio() callbacks.
   * Each position's marketPrice/marketValue comes from TWS's internal
   * portfolio valuation, NOT from a real-time market data subscription.
   *
   * TWS controls the push frequency. During regular hours (09:30-16:00 ET)
   * updates come every few seconds. After ~20:00 ET, updatePortfolio()
   * stops pushing entirely — prices freeze even though overnight trading
   * (Blue Ocean ATS) may be active. See README.md for details.
   *
   * To get fresher prices, use getQuote() which calls reqMktData in
   * snapshot mode and can see overnight session data.
   */
  async getPositions(): Promise<Position[]> {
    const download = this.bridge.getAccountCache()
    if (!download) throw new BrokerError('NETWORK', 'Account data not yet available')
    return download.positions
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    const allOrders = await this.bridge.requestOpenOrders()
    return allOrders
      .filter(o => orderIds.includes(String(o.order.orderId)))
      .map(o => this.enrichWithFillData(o))
  }

  async getOrder(orderId: string): Promise<OpenOrder | null> {
    // Try open orders first
    const results = await this.getOrders([orderId])
    if (results[0]) return results[0]

    // Fallback to completed orders (filled/cancelled orders leave the open list)
    const completed = await this.bridge.requestCompletedOrders()
    const match = completed.find(o => String(o.order.orderId) === orderId)
    return match ? this.enrichWithFillData(match) : null
  }

  /** Attach avgFillPrice from cached orderStatus data if available. */
  private enrichWithFillData(o: import('./ibkr-types.js').CollectedOpenOrder): OpenOrder {
    const fillData = this.bridge.getFillData(o.order.orderId)
    const rawAvg = fillData?.avgFillPrice ?? o.avgFillPrice
    return {
      contract: o.contract,
      order: o.order,
      orderState: o.orderState,
      avgFillPrice: rawAvg != null ? String(rawAvg) : undefined,
    }
  }

  /**
   * Get a one-time market data snapshot for a contract.
   *
   * Data source: reqMktData with snapshot=true → tickPrice/tickSize/
   * tickSnapshotEnd callbacks. Unlike updatePortfolio(), this channel
   * CAN return overnight session prices (Blue Ocean ATS) and is not
   * limited to positions in the account.
   *
   * Each call briefly occupies one TWS market data line (limit ~100),
   * auto-released after tickSnapshotEnd.
   */
  async getQuote(contract: Contract): Promise<Quote> {
    if (!contract.exchange) contract.exchange = 'SMART'
    if (!contract.currency) contract.currency = 'USD'

    const reqId = this.bridge.allocReqId()
    const promise = this.bridge.requestSnapshot(reqId)
    this.client.reqMktData(reqId, contract, '', true, false, [])
    const snap = await promise

    return {
      contract,
      last: String(snap.last ?? 0),
      bid: String(snap.bid ?? 0),
      ask: String(snap.ask ?? 0),
      volume: String(snap.volume ?? 0),
      high: snap.high != null ? String(snap.high) : undefined,
      low: snap.low != null ? String(snap.low) : undefined,
      timestamp: snap.lastTimestamp ? new Date(snap.lastTimestamp * 1000) : new Date(),
    }
  }

  async getMarketClock(): Promise<MarketClock> {
    // TODO: per-contract trading hours via ContractDetails.tradingHours
    // For now, use local time with NYSE schedule as a baseline.
    let now: Date
    try {
      const serverTime = await this.bridge.requestCurrentTime(3000)
      now = new Date(serverTime * 1000)
    } catch {
      now = new Date()
    }

    // NYSE hours: Mon-Fri 9:30-16:00 ET
    const etParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(now)

    const weekday = etParts.find(p => p.type === 'weekday')?.value
    const hour = parseInt(etParts.find(p => p.type === 'hour')?.value ?? '0', 10)
    const minute = parseInt(etParts.find(p => p.type === 'minute')?.value ?? '0', 10)

    const isWeekday = !['Sat', 'Sun'].includes(weekday ?? '')
    const timeMinutes = hour * 60 + minute
    const isOpen = isWeekday && timeMinutes >= 570 && timeMinutes < 960 // 9:30-16:00

    return { isOpen, timestamp: now }
  }

  // ==================== Capabilities ====================

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['STK', 'OPT', 'FUT', 'FOP', 'CASH', 'WAR', 'BOND'],
      supportedOrderTypes: ['MKT', 'LMT', 'STP', 'STP LMT', 'TRAIL', 'MOC', 'LOC', 'REL'],
    }
  }

  // ==================== Contract identity ====================

  getNativeKey(contract: Contract): string {
    // conId is IBKR's globally unique contract identifier
    if (contract.conId) return String(contract.conId)
    return contract.symbol
  }

  resolveNativeKey(nativeKey: string): Contract {
    const c = new Contract()
    const asNum = parseInt(nativeKey, 10)
    if (!isNaN(asNum) && String(asNum) === nativeKey) {
      // Numeric nativeKey = conId — TWS resolves everything else from this
      c.conId = asNum
    } else {
      // String nativeKey = symbol — fill in routing defaults.
      // Assumes STK; other secTypes should use conId for unambiguous resolution.
      c.symbol = nativeKey
      c.secType = 'STK'
      c.exchange = 'SMART'
      c.currency = 'USD'
    }
    return c
  }

}
