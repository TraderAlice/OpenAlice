/**
 * CtraderBroker — IBroker adapter for the cTrader Open API.
 *
 * Venue-neutral: works with any broker that offers cTrader, demo or live.
 * Every instrument comes from the account's own symbol catalog; nothing is
 * hard-coded per broker or per symbol.
 *
 * Identity and units:
 *   - nativeKey = the broker's symbol name (e.g. "EURUSD"); conId = symbolId
 *   - secType = CFD for every instrument (cTrader instruments are OTC
 *     contracts); the real asset class comes from the broker's categories
 *     via `assetClassFor`
 *   - quantities are base units, never lots (lot size varies per symbol)
 *   - position prices/values are in the symbol's quote currency; account
 *     totals are in the deposit currency
 */

import { z } from 'zod'
import Decimal from 'decimal.js'
import { Contract, ContractDescription, ContractDetails, Order, OrderState } from '@traderalice/ibkr'
import {
  BrokerError,
  type AccountCapabilities,
  type AccountInfo,
  type Bar,
  type BarParams,
  type BrokerConnectionStateEvent,
  type IBroker,
  type MarketClock,
  type OpenOrder,
  type PlaceOrderResult,
  type Position,
  type Quote,
} from '../types.js'
import '../../contract-ext.js'
import { buildContract, buildPosition } from '../contract-builder.js'
import { fuzzyRankContracts } from '../fuzzy-rank.js'
import { PayloadType } from './ctrader-protocol.js'
import { CtraderApiError, type CtraderTransportOptions } from './ctrader-transport.js'
import { CtraderSession, toBrokerError, type CtraderTokenRefresh } from './ctrader-session.js'
import { CtraderCatalog, type CatalogSymbol, type SymbolSpec } from './ctrader-catalog.js'
import { CtraderSpots } from './ctrader-spots.js'
import {
  BAR_INTERVAL_MS,
  BAR_INTERVAL_TO_PERIOD,
  OrderType,
  PositionStatus,
  TradeSide,
  TimeInForce,
  formatGoodTillDate,
  money,
  orderStatusToIbkr,
  orderTypeToIbkr,
  plainPrice,
  scaledPrice,
  scheduleClock,
  timeInForceToIbkr,
  tradeSideToAction,
  trendbarToBar,
  volumeToUnits,
  type RawTrendbar,
} from './ctrader-mapping.js'

// ==================== config ====================

const optionalPositiveInt = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.coerce.number().int().positive().optional(),
)

export const ctraderConfigSchema = z.object({
  environment: z.enum(['demo', 'live']).default('demo'),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  /** The account number shown in cTrader apps. */
  traderLogin: optionalPositiveInt,
  /** Open API account id; alternative to traderLogin. */
  ctidTraderAccountId: optionalPositiveInt,
}).refine((c) => c.traderLogin !== undefined || c.ctidTraderAccountId !== undefined, {
  message: 'traderLogin (the account number shown in cTrader) or ctidTraderAccountId is required',
})

export type CtraderBrokerConfig = z.infer<typeof ctraderConfigSchema>

export interface CtraderBrokerOptions {
  id?: string
  label?: string
  config: CtraderBrokerConfig
  onTokensRefreshed?: (tokens: CtraderTokenRefresh) => Promise<void> | void
  transport?: Omit<CtraderTransportOptions, 'url'>
  now?: () => Date
  /** How long getQuote waits for a first tick before falling back to bars. */
  quoteTimeoutMs?: number
}

export interface CtraderBrokerMeta {
  environment: 'demo' | 'live'
  traderLogin?: number
}

// ==================== constants ====================

const EXCHANGE = 'CTRADER'
const ORDER_TYPES = ['MKT', 'LMT', 'STP', 'STP LMT']
const NOT_FOUND_CODES = new Set(['ORDER_NOT_FOUND', 'ENTITY_NOT_FOUND', 'POSITION_NOT_FOUND'])
const DEFAULT_BAR_LIMIT = 500
const MAX_BAR_PAGES = 40

/** Conservative request windows per interval; halved on INCORRECT_BOUNDARIES. */
const BAR_WINDOW_MS: Record<BarParams['interval'], number> = {
  '1m': 5 * 86_400_000,
  '5m': 21 * 86_400_000,
  '15m': 56 * 86_400_000,
  '30m': 56 * 86_400_000,
  '1h': 182 * 86_400_000,
  '4h': 365 * 86_400_000,
  '1d': 5 * 365 * 86_400_000,
  '1w': 20 * 365 * 86_400_000,
}

