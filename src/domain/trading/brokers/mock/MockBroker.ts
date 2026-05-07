/**
 * MockBroker — in-memory exchange implementing IBroker.
 *
 * Same level as CcxtBroker/AlpacaBroker — a full behavioral implementation,
 * not just vi.fn() stubs. Internally all-Decimal for precision guarantees.
 *
 * Market orders fill immediately at current markPrice. Limit/stop orders
 * sit Submitted until either (a) `setMarkPrice()` 触达 the trigger price
 * (auto-match), or (b) the simulator manually calls `fillOrder(orderId)`.
 *
 * Beyond IBroker, MockBroker exposes a "simulator control panel" — methods
 * not on the IBroker interface that let test/dev surfaces inject god-view
 * events: change markPrice, fill or partially fill pending orders, simulate
 * external deposits/withdrawals (空投, transfer-in) and external trades
 * (user manually trading on the exchange app outside Alice). Routes/UI
 * call these to drive scenarios without going through `placeOrder`.
 */

import { z } from 'zod'
import Decimal from 'decimal.js'
import { Contract, ContractDescription, ContractDetails, Order, OrderState, UNSET_DECIMAL, UNSET_DOUBLE } from '@traderalice/ibkr'
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
} from '../types.js'
import '../../contract-ext.js'
import { derivePositionMath } from '../../position-math.js'
import { buildContract, buildPosition } from '../contract-builder.js'
import type { SecType } from '../../contract-discipline.js'

// ==================== Helpers ====================

/**
 * Per-contract multiplier as a Decimal. Defaults to 1 when the contract
 * doesn't declare one (stocks, crypto). Options need ×100; futures use
 * the contract-spec value (50 for ES, 5 for MES, etc.).
 */
function multiplierOf(c: Contract): Decimal {
  const m = c.multiplier
  if (!m) return new Decimal(1)
  const d = new Decimal(m)
  return d.isZero() ? new Decimal(1) : d
}

// ==================== Internal types ====================

interface InternalPosition {
  contract: Contract
  side: 'long' | 'short'
  quantity: Decimal
  avgCost: Decimal
  avgCostSource?: 'broker' | 'wallet'
  marketPriceOverride?: Decimal
}

interface InternalOrder {
  id: string
  contract: Contract
  order: Order
  status: 'Submitted' | 'Filled' | 'Cancelled'
  fillPrice?: number
}

// ==================== Options ====================

export interface CallRecord {
  method: string
  args: unknown[]
  timestamp: number
}

export interface MockBrokerOptions {
  id?: string
  label?: string
  cash?: number
  accountInfo?: Partial<AccountInfo>
}

// ==================== Defaults ====================

export const DEFAULT_ACCOUNT_INFO: AccountInfo = {
  baseCurrency: 'USD',
  netLiquidation: '105000',
  totalCashValue: '100000',
  unrealizedPnL: '5000',
  realizedPnL: '1000',
  buyingPower: '200000',
}

export const DEFAULT_CAPABILITIES: AccountCapabilities = {
  supportedSecTypes: ['STK', 'CRYPTO'],
  supportedOrderTypes: ['MKT', 'LMT', 'STP', 'STP LMT'],
}

// ==================== Factory helpers ====================

export function makeContract(overrides: Partial<Contract> & { aliceId?: string } = {}): Contract {
  const c = new Contract()
  c.aliceId = overrides.aliceId ?? 'mock-paper|AAPL'
  c.symbol = overrides.symbol ?? 'AAPL'
  c.secType = overrides.secType ?? 'STK'
  c.exchange = overrides.exchange ?? 'MOCK'
  c.currency = overrides.currency ?? 'USD'
  return c
}

export function makePosition(overrides: Partial<Position> = {}): Position {
  const contract = overrides.contract ?? makeContract()
  return {
    contract,
    currency: contract.currency || 'USD',
    side: 'long',
    quantity: new Decimal(10),
    avgCost: '150',
    marketPrice: '160',
    marketValue: '1600',
    unrealizedPnL: '100',
    realizedPnL: '0',
    multiplier: '1',
    ...overrides,
  }
}

