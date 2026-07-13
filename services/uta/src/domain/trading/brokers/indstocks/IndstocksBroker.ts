/**
 * IndstocksBroker — IBroker adapter for INDstocks (INDmoney's trading API).
 *
 * Scope v1: Indian EQUITIES on NSE/BSE (secType STK). F&O (FUT/OPT) is
 * deferred — see TODOs. No paper/sandbox exists upstream, so this trades the
 * LIVE environment only; test with tiny quantities.
 *
 * Daily-token reality (SEBI): the access token expires every 24h with no
 * refresh endpoint. A 403 maps to a permanent BrokerError('AUTH'), which the
 * UTA recovery loop treats as "disable + surface to the user" — i.e. trading
 * halts and the health/Inbox surface tells them to paste a fresh token. There
 * is intentionally NO attempt to auto-renew.  (See indstocks-client.ts.)
 *
 * STATUS: SCAFFOLD. Structure + REST wiring are real; raw field names follow
 * the public docs and MUST be verified against live responses. Order-product
 * selection, F&O, holidays, and the order-update WebSocket are marked TODO.
 */

import { z } from 'zod'
import Decimal from 'decimal.js'
import { Contract, ContractDescription, ContractDetails, Order, OrderState, UNSET_DECIMAL } from '@traderalice/ibkr'
import {
  BrokerError,
  type IBroker,
  type AccountCapabilities,
  type AccountInfo,
  type Position,
  type PlaceOrderResult,
  type PlaceOrderLeg,
  type OpenOrder,
  type Quote,
  type MarketClock,
  type BrokerConfigField,
  type TpSlParams,
  type Bar,
  type BarParams,
} from '../types.js'
import '../../contract-ext.js'
import type { IndstocksBrokerConfig, IndstocksInstrument, IndstocksOrderRaw, IndstocksLtpRaw } from './indstocks-types.js'
import {
  makeContract,
  resolveSymbol,
  scripCode,
  makeOrderState,
  ibkrOrderTypeToInd,
  ibkrTifToInd,
  algoIdFor,
  IND_INTERVAL,
  DEFAULT_EXCHANGE,
} from './indstocks-contracts.js'
import { buildPosition } from '../contract-builder.js'
import { fuzzyRankContracts, type FuzzyRankInput } from '../fuzzy-rank.js'
import { IndstocksClient, type IndPlaceOrderBody, type IndSmartOrderBody } from './indstocks-client.js'
import { IndstocksOrderStream, type IndstocksOrderStreamHandlers } from './indstocks-stream.js'

/** Decimal from a loose string|number|null. */
const dec = (v: string | number | undefined | null, d = '0'): Decimal =>
  new Decimal(v == null || v === '' ? d : String(v))

/** Decimal from a comma-formatted string ("1,318.10") — INDstocks market depth. */
const decLoose = (v: string | number | undefined | null): Decimal =>
  new Decimal((v == null ? '0' : String(v)).replace(/,/g, '') || '0')

/**
 * Default product for orders. INDstocks needs CNC | INTRADAY | MARGIN, but the
 * IBKR Order has no product field. v1 defaults to CNC (delivery).
 * TODO: thread product through (per-order override or account-level default).
 */
const DEFAULT_PRODUCT = 'CNC'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const NSE_OPEN_MIN = 9 * 60 + 15     // 09:15 IST
const NSE_CLOSE_MIN = 15 * 60 + 30   // 15:30 IST

export class IndstocksBroker implements IBroker {
  // ---- Self-registration ----

  static configSchema = z.object({
    accessToken: z.string().min(1),
    userId: z.string().min(1),
  })

