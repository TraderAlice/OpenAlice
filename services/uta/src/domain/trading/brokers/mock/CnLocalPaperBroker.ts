/**
 * CnLocalPaperBroker — local A-share paper for OpenAlice closed-loop dry runs.
 *
 * Wraps MockBroker (builtin mock engine): Tencent L1 marks + L1/L2 A-share
 * guards. Explicitly NOT a market-side virtual exchange.
 */

import { z } from 'zod'
import Decimal from 'decimal.js'
import { Contract, ContractDescription, ContractDetails, Order, UNSET_DECIMAL } from '@traderalice/ibkr'
import type {
  IBroker,
  AccountCapabilities,
  AccountInfo,
  Position,
  PlaceOrderResult,
  OpenOrder,
  Quote,
  MarketClock,
  TpSlParams,
  Bar,
  BarParams,
} from '../types.js'
import { BrokerError } from '../types.js'
import { MockBroker } from './MockBroker.js'
import {
  fetchCnQuote,
  fetchTencentQuotes,
  parseCnSymbol,
  toTencentCode,
  type CnMarket,
  type CnQuoteFetcher,
  type CnQuoteSnapshot,
} from './cn-quote.js'
import {
  assertLimitBand,
  assertOrderQty,
  cnTradingDayKey,
  commissionOnNotional,
  isCnAshareSessionOpen,
  limitBandFromPrevClose,
  stampTaxOnSell,
} from './cn-rules.js'

export const cnLocalPaperConfigSchema = z.object({
  variant: z.literal('cn-local-paper'),
  cash: z.coerce.number().default(1_000_000),
  quoteProvider: z.enum(['tencent', 'manual']).default('tencent'),
  enforceSession: z.boolean().default(true),
  enforceLotSize: z.boolean().default(true),
  enforceTPlus1: z.boolean().default(true),
  enforceLimitBand: z.boolean().default(true),
})

export type CnLocalPaperConfig = z.infer<typeof cnLocalPaperConfigSchema>

interface BoughtToday {
  day: string
  qty: Decimal
}

export class CnLocalPaperBroker implements IBroker {
  static configSchema = cnLocalPaperConfigSchema

  static fromConfig(config: {
    id: string
    label?: string
    brokerConfig: Record<string, unknown>
  }): CnLocalPaperBroker {
    const bc = cnLocalPaperConfigSchema.parse(config.brokerConfig)
    return new CnLocalPaperBroker({
      id: config.id,
      label: config.label,
      ...bc,
    })
  }

  readonly brokerEngine = 'mock' as const
  readonly id: string
  readonly label: string