export function makeOpenOrder(overrides: Partial<OpenOrder> = {}): OpenOrder {
  const contract = overrides.contract ?? makeContract()
  const order = overrides.order ?? new Order()
  if (!overrides.order) {
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)
  }
  const orderState = overrides.orderState ?? new OrderState()
  if (!overrides.orderState) {
    orderState.status = 'Filled'
  }
  return { contract, order, orderState }
}

export function makePlaceOrderResult(overrides: Partial<PlaceOrderResult> = {}): PlaceOrderResult {
  return {
    success: true,
    orderId: 'order-1',
    ...overrides,
  }
}

// ==================== MockBroker ====================

export class MockBroker implements IBroker {
  // ---- Self-registration ----

  static configSchema = z.object({
    cash: z.coerce.number().default(100_000),
  })
  static configFields: import('../types.js').BrokerConfigField[] = [
    { name: 'cash', type: 'number', label: 'Starting cash (USD)', default: 100_000 },
  ]

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): MockBroker {
    const bc = MockBroker.configSchema.parse(config.brokerConfig)
    return new MockBroker({ id: config.id, label: config.label, cash: bc.cash })
  }

  // ---- Instance ----

  readonly id: string
  readonly label: string

  private _positions = new Map<string, InternalPosition>()
  private _orders = new Map<string, InternalOrder>()
  /** Per-nativeKey markPrice. Replaces the legacy `_quotes` map. */
  private _markPrices = new Map<string, Decimal>()
  /**
   * Contracts seen via deposit / placeOrder / externalTrade, keyed by
   * `getNativeKey(contract)`. `resolveNativeKey` looks up here first so
   * orders against an aliceId for a previously-known instrument keep their
   * full secType / strike / multiplier metadata even if the position was
   * fully sold out of (i.e. removed from `_positions`).
   */
  private _contractRegistry = new Map<string, Contract>()
  private _cash: Decimal
  private _realizedPnL = new Decimal(0)
  private _nextOrderId = 1
  private _accountOverride: AccountInfo | null = null
  private _callLog: CallRecord[] = []
  private _failRemaining = 0

  constructor(options: MockBrokerOptions = {}) {
    this.id = options.id ?? 'mock-paper'
    this.label = options.label ?? 'Mock Paper Account'
    this._cash = new Decimal(options.cash ?? 100_000)
    if (options.accountInfo) {
      this._accountOverride = {
        baseCurrency: 'USD', netLiquidation: '0', totalCashValue: '0', unrealizedPnL: '0', realizedPnL: '0',
        ...options.accountInfo,
      }
    }
  }

  // ==================== Call tracking ====================

  private _record(method: string, args: unknown[]): void {
    this._callLog.push({ method, args, timestamp: Date.now() })
  }

  private _checkFail(method: string): void {
    if (this._failRemaining > 0) {
      this._failRemaining--
      throw new Error(`MockBroker[${this.id}]: simulated ${method} failure`)
    }
  }

  /** Get all calls, optionally filtered by method name. */
  calls(method?: string): CallRecord[] {
    return method ? this._callLog.filter(c => c.method === method) : [...this._callLog]
  }

  /** Count calls to a specific method. */
  callCount(method: string): number {
    return this._callLog.filter(c => c.method === method).length
  }

  /** Get the last call to a specific method, or null. */
  lastCall(method: string): CallRecord | null {
    const filtered = this._callLog.filter(c => c.method === method)
    return filtered.length > 0 ? filtered[filtered.length - 1] : null
  }

  /** Clear call log. */
  resetCalls(): void {
    this._callLog = []
  }

  // ---- Lifecycle ----

  async init(): Promise<void> { this._record('init', []); this._checkFail('init') }
  async close(): Promise<void> { this._record('close', []) }

  // ---- Contract search (stub) ----

  async searchContracts(_pattern: string): Promise<ContractDescription[]> {
    this._record('searchContracts', [_pattern])
    const desc = new ContractDescription()
    desc.contract = makeContract()
    return [desc]
  }

  async getContractDetails(_query: Contract): Promise<ContractDetails | null> {
    this._record('getContractDetails', [_query])
    const details = new ContractDetails()
    details.contract = makeContract()
    details.longName = 'Mock Contract'
    return details
  }

  // ---- Trading operations ----

  async placeOrder(contract: Contract, order: Order, tpsl?: TpSlParams): Promise<PlaceOrderResult> {
    this._record('placeOrder', [contract, order, tpsl])
    const orderId = `mock-ord-${this._nextOrderId++}`
    const isMarket = order.orderType === 'MKT'
    const side = order.action.toUpperCase()
    const qty = !order.totalQuantity.equals(UNSET_DECIMAL) ? order.totalQuantity : new Decimal(0)

    if (isMarket) {
      const price = this._markPriceFor(contract) ?? new Decimal(100)
      const mult = multiplierOf(contract)

      // Update position; on oversell `_applyFill` throws — match real broker
      // convention by returning PlaceOrderResult.success=false rather than
      // letting the exception escape to the caller.
      try {
        this._applyFill(contract, side, qty, price)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }

      // Cash flow honours multiplier: 1 OPT contract @ $58 with multiplier=100
      // costs $5,800, not $58. IBroker contract requires this even though
      // position.avgCost is per-unit.
      const cost = qty.mul(price).mul(mult)
      this._cash = side === 'BUY' ? this._cash.minus(cost) : this._cash.plus(cost)

      const filledOrder = this._cloneOrder(order, orderId)
      this._orders.set(orderId, {
        id: orderId, contract, order: filledOrder,
        status: 'Filled', fillPrice: price.toNumber(),
      })

      const orderState = new OrderState()
      orderState.status = 'Filled'
      return { success: true, orderId, orderState }
    }

    // Limit/stop order → pending
    const pendingOrder = this._cloneOrder(order, orderId)
    this._orders.set(orderId, {
      id: orderId, contract, order: pendingOrder, status: 'Submitted',
    })

    const orderState = new OrderState()
    orderState.status = 'Submitted'
    return { success: true, orderId, orderState }
  }

  async modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult> {
    this._record('modifyOrder', [orderId, changes])
    const internal = this._orders.get(orderId)
    if (!internal || internal.status !== 'Submitted') {
      return { success: false, error: `Order ${orderId} not found or not pending` }
    }

    if (changes.totalQuantity != null && !changes.totalQuantity.equals(UNSET_DECIMAL)) {
      internal.order.totalQuantity = changes.totalQuantity
    }
    if (changes.lmtPrice != null && !changes.lmtPrice.equals(UNSET_DECIMAL)) {
      internal.order.lmtPrice = changes.lmtPrice
    }
    if (changes.auxPrice != null && !changes.auxPrice.equals(UNSET_DECIMAL)) {
      internal.order.auxPrice = changes.auxPrice
    }
    if (changes.trailStopPrice != null && !changes.trailStopPrice.equals(UNSET_DECIMAL)) {
      internal.order.trailStopPrice = changes.trailStopPrice
    }
    if (changes.trailingPercent != null && !changes.trailingPercent.equals(UNSET_DECIMAL)) {
      internal.order.trailingPercent = changes.trailingPercent
    }
    if (changes.orderType) internal.order.orderType = changes.orderType
    if (changes.tif) internal.order.tif = changes.tif

    const orderState = new OrderState()
    orderState.status = 'Submitted'
    return { success: true, orderId, orderState }
  }

  async cancelOrder(orderId: string): Promise<PlaceOrderResult> {
    this._record('cancelOrder', [orderId])
    const internal = this._orders.get(orderId)
    if (!internal || internal.status !== 'Submitted') {
      return { success: false, error: `Order ${orderId} not found or not pending` }
    }
    internal.status = 'Cancelled'
    const orderState = new OrderState()
    orderState.status = 'Cancelled'
    return { success: true, orderId, orderState }
  }

  async closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult> {
    this._record('closePosition', [contract, quantity])
    const key = this.getNativeKey(contract)
    const pos = this._positions.get(key)
    if (!pos) {
      return { success: false, error: `No open position for ${key}` }
    }

    const order = new Order()
    order.action = pos.side === 'long' ? 'SELL' : 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = quantity ?? pos.quantity

    return this.placeOrder(pos.contract, order)
  }

  // ---- Queries ----

  async getAccount(): Promise<AccountInfo> {
    this._record('getAccount', [])
    this._checkFail('getAccount')
    if (this._accountOverride) return this._accountOverride

    let unrealizedPnL = new Decimal(0)
    let marketValueAcc = new Decimal(0)
    for (const pos of this._positions.values()) {
      const price = pos.marketPriceOverride ?? this._markPriceFor(pos.contract) ?? pos.avgCost
      const { marketValue, unrealizedPnL: pnl } = derivePositionMath({
        quantity: pos.quantity,
        marketPrice: price,
        avgCost: pos.avgCost,
        multiplier: pos.contract.multiplier || '1',
        side: pos.side,
      })
      marketValueAcc = marketValueAcc.plus(marketValue)
      unrealizedPnL = unrealizedPnL.plus(pnl)
    }

    return {
      baseCurrency: 'USD',
      netLiquidation: this._cash.plus(marketValueAcc).toString(),
      totalCashValue: this._cash.toString(),
      unrealizedPnL: unrealizedPnL.toString(),
      realizedPnL: this._realizedPnL.toString(),
    }
  }

  async getPositions(): Promise<Position[]> {
    this._record('getPositions', [])
    this._checkFail('getPositions')
    const result: Position[] = []
    for (const pos of this._positions.values()) {
      const price = pos.marketPriceOverride ?? this._markPriceFor(pos.contract) ?? pos.avgCost
      result.push(buildPosition({
        contract: pos.contract,
        currency: pos.contract.currency || 'USD',
        side: pos.side,
        quantity: pos.quantity,
        avgCost: pos.avgCost.toString(),
        marketPrice: price.toString(),
        realizedPnL: '0',
        ...(pos.avgCostSource && { avgCostSource: pos.avgCostSource }),
      }))
    }
    return result
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    this._record('getOrders', [orderIds])
    const results: OpenOrder[] = []
    for (const id of orderIds) {
      const order = await this.getOrder(id)
      if (order) results.push(order)
    }
    return results
  }

  async getOrder(orderId: string): Promise<OpenOrder | null> {
    this._record('getOrder', [orderId])
    const internal = this._orders.get(orderId)
    if (!internal) return null
    const orderState = new OrderState()
    orderState.status = internal.status
    return { contract: internal.contract, order: internal.order, orderState }
  }

  async getQuote(contract: Contract): Promise<Quote> {
    this._record('getQuote', [contract])
    const price = this._markPriceFor(contract) ?? new Decimal(100)
    return {
      contract,
      last: price.toString(),
      bid: price.minus('0.01').toString(),
      ask: price.plus('0.01').toString(),
      volume: '1000000',
      timestamp: new Date(),
    }
  }

  async getMarketClock(): Promise<MarketClock> {
    this._record('getMarketClock', [])
    return { isOpen: true }
  }

  getCapabilities(): AccountCapabilities {
    return DEFAULT_CAPABILITIES
  }

  // ==================== Contract identity ====================

  getNativeKey(contract: Contract): string {
    // Prefer localSymbol so multi-family scenarios (BTC spot vs BTC perp)
    // can coexist without colliding in the position/markPrice maps. Falls
    // back to plain symbol for the common single-family case — preserves
    // back-compat with existing tests that key off bare symbols.
    return contract.localSymbol || contract.symbol
  }

  resolveNativeKey(nativeKey: string): Contract {
    // Prefer the registry — preserves secType / strike / right / multiplier
    // for contracts we've already observed, so re-ordering an OPT/FUT
    // aliceId after a full sell-down still keeps the right metadata.
    const remembered = this._contractRegistry.get(nativeKey)
    if (remembered) return remembered
    const c = new Contract()
    c.symbol = nativeKey
    c.localSymbol = nativeKey
    c.secType = 'STK'
    return c
  }

  // ==================== Simulator control panel ====================
  // Methods below are NOT part of IBroker. They expose a "god view" so test
  // specs, the webui simulator route, and other dev surfaces can drive
  // scenarios that real exchanges produce on their own (price moves,
  // external transfers, manual fills). Keeping them on MockBroker (not on
  // a separate interface) means anything holding `IBroker` ignores them
  // entirely; the simulator route narrows via `instanceof MockBroker`.

  /**
   * Set the markPrice for a native key (= localSymbol or symbol). Auto-matches
   * any pending limit/stop orders触达 the new price; fills happen at the
   * markPrice (better-than-limit semantics). Returns the orderIds filled.
   */
  setMarkPrice(nativeKey: string, price: Decimal | string | number): string[] {
    const decimalPrice = price instanceof Decimal ? price : new Decimal(price)
    this._markPrices.set(nativeKey, decimalPrice)
    return this._matchPendingOrders(nativeKey, decimalPrice)
  }

  /** Move a markPrice by a relative percent (e.g. +5 = up 5%). */
  tickPrice(nativeKey: string, deltaPercent: number): string[] {
    const current = this._markPrices.get(nativeKey)
    if (!current) {
      throw new Error(`MockBroker[${this.id}]: tickPrice — no markPrice for ${nativeKey}; call setMarkPrice first`)
    }
    const next = current.mul(new Decimal(100).plus(deltaPercent)).div(100)
    return this.setMarkPrice(nativeKey, next)
  }

  /** Read the current markPrice for a native key (returns null if unset). */
  getMarkPrice(nativeKey: string): Decimal | null {
    return this._markPrices.get(nativeKey) ?? null
  }

  /** Manually fill a pending order. Optional price (defaults to markPrice or limit price); optional qty for partial. */
  fillOrder(orderId: string, opts: { price?: Decimal | string | number; qty?: Decimal | string | number } = {}): void {
    const internal = this._orders.get(orderId)
    if (!internal || internal.status !== 'Submitted') {
      throw new Error(`MockBroker[${this.id}]: fillOrder — ${orderId} not pending`)
    }

    const fillQty = opts.qty != null
      ? (opts.qty instanceof Decimal ? opts.qty : new Decimal(opts.qty))
      : internal.order.totalQuantity
    if (fillQty.lte(0)) throw new Error('fillOrder: qty must be positive')
    if (fillQty.gt(internal.order.totalQuantity)) {
      throw new Error('fillOrder: qty exceeds order totalQuantity')
    }

    const price = opts.price != null
      ? (opts.price instanceof Decimal ? opts.price : new Decimal(opts.price))
      : (this._markPriceFor(internal.contract)
        ?? (!internal.order.lmtPrice.equals(UNSET_DECIMAL) ? internal.order.lmtPrice : new Decimal(100)))

    const side = internal.order.action.toUpperCase()
    this._applyFill(internal.contract, side, fillQty, price)
    const cost = fillQty.mul(price).mul(multiplierOf(internal.contract))
    this._cash = side === 'BUY' ? this._cash.minus(cost) : this._cash.plus(cost)

    const isPartial = fillQty.lt(internal.order.totalQuantity)
    if (isPartial) {
      // Reduce remaining qty; order stays Submitted for follow-up fills
      internal.order.totalQuantity = internal.order.totalQuantity.minus(fillQty)
    } else {
      internal.status = 'Filled'
      internal.fillPrice = price.toNumber()
    }
  }

  /** Force-cancel a pending order (simulator surface; bypasses IBroker idempotency). */
  cancelPendingOrder(orderId: string): void {
    const internal = this._orders.get(orderId)
    if (!internal) throw new Error(`MockBroker[${this.id}]: order ${orderId} not found`)
    internal.status = 'Cancelled'
  }

  /**
   * Build a Contract from caller-supplied partial fields, defaulting only
   * the housekeeping bits (exchange / currency). Carries through every
   * IBKR contract field that distinguishes derivative instruments
   * (lastTradeDateOrContractMonth / strike / right / multiplier) so
   * options + futures + FOP positions render correctly downstream.
   */
  private _buildContract(nativeKey: string, partial: Partial<Contract> | undefined): Contract {
    const right = partial?.right
    const c = buildContract({
      symbol: partial?.symbol || nativeKey,
      secType: (partial?.secType as SecType) || 'CRYPTO',
      exchange: partial?.exchange || 'MOCK',
      currency: partial?.currency || 'USD',
      localSymbol: partial?.localSymbol || nativeKey,
      ...(partial?.lastTradeDateOrContractMonth && { lastTradeDateOrContractMonth: partial.lastTradeDateOrContractMonth }),
      ...(partial?.strike != null && partial.strike !== UNSET_DOUBLE && { strike: partial.strike }),
      ...(right === 'C' || right === 'P' || right === 'CALL' || right === 'PUT' ? { right } : {}),
      ...(partial?.multiplier && { multiplier: partial.multiplier }),
    })
    this._rememberContract(c)
    return c
  }

  /** Cache the contract under its native key so `resolveNativeKey` can
   *  recover the full IBKR Contract metadata even after the position is
   *  fully sold out of and removed from `_positions`. */
  private _rememberContract(c: Contract): void {
    const key = this.getNativeKey(c)
    if (!key) return
    if (!this._contractRegistry.has(key)) {
      this._contractRegistry.set(key, c)
    }
  }

  /**
   * Simulate an external balance change Alice didn't initiate (airdrop,
   * transfer-in, staking reward, off-exchange option assignment). Adds a
   * position without going through the order pipeline and tags
   * `avgCostSource: 'wallet'` so UTA's reconcile pipeline kicks in and
   * synthesizes a `reconcileBalance` commit at observed markPrice —
   * matching how CCXT spot synthesis behaves in real life.
   *
   * Cash is unchanged (deposit, not purchase).
   */
  externalDeposit(params: {
    nativeKey: string
    quantity: Decimal | string | number
    contract?: Partial<Contract>
  }): void {
    const qty = params.quantity instanceof Decimal ? params.quantity : new Decimal(params.quantity)
    if (qty.lte(0)) throw new Error('externalDeposit: quantity must be positive')

    const existing = this._positions.get(params.nativeKey)
    if (existing) {
      existing.quantity = existing.quantity.plus(qty)
      existing.avgCostSource = 'wallet'
      return
    }

    const markPrice = this._markPrices.get(params.nativeKey) ?? new Decimal(0)
    this._positions.set(params.nativeKey, {
      contract: this._buildContract(params.nativeKey, params.contract),
      side: 'long',
      quantity: qty,
      avgCost: markPrice,
      avgCostSource: 'wallet',
    })
  }

  /** Simulate an external withdrawal (transfer-out, burn). Cash unchanged. */
  externalWithdraw(nativeKey: string, quantity: Decimal | string | number): void {
    const qty = quantity instanceof Decimal ? quantity : new Decimal(quantity)
    const existing = this._positions.get(nativeKey)
    if (!existing) throw new Error(`MockBroker[${this.id}]: no position at ${nativeKey}`)
    existing.quantity = existing.quantity.minus(qty)
    if (existing.quantity.lte(0)) {
      this._positions.delete(nativeKey)
    } else {
      existing.avgCostSource = 'wallet'
    }
  }

  /**
   * Simulate the user manually trading on the exchange app (outside Alice's
   * order log). Updates position + cash like a real fill, but tags the
   * position as wallet-sourced so UTA reconciles via observed price.
   */
  externalTrade(params: {
    nativeKey: string
    side: 'BUY' | 'SELL'
    quantity: Decimal | string | number
    price: Decimal | string | number
    contract?: Partial<Contract>
  }): void {
    const qty = params.quantity instanceof Decimal ? params.quantity : new Decimal(params.quantity)
    const price = params.price instanceof Decimal ? params.price : new Decimal(params.price)
    if (qty.lte(0)) throw new Error('externalTrade: quantity must be positive')

    const existing = this._positions.get(params.nativeKey)
    if (!existing && params.side === 'SELL') {
      throw new Error(`MockBroker[${this.id}]: cannot externalTrade SELL — no position at ${params.nativeKey}`)
    }

    if (!existing) {
      this._positions.set(params.nativeKey, {
        contract: this._buildContract(params.nativeKey, params.contract),
        side: 'long',
        quantity: qty,
        avgCost: price,
        avgCostSource: 'wallet',
      })
    } else {
      this._applyFill(existing.contract, params.side, qty, price)
      const after = this._positions.get(params.nativeKey)
      if (after) after.avgCostSource = 'wallet'
    }

    const positionForMult = this._positions.get(params.nativeKey)
    const mult = positionForMult ? multiplierOf(positionForMult.contract) : new Decimal(1)
    const cashDelta = qty.mul(price).mul(mult)
    this._cash = params.side === 'BUY' ? this._cash.minus(cashDelta) : this._cash.plus(cashDelta)
  }

  /**
   * Snapshot of all simulator-relevant state. Used by the webui simulator tab
   * to render the control console without piecing together separate calls.
   */
  getSimulatorState(): {
    cash: string
    markPrices: Array<{ nativeKey: string; price: string }>
    positions: Array<{ nativeKey: string; symbol: string; localSymbol?: string; secType?: string; side: 'long' | 'short'; quantity: string; avgCost: string; avgCostSource?: 'broker' | 'wallet'; expiry?: string; strike?: number; right?: string; multiplier?: string }>
    pendingOrders: Array<{ orderId: string; nativeKey: string; symbol: string; action: string; orderType: string; totalQuantity: string; lmtPrice?: string; auxPrice?: string }>
  } {
    return {
      cash: this._cash.toString(),
      markPrices: [...this._markPrices.entries()].map(([k, v]) => ({ nativeKey: k, price: v.toString() })),
      positions: [...this._positions.entries()].map(([k, p]) => ({
        nativeKey: k,
        symbol: p.contract.symbol,
        localSymbol: p.contract.localSymbol || undefined,
        secType: p.contract.secType || undefined,
        side: p.side,
        quantity: p.quantity.toString(),
        avgCost: p.avgCost.toString(),
        avgCostSource: p.avgCostSource,
        expiry: p.contract.lastTradeDateOrContractMonth || undefined,
        strike: p.contract.strike !== UNSET_DOUBLE ? p.contract.strike : undefined,
        right: p.contract.right || undefined,
        multiplier: p.contract.multiplier || undefined,
      })),
      pendingOrders: [...this._orders.values()]
        .filter(o => o.status === 'Submitted')
        .map(o => ({
          orderId: o.id,
          nativeKey: this.getNativeKey(o.contract),
          symbol: o.contract.symbol,
          action: o.order.action,
          orderType: o.order.orderType,
          totalQuantity: o.order.totalQuantity.toString(),
          lmtPrice: !o.order.lmtPrice.equals(UNSET_DECIMAL) ? o.order.lmtPrice.toString() : undefined,
          auxPrice: !o.order.auxPrice.equals(UNSET_DECIMAL) ? o.order.auxPrice.toString() : undefined,
        })),
    }
  }

  /**
   * Walk pending orders for `nativeKey`, fill any whose trigger has been
   * crossed by `price`. Called from setMarkPrice. Returns filled orderIds.
   *
   * Trigger semantics:
   *  - LMT BUY: fills when markPrice <= lmtPrice (price came down to/below us)
   *  - LMT SELL: fills when markPrice >= lmtPrice
   *  - STP BUY: triggers when markPrice >= auxPrice (breakout up)
   *  - STP SELL: triggers when markPrice <= auxPrice (breakdown)
   * Fill price = markPrice (better-than-limit, like a real exchange).
   */
  private _matchPendingOrders(nativeKey: string, price: Decimal): string[] {
    const filled: string[] = []
    for (const internal of this._orders.values()) {
      if (internal.status !== 'Submitted') continue
      if (this.getNativeKey(internal.contract) !== nativeKey) continue

      const order = internal.order
      const side = order.action.toUpperCase()
      const type = order.orderType
      const lmt = !order.lmtPrice.equals(UNSET_DECIMAL) ? order.lmtPrice : null
      const aux = !order.auxPrice.equals(UNSET_DECIMAL) ? order.auxPrice : null

      let triggered = false
      if (type === 'LMT' && lmt) {
        triggered = side === 'BUY' ? price.lte(lmt) : price.gte(lmt)
      } else if (type === 'STP' && aux) {
        triggered = side === 'BUY' ? price.gte(aux) : price.lte(aux)
      } else if (type === 'STP LMT' && aux) {
        // Stop-limit: aux triggers, then becomes a limit at lmt. For mock we
        // collapse: trigger fills at lmt (or aux if no lmt) — sufficient for
        // simulation; precise stop-limit behaviour is out of scope.
        triggered = side === 'BUY' ? price.gte(aux) : price.lte(aux)
      }
      if (!triggered) continue

      this.fillOrder(internal.id, { price })
      filled.push(internal.id)
    }
    return filled
  }

  /** Resolve markPrice for a contract via its nativeKey. */
  private _markPriceFor(contract: Contract): Decimal | null {
    return this._markPrices.get(this.getNativeKey(contract)) ?? null
  }

  // ==================== Legacy test helpers ====================

  /** Legacy alias for setMarkPrice — number-typed price, no auto-match return. */
  setQuote(symbol: string, price: number): void {
    this.setMarkPrice(symbol, price)
  }

  /** Legacy alias for fillOrder. */
  fillPendingOrder(orderId: string, price: number): void {
    this.fillOrder(orderId, { price })
  }

  /** Override positions directly (for legacy test compatibility). */
  setPositions(positions: Position[]): void {
    this._positions.clear()
    for (const p of positions) {
      const key = this.getNativeKey(p.contract) || p.contract.aliceId || 'unknown'
      this._positions.set(key, {
        contract: p.contract,
        side: p.side,
        quantity: p.quantity,
        avgCost: new Decimal(p.avgCost),
        ...(p.avgCostSource && { avgCostSource: p.avgCostSource }),
        marketPriceOverride: new Decimal(p.marketPrice),
      })
    }
  }

  /** Override orders directly (for legacy test compatibility). */
  setOrders(orders: OpenOrder[]): void {
    this._orders.clear()
    for (const o of orders) {
      const id = (o.order.orderId && o.order.orderId !== 0)
        ? String(o.order.orderId)
        : `injected-${this._nextOrderId++}`
      this._orders.set(id, {
        id,
        contract: o.contract,
        order: o.order,
        status: o.orderState.status as InternalOrder['status'],
      })
    }
  }

  /** Make the next N broker calls throw. Used to test health transitions. */
  setFailMode(count: number): void {
    this._failRemaining = count
  }

  /** Override account info directly. Bypasses computed values from positions. */
  setAccountInfo(info: Partial<AccountInfo>): void {
    const base: AccountInfo = {
      baseCurrency: 'USD', netLiquidation: '0', totalCashValue: '0', unrealizedPnL: '0', realizedPnL: '0',
      ...this._accountOverride,
    }
    Object.assign(base, info)
    if (!base.baseCurrency) base.baseCurrency = 'USD'
    this._accountOverride = base
  }

  // ==================== Internal ====================

  private _applyFill(contract: Contract, side: string, qty: Decimal, price: Decimal): void {
    // All position map operations key by `getNativeKey(contract)` so that
    // orders placed via the IBroker pipeline (with UTA-stamped aliceId) and
    // simulator-direct calls (externalDeposit/externalTrade — keyed by
    // user-supplied nativeKey, e.g. "BTC") land in the same map slot.
    const key = this.getNativeKey(contract)
    this._rememberContract(contract)
    const existing = this._positions.get(key)

    if (!existing) {
      if (side === 'SELL') {
        // No position to sell. Real brokers reject oversell. Mock follows
        // suit — flipping into a short here would silently fabricate cash
        // and a wrong-direction position. Caller (placeOrder / externalTrade)
        // catches and surfaces the rejection.
        throw new Error(`MockBroker[${this.id}]: cannot SELL ${qty.toFixed()} ${key} — no existing position`)
      }
      this._positions.set(key, {
        contract,
        side: 'long',
        quantity: qty,
        avgCost: price,
      })
      return
    }

    const isIncreasing =
      (existing.side === 'long' && side === 'BUY') ||
      (existing.side === 'short' && side === 'SELL')

    if (isIncreasing) {
      // Add to position, recalculate avg cost
      const totalCost = existing.avgCost.mul(existing.quantity).plus(price.mul(qty))
      existing.quantity = existing.quantity.plus(qty)
      existing.avgCost = totalCost.div(existing.quantity)
    } else {
      // Reduce / close. Reject oversell — partial close OK, full flat OK,
      // beyond-flat is the bug shape (cash phantom-credited via the caller).
      const remaining = existing.quantity.minus(qty)
      if (remaining.lt(0)) {
        throw new Error(`MockBroker[${this.id}]: cannot ${side} ${qty.toFixed()} ${key} — only ${existing.quantity.toFixed()} held`)
      }
      if (remaining.isZero()) {
        this._positions.delete(key)
      } else {
        existing.quantity = remaining
        // avgCost stays the same on partial close (WAC sell-down semantics).
      }
    }
  }

  private _cloneOrder(order: Order, orderId: string): Order {
    const o = new Order()
    o.action = order.action
    o.orderType = order.orderType
    o.totalQuantity = order.totalQuantity
    o.tif = order.tif
    if (!order.lmtPrice.equals(UNSET_DECIMAL)) o.lmtPrice = order.lmtPrice
    if (!order.auxPrice.equals(UNSET_DECIMAL)) o.auxPrice = order.auxPrice
    o.orderId = parseInt(orderId.replace('mock-ord-', ''), 10) || 0
    return o
  }
}
