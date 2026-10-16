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

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import Decimal from 'decimal.js'
import { Contract, ContractDescription, ContractDetails, Execution, Order, OrderState, UNSET_DECIMAL } from '@traderalice/ibkr'
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
  type TpSlParams,
} from '../types.js'
import '../../contract-ext.js'
import { buildContract, buildPosition } from '../contract-builder.js'
import { fuzzyRankContracts } from '../fuzzy-rank.js'
import { PayloadType, type CtraderEnvelope } from './ctrader-protocol.js'
import { CtraderApiError, type CtraderTransportOptions } from './ctrader-transport.js'
import { CtraderSession, toBrokerError, type CtraderTokenRefresh } from './ctrader-session.js'
import { CtraderCatalog, type CatalogSymbol, type SymbolSpec } from './ctrader-catalog.js'
import { CtraderSpots } from './ctrader-spots.js'
import { CtraderExecutions, ExecutionType, parseExecution, type ExecutionUpdate } from './ctrader-executions.js'
import { buildAmendOrder, buildNewOrder, priceOnGrid, stopLimitPrice } from './ctrader-order-builder.js'
import {
  decideHedgedOrder,
  legRefs,
  makeLegOrder,
  parseLegId,
  protectionLegs,
  settleClosedLeg,
  viewPosition,
  type LegKind,
  type RawPositionView,
} from './ctrader-protection.js'
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
  scheduleTradingHours,
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
  /** How long a write waits for its fill / cancel confirmation. */
  fillTimeoutMs?: number
  /** How long a trading request waits for its first reply. */
  orderReplyTimeoutMs?: number
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
const ORDER_REPLY_TIMEOUT_MS = 20_000

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

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}

/** Unique per order and ≤ 50 chars (venue limit); used to find orders whose reply was lost. */
function newClientOrderId(): string {
  return `oa-${randomUUID().replace(/-/g, '').slice(0, 24)}`
}

function makeOrderState(status: string): OrderState {
  const state = new OrderState()
  state.status = status
  return state
}

/** Updates after which an order needs no further waiting. */
const TERMINAL_TYPES = [
  ExecutionType.ORDER_FILLED,
  ExecutionType.ORDER_REJECTED,
  ExecutionType.ORDER_CANCELLED,
  ExecutionType.ORDER_EXPIRED,
  ExecutionType.ORDER_ERROR,
]

function isFailure(update: ExecutionUpdate): boolean {
  return update.executionType === ExecutionType.ORDER_ERROR
    || update.executionType === ExecutionType.ORDER_REJECTED
    || update.executionType === ExecutionType.ORDER_CANCEL_REJECTED
}