type Row = Record<string, unknown>

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : []
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function obj(value: unknown): Row {
  return value && typeof value === 'object' ? (value as Row) : {}
}

// ==================== broker ====================

export class CtraderBroker implements IBroker<CtraderBrokerMeta> {
  static configSchema = ctraderConfigSchema

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): CtraderBroker {
    return new CtraderBroker({
      id: config.id,
      label: config.label,
      config: ctraderConfigSchema.parse(config.brokerConfig),
    })
  }

  readonly brokerEngine = 'ctrader'
  readonly id: string
  readonly label: string
  readonly meta: CtraderBrokerMeta

  private readonly session: CtraderSession
  private readonly catalog: CtraderCatalog
  private readonly spots: CtraderSpots
  private readonly now: () => Date
  private readonly quoteTimeoutMs: number

  constructor(options: CtraderBrokerOptions) {
    const cfg = options.config
    this.id = options.id ?? `ctrader-${cfg.environment}`
    this.label = options.label ?? `cTrader ${cfg.environment === 'live' ? 'Live' : 'Demo'}`
    this.meta = { environment: cfg.environment, ...(cfg.traderLogin !== undefined ? { traderLogin: cfg.traderLogin } : {}) }
    this.now = options.now ?? (() => new Date())
    this.quoteTimeoutMs = options.quoteTimeoutMs ?? 3_000
    this.session = new CtraderSession({
      environment: cfg.environment,
      account: {
        ...(cfg.traderLogin !== undefined ? { traderLogin: cfg.traderLogin } : {}),
        ...(cfg.ctidTraderAccountId !== undefined ? { ctidTraderAccountId: cfg.ctidTraderAccountId } : {}),
      },
      credentials: {
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        accessToken: cfg.accessToken,
        ...(cfg.refreshToken ? { refreshToken: cfg.refreshToken } : {}),
      },
      ...(options.onTokensRefreshed ? { onTokensRefreshed: options.onTokensRefreshed } : {}),
      ...(options.transport ? { transport: options.transport } : {}),
    })
    this.catalog = new CtraderCatalog(this.session)
    this.spots = new CtraderSpots(this.session, this.now)
  }

  // ---- Lifecycle ----

  async init(): Promise<void> {
    await this.call('connect', () => this.session.ensureConnected())
    if (!this.catalog.isLoaded) await this.call('catalog load', () => this.catalog.load())
  }

  async close(): Promise<void> {
    await this.session.close()
  }

  setConnectionStateListener(listener: ((event: BrokerConnectionStateEvent) => void) | null): void {
    this.session.setConnectionStateListener(listener)
  }

  async refreshCatalog(): Promise<void> {
    await this.call('catalog refresh', () => this.catalog.load())
  }

  // ---- Contracts ----

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    if (!pattern.trim()) return []
    this.requireCatalog()
    return fuzzyRankContracts(
      this.catalog.all().map((s) => ({
        contract: this.contractFor(s),
        ...(s.baseAsset ? { base: s.baseAsset } : {}),
        ...(s.quoteAsset ? { quote: s.quoteAsset } : {}),
        ...(s.description ? { name: s.description } : {}),
      })),
      pattern,
    )
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    this.requireCatalog()
    const sym = this.resolveSymbol(query)
    if (!sym) return null
    const spec = await this.call('symbol details', () => this.catalog.specFor(sym.symbolId))
    const details = new ContractDetails()
    details.contract = this.contractFor(sym)
    details.longName = sym.description || sym.name
    details.marketName = sym.category ?? ''
    details.category = sym.assetClassName ?? ''
    details.validExchanges = EXCHANGE
    details.orderTypes = ORDER_TYPES.join(',')
    if (spec) {
      details.minTick = new Decimal(10).pow(-spec.digits).toNumber()
      if (spec.minVolume !== undefined) details.minSize = volumeToUnits(spec.minVolume)
      if (spec.stepVolume !== undefined) details.sizeIncrement = volumeToUnits(spec.stepVolume)
      details.timeZoneId = spec.scheduleTimeZone ?? ''
    }
    return details
  }

  getNativeKey(contract: Contract): string {
    return this.resolveSymbol(contract)?.name ?? (contract.localSymbol || contract.symbol || '')
  }

  resolveNativeKey(nativeKey: string): Contract {
    this.requireCatalog()
    const sym = this.catalog.byName(nativeKey)
    if (!sym) throw new BrokerError('EXCHANGE', `Unknown cTrader symbol "${nativeKey}" for this account`)
    return this.contractFor(sym)
  }

  assetClassFor(contract: Contract): 'equity' | 'crypto' | 'currency' | 'commodity' | 'unknown' {
    return this.resolveSymbol(contract)?.assetClass ?? 'unknown'
  }

  // ---- Account ----

  async getAccount(): Promise<AccountInfo> {
    const [traderRes, pnlRes, reconcileRes] = await this.call('getAccount', () => Promise.all([
      this.session.accountRequest(PayloadType.TRADER_REQ, {}, { expect: PayloadType.TRADER_RES }),
      this.session.accountRequest(PayloadType.GET_POSITION_UNREALIZED_PNL_REQ, {}, { expect: PayloadType.GET_POSITION_UNREALIZED_PNL_RES }),
      this.session.accountRequest(PayloadType.RECONCILE_REQ, {}, { expect: PayloadType.RECONCILE_RES }),
    ]))
    const trader = obj(traderRes.payload?.['trader'])
    const balance = new Decimal(money(num(trader['balance']), num(trader['moneyDigits'])))
    const pnlDigits = num(pnlRes.payload?.['moneyDigits'])
    let unrealized = new Decimal(0)
    for (const p of rows(pnlRes.payload?.['positionUnrealizedPnL'])) {
      unrealized = unrealized.plus(money(num(p['netUnrealizedPnL']), pnlDigits))
    }
    let usedMargin = new Decimal(0)
    for (const p of rows(reconcileRes.payload?.['position'])) {
      usedMargin = usedMargin.plus(money(num(p['usedMargin']), num(p['moneyDigits'])))
    }
    const depositAssetId = num(trader['depositAssetId'])
    return {
      baseCurrency: (depositAssetId !== undefined ? this.catalog.assetName(depositAssetId) : undefined) ?? 'XXX',
      netLiquidation: balance.plus(unrealized).toString(),
      totalCashValue: balance.toString(),
      unrealizedPnL: unrealized.toString(),
      initMarginReq: usedMargin.toString(),
    }
  }

  async getPositions(): Promise<Position[]> {
    this.requireCatalog()
    const res = await this.call('getPositions', () =>
      this.session.accountRequest(PayloadType.RECONCILE_REQ, {}, { expect: PayloadType.RECONCILE_RES }))

    // Hedged accounts may hold several positions per symbol and side; UTA
    // sees one row per (symbol, side) with a volume-weighted average cost.
    const groups = new Map<string, { symbolId: number; side: number; volume: Decimal; cost: Decimal }>()
    for (const p of rows(res.payload?.['position'])) {
      if ((num(p['positionStatus']) ?? PositionStatus.OPEN) !== PositionStatus.OPEN) continue
      const td = obj(p['tradeData'])
      const symbolId = num(td['symbolId'])
      const volume = num(td['volume'])
      const price = num(p['price'])
      if (symbolId === undefined || volume === undefined || price === undefined) continue
      const side = num(td['tradeSide']) ?? TradeSide.BUY
      const key = `${symbolId}:${side}`
      const g = groups.get(key) ?? { symbolId, side, volume: new Decimal(0), cost: new Decimal(0) }
      g.volume = g.volume.plus(volume)
      g.cost = g.cost.plus(new Decimal(price).mul(volume))
      groups.set(key, g)
    }
    if (groups.size === 0) return []

    const symbolIds = [...new Set([...groups.values()].map((g) => g.symbolId))]
    const specs = await this.call('symbol details', () => this.catalog.specsFor(symbolIds))
    const prices = new Map(await Promise.all(symbolIds.map(async (id) =>
      [id, await this.priceFor(id, specs.get(id)).catch(() => undefined)] as const)))

    const out: Position[] = []
    for (const g of groups.values()) {
      const sym = this.catalog.byId(g.symbolId)
      const digits = specs.get(g.symbolId)?.digits
      const avgCost = g.cost.div(g.volume)
      const long = g.side !== TradeSide.SELL
      const price = prices.get(g.symbolId)
      const mark = price ? (long ? price.bid : price.ask) : avgCost.toString()
      const contract = sym ? this.contractFor(sym) : this.unknownContract(g.symbolId)
      out.push(buildPosition({
        contract,
        currency: contract.currency,
        side: long ? 'long' : 'short',
        quantity: volumeToUnits(g.volume.toNumber()),
        avgCost: digits === undefined ? avgCost.toString() : avgCost.toDecimalPlaces(digits + 2).toString(),
        marketPrice: mark,
        realizedPnL: '0',
        multiplier: '1',
      }))
    }
    return out
  }

  // ---- Orders (read) ----

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    const found = await Promise.all(orderIds.map((id) => this.getOrder(id)))
    return found.filter((o): o is OpenOrder => o !== null)
  }

  async getOrder(orderId: string): Promise<OpenOrder | null> {
    const id = Number(orderId)
    if (!Number.isSafeInteger(id) || id <= 0) return null
    this.requireCatalog()
    try {
      const res = await this.session.accountRequest(PayloadType.ORDER_DETAILS_REQ, { orderId: id }, { expect: PayloadType.ORDER_DETAILS_RES })
      const raw = obj(res.payload?.['order'])
      const [mapped] = await this.mapOrders([raw])
      return mapped ?? null
    } catch (err) {
      if (err instanceof CtraderApiError && NOT_FOUND_CODES.has(err.errorCode)) return null
      throw toBrokerError(err, 'getOrder')
    }
  }

  async getOpenOrders(): Promise<OpenOrder[]> {
    this.requireCatalog()
    const res = await this.call('getOpenOrders', () =>
      this.session.accountRequest(PayloadType.RECONCILE_REQ, {}, { expect: PayloadType.RECONCILE_RES }))
    return this.mapOrders(rows(res.payload?.['order']))
  }

  // ---- Order writes (increment 4) ----

  async placeOrder(): Promise<PlaceOrderResult> {
    return { success: false, error: 'cTrader order placement is not implemented yet' }
  }

  async modifyOrder(): Promise<PlaceOrderResult> {
    return { success: false, error: 'cTrader order modification is not implemented yet' }
  }

  async cancelOrder(): Promise<PlaceOrderResult> {
    return { success: false, error: 'cTrader order cancellation is not implemented yet' }
  }

  async closePosition(): Promise<PlaceOrderResult> {
    return { success: false, error: 'cTrader position closing is not implemented yet' }
  }

  // ---- Market data ----

  async getQuote(contract: Contract): Promise<Quote> {
    this.requireCatalog()
    const sym = this.resolveSymbol(contract)
    if (!sym) throw new BrokerError('EXCHANGE', `Cannot resolve contract "${contract.symbol}" to a cTrader symbol`)
    const spec = await this.call('symbol details', () => this.catalog.specFor(sym.symbolId))
    const price = await this.priceFor(sym.symbolId, spec)
    const mid = new Decimal(price.bid).plus(price.ask).div(2)
    return {
      contract: this.contractFor(sym),
      bid: price.bid,
      ask: price.ask,
      last: (spec ? mid.toDecimalPlaces(spec.digits) : mid).toString(),
      volume: '0',
      timestamp: price.timestamp,
    }
  }

  /**
   * cTrader has no venue-wide clock; each symbol has its own weekly
   * schedule. Report the schedule of the broker's first listed symbol.
   */
  async getMarketClock(): Promise<MarketClock> {
    this.requireCatalog()
    const reference = this.catalog.all()[0]
    if (!reference) return { isOpen: false, timestamp: this.now() }
    const spec = await this.call('symbol details', () => this.catalog.specFor(reference.symbolId))
    return scheduleClock(spec?.schedule ?? [], spec?.scheduleTimeZone, this.now())
  }

  async getHistorical(contract: Contract, params: BarParams): Promise<Bar[]> {
    this.requireCatalog()
    const sym = this.resolveSymbol(contract)
    if (!sym) throw new BrokerError('EXCHANGE', `Cannot resolve contract "${contract.symbol}" to a cTrader symbol`)
    const period = BAR_INTERVAL_TO_PERIOD[params.interval]
    if (period === undefined) throw new BrokerError('CONFIG', `Unsupported bar interval "${params.interval}"`)
    const spec = await this.call('symbol details', () => this.catalog.specFor(sym.symbolId))

    const startMs = params.start?.getTime()
    const endMs = (params.end ?? this.now()).getTime()
    const limit = params.limit ?? (startMs === undefined ? DEFAULT_BAR_LIMIT : Number.POSITIVE_INFINITY)
    const minWindow = BAR_INTERVAL_MS[params.interval] * 10
    let window = BAR_WINDOW_MS[params.interval]
    const bars = new Map<number, Bar>()
    let to = endMs
    let emptyPages = 0

    for (let page = 0; page < MAX_BAR_PAGES; page++) {
      if (startMs !== undefined && to < startMs) break
      const from = Math.max(startMs ?? 0, to - window)
      let res
      try {
        res = await this.session.accountRequest(
          PayloadType.GET_TRENDBARS_REQ,
          { fromTimestamp: from, toTimestamp: to, period, symbolId: sym.symbolId },
          { expect: PayloadType.GET_TRENDBARS_RES },
        )
      } catch (err) {
        if (err instanceof CtraderApiError && err.errorCode === 'INCORRECT_BOUNDARIES' && window / 2 >= minWindow) {
          window /= 2
          continue
        }
        throw toBrokerError(err, 'getHistorical')
      }
      const pageBars = rows(res.payload?.['trendbar'])
        .map((r) => trendbarToBar(r as RawTrendbar, spec?.digits))
        .filter((b): b is Bar => b !== null)
      for (const bar of pageBars) bars.set(bar.timestamp.getTime(), bar)
      emptyPages = pageBars.length === 0 ? emptyPages + 1 : 0

      if (bars.size >= limit || emptyPages >= 3) break
      if (startMs !== undefined && from <= startMs) break
      if (from <= 0) break
      const earliest = pageBars.length > 0 ? Math.min(...pageBars.map((b) => b.timestamp.getTime())) : undefined
      // A truncated page (hasMore) continues just before its earliest bar.
      to = res.payload?.['hasMore'] === true && earliest !== undefined ? earliest - 1 : from - 1
    }

    let out = [...bars.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    if (startMs !== undefined) out = out.filter((b) => b.timestamp.getTime() >= startMs)
    out = out.filter((b) => b.timestamp.getTime() <= endMs)
    return Number.isFinite(limit) ? out.slice(-limit) : out
  }

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['CFD'],
      supportedOrderTypes: ORDER_TYPES,
      historicalBars: {
        supported: true,
        quality: 'realtime',
        supportedBarSizes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
      },
    }
  }

  // ==================== internals ====================

  private async call<T>(context: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      throw toBrokerError(err, context)
    }
  }

  private requireCatalog(): void {
    if (!this.catalog.isLoaded) throw new BrokerError('CONNECTING', 'cTrader symbol catalog is not loaded yet')
  }

  private contractFor(sym: CatalogSymbol): Contract {
    return buildContract({
      symbol: sym.name,
      secType: 'CFD',
      exchange: EXCHANGE,
      currency: sym.quoteAsset ?? 'XXX',
      localSymbol: sym.name,
      conId: sym.symbolId,
      multiplier: '1',
      ...(sym.description ? { description: sym.description } : {}),
    })
  }

  private unknownContract(symbolId: number): Contract {
    return buildContract({ symbol: `SYMBOL-${symbolId}`, secType: 'CFD', exchange: EXCHANGE, currency: 'XXX', conId: symbolId, multiplier: '1' })
  }

  /** conId → localSymbol → aliceId native key → symbol. */
  private resolveSymbol(contract: Contract): CatalogSymbol | undefined {
    if (contract.conId) {
      const byId = this.catalog.byId(contract.conId)
      if (byId) return byId
    }
    const aliceNative = contract.aliceId?.includes('|') ? contract.aliceId.slice(contract.aliceId.indexOf('|') + 1) : undefined
    for (const name of [contract.localSymbol, aliceNative, contract.symbol]) {
      if (!name) continue
      const sym = this.catalog.byName(name)
      if (sym) return sym
    }
    return undefined
  }

  /**
   * Current bid/ask as decimal strings. Uses the spot stream; when no tick
   * arrives (closed market) falls back to the last 1-minute bar close.
   */
  private async priceFor(symbolId: number, spec: SymbolSpec | undefined): Promise<{ bid: string; ask: string; timestamp: Date }> {
    const digits = spec?.digits
    const spot = await this.call('quote', () => this.spots.get(symbolId, this.quoteTimeoutMs))
    if (spot?.bid !== undefined && spot.ask !== undefined) {
      return { bid: scaledPrice(spot.bid, digits), ask: scaledPrice(spot.ask, digits), timestamp: spot.timestamp }
    }
    const to = this.now().getTime()
    const res = await this.call('quote', () => this.session.accountRequest(
      PayloadType.GET_TRENDBARS_REQ,
      { fromTimestamp: to - 7 * 86_400_000, toTimestamp: to, period: BAR_INTERVAL_TO_PERIOD['1m'], symbolId, count: 1 },
      { expect: PayloadType.GET_TRENDBARS_RES },
    ))
    const last = rows(res.payload?.['trendbar'])
      .map((r) => trendbarToBar(r as RawTrendbar, digits))
      .filter((b): b is Bar => b !== null)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0]
    if (last) return { bid: last.close, ask: last.close, timestamp: last.timestamp }
    const name = this.catalog.byId(symbolId)?.name ?? String(symbolId)
    throw new BrokerError('MARKET_CLOSED', `No cTrader price available for ${name}`)
  }

  private async mapOrders(raws: Row[]): Promise<OpenOrder[]> {
    const symbolIds = raws.map((r) => num(obj(r['tradeData'])['symbolId'])).filter((id): id is number => id !== undefined)
    const specs = symbolIds.length > 0 ? await this.call('symbol details', () => this.catalog.specsFor(symbolIds)) : new Map<number, SymbolSpec>()
    const out: OpenOrder[] = []
    for (const raw of raws) {
      const mapped = this.mapOrder(raw, specs)
      if (mapped) out.push(mapped)
    }
    return out
  }

  private mapOrder(raw: Row, specs: Map<number, SymbolSpec>): OpenOrder | null {
    const orderId = num(raw['orderId'])
    const td = obj(raw['tradeData'])
    const symbolId = num(td['symbolId'])
    const volume = num(td['volume'])
    if (orderId === undefined || symbolId === undefined || volume === undefined) return null
    const sym = this.catalog.byId(symbolId)
    const digits = specs.get(symbolId)?.digits
    const type = num(raw['orderType']) ?? OrderType.MARKET
    const action = tradeSideToAction(num(td['tradeSide']) ?? TradeSide.BUY)

    const order = new Order()
    order.action = action
    order.totalQuantity = volumeToUnits(volume)
    order.orderType = orderTypeToIbkr(type)
    order.tif = timeInForceToIbkr(num(raw['timeInForce']))
    const limitPrice = num(raw['limitPrice'])
    const stopPrice = num(raw['stopPrice'])
    if (type === OrderType.LIMIT && limitPrice !== undefined) order.lmtPrice = new Decimal(plainPrice(limitPrice, digits))
    if ((type === OrderType.STOP || type === OrderType.STOP_LIMIT || type === OrderType.STOP_LOSS_TAKE_PROFIT) && stopPrice !== undefined) {
      order.auxPrice = new Decimal(plainPrice(stopPrice, digits))
    }
    const slippage = num(raw['slippageInPoints'])
    if (type === OrderType.STOP_LIMIT && stopPrice !== undefined && slippage !== undefined && digits !== undefined) {
      const offset = new Decimal(slippage).mul(new Decimal(10).pow(-digits))
      order.lmtPrice = new Decimal(stopPrice).plus(action === 'BUY' ? offset : offset.neg()).toDecimalPlaces(digits)
    }
    const expiry = num(raw['expirationTimestamp'])
    if (num(raw['timeInForce']) === TimeInForce.GOOD_TILL_DATE && expiry !== undefined) order.goodTillDate = formatGoodTillDate(expiry)
    const ref = typeof raw['clientOrderId'] === 'string' ? raw['clientOrderId'] : typeof td['label'] === 'string' ? td['label'] : ''
    if (ref) order.orderRef = ref

    const orderState = new OrderState()
    orderState.status = orderStatusToIbkr(num(raw['orderStatus']) ?? 1)

    const result: OpenOrder = {
      contract: sym ? this.contractFor(sym) : this.unknownContract(symbolId),
      order,
      orderState,
      orderId: String(orderId),
    }
    const executionPrice = num(raw['executionPrice'])
    if (executionPrice !== undefined) result.avgFillPrice = plainPrice(executionPrice, digits)
    const stopLoss = num(raw['stopLoss'])
    const takeProfit = num(raw['takeProfit'])
    if (stopLoss !== undefined || takeProfit !== undefined) {
      result.tpsl = {
        ...(takeProfit !== undefined ? { takeProfit: { price: plainPrice(takeProfit, digits) } } : {}),
        ...(stopLoss !== undefined ? { stopLoss: { price: plainPrice(stopLoss, digits) } } : {}),
      }
    }
    return result
  }
}
