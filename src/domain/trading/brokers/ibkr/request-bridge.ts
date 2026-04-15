/**
 * RequestBridge — callback→Promise bridging layer for IBKR TWS API.
 *
 * Extends DefaultEWrapper to intercept TWS callbacks and route them
 * to pending Promises. Three routing modes:
 *
 * A) reqId-based: symbolSamples, contractDetails, accountSummary, tickSnapshot
 * B) orderId-based: openOrder, orderStatus (for placeOrder/cancelOrder)
 * C) Single-slot: openOrders batch, completedOrders batch
 * D) Persistent subscription: account data (updatePortfolio/updateAccountValue) with cache
 */

import Decimal from 'decimal.js'
import {
  DefaultEWrapper,
  NO_VALID_ID,
  TickTypeEnum,
  Contract as ContractClass,
  Order as OrderClass,
  OrderState as OrderStateClass,
  type Contract,
  type ContractDescription,
  type ContractDetails,
  type Order,
  type OrderState,
  type EClient,
  type TickAttrib,
} from '@traderalice/ibkr'
import { BrokerError } from '../types.js'
import { classifyIbkrError } from './ibkr-contracts.js'
import type {
  PendingRequest,
  TickSnapshot,
  AccountDownloadResult,
  CollectedOpenOrder,
} from './ibkr-types.js'

const DEFAULT_TIMEOUT_MS = 10_000
const ACCOUNT_READY_TIMEOUT_MS = 20_000

export class RequestBridge extends DefaultEWrapper {
  // ---- State ----
  private nextReqId_ = 10_000
  private nextOrderId_ = 0
  private accountId_: string | null = null
  private client_: EClient | null = null

  // ---- Mode A: reqId-based pending requests ----
  private pending = new Map<number, PendingRequest>()
  private collectors = new Map<number, unknown[]>()

  // ---- Mode A: tick snapshot accumulators ----
  private snapshots = new Map<number, TickSnapshot>()

  // ---- Mode B: orderId-based pending requests ----
  private orderPending = new Map<number, PendingRequest<CollectedOpenOrder>>()

