/** Read-only UTA adapter for a single SnapTrade securities account. */
import { z } from 'zod'
import Decimal from 'decimal.js'
import { Contract, ContractDescription, ContractDetails, Order, OrderState } from '@traderalice/ibkr'
import {
  BrokerError,
  type AccountCapabilities,
  type AccountInfo,
  type BrokerConfigField,
  type IBroker,
  type MarketClock,
  type OpenOrder,
  type PlaceOrderResult,
  type Position,
  type Quote,
  type TpSlParams,
} from '../types.js'
import { buildContract } from '../contract-builder.js'
import { SnapTradeClient, type SnapTradePersonalCredentials } from './snaptrade-client.js'
import {
  assessSnapTradeConnection,
  mapSnapTradeEquityPosition,
  type SnapTradeOrder,
  type SnapTradeRawPosition,
} from './snaptrade-read-model.js'

export interface SnapTradeBrokerConfig extends SnapTradePersonalCredentials {
  id?: string
  label?: string
  /** SnapTrade authorization id: used to prove this connection is read + realtime. */
  authorizationId: string
  /** Immutable SnapTrade account id selected from that authorization. */
  accountId: string
  baseCurrency?: string
}

const OPEN_STATUSES = new Set(['PENDING', 'QUEUED', 'ACCEPTED', 'PARTIAL', 'TRIGGERED', 'ACTIVATED', 'CANCEL_PENDING', 'REPLACE_PENDING'])

export class SnapTradeBroker implements IBroker {
  static configSchema = z.object({
    clientId: z.string().min(1),
    consumerKey: z.string().min(1),
    authorizationId: z.string().min(1),
    accountId: z.string().min(1),
    baseCurrency: z.string().length(3).default('USD'),
  })