function failureResult(context: string, update: ExecutionUpdate): PlaceOrderResult & { error: string } {
  const code = update.errorCode ?? (update.executionType === ExecutionType.ORDER_CANCEL_REJECTED ? 'CANCEL_REJECTED' : 'ORDER_REJECTED')
  const detail = update.description ? `: ${update.description}` : ''
  return { success: false, error: `cTrader ${context} rejected: ${code}${detail}` }
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
  private readonly executions: CtraderExecutions
  private readonly now: () => Date
  private readonly quoteTimeoutMs: number
  private readonly fillTimeoutMs: number
  private readonly orderReplyTimeoutMs: number
  /** HEDGED (or spread-betting) accounts keep separate positions per order; null until known. */
  private hedged: boolean | null = null

  constructor(options: CtraderBrokerOptions) {
    const cfg = options.config
    this.id = options.id ?? `ctrader-${cfg.environment}`
    this.label = options.label ?? `cTrader ${cfg.environment === 'live' ? 'Live' : 'Demo'}`
    this.meta = { environment: cfg.environment, ...(cfg.traderLogin !== undefined ? { traderLogin: cfg.traderLogin } : {}) }
    this.now = options.now ?? (() => new Date())
    this.quoteTimeoutMs = options.quoteTimeoutMs ?? 3_000
    this.fillTimeoutMs = options.fillTimeoutMs ?? 8_000
    this.orderReplyTimeoutMs = options.orderReplyTimeoutMs ?? ORDER_REPLY_TIMEOUT_MS
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
      // Until a credential store exists (plan Q1) a rotated token lives only in
      // memory; say so loudly, since the stored refresh token is now void.
      onTokensRefreshed: options.onTokensRefreshed ?? (() => {
        console.warn(`UTA[${this.id}]: cTrader access token refreshed in memory; the stored refresh token is no longer valid. Re-authorize before the next restart.`)
        throw new Error('no credential store configured')
      }),
      ...(options.transport ? { transport: options.transport } : {}),
    })
    this.catalog = new CtraderCatalog(this.session)
    this.spots = new CtraderSpots(this.session, this.now)
    this.executions = new CtraderExecutions(this.session)
  }

  // ---- Lifecycle ----

  async init(): Promise<void> {
    await this.call('connect', () => this.session.ensureConnected())
    if (!this.catalog.isLoaded) await this.call('catalog load', () => this.catalog.load())
    if (this.hedged === null) {
      const res = await this.call('account type', () =>
        this.session.accountRequest(PayloadType.TRADER_REQ, {}, { expect: PayloadType.TRADER_RES }))
      // ProtoOAAccountType: 0 HEDGED, 1 NETTED, 2 SPREAD_BETTING. Only NETTED reduces implicitly.
      this.hedged = (num(obj(res.payload?.['trader'])['accountType']) ?? 0) !== 1
    }
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
      details.tradingHours = scheduleTradingHours(spec.schedule, spec.scheduleTimeZone, this.now())
      details.timeZoneId = spec.scheduleTimeZone || (details.tradingHours ? 'UTC' : '')
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
    const leg = parseLegId(orderId)
    if (leg) {
      this.requireCatalog()
      return this.call('getOrder', () => this.getLeg(leg.kind, leg.positionId))
    }
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

  /** Pending orders plus the stop-loss / take-profit legs of open positions. */
  async getOpenOrders(): Promise<OpenOrder[]> {
    this.requireCatalog()
    const res = await this.call('getOpenOrders', () =>
      this.session.accountRequest(PayloadType.RECONCILE_REQ, {}, { expect: PayloadType.RECONCILE_RES }))
    const orders = await this.mapOrders(rows(res.payload?.['order']))
    const positions = rows(res.payload?.['position']).map(viewPosition).filter((p): p is RawPositionView => p !== null && p.open)
    if (positions.length === 0) return orders
    const specs = await this.call('symbol details', () => this.catalog.specsFor(positions.map((p) => p.symbolId)))
    const legs = positions.flatMap((p) => protectionLegs(p, this.contractForId(p.symbolId), specs.get(p.symbolId)?.digits))
    return [...orders, ...legs]
  }

  /** A protection leg: live from the open position, or settled from its closing deals. */
  private async getLeg(kind: LegKind, positionId: number): Promise<OpenOrder | null> {
    const res = await this.session.accountRequest(PayloadType.RECONCILE_REQ, {}, { expect: PayloadType.RECONCILE_RES })
    const open = rows(res.payload?.['position']).map(viewPosition).find((p) => p?.positionId === positionId && p.open)
    if (open) {
      const digits = (await this.catalog.specFor(open.symbolId))?.digits
      const price = open[kind]
      return makeLegOrder({
        kind, positionId, positionSide: open.side, volume: open.volume, price,
        status: price === undefined ? 'Cancelled' : 'Submitted', contract: this.contractForId(open.symbolId), digits,
      })
    }
    // Position closed: its deals say how it closed and at what price. The
    // venue's order list by position leaves out the protection order, so the
    // closing deals' own orders are looked up instead.
    // The demo venue (2026-10-16) answered INCORRECT_BOUNDARIES for a while
    // after positions closed, then accepted the same window. An unreadable
    // leg is reported as unknown (null) so the caller retries it later; one
    // throw would stop UTA from syncing every other order and from pushing.
    const now = this.now().getTime()
    let history: CtraderEnvelope
    try {
      history = await this.session.accountRequest(
        PayloadType.DEAL_LIST_BY_POSITION_ID_REQ,
        { positionId, fromTimestamp: now - 90 * 86_400_000, toTimestamp: now },
        { expect: PayloadType.DEAL_LIST_BY_POSITION_ID_RES },
      )
    } catch (err) {
      if (err instanceof CtraderApiError && err.errorCode === 'INCORRECT_BOUNDARIES') return null
      throw err
    }
    const deals = rows(history.payload?.['deal']).filter((d) => (num(d['filledVolume']) ?? 0) > 0)
    const symbolId = num(deals[0]?.['symbolId'])
    if (symbolId === undefined) return null
    const closing = deals.filter((d) => d['closePositionDetail'] !== undefined)
    // The opening deal carries the position's side; closing deals trade the opposite way.
    const opening = deals.filter((d) => d['closePositionDetail'] === undefined)
    const positionSide = opening[0]
      ? num(opening[0]['tradeSide']) ?? TradeSide.BUY
      : num(closing[0]?.['tradeSide']) === TradeSide.BUY ? TradeSide.SELL : TradeSide.BUY
    const volumeOf = (list: Row[]) => list.reduce((sum, d) => sum + (num(d['filledVolume']) ?? 0), 0)

    let protection: Row | undefined
    for (const orderId of new Set(closing.map((d) => num(d['orderId'])))) {
      if (orderId === undefined) continue
      const order = await this.closingOrder(orderId)
      if (num(order?.['orderType']) === OrderType.STOP_LOSS_TAKE_PROFIT) {
        protection = order
        break
      }
    }
    const settled = settleClosedLeg(kind, protection, closing)
    return makeLegOrder({
      kind, positionId,
      positionSide,
      volume: volumeOf(opening) || volumeOf(closing),
      price: settled.level,
      status: settled.status,
      contract: this.contractForId(symbolId),
      digits: (await this.catalog.specFor(symbolId))?.digits,
      ...(settled.fillPrice && settled.filledVolume ? { fill: { price: settled.fillPrice, volume: settled.filledVolume } } : {}),
    })
  }

  /** The raw order behind a closing deal; undefined when the venue no longer knows it. */
  private async closingOrder(orderId: number): Promise<Row | undefined> {
    try {
      const res = await this.session.accountRequest(PayloadType.ORDER_DETAILS_REQ, { orderId }, { expect: PayloadType.ORDER_DETAILS_RES })
      return obj(res.payload?.['order'])
    } catch (err) {
      if (err instanceof CtraderApiError && NOT_FOUND_CODES.has(err.errorCode)) return undefined
      throw err
    }
  }

  // ---- Order writes ----

  async placeOrder(contract: Contract, order: Order, tpsl?: TpSlParams): Promise<PlaceOrderResult> {
    const blocked = this.writeBlocked()
    if (blocked) return blocked
    const sym = this.resolveSymbol(contract)
    if (!sym) return { success: false, error: `Cannot resolve contract "${contract.symbol}" to a cTrader symbol` }
    let spec: SymbolSpec | undefined
    let reference: { bid: Decimal; ask: Decimal } | undefined
    try {
      spec = await this.catalog.specFor(sym.symbolId)
      if (spec && (order.orderType || '').toUpperCase() === 'MKT' && (tpsl?.stopLoss || tpsl?.takeProfit)) {
        const price = await this.priceFor(sym.symbolId, spec)
        reference = { bid: new Decimal(price.bid), ask: new Decimal(price.ask) }
      }
    } catch (err) {
      return { success: false, error: toBrokerError(err, 'placeOrder').message }
    }
    if (!spec) return { success: false, error: `No cTrader specification for ${sym.name}` }

    const clientOrderId = newClientOrderId()
    const plan = buildNewOrder({
      order, symbol: sym, spec, clientOrderId, now: this.now(),
      ...(tpsl ? { tpsl } : {}),
      ...(reference ? { reference } : {}),
    })
    if (!plan.ok) return { success: false, error: plan.error }

    // Hedged accounts: an order against an open position must reduce it, as
    // it would on a netting (IBKR-style) account, not open an opposite one.
    let reducing = false
    if (this.hedged) {
      let decision
      try {
        const res = await this.session.accountRequest(PayloadType.RECONCILE_REQ, {}, { expect: PayloadType.RECONCILE_RES })
        const positions = rows(res.payload?.['position']).map(viewPosition)
          .filter((p): p is RawPositionView => p !== null && p.symbolId === sym.symbolId)
        decision = decideHedgedOrder(positions, sym.name, plan.value.payload['tradeSide'] as number, plan.value.payload['volume'] as number)
      } catch (err) {
        return { success: false, error: toBrokerError(err, 'placeOrder').message }
      }
      if (decision.kind === 'refuse') return { success: false, error: decision.error }
      if (decision.kind === 'reduce') {
        if (tpsl?.stopLoss || tpsl?.takeProfit) {
          return { success: false, error: `This order reduces the open ${sym.name} position; set stop-loss / take-profit on the position instead (modify its sl-/tp- order)` }
        }
        plan.value.payload['positionId'] = decision.positionId
        reducing = true
      }
    }

    const sentAt = this.now().getTime()
    let first: ExecutionUpdate
    try {
      first = await this.sendOrderRequest(PayloadType.NEW_ORDER_REQ, plan.value.payload)
    } catch (err) {
      if (err instanceof CtraderApiError || err instanceof BrokerError) {
        return { success: false, error: toBrokerError(err, 'placeOrder').message }
      }
      // The reply was lost: the order may exist. Look it up before reporting.
      const found = await this.findByClientOrderId(clientOrderId, sentAt).catch(() => null)
      if (found) {
        return { success: true, orderId: found.orderId!, orderState: found.orderState, message: 'cTrader order confirmed by lookup after its reply was lost' }
      }
      const reason = err instanceof Error ? err.message : String(err)
      return { success: false, error: `cTrader placeOrder outcome unknown (${reason}). Check open orders and positions before retrying.` }
    }
    if (isFailure(first)) return failureResult('placeOrder', first)

    let final = first
    if (plan.value.isMarket && first.executionType !== ExecutionType.ORDER_FILLED) {
      final = await this.executions.waitFor(first.orderId, TERMINAL_TYPES, this.fillTimeoutMs) ?? first
      if (isFailure(final)) return failureResult('placeOrder', final)
    }
    const result = this.resultFrom(final)
    if (plan.value.marketProtection && final.executionType === ExecutionType.ORDER_FILLED && !reducing) {
      const note = await this.applyExactProtection(final, plan.value.marketProtection, spec)
      if (note) result.message = note
      // Surface the protection as trackable legs from birth.
      const positionId = num(final.position?.['positionId']) ?? num(final.deal?.['positionId'])
      if (positionId !== undefined) {
        const legs = legRefs({
          positionId,
          stopLoss: plan.value.marketProtection.stopLoss ?? num(final.position?.['stopLoss']),
          takeProfit: plan.value.marketProtection.takeProfit ?? num(final.position?.['takeProfit']),
        })
        if (legs.length > 0) result.legs = legs
      }
    }
    return result
  }

  async modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult> {
    const blocked = this.writeBlocked()
    if (blocked) return blocked
    const leg = parseLegId(orderId)
    if (leg) return this.amendLeg(orderId, leg.kind, leg.positionId, changes)
    const id = Number(orderId)
    if (!Number.isSafeInteger(id) || id <= 0) return { success: false, error: `Invalid cTrader order id "${orderId}"` }
    try {
      const res = await this.session.accountRequest(PayloadType.ORDER_DETAILS_REQ, { orderId: id }, { expect: PayloadType.ORDER_DETAILS_RES })
      const raw = obj(res.payload?.['order'])
      const td = obj(raw['tradeData'])
      const symbolId = num(td['symbolId'])
      const sym = symbolId !== undefined ? this.catalog.byId(symbolId) : undefined
      if (!sym) return { success: false, error: `Order ${orderId} is on an unknown symbol` }
      if ((num(raw['orderStatus']) ?? 0) !== 1) {
        return { success: false, error: `Order ${orderId} is no longer working (${orderStatusToIbkr(num(raw['orderStatus']) ?? 0)})` }
      }
      const spec = await this.catalog.specFor(sym.symbolId)
      if (!spec) return { success: false, error: `No cTrader specification for ${sym.name}` }
      const plan = buildAmendOrder({
        current: {
          orderId: id,
          orderType: num(raw['orderType']) ?? OrderType.LIMIT,
          tradeSide: num(td['tradeSide']) ?? TradeSide.BUY,
          volume: num(td['volume']) ?? 0,
          ...optional('limitPrice', num(raw['limitPrice'])),
          ...optional('stopPrice', num(raw['stopPrice'])),
          ...optional('stopLoss', num(raw['stopLoss'])),
          ...optional('takeProfit', num(raw['takeProfit'])),
          ...optional('timeInForce', num(raw['timeInForce'])),
          ...optional('expirationTimestamp', num(raw['expirationTimestamp'])),
          ...optional('slippageInPoints', num(raw['slippageInPoints'])),
        },
        changes,
        symbol: sym,
        spec,
        now: this.now(),
      })
      if (!plan.ok) return { success: false, error: plan.error }
      const update = await this.sendOrderRequest(PayloadType.AMEND_ORDER_REQ, plan.value)
      if (isFailure(update)) return failureResult('modifyOrder', update)
      return this.resultFrom(update)
    } catch (err) {
      if (err instanceof CtraderApiError && NOT_FOUND_CODES.has(err.errorCode)) return { success: false, error: `cTrader order ${orderId} not found` }
      return { success: false, error: toBrokerError(err, 'modifyOrder').message }
    }
  }

  async cancelOrder(orderId: string): Promise<PlaceOrderResult> {
    const blocked = this.writeBlocked()
    if (blocked) return blocked
    const leg = parseLegId(orderId)
    if (leg) return this.amendLeg(orderId, leg.kind, leg.positionId, null)
    const id = Number(orderId)
    if (!Number.isSafeInteger(id) || id <= 0) return { success: false, error: `Invalid cTrader order id "${orderId}"` }
    try {
      const first = await this.sendOrderRequest(PayloadType.CANCEL_ORDER_REQ, { orderId: id })
      if (isFailure(first)) return failureResult('cancelOrder', first)
      const final = first.executionType === ExecutionType.ORDER_CANCELLED
        ? first
        : await this.executions.waitFor(id, [ExecutionType.ORDER_CANCELLED, ExecutionType.ORDER_CANCEL_REJECTED, ExecutionType.ORDER_ERROR], this.fillTimeoutMs) ?? first
      if (isFailure(final)) return failureResult('cancelOrder', final)
      return this.resultFrom(final)
    } catch (err) {
      if (err instanceof CtraderApiError && NOT_FOUND_CODES.has(err.errorCode)) return { success: false, error: `cTrader order ${orderId} not found` }
      return { success: false, error: toBrokerError(err, 'cancelOrder').message }
    }
  }

  /**
   * Move (`changes`) or remove (`null`) one protection level of an open
   * position. The other level is always re-sent so it is never dropped.
   */
  private async amendLeg(orderId: string, kind: LegKind, positionId: number, changes: Partial<Order> | null): Promise<PlaceOrderResult> {
    try {
      const res = await this.session.accountRequest(PayloadType.RECONCILE_REQ, {}, { expect: PayloadType.RECONCILE_RES })
      const position = rows(res.payload?.['position']).map(viewPosition).find((p) => p?.positionId === positionId && p.open)
      if (!position) return { success: false, error: `Position ${positionId} is no longer open` }
      const sym = this.catalog.byId(position.symbolId)
      const spec = await this.catalog.specFor(position.symbolId)
      if (!sym || !spec) return { success: false, error: `Position ${positionId} is on an unknown symbol` }

      const levels: { stopLoss: number | undefined; takeProfit: number | undefined } = {
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
      }
      if (changes === null) {
        if (levels[kind] === undefined) return { success: false, error: `Position ${positionId} has no ${kind === 'stopLoss' ? 'stop-loss' : 'take-profit'} to cancel` }
        levels[kind] = undefined
      } else {
        if (changes.totalQuantity != null && !changes.totalQuantity.equals(UNSET_DECIMAL)) {
          return { success: false, error: 'Position protection always covers the whole position; use closePosition to exit part of it' }
        }
        const field = kind === 'stopLoss' ? changes.auxPrice : changes.lmtPrice
        const fieldName = kind === 'stopLoss' ? 'auxPrice' : 'lmtPrice'
        if (field == null || field.equals(UNSET_DECIMAL)) {
          return { success: false, error: `Give the new ${kind === 'stopLoss' ? 'stop-loss' : 'take-profit'} price as ${fieldName}` }
        }
        const price = priceOnGrid(field, spec, kind === 'stopLoss' ? 'Stop loss' : 'Take profit', sym.name)
        if (!price.ok) return { success: false, error: price.error }
        levels[kind] = price.value
      }

      const payload: Record<string, unknown> = { positionId }
      if (levels.stopLoss !== undefined) payload['stopLoss'] = levels.stopLoss
      if (levels.takeProfit !== undefined) payload['takeProfit'] = levels.takeProfit
      const update = await this.sendOrderRequest(PayloadType.AMEND_POSITION_SLTP_REQ, payload)
      if (isFailure(update)) return failureResult(changes === null ? 'cancelOrder' : 'modifyOrder', update)
      return { success: true, orderId, orderState: makeOrderState(changes === null ? 'Cancelled' : 'Submitted') }
    } catch (err) {
      return { success: false, error: toBrokerError(err, changes === null ? 'cancelOrder' : 'modifyOrder').message }
    }
  }

  /**
   * Close all or part of the open position on a symbol. Hedged accounts may
   * hold several positions per symbol; they are closed oldest first. A
   * symbol with both long and short positions open is refused, since the
   * contract alone cannot say which side to close.
   */
  async closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult> {
    const blocked = this.writeBlocked()
    if (blocked) return blocked
    const sym = this.resolveSymbol(contract)
    if (!sym) return { success: false, error: `Cannot resolve contract "${contract.symbol}" to a cTrader symbol` }

    let open: Array<{ positionId: number; volume: number; side: number; openedAt: number }>
    let spec: SymbolSpec | undefined
    try {
      const res = await this.session.accountRequest(PayloadType.RECONCILE_REQ, {}, { expect: PayloadType.RECONCILE_RES })
      open = rows(res.payload?.['position'])
        .filter((p) => (num(p['positionStatus']) ?? PositionStatus.OPEN) === PositionStatus.OPEN)
        .map((p) => {
          const td = obj(p['tradeData'])
          return {
            positionId: num(p['positionId']) ?? 0,
            symbolId: num(td['symbolId']),
            volume: num(td['volume']) ?? 0,
            side: num(td['tradeSide']) ?? TradeSide.BUY,
            openedAt: num(td['openTimestamp']) ?? 0,
          }
        })
        .filter((p) => p.symbolId === sym.symbolId && p.positionId > 0 && p.volume > 0)
        .sort((a, b) => a.openedAt - b.openedAt || a.positionId - b.positionId)
      spec = await this.catalog.specFor(sym.symbolId)
    } catch (err) {
      return { success: false, error: toBrokerError(err, 'closePosition').message }
    }
    if (open.length === 0) return { success: false, error: `No open ${sym.name} position to close` }
    if (new Set(open.map((p) => p.side)).size > 1) {
      return { success: false, error: `Both long and short ${sym.name} positions are open; close each side with an opposite order instead` }
    }

    const total = open.reduce((sum, p) => sum + p.volume, 0)
    let target = total
    if (quantity !== undefined) {
      const cents = quantity.mul(100)
      if (!quantity.isFinite() || quantity.lte(0) || !cents.isInteger()) return { success: false, error: `Invalid close quantity ${quantity.toString()}` }
      target = cents.toNumber()
      if (target > total) {
        return { success: false, error: `Close quantity ${quantity.toString()} exceeds the open ${sym.name} position of ${volumeToUnits(total).toString()} units` }
      }
      const step = spec?.stepVolume
      if (target !== total && step && target % step !== 0) {
        return { success: false, error: `Close quantity ${quantity.toString()} is not a multiple of the ${sym.name} step of ${volumeToUnits(step).toString()} units` }
      }
    }

    const closed: ExecutionUpdate[] = []
    const fullyClosed: number[] = []
    let remaining = target
    let failure: string | undefined
    for (const position of open) {
      if (remaining <= 0) break
      const volume = Math.min(remaining, position.volume)
      try {
        const first = await this.sendOrderRequest(PayloadType.CLOSE_POSITION_REQ, { positionId: position.positionId, volume })
        if (isFailure(first)) {
          failure = failureResult('closePosition', first).error
          break
        }
        const final = first.executionType === ExecutionType.ORDER_FILLED
          ? first
          : await this.executions.waitFor(first.orderId, TERMINAL_TYPES, this.fillTimeoutMs) ?? first
        if (isFailure(final)) {
          failure = failureResult('closePosition', final).error
          break
        }
        closed.push(final)
        if (volume === position.volume) fullyClosed.push(position.positionId)
        remaining -= volume
      } catch (err) {
        failure = toBrokerError(err, 'closePosition').message
        break
      }
    }

    if (closed.length === 0) return { success: false, error: failure ?? `Could not close ${sym.name}` }
    const result = this.resultFrom(closed[0]!)
    const notes: string[] = []
    const orphans = await this.cancelLinkedOrders(fullyClosed)
    if (orphans) notes.push(orphans)
    if (closed.length > 1) notes.push(`closed ${closed.length} positions via orders ${closed.map((u) => u.orderId).join(', ')}`)
    if (failure) notes.push(`${volumeToUnits(remaining).toString()} units remain open: ${failure}`)
    if (notes.length > 0) result.message = notes.join('; ')
    if (closed.some((u) => u.executionType !== ExecutionType.ORDER_FILLED)) {
      result.orderState = makeOrderState('Submitted')
    }
    return result
  }

  /**
   * Cancel pending orders still linked to positions that no longer exist
   * (e.g. a reducing stop placed IBKR-style), so they cannot fire later.
   * Returns a note for the result, or null when nothing needed attention.
   */
  private async cancelLinkedOrders(positionIds: number[]): Promise<string | null> {
    if (positionIds.length === 0) return null
    try {
      const res = await this.session.accountRequest(PayloadType.RECONCILE_REQ, {}, { expect: PayloadType.RECONCILE_RES })
      const linked = rows(res.payload?.['order'])
        .filter((o) => positionIds.includes(num(o['positionId']) ?? -1) && num(o['orderType']) !== 4)
        .map((o) => num(o['orderId']))
        .filter((id): id is number => id !== undefined)
      const failed: number[] = []
      for (const id of linked) {
        try {
          const update = await this.sendOrderRequest(PayloadType.CANCEL_ORDER_REQ, { orderId: id })
          if (isFailure(update)) failed.push(id)
        } catch {
          failed.push(id)
        }
      }
      if (failed.length > 0) return `linked pending orders ${failed.join(', ')} could not be cancelled; cancel them before they trigger`
      return linked.length > 0 ? `cancelled linked pending orders ${linked.join(', ')}` : null
    } catch (err) {
      return `could not check for linked pending orders (${toBrokerError(err, 'closePosition').message}); review open orders`
    }
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
   * A symbol's own hours are in its contract details (`tradingHours`).
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

  /** A failed result when writes are impossible right now, else null. */
  private writeBlocked(): PlaceOrderResult | null {
    if (!this.catalog.isLoaded) return { success: false, error: 'cTrader account is not connected yet' }
    let canTrade = true
    try {
      canTrade = this.session.accountRef.canTrade
    } catch {
      return { success: false, error: 'cTrader account is not connected yet' }
    }
    if (!canTrade) {
      return { success: false, error: 'This cTrader token was granted view-only access; re-authorize the application with the trading scope' }
    }
    return null
  }

  /** Send a trading request; its first reply is an execution or an order error. */
  private async sendOrderRequest(payloadType: number, payload: Record<string, unknown>): Promise<ExecutionUpdate> {
    const reply = await this.session.accountRequest(payloadType, payload, {
      expect: [PayloadType.EXECUTION_EVENT, PayloadType.ORDER_ERROR_EVENT],
      timeoutMs: this.orderReplyTimeoutMs,
    })
    const update = parseExecution(reply, Date.now())
    if (!update) {
      const errorCode = typeof reply.payload?.['errorCode'] === 'string' ? reply.payload['errorCode'] : 'UNEXPECTED_REPLY'
      return {
        executionType: ExecutionType.ORDER_ERROR, orderId: 0, order: undefined, position: undefined, deal: undefined,
        errorCode, description: typeof reply.payload?.['description'] === 'string' ? reply.payload['description'] : undefined,
        receivedAt: Date.now(),
      }
    }
    return update
  }

  private resultFrom(update: ExecutionUpdate): PlaceOrderResult {
    const orderStatus = num(update.order?.['orderStatus'])
    const status = update.executionType === ExecutionType.ORDER_FILLED
      ? 'Filled'
      : update.executionType === ExecutionType.ORDER_CANCELLED || update.executionType === ExecutionType.ORDER_EXPIRED
        ? 'Cancelled'
        : orderStatus !== undefined ? orderStatusToIbkr(orderStatus) : 'Submitted'
    const result: PlaceOrderResult = { success: true, orderId: String(update.orderId), orderState: makeOrderState(status) }
    const deal = update.deal
    const price = num(deal?.['executionPrice'])
    const filled = num(deal?.['filledVolume'])
    if (deal && price !== undefined && filled !== undefined && filled > 0) {
      const execution = new Execution()
      execution.execId = String(num(deal['dealId']) ?? '')
      execution.orderId = update.orderId
      execution.time = new Date(num(deal['executionTimestamp']) ?? Date.now()).toISOString()
      execution.side = num(deal['tradeSide']) === TradeSide.SELL ? 'SLD' : 'BOT'
      execution.shares = volumeToUnits(filled)
      execution.cumQty = volumeToUnits(filled)
      execution.price = price
      execution.avgPrice = price
      execution.exchange = EXCHANGE
      result.execution = execution
    }
    return result
  }

  /**
   * After a market fill, move the fill-relative protection to the exact
   * requested prices. Returns a note for the result, or null when exact.
   */
  private async applyExactProtection(
    fill: ExecutionUpdate,
    wanted: { stopLoss?: number; takeProfit?: number },
    spec: SymbolSpec,
  ): Promise<string | null> {
    const positionId = num(fill.position?.['positionId']) ?? num(fill.deal?.['positionId'])
    if (positionId === undefined) return 'Protection was placed relative to the fill; the position id was not reported, so exact prices were not applied'
    const tick = new Decimal(10).pow(-spec.digits).div(2)
    const close = (a: number | undefined, b: number | undefined) =>
      b === undefined || (a !== undefined && new Decimal(a).minus(b).abs().lt(tick))
    const currentSl = num(fill.position?.['stopLoss'])
    const currentTp = num(fill.position?.['takeProfit'])
    if (close(currentSl, wanted.stopLoss) && close(currentTp, wanted.takeProfit)) return null

    const payload: Record<string, unknown> = { positionId }
    const sl = wanted.stopLoss ?? currentSl
    const tp = wanted.takeProfit ?? currentTp
    if (sl !== undefined) payload['stopLoss'] = sl
    if (tp !== undefined) payload['takeProfit'] = tp
    try {
      const update = await this.sendOrderRequest(PayloadType.AMEND_POSITION_SLTP_REQ, payload)
      if (isFailure(update)) {
        return `Protection is active relative to the fill (SL ${currentSl ?? '-'}, TP ${currentTp ?? '-'}); moving it to the exact prices failed: ${failureResult('amend', update).error}`
      }
      return null
    } catch (err) {
      return `Protection is active relative to the fill (SL ${currentSl ?? '-'}, TP ${currentTp ?? '-'}); moving it to the exact prices failed: ${toBrokerError(err, 'amend').message}`
    }
  }

  /** Find a recently placed order by its clientOrderId (lost-reply recovery). */
  private async findByClientOrderId(clientOrderId: string, sentAt: number): Promise<OpenOrder | null> {
    const res = await this.session.accountRequest(
      PayloadType.ORDER_LIST_REQ,
      { fromTimestamp: sentAt - 60_000, toTimestamp: this.now().getTime() + 60_000 },
      { expect: PayloadType.ORDER_LIST_RES },
    )
    const raw = rows(res.payload?.['order']).find((o) => o['clientOrderId'] === clientOrderId)
    if (!raw) return null
    const [mapped] = await this.mapOrders([raw])
    return mapped ?? null
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

  private contractForId(symbolId: number): Contract {
    const sym = this.catalog.byId(symbolId)
    return sym ? this.contractFor(sym) : this.unknownContract(symbolId)
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
    const executed = num(raw['executedVolume'])
    if (executed !== undefined && executed > 0) order.filledQuantity = volumeToUnits(executed)
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
      order.lmtPrice = stopLimitPrice(new Decimal(stopPrice), slippage, action, digits)
    }
    const expiry = num(raw['expirationTimestamp'])
    if (num(raw['timeInForce']) === TimeInForce.GOOD_TILL_DATE && expiry !== undefined) order.goodTillDate = formatGoodTillDate(expiry)
    // orderRef travels as the label; clientOrderId is generated per order.
    if (typeof td['label'] === 'string' && td['label']) order.orderRef = td['label']

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