  private readonly inner: MockBroker
  private readonly opts: CnLocalPaperConfig
  private readonly quoteFetcher: CnQuoteFetcher
  private readonly quoteCache = new Map<string, CnQuoteSnapshot>()
  /** Shares bought on the current Shanghai trading day — blocks same-day sell. */
  private readonly boughtToday = new Map<string, BoughtToday>()
  /** BUY LMT reservations: orderId → notional + estimated commission (CNY). */
  private readonly frozenByOrder = new Map<string, Decimal>()
  private pollTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    options: Partial<CnLocalPaperConfig> & {
      id?: string
      label?: string
      quoteFetcher?: CnQuoteFetcher
    } = {},
  ) {
    const parsed = cnLocalPaperConfigSchema.parse({
      variant: 'cn-local-paper',
      cash: options.cash ?? 1_000_000,
      quoteProvider: options.quoteProvider ?? 'tencent',
      enforceSession: options.enforceSession ?? true,
      enforceLotSize: options.enforceLotSize ?? true,
      enforceTPlus1: options.enforceTPlus1 ?? true,
      enforceLimitBand: options.enforceLimitBand ?? true,
    })
    this.opts = parsed
    this.id = options.id ?? 'cn-local-paper'
    this.label = options.label ?? 'CN Local Paper'
    this.inner = new MockBroker({
      id: this.id,
      label: this.label,
      cash: parsed.cash,
    })
    this.quoteFetcher = options.quoteFetcher ?? fetchTencentQuotes
  }

  // ---- Lifecycle ----

  async init(): Promise<void> {
    await this.inner.init()
    if (this.opts.quoteProvider === 'tencent') {
      this.pollTimer = setInterval(() => {
        void this.refreshWatchedMarks().catch(() => {})
      }, 3_000)
      if (typeof this.pollTimer === 'object' && this.pollTimer && 'unref' in this.pollTimer) {
        ;(this.pollTimer as NodeJS.Timeout).unref?.()
      }
    }
  }

  async close(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    await this.inner.close()
  }

  // ---- Contracts ----

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    const parsed = parseCnSymbol(pattern)
    if (!parsed.ok) return []

    let snap: CnQuoteSnapshot | null = null
    if (this.opts.quoteProvider === 'tencent') {
      snap = await fetchCnQuote(parsed.ref.canonical, this.quoteFetcher).catch(() => null)
      // Tencent mode: no quote ⇒ not tradeable here (avoid inventing a dead contract).
      if (!snap) return []
    } else {
      snap = this.quoteCache.get(parsed.ref.bare) ?? null
      if (!snap) return []
    }

    const c = this.buildCnContract(snap.code, snap)
    const desc = new ContractDescription()
    desc.contract = c
    return [desc]
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    const symbol = query.symbol || query.localSymbol || ''
    const parsed = parseCnSymbol(symbol)
    if (!parsed.ok) return null
    const snap = this.opts.quoteProvider === 'manual'
      ? this.quoteCache.get(parsed.ref.bare) ?? null
      : await this.ensureQuote(query)
    if (!snap) return null
    const c = this.buildCnContract(snap.code, snap)
    const details = new ContractDetails()
    details.contract = c
    details.longName = snap.name
    return details
  }

  // ---- Trading ----

  async placeOrder(contract: Contract, order: Order, tpsl?: TpSlParams): Promise<PlaceOrderResult> {
    const symbol = contract.symbol || contract.localSymbol || ''
    const parsed = parseCnSymbol(symbol)
    if (!parsed.ok) {
      return { success: false, error: `UNKNOWN_SYMBOL: ${parsed.message}` }
    }

    const cnContract = this.normalizeContract(contract)
    const side = order.action.toUpperCase()
    const qty = !order.totalQuantity.equals(UNSET_DECIMAL) ? order.totalQuantity : new Decimal(0)

    if (this.opts.enforceSession && !isCnAshareSessionOpen() && this.opts.quoteProvider !== 'manual') {
      throw new BrokerError('MARKET_CLOSED', 'CN A-share session closed (local paper)')
    }

    if (this.opts.enforceLotSize) {
      const lotErr = assertOrderQty(side, qty)
      if (lotErr) return { success: false, error: lotErr }
    }

    const snap = await this.ensureQuote(cnContract)
    if (!snap && this.opts.quoteProvider === 'tencent') {
      return {
        success: false,
        error: `NO_QUOTE: No Tencent quote for ${parsed.ref.canonical}`,
      }
    }
    if (snap) {
      const filledIds = this.inner.setMarkPrice(this.inner.getNativeKey(cnContract), snap.last)
      await this.settleFilledOrders(filledIds, new Decimal(snap.last))
    }

    const px = order.orderType === 'MKT'
      ? new Decimal(snap?.last ?? this.inner.getMarkPrice(this.inner.getNativeKey(cnContract))?.toNumber() ?? 0)
      : (!order.lmtPrice.equals(UNSET_DECIMAL)
        ? order.lmtPrice
        : new Decimal(snap?.last ?? 0))

    if (this.opts.enforceLimitBand && snap) {
      const bandErr = assertLimitBand(side, px, snap)
      if (bandErr) return { success: false, error: bandErr }
    }

    if (this.opts.enforceTPlus1 && side === 'SELL') {
      const t1 = await this.tPlus1Error(cnContract, qty)
      if (t1) return { success: false, error: t1 }
    }

    const notional = qty.mul(px)
    const estCommission = commissionOnNotional(notional)
    if (side === 'BUY') {
      const need = notional.plus(estCommission)
      const available = await this.availableCash()
      if (available.lt(need)) {
        return {
          success: false,
          error: `INSUFFICIENT_CASH: need ${need.toFixed(2)} (notional ${notional.toFixed(2)} + commission ${estCommission.toFixed(2)}), available ${available.toFixed(2)}`,
        }
      }
    }

    const result = await this.inner.placeOrder(cnContract, order, tpsl)
    if (!result.success) return result

    const filledNow = order.orderType === 'MKT' || result.orderState?.status === 'Filled'
    if (!filledNow && side === 'BUY' && order.orderType === 'LMT' && result.orderId) {
      this.frozenByOrder.set(result.orderId, notional.plus(estCommission))
    }

    if (filledNow) {
      this.applyFillFees(side, qty, px)
      if (side === 'BUY') this.recordBuy(cnContract, qty)
    }

    return result
  }

  async modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult> {
    const open = await this.inner.getOrder(orderId)
    if (!open || open.orderState.status !== 'Submitted') {
      return this.inner.modifyOrder(orderId, changes)
    }

    const side = (changes.action ?? open.order.action).toUpperCase()
    const orderType = changes.orderType ?? open.order.orderType
    const prevFreeze = this.frozenByOrder.get(orderId) ?? new Decimal(0)

    if (side === 'BUY' && orderType === 'LMT') {
      const qty = changes.totalQuantity && !changes.totalQuantity.equals(UNSET_DECIMAL)
        ? changes.totalQuantity
        : open.order.totalQuantity
      const px = changes.lmtPrice && !changes.lmtPrice.equals(UNSET_DECIMAL)
        ? changes.lmtPrice
        : (!open.order.lmtPrice.equals(UNSET_DECIMAL) ? open.order.lmtPrice : new Decimal(0))
      const need = qty.mul(px).plus(commissionOnNotional(qty.mul(px)))
      const available = (await this.availableCash()).plus(prevFreeze)
      if (available.lt(need)) {
        return {
          success: false,
          error: `INSUFFICIENT_CASH: modified LMT needs ${need.toFixed(2)}, available ${available.toFixed(2)}`,
        }
      }
      const result = await this.inner.modifyOrder(orderId, changes)
      if (result.success) this.frozenByOrder.set(orderId, need)
      return result
    }

    const result = await this.inner.modifyOrder(orderId, changes)
    if (result.success) this.frozenByOrder.delete(orderId)
    return result
  }

  async cancelOrder(orderId: string): Promise<PlaceOrderResult> {
    const result = await this.inner.cancelOrder(orderId)
    if (result.success) this.frozenByOrder.delete(orderId)
    return result
  }

  async closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult> {
    const cn = this.normalizeContract(contract)
    const order = new Order()
    order.action = 'SELL'
    order.orderType = 'MKT'
    if (quantity && !quantity.equals(UNSET_DECIMAL)) {
      order.totalQuantity = quantity
    } else {
      const positions = await this.inner.getPositions()
      const key = this.inner.getNativeKey(cn)
      const pos = positions.find((p) => this.inner.getNativeKey(p.contract) === key)
      if (!pos) return { success: false, error: `No open position for ${key}` }
      order.totalQuantity = pos.quantity
    }
    return this.placeOrder(cn, order)
  }

  // ---- Queries ----

  async getAccount(_subAccountId?: string): Promise<AccountInfo> {
    const info = await this.inner.getAccount()
    const available = await this.availableCash()
    return {
      ...info,
      baseCurrency: 'CNY',
      // Ledger cash stays in totalCashValue; buyingPower is cash minus LMT BUY freezes.
      buyingPower: available.toString(),
    }
  }

  async getPositions(_subAccountId?: string): Promise<Position[]> {
    const positions = await this.inner.getPositions()
    return positions.map((p) => ({
      ...p,
      currency: 'CNY',
      contract: this.normalizeContract(p.contract),
    }))
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    return this.inner.getOrders(orderIds)
  }

  async getOrder(orderId: string, symbolHint?: string): Promise<OpenOrder | null> {
    return this.inner.getOrder(orderId, symbolHint)
  }

  async getOpenOrders(): Promise<OpenOrder[]> {
    return this.inner.getOpenOrders()
  }

  async getQuote(contract: Contract): Promise<Quote> {
    const cn = this.normalizeContract(contract)
    const snap = await this.ensureQuote(cn)
    if (snap) {
      this.inner.setMarkPrice(this.inner.getNativeKey(cn), snap.last)
      return {
        contract: cn,
        last: String(snap.last),
        bid: String(snap.bid),
        ask: String(snap.ask),
        volume: String(snap.volume),
        timestamp: snap.timestamp,
      }
    }
    const fallback = await this.inner.getQuote(cn)
    return { ...fallback, contract: cn }
  }

  async getHistorical(contract: Contract, params: BarParams): Promise<Bar[]> {
    return this.inner.getHistorical(this.normalizeContract(contract), params)
  }

  async getMarketClock(): Promise<MarketClock> {
    return { isOpen: isCnAshareSessionOpen() }
  }

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['STK'],
      supportedOrderTypes: ['MKT', 'LMT'],
      historicalBars: { supported: true, quality: 'delayed' },
    }
  }

  getNativeKey(contract: Contract): string {
    return this.inner.getNativeKey(this.normalizeContract(contract))
  }

  resolveNativeKey(nativeKey: string): Contract {
    return this.normalizeContract(this.inner.resolveNativeKey(nativeKey))
  }

  /** Test / manual mark injection when quoteProvider=manual. */
  setMarkPrice(
    nativeKey: string,
    price: Decimal | string | number,
    quote?: Partial<CnQuoteSnapshot>,
  ): string[] {
    const parsed = parseCnSymbol(nativeKey)
    const bare = parsed.ok
      ? parsed.ref.bare
      : nativeKey.replace(/^(sh|sz|bj)/i, '').replace(/\.(ss|sh|sz|bj)$/i, '')
    const market: CnMarket = parsed.ok
      ? parsed.ref.market
      : (quote?.market ?? 'sh')
    const n = price instanceof Decimal ? price.toNumber() : Number(price)
    const prev = quote?.prevClose ?? n
    const tencentCode = parsed.ok ? parsed.ref.tencentCode : (toTencentCode(nativeKey) ?? `sh${bare}`)
    const band = limitBandFromPrevClose(prev, bare)
    const snap: CnQuoteSnapshot = {
      code: bare,
      market,
      tencentCode,
      name: quote?.name ?? bare,
      last: n,
      prevClose: prev,
      open: quote?.open ?? n,
      bid: quote?.bid ?? n,
      ask: quote?.ask ?? n,
      volume: quote?.volume ?? 0,
      limitUp: quote?.limitUp ?? band.limitUp,
      limitDown: quote?.limitDown ?? band.limitDown,
      timestamp: new Date(),
    }
    this.quoteCache.set(bare, snap)
    this.quoteCache.set(snap.tencentCode, snap)
    return this.inner.setMarkPrice(bare, price)
  }

  // ---- internals ----

  private nativeBare(contract: Contract): string {
    const symbol = contract.symbol || contract.localSymbol || ''
    const parsed = parseCnSymbol(symbol)
    if (parsed.ok) return parsed.ref.bare
    return symbol.replace(/^(sh|sz|bj)/i, '').replace(/\.(ss|sh|sz|bj)$/i, '')
  }

  private buildCnContract(code: string, snap: CnQuoteSnapshot | null): Contract {
    const parsed = parseCnSymbol(code)
    const bare = parsed.ok ? parsed.ref.bare : code.replace(/^(sh|sz|bj)/i, '')
    const market: CnMarket = snap?.market
      ?? (parsed.ok ? parsed.ref.market : 'sh')
    const c = new Contract()
    c.symbol = bare
    c.localSymbol = bare
    c.secType = 'STK'
    c.exchange = 'CNLOCAL'
    c.primaryExchange = market.toUpperCase()
    c.currency = 'CNY'
    c.aliceId = `${this.id}|${bare}`
    return c
  }

  private normalizeContract(contract: Contract): Contract {
    const bare = this.nativeBare(contract)
    if (!/^\d{6}$/.test(bare)) return contract
    const snap = this.quoteCache.get(bare) ?? null
    const c = this.buildCnContract(bare, snap)
    if (contract.aliceId) c.aliceId = contract.aliceId
    return c
  }

  private async ensureQuote(contract: Contract): Promise<CnQuoteSnapshot | null> {
    const key = this.nativeBare(this.normalizeContract(contract))
    const cached = this.quoteCache.get(key)
    if (cached && Date.now() - cached.timestamp.getTime() < 2_500) return cached

    if (this.opts.quoteProvider === 'manual') {
      return cached ?? null
    }

    const snap = await fetchCnQuote(key, this.quoteFetcher)
    if (snap) {
      this.quoteCache.set(snap.code, snap)
      this.quoteCache.set(snap.tencentCode, snap)
      this.inner.setMarkPrice(snap.code, snap.last)
    }
    return snap
  }

  private async refreshWatchedMarks(): Promise<void> {
    const positions = await this.inner.getPositions()
    const open = await this.inner.getOpenOrders()
    const keys = new Set<string>()
    for (const p of positions) keys.add(this.inner.getNativeKey(p.contract))
    for (const o of open) keys.add(this.inner.getNativeKey(o.contract))
    if (!keys.size) return

    const codes = [...keys].map((k) => toTencentCode(k)).filter((c): c is string => !!c)
    if (!codes.length) return
    const rows = await this.quoteFetcher(codes)
    for (const row of rows) {
      this.quoteCache.set(row.code, row)
      this.quoteCache.set(row.tencentCode, row)
      const filledIds = this.inner.setMarkPrice(row.code, row.last)
      await this.settleFilledOrders(filledIds, new Decimal(row.last))
    }
  }

  private async settleFilledOrders(filledIds: string[], fillPxHint: Decimal): Promise<void> {
    for (const id of filledIds) {
      this.frozenByOrder.delete(id)
      const filled = await this.inner.getOrder(id)
      if (!filled) continue
      // Fully filled orders drop out of Submitted; partials may remain open.
      const side = filled.order.action.toUpperCase()
      const qty = filled.order.filledQuantity && !filled.order.filledQuantity.equals(UNSET_DECIMAL)
        ? filled.order.filledQuantity
        : filled.order.totalQuantity
      const fillPx = filled.avgFillPrice
        ? new Decimal(filled.avgFillPrice)
        : fillPxHint
      this.applyFillFees(side, qty, fillPx)
      if (side === 'BUY') this.recordBuy(filled.contract, qty)
    }
  }

  private frozenTotal(): Decimal {
    let sum = new Decimal(0)
    for (const v of this.frozenByOrder.values()) sum = sum.plus(v)
    return sum
  }

  private async availableCash(): Promise<Decimal> {
    const info = await this.inner.getAccount()
    return new Decimal(info.totalCashValue).minus(this.frozenTotal())
  }

  private applyFillFees(side: string, qty: Decimal, fillPx: Decimal): void {
    const notional = qty.mul(fillPx)
    const commission = commissionOnNotional(notional)
    if (commission.gt(0)) this.inner.adjustCash(commission.neg())
    if (side === 'SELL') {
      const tax = stampTaxOnSell(notional)
      if (tax.gt(0)) this.inner.adjustCash(tax.neg())
    }
  }

  private recordBuy(contract: Contract, qty: Decimal): void {
    const key = this.inner.getNativeKey(this.normalizeContract(contract))
    const day = cnTradingDayKey()
    const prev = this.boughtToday.get(key)
    if (prev && prev.day === day) {
      prev.qty = prev.qty.plus(qty)
    } else {
      this.boughtToday.set(key, { day, qty })
    }
  }

  private async tPlus1Error(contract: Contract, sellQty: Decimal): Promise<string | null> {
    const key = this.inner.getNativeKey(this.normalizeContract(contract))
    const day = cnTradingDayKey()
    const bought = this.boughtToday.get(key)
    const locked = bought && bought.day === day ? bought.qty : new Decimal(0)
    const positions = await this.inner.getPositions()
    const pos = positions.find((p) => this.inner.getNativeKey(p.contract) === key)
    const held = pos?.quantity ?? new Decimal(0)
    const available = Decimal.max(held.minus(locked), 0)
    if (sellQty.gt(available)) {
      return `T+1: can sell ${available.toString()} today (${held.toString()} held, ${locked.toString()} bought today)`
    }
    return null
  }
}