  static configFields: BrokerConfigField[] = [
    { name: 'userId', type: 'text', label: 'INDstocks Client ID', required: true, description: 'Stable account identifier (from your INDstocks profile).' },
    { name: 'accessToken', type: 'password', label: 'Access Token', required: true, sensitive: true, description: 'Daily token from web.indstocks.com → API. Expires every 24h; paste a fresh one each session.' },
  ]

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): IndstocksBroker {
    const bc = IndstocksBroker.configSchema.parse(config.brokerConfig)
    return new IndstocksBroker({
      id: config.id,
      label: config.label,
      accessToken: bc.accessToken,
      userId: bc.userId,
    })
  }

  // ---- Instance ----

  readonly id: string
  readonly label: string

  private readonly config: IndstocksBrokerConfig
  private client!: IndstocksClient
  /** symbol catalog keyed `${EXCH}:${SYMBOL}`. null = not loaded yet. */
  private catalog: Map<string, IndstocksInstrument> | null = null

  constructor(config: IndstocksBrokerConfig) {
    this.config = config
    this.id = config.id ?? `indstocks-${config.userId}`
    this.label = config.label ?? 'INDmoney'
  }

  // ---- Lifecycle ----

  private static readonly MAX_INIT_RETRIES = 4
  private static readonly INIT_RETRY_BASE_MS = 1000

  async init(): Promise<void> {
    if (!this.config.accessToken) {
      throw new BrokerError('CONFIG', 'No INDstocks access token configured.')
    }
    this.client = new IndstocksClient(this.config.accessToken)

    let lastErr: unknown
    for (let attempt = 1; attempt <= IndstocksBroker.MAX_INIT_RETRIES; attempt++) {
      try {
        // Probe token validity. A 403 here throws a permanent AUTH error
        // (client.request) and bails immediately — no point retrying an
        // expired daily token.
        await this.client.getProfile()
        console.log(`IndstocksBroker[${this.id}]: connected (live)`)
        this.refreshCatalog().catch((err) => {
          console.warn(`IndstocksBroker[${this.id}]: initial catalog load failed:`, err instanceof Error ? err.message : err)
        })
        return
      } catch (err) {
        if (err instanceof BrokerError && err.permanent) throw err   // AUTH/CONFIG: don't retry
        lastErr = err
        if (attempt < IndstocksBroker.MAX_INIT_RETRIES) {
          const delay = IndstocksBroker.INIT_RETRY_BASE_MS * 2 ** (attempt - 1)
          console.warn(`IndstocksBroker[${this.id}]: init attempt ${attempt} failed, retrying in ${delay}ms...`)
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }
    throw lastErr
  }

  async close(): Promise<void> {
    // REST is stateless; nothing to tear down. TODO: close order-update WS.
  }

  // ---- Contract search (EnumeratingCatalog) ----

  async refreshCatalog(): Promise<void> {
    const rows = await this.client.getInstruments('equity')
    const next = new Map<string, IndstocksInstrument>()
    for (const r of rows) {
      next.set(`${r.exch.toUpperCase()}:${r.tradingSymbol.toUpperCase()}`, r)
    }
    this.catalog = next
    console.log(`IndstocksBroker[${this.id}]: catalog loaded (${next.size} equity instruments)`)
  }

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    if (!pattern) return []
    if (this.catalog == null) {
      const desc = new ContractDescription()
      desc.contract = makeContract(pattern.toUpperCase())
      return [desc]
    }
    const entries: FuzzyRankInput[] = []
    for (const r of this.catalog.values()) {
      const c = makeContract(r.tradingSymbol, r.exch || DEFAULT_EXCHANGE)
      if (r.customSymbol) c.description = r.customSymbol
      if (r.exch) c.primaryExchange = r.exch
      entries.push({ contract: c, name: r.customSymbol })
    }
    return fuzzyRankContracts(entries, pattern)
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    const symbol = resolveSymbol(query)
    if (!symbol) return null
    const details = new ContractDetails()
    details.contract = makeContract(symbol, query.exchange || DEFAULT_EXCHANGE)
    details.validExchanges = 'NSE,BSE'
    details.orderTypes = 'MKT,LMT'
    details.stockType = 'COMMON'
    return details
  }

  // ---- Trading operations ----

  async placeOrder(contract: Contract, order: Order, tpsl?: TpSlParams): Promise<PlaceOrderResult> {
    const inst = this.lookupInstrument(contract)
    if (!inst) return { success: false, error: `Cannot resolve ${contract.symbol} to an INDstocks security_id (catalog miss).` }

    const orderType = ibkrOrderTypeToInd(order.orderType)
    const qty = order.totalQuantity.equals(UNSET_DECIMAL) ? 0 : Number(order.totalQuantity.toFixed(0))
    if (qty <= 0) return { success: false, error: 'INDstocks requires a positive integer share quantity.' }
    const exchange = inst.exch || DEFAULT_EXCHANGE

    const base: IndPlaceOrderBody = {
      txn_type: order.action.toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
      exchange,
      segment: 'EQUITY',
      product: DEFAULT_PRODUCT,
      order_type: orderType,
      validity: ibkrTifToInd(order.tif),
      security_id: inst.securityId,
      qty,
      algo_id: algoIdFor(exchange),
    }
    if (orderType === 'LIMIT' && !order.lmtPrice.equals(UNSET_DECIMAL)) {
      base.limit_price = Number(order.lmtPrice.toFixed())
    }

    // Attached TP/SL → GTT smart order. The protective legs are created with
    // the entry and arm only after it fills; their ids ride back as `legs`.
    if (tpsl?.takeProfit || tpsl?.stopLoss) {
      return this.placeSmartOrder(base, tpsl)
    }

    try {
      const res = await this.client.placeOrder(base)
      const d = res.data
      if (!d?.order_id) {
        // Live finding: a SELL of holdings on an account without DDPI (CDSL
        // eDIS) active comes back as a generic InternalServerException with no
        // order_id. Add a hint so the failure is actionable, not mysterious.
        const msg = res.message ?? 'INDstocks returned no order_id.'
        const hint = base.txn_type === 'SELL' && /internal server|exception/i.test(msg)
          ? ' (selling holdings via API requires DDPI/eDIS active in your INDmoney account)'
          : ''
        return { success: false, error: msg + hint }
      }
      return { success: true, orderId: d.order_id, orderState: makeOrderState(d.order_status ?? 'PENDING') }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Entry + GTT SL/TP legs in one POST /smart/order (OCO when both present). */
  private async placeSmartOrder(base: IndPlaceOrderBody, tpsl: TpSlParams): Promise<PlaceOrderResult> {
    const body: IndSmartOrderBody = { ...base }
    if (tpsl.stopLoss) {
      body.sl_trigger_price = Number(tpsl.stopLoss.price)
      body.sl_limit_price = Number(tpsl.stopLoss.limitPrice ?? tpsl.stopLoss.price)
    }
    if (tpsl.takeProfit) {
      body.tgt_trigger_price = Number(tpsl.takeProfit.price)
      body.tgt_limit_price = Number(tpsl.takeProfit.price)
    }
    try {
      const res = await this.client.placeSmartOrder(body)
      const rows = res.data?.order_data ?? []
      if (!rows.length || !rows[0]?.order_id) {
        return { success: false, error: res.message ?? 'INDstocks smart order returned no order_id.' }
      }
      const parent = rows[0]
      // Surface GTT child legs so the ledger tracks them from birth. Exact
      // SL-vs-TP attribution isn't in the documented single-child response —
      // default a lone child to the stop-loss (the protective leg).
      // TODO: refine once the live OCO response shape is confirmed.
      const legs: PlaceOrderLeg[] = []
      for (const r of rows) {
        const child = r.child_order_details
        if (child?.order_id) {
          legs.push({ orderId: child.order_id, kind: tpsl.stopLoss ? 'stopLoss' : 'takeProfit' })
        }
      }
      return {
        success: true,
        orderId: parent.order_id,
        orderState: makeOrderState(parent.order_status ?? 'CREATED'),
        ...(legs.length ? { legs } : {}),
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * Opt-in push stream of order fills over the order-updates WebSocket. NOT
   * part of the (poll-based) IBroker contract — the caller owns start/stop.
   * TODO: wire into the UTA order-sync poller to cut pending-lane latency.
   */
  streamOrderUpdates(handlers: IndstocksOrderStreamHandlers): IndstocksOrderStream {
    const stream = new IndstocksOrderStream(this.config.accessToken, handlers)
    stream.start()
    return stream
  }

  async modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult> {
    const patch: Record<string, unknown> = { order_id: orderId }
    if (changes.totalQuantity != null && !changes.totalQuantity.equals(UNSET_DECIMAL)) patch.qty = Number(changes.totalQuantity.toFixed(0))
    if (changes.lmtPrice != null && !changes.lmtPrice.equals(UNSET_DECIMAL)) patch.limit_price = Number(changes.lmtPrice.toFixed())
    if (changes.tif) patch.validity = ibkrTifToInd(changes.tif)
    try {
      const res = await this.client.modifyOrder(patch)
      return { success: true, orderId: res.data?.order_id ?? orderId, orderState: makeOrderState(res.data?.order_status ?? 'MODIFIED') }
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
    if (!symbol) return { success: false, error: 'Cannot resolve contract to INDstocks symbol.' }
    const positions = await this.getPositions()
    const pos = positions.find(p => p.contract.symbol === symbol)
    if (!pos) return { success: false, error: `No open position for ${symbol}.` }

    const order = new Order()
    order.action = pos.side === 'long' ? 'SELL' : 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = quantity ?? pos.quantity.abs()
    order.tif = 'DAY'
    return this.placeOrder(contract, order)
  }

  // ---- Queries ----

  async getAccount(): Promise<AccountInfo> {
    try {
      const [funds, positions] = await Promise.all([this.client.getFunds(), this.getPositions()])
      const d = funds.data ?? {}
      const cash = dec(d.withdrawal_balance ?? d.sod_balance)
      const posMV = positions.reduce((s, p) => s.plus(dec(p.marketValue)), new Decimal(0))
      const unrealizedPnL = d.unrealized_pnl != null
        ? dec(d.unrealized_pnl)
        : positions.reduce((s, p) => s.plus(dec(p.unrealizedPnL)), new Decimal(0))
      const buyingPower = d.detailed_avl_balance?.eq_cnc
      return {
        baseCurrency: 'INR',
        netLiquidation: cash.plus(posMV).toString(),
        totalCashValue: cash.toString(),
        unrealizedPnL: unrealizedPnL.toString(),
        ...(d.realized_pnl != null ? { realizedPnL: dec(d.realized_pnl).toString() } : {}),
        ...(buyingPower != null ? { buyingPower: dec(buyingPower).toString() } : {}),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      const [holdings, positions] = await Promise.all([
        this.client.getHoldings().then(r => r.data ?? []).catch(() => []),
        this.client.getPositions('equity').then(r => r.data ?? []).catch(() => []),
      ])
      const out: Position[] = []

      // Holdings carry no market price — batch-fetch LTP (security_id is the
      // NSE id) and fold it in so marketValue / PnL are live, not flat at cost.
      const heldCodes = holdings.filter(h => h.security_id).map(h => scripCode(DEFAULT_EXCHANGE, h.security_id))
      const ltp: Record<string, IndstocksLtpRaw> = heldCodes.length
        ? await this.client.getLtp(heldCodes).then(r => r.data ?? {}).catch(() => ({}))
        : {}

      // Delivery holdings — always long.
      for (const h of holdings) {
        const symbol = (h.symbol ?? '').toUpperCase()
        if (!symbol) continue
        const code = scripCode(DEFAULT_EXCHANGE, h.security_id)
        const live = ltp[code]?.live_price
        const marketPrice = live != null ? dec(live) : dec(h.avg_price)
        out.push(buildPosition({
          contract: makeContract(symbol, DEFAULT_EXCHANGE),
          currency: 'INR',
          side: 'long',
          quantity: dec(h.total_qty),
          avgCost: dec(h.avg_price).toString(),
          marketPrice: marketPrice.toString(),
          realizedPnL: '0',
          multiplier: '1',
        }))
      }

      // Intraday / open positions — sign of net_quantity gives side.
      for (const p of positions) {
        const symbol = (p.trading_symbol ?? '').toUpperCase()
        if (!symbol) continue
        const qty = dec(p.net_quantity)
        if (qty.isZero()) continue
        out.push(buildPosition({
          contract: makeContract(symbol, p.exchange || DEFAULT_EXCHANGE),
          currency: 'INR',
          side: qty.isNegative() ? 'short' : 'long',
          quantity: qty.abs(),
          avgCost: dec(p.average_price).toString(),
          marketPrice: dec(p.last_traded_price).toString(),
          realizedPnL: '0',
          // TODO: F&O multiplier from instrument LOT_UNITS once F&O is in scope.
          multiplier: dec(p.multiplier, '1').toString(),
          ...(p.market_value != null ? { marketValue: dec(p.market_value).abs().toString() } : {}),
          ...(p.pnl_absolute != null ? { unrealizedPnL: dec(p.pnl_absolute).toString() } : {}),
        }))
      }
      return out
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    const out: OpenOrder[] = []
    for (const id of orderIds) {
      const o = await this.getOrder(id)
      if (o) out.push(o)
    }
    return out
  }

  async getOrder(orderId: string): Promise<OpenOrder | null> {
    try {
      const res = await this.client.getOrder(orderId)
      return res.data ? this.mapOpenOrder(res.data) : null
    } catch {
      return null
    }
  }

  async getOpenOrders(): Promise<OpenOrder[]> {
    try {
      const res = await this.client.getOrderBook()
      const working = new Set(['Submitted'])
      return (res.data ?? [])
        .map(o => this.mapOpenOrder(o))
        .filter(o => working.has(o.orderState.status))
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getQuote(contract: Contract): Promise<Quote> {
    const inst = this.lookupInstrument(contract)
    if (!inst) throw new BrokerError('EXCHANGE', `Cannot resolve ${contract.symbol} to an INDstocks scrip-code.`)
    try {
      const code = scripCode(inst.exch || DEFAULT_EXCHANGE, inst.securityId)
      const res = await this.client.getQuotes([code])
      const q = res.data?.[code]
      if (!q) throw new BrokerError('EXCHANGE', `No quote returned for ${code}.`)
      const last = dec(q.live_price)
      // bid/ask live in market_depth[code].depth[0] as comma-strings; fall back
      // to last when depth is empty (illiquid / one-sided book).
      const top = q.market_depth?.[code]?.depth?.[0]
      const bid = top?.buy?.price ? decLoose(top.buy.price) : last
      const ask = top?.sell?.price ? decLoose(top.sell.price) : last
      return {
        contract: makeContract(inst.tradingSymbol, inst.exch || DEFAULT_EXCHANGE),
        last: last.toString(),
        bid: (bid.isZero() ? last : bid).toString(),
        ask: (ask.isZero() ? last : ask).toString(),
        volume: dec(q.volume).toString(),
        ...(q.day_high != null ? { high: dec(q.day_high).toString() } : {}),
        ...(q.day_low != null ? { low: dec(q.day_low).toString() } : {}),
        timestamp: new Date(),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getHistorical(contract: Contract, params: BarParams): Promise<Bar[]> {
    const inst = this.lookupInstrument(contract)
    if (!inst) throw new BrokerError('EXCHANGE', `Cannot resolve ${contract.symbol} to an INDstocks scrip-code.`)
    const interval = IND_INTERVAL[params.interval]
    const end = params.end ?? new Date()
    // INDstocks caps the range per interval (1d / 7d / 14d / 1y). Default to a
    // 7-day lookback when no start is given. TODO: enforce the per-interval cap.
    const start = params.start ?? new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
    try {
      const code = scripCode(inst.exch || DEFAULT_EXCHANGE, inst.securityId)
      const res = await this.client.getHistorical(interval, code, start.getTime(), end.getTime())
      const candles = res.data ?? []
      const bars = candles.map(([ts, o, h, l, c, v]): Bar => ({
        timestamp: new Date(ts),
        open: String(o), high: String(h), low: String(l), close: String(c), volume: String(v),
      }))
      return params.limit ? bars.slice(-params.limit) : bars
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  // ---- Capabilities ----

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['STK'],              // TODO: add FUT/OPT for F&O.
      supportedOrderTypes: ['MKT', 'LMT'],     // no native STP (GTT only).
      historicalBars: {
        supported: true,
        quality: 'realtime',
        supportedBarSizes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
      },
    }
  }

  assetClassFor(): 'equity' {
    return 'equity'
  }

  async getMarketClock(): Promise<MarketClock> {
    // Hardcoded NSE/BSE regular session, IST (UTC+5:30), Mon–Fri.
    // TODO: honour the NSE holiday calendar + special muhurat sessions.
    const now = new Date()
    const ist = now.getTime() + IST_OFFSET_MS
    const dayMs = 24 * 60 * 60 * 1000
    const istMidnight = Math.floor(ist / dayMs) * dayMs
    const minsOfDay = Math.floor((ist - istMidnight) / 60000)
    const dow = new Date(istMidnight).getUTCDay()   // 0=Sun..6=Sat in IST terms
    const isWeekday = dow >= 1 && dow <= 5
    const isOpen = isWeekday && minsOfDay >= NSE_OPEN_MIN && minsOfDay < NSE_CLOSE_MIN

    const openUtc = (offsetDays: number) => new Date(istMidnight + offsetDays * dayMs + NSE_OPEN_MIN * 60000 - IST_OFFSET_MS)
    const closeUtc = new Date(istMidnight + NSE_CLOSE_MIN * 60000 - IST_OFFSET_MS)

    let nextOpen: Date | undefined
    if (!isOpen) {
      // Walk forward to the next weekday's open (skips Sat/Sun; NOT holidays).
      let d = minsOfDay < NSE_OPEN_MIN && isWeekday ? 0 : 1
      for (let i = 0; i < 7; i++) {
        const cand = (dow + d) % 7
        if (cand >= 1 && cand <= 5) break
        d++
      }
      nextOpen = openUtc(d)
    }
    return {
      isOpen,
      ...(isOpen ? { nextClose: closeUtc } : {}),
      ...(nextOpen ? { nextOpen } : {}),
      timestamp: now,
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

  private lookupInstrument(contract: Contract): IndstocksInstrument | null {
    const symbol = resolveSymbol(contract)
    if (!symbol || this.catalog == null) return null
    const exch = (contract.exchange || DEFAULT_EXCHANGE).toUpperCase()
    return this.catalog.get(`${exch}:${symbol}`)
      ?? this.catalog.get(`${DEFAULT_EXCHANGE}:${symbol}`)
      ?? null
  }

  private mapOpenOrder(o: IndstocksOrderRaw): OpenOrder {
    const symbol = (o.trading_symbol ?? o.security_id ?? '').toUpperCase()
    const contract = makeContract(symbol, o.exchange || DEFAULT_EXCHANGE)

    const order = new Order()
    order.action = o.txn_type?.toUpperCase() === 'SELL' ? 'SELL' : 'BUY'
    order.totalQuantity = dec(o.qty)
    order.orderType = (o.order_type ?? 'MARKET').toUpperCase() === 'MARKET' ? 'MKT' : 'LMT'
    if (o.limit_price != null) order.lmtPrice = dec(o.limit_price)
    if (o.validity) order.tif = o.validity.toUpperCase()
    if (o.filled_qty != null) order.filledQuantity = dec(o.filled_qty)
    order.orderId = 0   // INDstocks ids are strings; real id rides on OpenOrder.orderId

    return {
      contract,
      order,
      orderState: makeOrderState(o.order_status, o.reject_reason ?? undefined),
      orderId: o.order_id,
      ...(o.average_price != null ? { avgFillPrice: dec(o.average_price).toString() } : {}),
    }
  }
}