  static configFields: BrokerConfigField[] = [
    { name: 'clientId', type: 'password', label: 'SnapTrade Client ID', required: true, sensitive: true },
    { name: 'consumerKey', type: 'password', label: 'SnapTrade Consumer Key', required: true, sensitive: true },
    { name: 'authorizationId', type: 'text', label: 'Connection ID', required: true, description: 'The read-only, realtime SnapTrade connection ID.' },
    { name: 'accountId', type: 'text', label: 'Account ID', required: true, description: 'One securities account under that connection.' },
    { name: 'baseCurrency', type: 'text', label: 'Base Currency', default: 'USD' },
  ]

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): SnapTradeBroker {
    const parsed = SnapTradeBroker.configSchema.parse(config.brokerConfig)
    return new SnapTradeBroker({ ...parsed, id: config.id, label: config.label })
  }

  readonly brokerEngine = 'snaptrade'
  readonly id: string
  readonly label: string
  private readonly client: SnapTradeClient
  private readonly config: Required<Pick<SnapTradeBrokerConfig, 'authorizationId' | 'accountId' | 'baseCurrency'>>

  constructor(config: SnapTradeBrokerConfig, client?: SnapTradeClient) {
    this.id = config.id ?? `snaptrade-${config.accountId}`
    this.label = config.label ?? 'SnapTrade Securities (read-only)'
    this.config = { authorizationId: config.authorizationId, accountId: config.accountId, baseCurrency: (config.baseCurrency ?? 'USD').toUpperCase() }
    this.client = client ?? new SnapTradeClient({ clientId: config.clientId, consumerKey: config.consumerKey })
  }

  async init(): Promise<void> {
    await this.assertRealtimeReadConnection()
  }

  /** Re-check at every top-level read: a connection can be disabled or downgraded after init. */
  private async assertRealtimeReadConnection(): Promise<void> {
    try {
      const connection = (await this.client.listConnections()).find((item) => item.id === this.config.authorizationId)
      if (!connection) throw new BrokerError('AUTH', `SnapTrade connection ${this.config.authorizationId} was not found`)
      const readiness = assessSnapTradeConnection(connection)
      if (!readiness.eligible) {
        throw new BrokerError('AUTH', `SnapTrade connection is not eligible for unattended monitoring: ${readiness.reason}`)
      }
    } catch (err) {
      throw BrokerError.from(err, 'AUTH')
    }
  }

  async close(): Promise<void> {}

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    if (!pattern) return []
    await this.assertRealtimeReadConnection()
    const needle = pattern.toUpperCase()
    const positions = await this.client.getAllAccountPositions(this.config.accountId)
    return positions.results
      .filter((p) => p.instrument.symbol.toUpperCase().includes(needle) || (p.instrument.description ?? '').toUpperCase().includes(needle))
      .map((p) => this.contractFromPosition(p))
      .map((contract) => { const d = new ContractDescription(); d.contract = contract; return d })
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    const symbol = query.localSymbol || query.symbol
    if (!symbol) return null
    await this.assertRealtimeReadConnection()
    const found = (await this.client.getAllAccountPositions(this.config.accountId)).results
      .find((p) => p.instrument.symbol === symbol || p.instrument.raw_symbol === symbol)
    if (!found) return null
    const details = new ContractDetails()
    details.contract = this.contractFromPosition(found)
    details.validExchanges = found.instrument.exchange ?? 'SMART'
    details.stockType = 'COMMON'
    return details
  }

  private refuseWrite(): never {
    throw new BrokerError('CONFIG', 'SnapTrade adapter is permanently read-only: order placement, modification, cancellation, and position closing are disabled')
  }
  async placeOrder(_contract: Contract, _order: Order, _tpsl?: TpSlParams): Promise<PlaceOrderResult> { return this.refuseWrite() }
  async modifyOrder(_orderId: string, _changes: Partial<Order>): Promise<PlaceOrderResult> { return this.refuseWrite() }
  async cancelOrder(_orderId: string): Promise<PlaceOrderResult> { return this.refuseWrite() }
  async closePosition(_contract: Contract, _quantity?: Decimal): Promise<PlaceOrderResult> { return this.refuseWrite() }

  async getAccount(): Promise<AccountInfo> {
    try {
      await this.assertRealtimeReadConnection()
      const [balances, positions] = await Promise.all([this.client.getAccountBalances(this.config.accountId), this.getPositionsUnsafe()])
      const balance = balances.find((b) => b.currency.code.toUpperCase() === this.config.baseCurrency)
      if (!balance) throw new BrokerError('EXCHANGE', `SnapTrade did not return a ${this.config.baseCurrency} cash balance`)
      const cash = new Decimal(balance.cash ?? 0)
      const marketValue = positions.reduce((total, p) => total.plus(p.marketValue), cash)
      const unrealizedPnL = positions.reduce((total, p) => total.plus(p.unrealizedPnL), new Decimal(0))
      return { baseCurrency: this.config.baseCurrency, netLiquidation: marketValue.toString(), totalCashValue: cash.toString(), unrealizedPnL: unrealizedPnL.toString(), buyingPower: String(balance.buying_power ?? balance.cash ?? 0) }
    } catch (err) { throw BrokerError.from(err) }
  }

  async getPositions(): Promise<Position[]> {
    try { await this.assertRealtimeReadConnection(); return await this.getPositionsUnsafe() }
    catch (err) { throw BrokerError.from(err) }
  }
  private async getPositionsUnsafe(): Promise<Position[]> { return (await this.client.getAllAccountPositions(this.config.accountId)).results.map(mapSnapTradeEquityPosition) }

  private mapOrder(raw: SnapTradeOrder): OpenOrder {
    const symbol = raw.universal_symbol?.raw_symbol ?? raw.universal_symbol?.symbol
    if (!symbol) throw new BrokerError('EXCHANGE', `SnapTrade order ${raw.brokerage_order_id} has no symbol`)
    const contract = buildContract({ symbol, localSymbol: raw.universal_symbol?.symbol ?? symbol, secType: 'STK', exchange: 'SMART', currency: this.config.baseCurrency })
    const order = new Order()
    order.orderType = raw.order_type?.toUpperCase() === 'MARKET' ? 'MKT' : raw.order_type?.toUpperCase() === 'LIMIT' ? 'LMT' : raw.order_type ?? ''
    order.totalQuantity = new Decimal(raw.total_quantity ?? raw.open_quantity ?? 0)
    order.orderId = Number(raw.brokerage_order_id) || 0
    const orderState = new OrderState(); orderState.status = raw.status
    return { contract, order, orderState, orderId: raw.brokerage_order_id }
  }
  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    await this.assertRealtimeReadConnection()
    const wanted = new Set(orderIds)
    return (await this.client.getAccountOrders(this.config.accountId, 90)).filter((o) => wanted.has(o.brokerage_order_id)).map((o) => this.mapOrder(o))
  }
  async getOrder(orderId: string): Promise<OpenOrder | null> {
    await this.assertRealtimeReadConnection()
    const found = (await this.client.getAccountOrders(this.config.accountId, 90)).find((o) => o.brokerage_order_id === orderId)
    return found ? this.mapOrder(found) : null
  }
  async getOpenOrders(): Promise<OpenOrder[]> { await this.assertRealtimeReadConnection(); return (await this.client.getAccountOrders(this.config.accountId, 90)).filter((o) => OPEN_STATUSES.has(o.status.toUpperCase())).map((o) => this.mapOrder(o)) }

  async getQuote(contract: Contract): Promise<Quote> {
    await this.assertRealtimeReadConnection()
    const symbol = contract.localSymbol || contract.symbol
    const snapshot = await this.client.getAllAccountPositions(this.config.accountId)
    const found = snapshot.results.find((p) => p.instrument.symbol === symbol || p.instrument.raw_symbol === symbol)
    if (!found?.price) throw new BrokerError('EXCHANGE', `SnapTrade has no held-position price for ${symbol}; this read-only adapter does not provide standalone quotes`)
    return { contract: this.contractFromPosition(found), last: found.price, bid: found.price, ask: found.price, volume: '0', timestamp: snapshot.data_freshness?.as_of ? new Date(snapshot.data_freshness.as_of) : new Date() }
  }

  async getMarketClock(): Promise<MarketClock> { throw new BrokerError('CONFIG', 'SnapTrade read-only adapter does not expose an exchange clock') }
  getCapabilities(): AccountCapabilities { return { supportedSecTypes: ['STK'], supportedOrderTypes: [] } }
  getNativeKey(contract: Contract): string { return contract.localSymbol || contract.symbol }
  resolveNativeKey(nativeKey: string): Contract { return buildContract({ symbol: nativeKey, localSymbol: nativeKey, secType: 'STK', exchange: 'SMART', currency: this.config.baseCurrency }) }

  private contractFromPosition(raw: SnapTradeRawPosition): Contract {
    // Re-use the strict position mapper so unsupported derivatives never become fake stocks.
    return mapSnapTradeEquityPosition(raw).contract
  }
}
