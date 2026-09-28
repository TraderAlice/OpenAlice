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
import {
  CN_PAPER_BOOK_VERSION,
  type CnPaperBookState,
} from './cn-paper-book.js'

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
  private bookPersister: ((state: CnPaperBookState) => void | Promise<void>) | null = null
  private persistChain: Promise<void> = Promise.resolve()

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

    this.schedulePersist()
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
      if (result.success) {
        this.frozenByOrder.set(orderId, need)
        this.schedulePersist()
      }
      return result
    }

    const result = await this.inner.modifyOrder(orderId, changes)
    if (result.success) {
      this.frozenByOrder.delete(orderId)
      this.schedulePersist()
    }
    return result
  }

  async cancelOrder(orderId: string): Promise<PlaceOrderResult> {
    const result = await this.inner.cancelOrder(orderId)
    if (result.success) {
      this.frozenByOrder.delete(orderId)
      this.schedulePersist()
    }
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
    if (filledIds.length > 0) this.schedulePersist()
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

  // ---- Book persistence + bookkeeping adjustment ----

  /** Register durable save callback (UTAManager wires cn-paper-book.json). */
  setBookPersister(persister: ((state: CnPaperBookState) => void | Promise<void>) | null): void {
    this.bookPersister = persister
  }

  /** Snapshot for disk / UI. Pending LMT freezes are not included (see cn-paper-book.ts). */
  exportBookState(): CnPaperBookState {
    const sim = this.inner.getSimulatorState()
    const day = cnTradingDayKey()
    return {
      version: CN_PAPER_BOOK_VERSION,
      cash: sim.cash,
      positions: sim.positions.map((p) => {
        const parsed = parseCnSymbol(p.nativeKey)
        return {
          nativeKey: p.nativeKey,
          quantity: p.quantity,
          avgCost: p.avgCost,
          ...(p.avgCostSource && { avgCostSource: p.avgCostSource }),
          ...(parsed.ok ? { market: parsed.ref.market } : {}),
        }
      }),
      boughtToday: [...this.boughtToday.entries()]
        .filter(([, v]) => v.day === day && v.qty.gt(0))
        .map(([nativeKey, v]) => ({
          nativeKey,
          day: v.day,
          qty: v.qty.toString(),
        })),
      markPrices: sim.markPrices.map((m) => ({ nativeKey: m.nativeKey, price: m.price })),
      updatedAt: new Date().toISOString(),
    }
  }

  /** Restore from disk. Missing file caller should skip — create-time cash stays. */
  importBookState(state: CnPaperBookState): void {
    this.inner.setCash(state.cash)
    this.boughtToday.clear()
    for (const row of state.boughtToday) {
      this.boughtToday.set(row.nativeKey, {
        day: row.day,
        qty: new Decimal(row.qty),
      })
    }

    for (const m of state.markPrices) {
      this.inner.setMarkPrice(m.nativeKey, m.price)
    }

    const positions: Position[] = state.positions.map((row) => {
      const qty = new Decimal(row.quantity)
      const avgCost = new Decimal(row.avgCost)
      const mark = this.inner.getMarkPrice(row.nativeKey) ?? avgCost
      const snap = this.quoteCache.get(row.nativeKey)
      const contract = this.buildCnContract(row.nativeKey, snap ?? {
        code: row.nativeKey,
        market: row.market ?? 'sh',
        tencentCode: toTencentCode(row.nativeKey) ?? `sh${row.nativeKey}`,
        name: row.name ?? row.nativeKey,
        last: mark.toNumber(),
        prevClose: mark.toNumber(),
        open: mark.toNumber(),
        bid: mark.toNumber(),
        ask: mark.toNumber(),
        volume: 0,
        limitUp: mark.toNumber(),
        limitDown: mark.toNumber(),
        timestamp: new Date(),
      })
      const marketPrice = mark.toString()
      const marketValue = qty.mul(mark).toString()
      return {
        contract,
        currency: 'CNY',
        side: 'long' as const,
        quantity: qty,
        avgCost: avgCost.toString(),
        marketPrice,
        marketValue,
        unrealizedPnL: qty.mul(mark.minus(avgCost)).toString(),
        realizedPnL: '0',
        multiplier: '1',
        avgCostSource: row.avgCostSource ?? 'broker',
      }
    })
    this.inner.setPositions(positions)
  }

  /**
   * Position book view with T+1 split. Used by the 调整账面 UI.
   */
  async getBookView(): Promise<{
    cash: string
    buyingPower: string
    positions: Array<{
      nativeKey: string
      quantity: string
      avgCost: string
      locked: string
      sellable: string
    }>
  }> {
    const account = await this.getAccount()
    const positions = await this.getPositions()
    const day = cnTradingDayKey()
    return {
      cash: account.totalCashValue,
      buyingPower: account.buyingPower ?? account.totalCashValue,
      positions: positions.map((p) => {
        const key = this.inner.getNativeKey(p.contract)
        const bought = this.boughtToday.get(key)
        const locked = bought && bought.day === day ? bought.qty : new Decimal(0)
        const sellable = Decimal.max(p.quantity.minus(locked), 0)
        return {
          nativeKey: key,
          quantity: p.quantity.toString(),
          avgCost: p.avgCost,
          locked: locked.toString(),
          sellable: sellable.toString(),
        }
      }),
    }
  }

  /** Cash ±/credit without an order. Reason is required by the UTA journal layer. */
  adjustBookCash(delta: Decimal | string | number): void {
    const d = delta instanceof Decimal ? delta : new Decimal(delta)
    if (d.isZero()) throw new Error('paperAdjustCash: delta must be non-zero')
    const next = new Decimal(this.inner.getSimulatorState().cash).plus(d)
    if (next.lt(0)) throw new Error(`paperAdjustCash: cash would go negative (${next.toString()})`)
    this.inner.adjustCash(d)
    this.schedulePersist()
  }

  /**
   * Position qty ± and optional avg-cost / locked (T+1) rewrite.
   * Does not route through the order pipeline.
   */
  adjustBookPosition(params: {
    nativeKey: string
    quantityDelta: Decimal | string | number
    avgCost?: Decimal | string | number
    lockedQty?: Decimal | string | number
  }): void {
    const parsed = parseCnSymbol(params.nativeKey)
    if (!parsed.ok) throw new Error(`paperAdjustPosition: ${parsed.message}`)
    const key = parsed.ref.bare
    const delta = params.quantityDelta instanceof Decimal
      ? params.quantityDelta
      : new Decimal(params.quantityDelta)

    const sim = this.inner.getSimulatorState()
    const existing = sim.positions.find((p) => p.nativeKey === key)
    const prevQty = existing ? new Decimal(existing.quantity) : new Decimal(0)
    const nextQty = prevQty.plus(delta)
    if (nextQty.lt(0)) {
      throw new Error(`paperAdjustPosition: quantity would go negative for ${key}`)
    }

    const openSells = sim.pendingOrders
      .filter((o) => o.nativeKey === key && o.action.toUpperCase() === 'SELL')
      .reduce((s, o) => s.plus(o.totalQuantity), new Decimal(0))
    if (nextQty.lt(openSells)) {
      throw new Error(
        `paperAdjustPosition: cannot reduce below open sell qty ${openSells.toString()} for ${key}`,
      )
    }

    let avgCost = params.avgCost != null
      ? (params.avgCost instanceof Decimal ? params.avgCost : new Decimal(params.avgCost))
      : (existing ? new Decimal(existing.avgCost) : (this.inner.getMarkPrice(key) ?? new Decimal(0)))

    if (delta.gt(0) && params.avgCost == null && existing) {
      // Weighted average when adding without an explicit cost.
      const mark = this.inner.getMarkPrice(key) ?? avgCost
      avgCost = prevQty.mul(avgCost).plus(delta.mul(mark)).div(nextQty)
    }

    if (nextQty.isZero()) {
      this.inner.setPositions(
        (awaitablePositionsFromSim(sim, key, this)).filter((p) => this.inner.getNativeKey(p.contract) !== key),
      )
      this.boughtToday.delete(key)
    } else {
      const mark = this.inner.getMarkPrice(key) ?? avgCost
      const snap = this.quoteCache.get(key)
      const contract = this.buildCnContract(key, snap ?? null)
      const others = awaitablePositionsFromSim(sim, key, this)
        .filter((p) => this.inner.getNativeKey(p.contract) !== key)
      others.push({
        contract,
        currency: 'CNY',
        side: 'long',
        quantity: nextQty,
        avgCost: avgCost.toString(),
        marketPrice: mark.toString(),
        marketValue: nextQty.mul(mark).toString(),
        unrealizedPnL: nextQty.mul(mark.minus(avgCost)).toString(),
        realizedPnL: '0',
        multiplier: '1',
        avgCostSource: 'broker',
      })
      this.inner.setPositions(others)

      if (params.lockedQty != null) {
        const locked = params.lockedQty instanceof Decimal
          ? params.lockedQty
          : new Decimal(params.lockedQty)
        if (locked.lt(0) || locked.gt(nextQty)) {
          throw new Error(`paperAdjustPosition: lockedQty must be in [0, ${nextQty.toString()}]`)
        }
        if (locked.isZero()) this.boughtToday.delete(key)
        else this.boughtToday.set(key, { day: cnTradingDayKey(), qty: locked })
      } else if (delta.gt(0)) {
        // New shares default to locked today (conservative T+1).
        this.recordBuy(contract, delta)
      } else if (delta.lt(0)) {
        // Reduce lock first when selling out of book (transfer-out semantics).
        const bought = this.boughtToday.get(key)
        const day = cnTradingDayKey()
        if (bought && bought.day === day) {
          const reduce = Decimal.min(bought.qty, delta.abs())
          bought.qty = bought.qty.minus(reduce)
          if (bought.qty.lte(0)) this.boughtToday.delete(key)
        }
        const after = this.boughtToday.get(key)
        if (after && after.qty.gt(nextQty)) {
          after.qty = nextQty
        }
      }
    }

    this.schedulePersist()
  }

  /** Reclassify sellable vs locked for one symbol. Invariant: sellable + locked = total. */
  setSellable(params: { nativeKey: string; sellable: Decimal | string | number }): void {
    const parsed = parseCnSymbol(params.nativeKey)
    if (!parsed.ok) throw new Error(`setSellable: ${parsed.message}`)
    const key = parsed.ref.bare
    const sim = this.inner.getSimulatorState()
    const existing = sim.positions.find((p) => p.nativeKey === key)
    if (!existing) throw new Error(`setSellable: no position at ${key}`)
    const total = new Decimal(existing.quantity)
    const sellable = params.sellable instanceof Decimal
      ? params.sellable
      : new Decimal(params.sellable)
    if (sellable.lt(0) || sellable.gt(total)) {
      throw new Error(`setSellable: sellable must be in [0, ${total.toString()}]`)
    }
    const locked = total.minus(sellable)
    if (locked.isZero()) this.boughtToday.delete(key)
    else this.boughtToday.set(key, { day: cnTradingDayKey(), qty: locked })
    this.schedulePersist()
  }

  /** Replace entire book (seed / align to external broker App). */
  setBookSnapshot(params: {
    cash: Decimal | string | number
    positions: Array<{
      nativeKey: string
      quantity: Decimal | string | number
      avgCost?: Decimal | string | number
      sellable?: Decimal | string | number
    }>
  }): void {
    const cash = params.cash instanceof Decimal ? params.cash : new Decimal(params.cash)
    if (cash.lt(0)) throw new Error('paperSetSnapshot: cash must be >= 0')

    const open = this.inner.getSimulatorState().pendingOrders
    if (open.length > 0) {
      throw new Error('paperSetSnapshot: cancel open orders before replacing the book')
    }

    this.inner.setCash(cash)
    this.boughtToday.clear()
    const built: Position[] = []
    for (const row of params.positions) {
      const parsed = parseCnSymbol(row.nativeKey)
      if (!parsed.ok) throw new Error(`paperSetSnapshot: ${parsed.message}`)
      const key = parsed.ref.bare
      const qty = row.quantity instanceof Decimal ? row.quantity : new Decimal(row.quantity)
      if (qty.lt(0)) throw new Error(`paperSetSnapshot: quantity must be >= 0 for ${key}`)
      if (qty.isZero()) continue
      const avgCost = row.avgCost != null
        ? (row.avgCost instanceof Decimal ? row.avgCost : new Decimal(row.avgCost))
        : (this.inner.getMarkPrice(key) ?? new Decimal(0))
      const mark = this.inner.getMarkPrice(key) ?? avgCost
      const contract = this.buildCnContract(key, this.quoteCache.get(key) ?? null)
      built.push({
        contract,
        currency: 'CNY',
        side: 'long',
        quantity: qty,
        avgCost: avgCost.toString(),
        marketPrice: mark.toString(),
        marketValue: qty.mul(mark).toString(),
        unrealizedPnL: qty.mul(mark.minus(avgCost)).toString(),
        realizedPnL: '0',
        multiplier: '1',
        avgCostSource: 'broker',
      })
      if (row.sellable != null) {
        const sellable = row.sellable instanceof Decimal ? row.sellable : new Decimal(row.sellable)
        if (sellable.lt(0) || sellable.gt(qty)) {
          throw new Error(`paperSetSnapshot: sellable out of range for ${key}`)
        }
        const locked = qty.minus(sellable)
        if (locked.gt(0)) this.boughtToday.set(key, { day: cnTradingDayKey(), qty: locked })
      }
    }
    this.inner.setPositions(built)
    this.schedulePersist()
  }

  private schedulePersist(): void {
    if (!this.bookPersister) return
    const snapshot = this.exportBookState()
    const run = this.bookPersister
    this.persistChain = this.persistChain
      .then(() => Promise.resolve(run(snapshot)))
      .catch((err) => {
        console.error(`CnLocalPaperBroker[${this.id}]: book persist failed:`, err)
      })
  }
}

/** Build Position[] from simulator state except an optional key to replace. */
function awaitablePositionsFromSim(
  sim: ReturnType<MockBroker['getSimulatorState']>,
  _skipKey: string,
  broker: CnLocalPaperBroker,
): Position[] {
  return sim.positions.map((p) => {
    const qty = new Decimal(p.quantity)
    const avgCost = new Decimal(p.avgCost)
    const mark = new Decimal(
      sim.markPrices.find((m) => m.nativeKey === p.nativeKey)?.price ?? p.avgCost,
    )
    const contract = broker.resolveNativeKey(p.nativeKey)
    return {
      contract,
      currency: 'CNY' as const,
      side: p.side,
      quantity: qty,
      avgCost: avgCost.toString(),
      marketPrice: mark.toString(),
      marketValue: qty.mul(mark).toString(),
      unrealizedPnL: qty.mul(mark.minus(avgCost)).toString(),
      realizedPnL: '0',
      multiplier: '1',
      ...(p.avgCostSource && { avgCostSource: p.avgCostSource }),
    }
  })
}
