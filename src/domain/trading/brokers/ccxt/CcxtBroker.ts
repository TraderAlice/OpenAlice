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
import type { CcxtBrokerConfig, CcxtMarket, FundingRate, OrderBook, OrderBookLevel } from './ccxt-types.js'
import { MAX_INIT_RETRIES, INIT_RETRY_BASE_MS } from './ccxt-types.js'
import {
  ccxtTypeToSecType,
  mapOrderStatus,
  makeOrderState,
  marketToContract,
  contractToCcxt,
} from './ccxt-contracts.js'
import {
  type CcxtExchangeOverrides,
  exchangeOverrides,
  defaultFetchOrderById,
  defaultCancelOrderById,
} from './overrides.js'

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
    apiKey: z.string().optional(),
    apiSecret: z.string().optional(),
    password: z.string().optional(),
  })

  static configFields: BrokerConfigField[] = [
    { name: 'exchange', type: 'select', label: 'Exchange', required: true, options: [
      'binance', 'bybit', 'okx', 'bitget', 'gate', 'kucoin', 'coinbase',
      'kraken', 'htx', 'mexc', 'bingx', 'phemex', 'woo', 'hyperliquid',
    ].map(e => ({ value: e, label: e.charAt(0).toUpperCase() + e.slice(1) })) },
    { name: 'sandbox', type: 'boolean', label: 'Sandbox Mode', default: false },
    { name: 'demoTrading', type: 'boolean', label: 'Demo Trading', default: false },
    { name: 'apiKey', type: 'password', label: 'API Key', required: true, sensitive: true },
    { name: 'apiSecret', type: 'password', label: 'API Secret', required: true, sensitive: true },
    { name: 'password', type: 'password', label: 'Password', placeholder: 'Required by some exchanges (e.g. OKX)', sensitive: true },
  ]

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): CcxtBroker {
    const bc = CcxtBroker.configSchema.parse(config.brokerConfig)
    return new CcxtBroker({
      id: config.id,
      label: config.label,
      exchange: bc.exchange,
      sandbox: bc.sandbox,
      demoTrading: bc.demoTrading,
      options: bc.options,
      apiKey: bc.apiKey ?? '',
      apiSecret: bc.apiSecret ?? '',
      password: bc.password,
    })
  }

  // ---- Instance ----

  readonly id: string
  readonly label: string
  readonly meta: CcxtBrokerMeta

  private exchange: Exchange
  private exchangeName: string
  private initialized = false
  private overrides: CcxtExchangeOverrides
  // orderId → ccxtSymbol cache (CCXT needs symbol to cancel)
  private orderSymbolCache = new Map<string, string>()

  constructor(config: CcxtBrokerConfig) {
    this.exchangeName = config.exchange
    this.meta = { exchange: config.exchange }
    this.overrides = exchangeOverrides[config.exchange] ?? {}
    this.id = config.id ?? `${config.exchange}-main`
    this.label = config.label ?? `${config.exchange.charAt(0).toUpperCase() + config.exchange.slice(1)} ${config.sandbox ? 'Testnet' : 'Live'}`

    const exchanges = ccxt as unknown as Record<string, new (opts: Record<string, unknown>) => Exchange>
    const ExchangeClass = exchanges[config.exchange]
    if (!ExchangeClass) {
      throw new BrokerError('CONFIG', `Unknown CCXT exchange: ${config.exchange}`)
    }

    // Default: skip option markets to reduce concurrent requests during loadMarkets
    const defaultOptions: Record<string, unknown> = {
      fetchMarkets: { types: ['spot', 'linear', 'inverse'] },
    }
    const mergedOptions = { ...defaultOptions, ...config.options }

    this.exchange = new ExchangeClass({
      apiKey: config.apiKey,
      secret: config.apiSecret,
      password: config.password,
      options: mergedOptions,
    })

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
    if (!this.exchange.apiKey || !this.exchange.secret) {
      throw new BrokerError(
        'CONFIG',
        `No API credentials configured. Set apiKey and apiSecret in accounts.json to enable this account.`,
      )
    }

    const origFetchMarkets = this.exchange.fetchMarkets.bind(this.exchange)
    const accountId = this.id

    this.exchange.fetchMarkets = async (params?: Record<string, unknown>) => {
      const ex = this.exchange as unknown as Record<string, unknown>
      const opts = (ex['options'] ?? {}) as Record<string, unknown>
      const fmOpts = (opts['fetchMarkets'] ?? {}) as Record<string, unknown>
      const types = (fmOpts['types'] ?? ['spot', 'linear', 'inverse']) as string[]

      const allMarkets: unknown[] = []
      for (const type of types) {
        for (let attempt = 1; attempt <= MAX_INIT_RETRIES; attempt++) {
          try {
            const prevTypes = fmOpts['types']
            fmOpts['types'] = [type]
            const markets = await origFetchMarkets(params)
            fmOpts['types'] = prevTypes
            allMarkets.push(...markets)
            break
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (attempt < MAX_INIT_RETRIES) {
              const delay = INIT_RETRY_BASE_MS * Math.pow(2, attempt - 1)
              console.warn(`CcxtBroker[${accountId}]: fetchMarkets(${type}) attempt ${attempt}/${MAX_INIT_RETRIES} failed, retrying in ${delay}ms...`)
              await new Promise(r => setTimeout(r, delay))
            } else {
              console.warn(`CcxtBroker[${accountId}]: fetchMarkets(${type}) failed after ${MAX_INIT_RETRIES} attempts: ${msg} — skipping`)
            }
          }
        }
      }
      return allMarkets as Awaited<ReturnType<Exchange['fetchMarkets']>>
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

  // ---- Contract search ----

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    this.ensureInit()
    if (!pattern) return []

    const searchBase = pattern.toUpperCase()
    const matchedMarkets: CcxtMarket[] = []

    for (const market of Object.values(this.markets)) {
      if (market.active === false) continue
      if (market.base.toUpperCase() !== searchBase) continue

      const quote = market.quote.toUpperCase()
      if (quote !== 'USDT' && quote !== 'USD' && quote !== 'USDC') continue

      matchedMarkets.push(market)
    }

    // Sort: derivatives first (more common for trading), then stablecoin preference
    const typeOrder: Record<string, number> = { swap: 0, future: 1, spot: 2, option: 3 }
    const quoteOrder: Record<string, number> = { USDT: 0, USD: 1, USDC: 2 }

    matchedMarkets.sort((a, b) => {
      const aType = typeOrder[a.type as keyof typeof typeOrder] ?? 99
      const bType = typeOrder[b.type as keyof typeof typeOrder] ?? 99
      if (aType !== bType) return aType - bType
      const aQuote = quoteOrder[a.quote.toUpperCase()] ?? 99
      const bQuote = quoteOrder[b.quote.toUpperCase()] ?? 99
      return aQuote - bQuote
    })

    // Collect derivative types available for this base asset
    const derivativeTypes = new Set<string>()
    for (const m of matchedMarkets) {
      if (m.type === 'future') derivativeTypes.add('FUT')
      if (m.type === 'option') derivativeTypes.add('OPT')
    }
    const derivativeSecTypes: string[] | undefined = derivativeTypes.size > 0
      ? Array.from(derivativeTypes)
      : undefined

    return matchedMarkets.map(market => {
      const desc = new ContractDescription()
      desc.contract = marketToContract(market, this.exchangeName)
      desc.derivativeSecTypes = derivativeSecTypes ?? []
      return desc
    })
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

    // Use toString() to preserve Decimal precision — never go through IEEE 754 float
    let size: string | undefined = !order.totalQuantity.equals(UNSET_DECIMAL)
      ? order.totalQuantity.toString()
      : undefined

    // cashQty (notional) → size conversion
    if (!size && order.cashQty !== UNSET_DOUBLE && order.cashQty > 0) {
      const ticker = await this.exchange.fetchTicker(ccxtSymbol)
      const price = order.lmtPrice !== UNSET_DOUBLE ? order.lmtPrice : ticker.last
      if (!price) {
        return { success: false, error: 'Cannot determine price for notional conversion' }
      }
      size = String(order.cashQty / price)
    }

    if (!size) {
      return { success: false, error: 'Either totalQuantity or cashQty must be provided' }
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

      const ccxtOrderType = ibkrOrderTypeToCcxt(order.orderType)
      const side = order.action.toLowerCase() as 'buy' | 'sell'

      const ccxtOrder = await this.exchange.createOrder(
        ccxtSymbol,
        ccxtOrderType,
        side,
        parseFloat(size),
        ccxtOrderType === 'limit' && order.lmtPrice !== UNSET_DOUBLE ? order.lmtPrice : undefined,
        params,
      )

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
      const cancel = this.overrides.cancelOrderById ?? defaultCancelOrderById
      await cancel(this.exchange, orderId, ccxtSymbol)
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
      const fetch = this.overrides.fetchOrderById ?? defaultFetchOrderById
      const original = await fetch(this.exchange, orderId, ccxtSymbol)
      const qty = changes.totalQuantity != null && !changes.totalQuantity.equals(UNSET_DECIMAL) ? parseFloat(changes.totalQuantity.toString()) : original.amount
      const price = changes.lmtPrice != null && changes.lmtPrice !== UNSET_DOUBLE ? changes.lmtPrice : original.price

      // Extra params for fields that don't fit editOrder's positional arguments
      const params: Record<string, unknown> = {}
      if (changes.auxPrice != null && changes.auxPrice !== UNSET_DOUBLE) params.stopPrice = changes.auxPrice
      if (changes.trailStopPrice != null && changes.trailStopPrice !== UNSET_DOUBLE) params.trailStopPrice = changes.trailStopPrice
      if (changes.trailingPercent != null && changes.trailingPercent !== UNSET_DOUBLE) params.trailingPercent = changes.trailingPercent
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
    const ccxtSymbol = contractToCcxt(contract, this.exchange.markets as Record<string, CcxtMarket>, this.exchangeName)
    const symbol = contract.symbol?.toUpperCase()

    const pos = positions.find(p =>
      (ccxtSymbol && p.contract.localSymbol === ccxtSymbol) ||
      (symbol && p.contract.symbol === symbol),
    )

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

  async getAccount(): Promise<AccountInfo> {
    this.ensureInit()

    try {
      const [balance, rawPositions] = await Promise.all([
        this.exchange.fetchBalance(),
        this.exchange.fetchPositions(),
      ])

      const bal = balance as unknown as Record<string, Record<string, unknown>>
      const free = parseFloat(String(bal['free']?.['USDT'] ?? bal['free']?.['USD'] ?? 0))
      const used = parseFloat(String(bal['used']?.['USDT'] ?? bal['used']?.['USD'] ?? 0))

      // Aggregate P&L and market value from positions.
      // We use position-level markPrice (which is fresh from the exchange's
      // websocket feed) rather than balance.total (which is a cached wallet
      // snapshot that may not update between funding/settlement cycles).
      let unrealizedPnL = 0
      let realizedPnL = 0
      let totalPositionValue = 0
      for (const p of rawPositions) {
        unrealizedPnL += parseFloat(String(p.unrealizedPnl ?? 0))
        realizedPnL += parseFloat(String((p as unknown as Record<string, unknown>).realizedPnl ?? 0))

        // Compute position market value from fresh markPrice
        const contracts = new Decimal(String(p.contracts ?? 0)).abs()
        const contractSize = new Decimal(String(p.contractSize ?? 1))
        const quantity = contracts.mul(contractSize)
        const markPrice = parseFloat(String(p.markPrice ?? 0))
        totalPositionValue += quantity.toNumber() * markPrice
      }

      // Reconstruct netLiquidation from fresh components:
      //   netLiq = available cash + total position market value
      // This gives a real-time equity figure that tracks markPrice movements,
      // unlike balance.total which only updates on exchange settlement.
      const netLiquidation = free + totalPositionValue

      return {
        netLiquidation,
        totalCashValue: free,
        unrealizedPnL,
        realizedPnL,
        initMarginReq: used,
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getPositions(): Promise<Position[]> {
    this.ensureInit()

    try {
      const raw = await this.exchange.fetchPositions()
      const result: Position[] = []

      for (const p of raw) {
        const market = this.markets[p.symbol]
        if (!market) continue

        // Use Decimal arithmetic to avoid IEEE 754 precision loss (e.g. 0.51 → 0.50999...)
        const contracts = new Decimal(String(p.contracts ?? 0)).abs()
        const contractSize = new Decimal(String(p.contractSize ?? 1))
        const quantity = contracts.mul(contractSize)
        if (quantity.isZero()) continue

        const markPrice = parseFloat(String(p.markPrice ?? 0))
        const entryPrice = parseFloat(String(p.entryPrice ?? 0))
        const marketValue = quantity.toNumber() * markPrice
        const unrealizedPnL = parseFloat(String(p.unrealizedPnl ?? 0))

        result.push({
          contract: marketToContract(market, this.exchangeName),
          side: p.side === 'long' ? 'long' : 'short',
          quantity,
          avgCost: entryPrice,
          marketPrice: markPrice,
          marketValue,
          unrealizedPnL,
          realizedPnL: parseFloat(String((p as unknown as Record<string, unknown>).realizedPnl ?? 0)),
        })
      }

      return result
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    this.ensureInit()


    const results: OpenOrder[] = []
    for (const id of orderIds) {
      const order = await this.getOrder(id)
      if (order) results.push(order)
    }
    return results
  }

  async getOrder(orderId: string): Promise<OpenOrder | null> {
    this.ensureInit()

    const ccxtSymbol = this.orderSymbolCache.get(orderId)
    if (!ccxtSymbol) return null

    const fetch = this.overrides.fetchOrderById ?? defaultFetchOrderById
    try {
      const order = await fetch(this.exchange, orderId, ccxtSymbol)
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
    if (o.price != null) order.lmtPrice = o.price
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
      ...(tpsl && { tpsl }),
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
        last: ticker.last ?? 0,
        bid: ticker.bid ?? 0,
        ask: ticker.ask ?? 0,
        volume: ticker.baseVolume ?? 0,
        high: ticker.high ?? undefined,
        low: ticker.low ?? undefined,
        timestamp: new Date(ticker.timestamp ?? Date.now()),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  // ---- Capabilities ----

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['CRYPTO'],
      supportedOrderTypes: ['MKT', 'LMT'],
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
    const market = this.markets[nativeKey]
    if (market) return marketToContract(market, this.exchange.id)
    // Fallback: construct minimal contract from symbol string
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