  // ---- Mode C: single-slot collectors ----
  private openOrdersCollector: {
    orders: CollectedOpenOrder[]
    resolve: (orders: CollectedOpenOrder[]) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

  private completedOrdersCollector: {
    orders: CollectedOpenOrder[]
    resolve: (orders: CollectedOpenOrder[]) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

  // ---- Mode D: persistent account subscription cache ----
  private accountCache_: AccountDownloadResult | null = null
  private accountCachePending_: {
    positions: AccountDownloadResult['positions']
    values: Map<string, string>
  } | null = null
  private accountReadyResolve_: (() => void) | null = null
  private accountReadyReject_: ((err: Error) => void) | null = null
  private accountReadyPromise_: Promise<void> | null = null
  private accountSubscribed_ = false
  private accountCode_: string | null = null

  // ---- Fill data cache (from orderStatus callbacks) ----
  private fillData_ = new Map<number, { filled: Decimal; avgFillPrice: number }>()

  // ---- Connection handshake ----
  private connectResolve: (() => void) | null = null
  private connectReject: ((err: Error) => void) | null = null

  // ---- Current time request ----
  private currentTimePending: PendingRequest<number> | null = null

  // ==================== Public API ====================

  /** Store reference to the EClient for unsubscribe calls. */
  setClient(client: EClient): void {
    this.client_ = client
  }

  /** Allocate a unique reqId (starts at 10000 to avoid orderId range). */
  allocReqId(): number {
    return this.nextReqId_++
  }

  /** Get and increment the next valid order ID. */
  getNextOrderId(): number {
    return this.nextOrderId_++
  }

  /** Get the auto-detected account ID from managedAccounts callback. */
  getAccountId(): string | null {
    return this.accountId_
  }

  // ---- Connection ----

  /** Connect the EClient and wait for nextValidId (indicates TWS is ready). */
  async waitForConnect(
    client: EClient,
    host: string,
    port: number,
    clientId: number,
    timeoutMs = 15_000,
  ): Promise<void> {
    this.client_ = client

    const promise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject
      setTimeout(() => {
        this.connectResolve = null
        this.connectReject = null
        reject(new BrokerError('NETWORK', `Connection to TWS/Gateway timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    await client.connect(host, port, clientId)
    return promise
  }

  // ---- Mode A: reqId-based requests ----

  /** Register a pending request that resolves with a single value. */
  request<T>(reqId: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new BrokerError('NETWORK', `Request ${reqId} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, timer })
    })
  }

  /** Register a pending request that collects multiple callbacks into an array. */
  requestCollector<T>(reqId: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T[]> {
    this.collectors.set(reqId, [])
    return this.request<T[]>(reqId, timeoutMs)
  }

  /** Register a snapshot market data request. */
  requestSnapshot(reqId: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<TickSnapshot> {
    this.snapshots.set(reqId, {})
    return this.request<TickSnapshot>(reqId, timeoutMs)
  }

  // ---- Mode B: orderId-based requests ----

  /** Register a pending order request (waits for openOrder callback). */
  requestOrder(orderId: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CollectedOpenOrder> {
    return new Promise<CollectedOpenOrder>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.orderPending.delete(orderId)
        reject(new BrokerError('NETWORK', `Order ${orderId} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.orderPending.set(orderId, { resolve, reject, timer })
    })
  }

  // ---- Mode C: single-slot requests ----

  /** Request all open orders (batch collector). */
  requestOpenOrders(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CollectedOpenOrder[]> {
    return new Promise<CollectedOpenOrder[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.openOrdersCollector = null
        reject(new BrokerError('NETWORK', `Open orders request timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.openOrdersCollector = { orders: [], resolve, reject, timer }
      this.client_!.reqOpenOrders()
    })
  }

  /** Request completed orders (filled/cancelled). */
  requestCompletedOrders(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CollectedOpenOrder[]> {
    return new Promise<CollectedOpenOrder[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.completedOrdersCollector = null
        reject(new BrokerError('NETWORK', `Completed orders request timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.completedOrdersCollector = { orders: [], resolve, reject, timer }
      this.client_!.reqCompletedOrders(true)
    })
  }

  /** Get cached fill data from orderStatus callbacks. */
  getFillData(orderId: number): { filled: Decimal; avgFillPrice: number } | undefined {
    return this.fillData_.get(orderId)
  }

  /** Request current TWS server time. */
  requestCurrentTime(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.currentTimePending = null
        reject(new BrokerError('NETWORK', `currentTime request timed out`))
      }, timeoutMs)

      this.currentTimePending = { resolve: resolve as (v: unknown) => void, reject, timer }
      this.client_!.reqCurrentTime()
    })
  }

  // ---- Mode D: persistent account subscription ----

  /** Subscribe to account updates. Call once after connect. */
  startAccountSubscription(acctCode: string): void {
    if (this.accountSubscribed_) return
    this.accountSubscribed_ = true
    this.accountCode_ = acctCode
    this.accountCachePending_ = { positions: [], values: new Map() }
    this.accountReadyPromise_ = new Promise<void>((resolve, reject) => {
      this.accountReadyResolve_ = resolve
      this.accountReadyReject_ = reject
    })
    this.client_!.reqAccountUpdates(true, acctCode)
  }

  /** Wait for first account download to complete. */
  async waitForAccountReady(timeoutMs = ACCOUNT_READY_TIMEOUT_MS): Promise<void> {
    if (this.accountCache_) return
    if (!this.accountReadyPromise_) {
      throw new BrokerError('NETWORK', 'Account subscription not started')
    }
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new BrokerError('NETWORK', `Initial account download timed out after ${timeoutMs}ms`)), timeoutMs),
    )
    await Promise.race([this.accountReadyPromise_, timeout])
  }

  /** Read the cached account data. Returns null if not yet loaded. */
  getAccountCache(): AccountDownloadResult | null {
    return this.accountCache_
  }

  /** Stop the account subscription. */
  stopAccountSubscription(): void {
    if (!this.accountSubscribed_ || !this.accountCode_) return
    this.accountSubscribed_ = false
    this.client_?.reqAccountUpdates(false, this.accountCode_)
    this.accountCode_ = null
  }

  // ==================== Internal helpers ====================

  private resolveRequest(reqId: number, value: unknown): void {
    const entry = this.pending.get(reqId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(reqId)
    this.collectors.delete(reqId)
    this.snapshots.delete(reqId)
    entry.resolve(value)
  }

  private rejectRequest(reqId: number, error: Error): void {
    const entry = this.pending.get(reqId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(reqId)
    this.collectors.delete(reqId)
    this.snapshots.delete(reqId)
    entry.reject(error)
  }

  private pushCollector(reqId: number, item: unknown): void {
    this.collectors.get(reqId)?.push(item)
  }

  private resolveCollector(reqId: number): void {
    this.resolveRequest(reqId, this.collectors.get(reqId) ?? [])
  }

  private resolveOrderRequest(orderId: number, value: CollectedOpenOrder): void {
    const entry = this.orderPending.get(orderId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.orderPending.delete(orderId)
    entry.resolve(value)
  }

  private rejectOrderRequest(orderId: number, error: Error): void {
    const entry = this.orderPending.get(orderId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.orderPending.delete(orderId)
    entry.reject(error)
  }

  private rejectAll(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
    this.collectors.clear()
    this.snapshots.clear()

    for (const [, entry] of this.orderPending) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.orderPending.clear()

    // Reject account subscription ready promise if still pending
    if (this.accountReadyReject_) {
      this.accountReadyReject_(error)
      this.accountReadyResolve_ = null
      this.accountReadyReject_ = null
    }
    this.accountSubscribed_ = false
    this.accountCache_ = null
    this.accountCachePending_ = null

    if (this.openOrdersCollector) {
      clearTimeout(this.openOrdersCollector.timer)
      this.openOrdersCollector.reject(error)
      this.openOrdersCollector = null
    }

    if (this.completedOrdersCollector) {
      clearTimeout(this.completedOrdersCollector.timer)
      this.completedOrdersCollector.reject(error)
      this.completedOrdersCollector = null
    }

    if (this.currentTimePending) {
      clearTimeout(this.currentTimePending.timer)
      this.currentTimePending.reject(error)
      this.currentTimePending = null
    }
  }

  // ==================== EWrapper callback overrides ====================

  // ---- Connection ----

  override nextValidId(orderId: number): void {
    this.nextOrderId_ = orderId
    // Resolve the connect promise (TWS is ready)
    if (this.connectResolve) {
      this.connectResolve()
      this.connectResolve = null
      this.connectReject = null
    }
  }

  override managedAccounts(accountsList: string): void {
    const accounts = accountsList.split(',').map(s => s.trim()).filter(Boolean)
    this.accountId_ = accounts[0] ?? null
  }

  override connectionClosed(): void {
    this.rejectAll(new BrokerError('NETWORK', 'Connection to TWS/Gateway lost'))

    if (this.connectReject) {
      this.connectReject(new BrokerError('NETWORK', 'Connection to TWS/Gateway closed during handshake'))
      this.connectResolve = null
      this.connectReject = null
    }
  }

  // ---- Error routing ----

  override error(reqId: number, _errorTime: number, errorCode: number, errorString: string): void {
    // Informational messages (code >= 2000) — data farm status, etc.
    if (errorCode >= 2000) return

    // System-level errors (reqId === -1) — connectivity events
    if (reqId === NO_VALID_ID) {
      if (errorCode === 502 || errorCode === 504 || errorCode === 1100) {
        // These will be followed by connectionClosed() which rejects all
      }
      return
    }

    // Request-specific errors — reject the corresponding pending Promise
    const brokerError = classifyIbkrError(errorCode, errorString)

    // Try reqId-based first, then orderId-based
    if (this.pending.has(reqId)) {
      this.rejectRequest(reqId, brokerError)
    } else if (this.orderPending.has(reqId)) {
      this.rejectOrderRequest(reqId, brokerError)
    }
  }

  // ---- Contract search (symbolSamples) ----

  override symbolSamples(_reqId: number, contractDescriptions: ContractDescription[]): void {
    this.resolveRequest(_reqId, contractDescriptions)
  }

  // ---- Contract details (collector) ----

  override contractDetails(reqId: number, cd: ContractDetails): void {
    this.pushCollector(reqId, cd)
  }

  override contractDetailsEnd(reqId: number): void {
    this.resolveCollector(reqId)
  }

  // ---- Account summary (collector using Map) ----

  override accountSummary(reqId: number, _account: string, tag: string, value: string, _currency: string): void {
    // For accountSummary we use the collectors map but store a Map<string,string>
    let map = this.collectors.get(reqId) as unknown as Map<string, string> | undefined
    if (!map) {
      map = new Map()
      this.collectors.set(reqId, map as unknown as unknown[])
    }
    map.set(tag, value)
  }

  override accountSummaryEnd(reqId: number): void {
    // Resolve with the Map (stored in collectors slot)
    this.resolveRequest(reqId, this.collectors.get(reqId) ?? new Map<string, string>())
  }

  // ---- Account subscription callbacks (persistent cache) ----

  override updatePortfolio(
    contract: Contract,
    position: Decimal,
    marketPrice: string,
    marketValue: string,
    averageCost: string,
    unrealizedPNL: string,
    realizedPNL: string,
    _accountName: string,
  ): void {
    if (!this.accountCachePending_) return
    if (position.isZero()) return

    this.accountCachePending_.positions.push({
      contract,
      currency: contract.currency || 'USD',
      side: position.greaterThan(0) ? 'long' : 'short',
      quantity: position.abs(),
      avgCost: averageCost,
      marketPrice,
      marketValue: new Decimal(marketValue).abs().toString(),
      unrealizedPnL: unrealizedPNL,
      realizedPnL: realizedPNL,
    })
  }

  override updateAccountValue(key: string, val: string, _currency: string, _accountName: string): void {
    this.accountCachePending_?.values.set(key, val)
  }

  override accountDownloadEnd(_accountName: string): void {
    if (!this.accountCachePending_) return

    // Swap pending buffer into cache (atomic replace)
    this.accountCache_ = {
      values: this.accountCachePending_.values,
      positions: this.accountCachePending_.positions,
    }

    // Reset pending buffer for next batch
    this.accountCachePending_ = { positions: [], values: new Map() }

    // Resolve the initial-load promise (first call only)
    if (this.accountReadyResolve_) {
      this.accountReadyResolve_()
      this.accountReadyResolve_ = null
      this.accountReadyReject_ = null
    }
  }

  // ---- Market data snapshot ----

  override tickPrice(reqId: number, tickType: number, price: number, _attrib: TickAttrib): void {
    const snap = this.snapshots.get(reqId)
    if (!snap) return

    switch (tickType) {
      case TickTypeEnum.BID: snap.bid = price; break
      case TickTypeEnum.ASK: snap.ask = price; break
      case TickTypeEnum.LAST: snap.last = price; break
      case TickTypeEnum.HIGH: snap.high = price; break
      case TickTypeEnum.LOW: snap.low = price; break
    }
  }

  override tickSize(reqId: number, tickType: number, size: Decimal): void {
    const snap = this.snapshots.get(reqId)
    if (!snap) return

    if (tickType === TickTypeEnum.VOLUME) {
      snap.volume = size.toNumber()
    }
  }

  override tickString(reqId: number, tickType: number, value: string): void {
    const snap = this.snapshots.get(reqId)
    if (!snap) return

    // TickType 45 = LAST_TIMESTAMP
    if (tickType === 45) {
      snap.lastTimestamp = parseInt(value, 10)
    }
  }

  override tickSnapshotEnd(reqId: number): void {
    const snap = this.snapshots.get(reqId) ?? {}
    this.snapshots.delete(reqId)
    this.resolveRequest(reqId, snap)
  }

  // ---- Orders ----

  override openOrder(orderId: number, contract: Contract, order: Order, orderState: OrderState): void {
    const collected: CollectedOpenOrder = { contract, order, orderState }

    // Route to pending order request (placeOrder/modifyOrder)
    if (this.orderPending.has(orderId)) {
      this.resolveOrderRequest(orderId, collected)
    }

    // Also collect for openOrders batch
    this.openOrdersCollector?.orders.push(collected)
  }

  override orderStatus(
    orderId: number,
    status: string,
    filled: Decimal,
    _remaining: Decimal,
    avgFillPrice: number,
    _permId: number,
    _parentId: number,
    _lastFillPrice: number,
    _clientId: number,
    _whyHeld: string,
    _mktCapPrice: number,
  ): void {
    // Cache fill data for later retrieval (e.g. by sync())
    if (filled.greaterThan(0) && avgFillPrice > 0) {
      this.fillData_.set(orderId, { filled, avgFillPrice })
    }

    // For cancel requests, we wait for status 'Cancelled'
    if (this.orderPending.has(orderId) && status === 'Cancelled') {
      const os = new OrderStateClass()
      os.status = 'Cancelled'
      this.resolveOrderRequest(orderId, {
        contract: new ContractClass(),
        order: new OrderClass(),
        orderState: os,
      })
    }
  }

  override openOrderEnd(): void {
    if (!this.openOrdersCollector) return
    clearTimeout(this.openOrdersCollector.timer)
    this.openOrdersCollector.resolve(this.openOrdersCollector.orders)
    this.openOrdersCollector = null
  }

  // ---- Completed orders ----

  override completedOrder(contract: Contract, order: Order, orderState: OrderState): void {
    this.completedOrdersCollector?.orders.push({ contract, order, orderState })
  }

  override completedOrdersEnd(): void {
    if (!this.completedOrdersCollector) return
    clearTimeout(this.completedOrdersCollector.timer)
    this.completedOrdersCollector.resolve(this.completedOrdersCollector.orders)
    this.completedOrdersCollector = null
  }

  // ---- Current time ----

  override currentTime(time: number): void {
    if (!this.currentTimePending) return
    clearTimeout(this.currentTimePending.timer)
    this.currentTimePending.resolve(time)
    this.currentTimePending = null
  }
}
