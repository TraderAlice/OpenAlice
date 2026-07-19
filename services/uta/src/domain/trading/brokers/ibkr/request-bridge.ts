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
import { BrokerError, type BrokerConnectionStateEvent } from '../types.js'
import { classifyIbkrError } from './ibkr-contracts.js'
import { buildPosition } from '../contract-builder.js'
import type {
  PendingRequest,
  TickSnapshot,
  AccountDownloadResult,
  CollectedOpenOrder,
} from './ibkr-types.js'

const DEFAULT_TIMEOUT_MS = 10_000
const SNAPSHOT_TIMEOUT_MS = 12_500
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
  private snapshotResolveOnBidAsk = new Set<number>()

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
  private connectTimer: ReturnType<typeof setTimeout> | null = null

  // ---- Current time request ----
  private currentTimePending: PendingRequest<number> | null = null
  private currentTimePromise: Promise<number> | null = null

  private connectionStateListener: ((event: BrokerConnectionStateEvent) => void) | null = null

  // ==================== Public API ====================

  /** Store reference to the EClient for unsubscribe calls. */
  setClient(client: EClient): void {
    this.client_ = client
  }

  setConnectionStateListener(listener: ((event: BrokerConnectionStateEvent) => void) | null): void {
    this.connectionStateListener = listener
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

    if (this.connectReject) {
      this.rejectConnect(new BrokerError('NETWORK', 'Previous TWS/Gateway connection attempt was superseded'))
    }

    const handshake = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject
      this.connectTimer = setTimeout(() => {
        this.rejectConnect(
          new BrokerError('NETWORK', `Connection to TWS/Gateway timed out after ${timeoutMs}ms`),
        )
      }, timeoutMs)
    })

    // Observe both promises from the moment the socket attempt starts. TWS can
    // accept TCP and close before EClient.connect() finishes its own protocol
    // handshake; leaving `handshake` unobserved during that window turns the
    // normal rejection from connectionClosed() into a process-fatal unhandled
    // rejection on Node 22.
    const observedHandshake = handshake.catch((error: unknown) => {
      // Also make the bridge timeout authoritative. Without this teardown, a
      // custom short timeout could reject while EClient's independent 10s
      // protocol timer kept the socket attempt alive in the background.
      try { client.disconnect() } catch { /* best-effort teardown */ }
      throw error
    })
    const [transportResult, handshakeResult] = await Promise.allSettled([
      client.connect(host, port, clientId),
      observedHandshake,
    ])

    const failure = handshakeResult.status === 'rejected'
      ? handshakeResult.reason
      : transportResult.status === 'rejected'
        ? transportResult.reason
        : null
    if (failure !== null) {
      this.clearConnectWaiter()
      // A failed handshake must leave no half-connected EClient for the UTA
      // recovery loop to mistake for a successful reconnect.
      try { client.disconnect() } catch { /* best-effort teardown */ }
      throw failure
    }
  }

  private clearConnectWaiter(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.connectTimer = null
    this.connectResolve = null
    this.connectReject = null
  }

  private rejectConnect(error: Error): void {
    const reject = this.connectReject
    this.clearConnectWaiter()
    reject?.(error)
  }

  // ---- Mode A: reqId-based requests ----

  /** Register a pending request that resolves with a single value. */
  request<T>(reqId: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        this.collectors.delete(reqId)
        this.snapshots.delete(reqId)
        this.snapshotResolveOnBidAsk.delete(reqId)
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
  requestSnapshot(
    reqId: number,
    timeoutMs = SNAPSHOT_TIMEOUT_MS,
    options: { resolveOnBidAsk?: boolean } = {},
  ): Promise<TickSnapshot> {
    this.snapshots.set(reqId, {})
    if (options.resolveOnBidAsk) this.snapshotResolveOnBidAsk.add(reqId)
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
    if (this.currentTimePromise) return this.currentTimePromise

    let resolvePromise!: (value: number) => void
    let rejectPromise!: (error: Error) => void
    const promise = new Promise<number>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    this.currentTimePromise = promise
    const clear = (): void => {
      if (this.currentTimePromise === promise) this.currentTimePromise = null
      this.currentTimePending = null
    }
    const timer = setTimeout(() => {
      clear()
      rejectPromise(new BrokerError('NETWORK', `currentTime request timed out`))
    }, timeoutMs)
    this.currentTimePending = {
      resolve: (value) => { clearTimeout(timer); clear(); resolvePromise(value as number) },
      reject: (error) => { clearTimeout(timer); clear(); rejectPromise(error) },
      timer,
    }
    try {
      this.client_!.reqCurrentTime()
    } catch (err) {
      this.currentTimePending?.reject(BrokerError.from(err, 'NETWORK'))
    }
    return promise
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
    this.snapshotResolveOnBidAsk.delete(reqId)
    entry.resolve(value)
  }

  private rejectRequest(reqId: number, error: Error): void {
    const entry = this.pending.get(reqId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(reqId)
    this.collectors.delete(reqId)
    this.snapshots.delete(reqId)
    this.snapshotResolveOnBidAsk.delete(reqId)
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
    this.snapshotResolveOnBidAsk.clear()

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
    const resolve = this.connectResolve
    this.clearConnectWaiter()
    resolve?.()
  }

  override managedAccounts(accountsList: string): void {
    const accounts = accountsList.split(',').map(s => s.trim()).filter(Boolean)
    this.accountId_ = accounts[0] ?? null
  }

  /** True once the socket is known-dead (connectionClosed or a failed
   *  heartbeat) and until the next successful (re)connect. The IBKR account
   *  surface is cache-backed — without this flag a dead-but-idle connection
   *  serves stale data and SWALLOWS ORDERS while health stays green
   *  (issue #294). */
  private connectionDead_ = false
  get connectionDead(): boolean { return this.connectionDead_ }
  markDead(error = 'Connection to TWS/Gateway lost'): void {
    if (this.connectionDead_) return
    this.connectionDead_ = true
    this.connectionStateListener?.({ state: 'dead', error })
  }
  markAlive(): void {
    const wasDead = this.connectionDead_
    this.connectionDead_ = false
    if (wasDead) this.connectionStateListener?.({ state: 'alive' })
  }

  override connectionClosed(): void {
    this.markDead()
    this.rejectAll(new BrokerError('NETWORK', 'Connection to TWS/Gateway lost'))

    if (this.connectReject) {
      this.rejectConnect(new BrokerError('NETWORK', 'Connection to TWS/Gateway closed during handshake'))
    }
  }

  // ---- Error routing ----

  override error(reqId: number, _errorTime: number, errorCode: number, errorString: string): void {
    // Informational warnings live in the 2100-2200 band (data farm
    // status etc.). The old `>= 2000` blanket also swallowed the 10xxx
    // REAL errors (10089 no-subscription, 10197 competing session...) —
    // pending requests then died as useless timeouts instead of carrying
    // the venue's actionable message.
    if (errorCode >= 2100 && errorCode < 2200) return

    // System-level errors (reqId === -1) — connectivity events
    if (reqId === NO_VALID_ID) {
      if (errorCode === 502 || errorCode === 504 || errorCode === 1100) {
        this.markDead(`TWS/Gateway reported connectivity lost (${errorCode})`)
      } else if (errorCode === 1101 || errorCode === 1102) {
        // A restored farm/socket is a reason to retry immediately, not proof
        // that account subscriptions and private reads are healthy again.
        this.connectionStateListener?.({ state: 'restored' })
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

  // Bonds arrive via their own callback (TWS quirk) — same collector.
  override bondContractDetails(reqId: number, cd: ContractDetails): void {
    this.pushCollector(reqId, cd)
  }

  override contractDetailsEnd(reqId: number): void {
    this.resolveCollector(reqId)
  }

  // ---- Option chain parameters (collector) ----

  override securityDefinitionOptionParameter(
    reqId: number,
    exchange: string,
    underlyingConId: number,
    tradingClass: string,
    multiplier: string,
    expirations: Set<string>,
    strikes: Set<number>,
  ): void {
    this.pushCollector(reqId, {
      exchange,
      underlyingConId,
      tradingClass,
      multiplier,
      expirations: [...expirations].sort(),
      strikes: [...strikes].sort((a, b) => a - b),
    })
  }

  override securityDefinitionOptionParameterEnd(reqId: number): void {
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

  /**
   * Upsert-by-conId into a position list; null row = remove.
   * TWS sends DELTAS between accountDownloadEnd markers (a fill updates one
   * position immediately, the next full download can be ~3 minutes away) —
   * so updates must apply to BOTH the live cache (immediate visibility) and
   * the pending rebuild buffer (next swap must not resurrect stale rows).
   * Keying by conId also prevents duplicate rows when the same position
   * updates repeatedly within one batch window (price ticks do this).
   */
  private upsertPosition(list: AccountDownloadResult['positions'], contract: Contract, row: AccountDownloadResult['positions'][number] | null): void {
    const idx = list.findIndex((p) => p.contract.conId === contract.conId)
    if (row === null) {
      if (idx >= 0) list.splice(idx, 1)
    } else if (idx >= 0) {
      list[idx] = row
    } else {
      list.push(row)
    }
  }

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
    // Zero quantity = position fully closed — must REMOVE from cache, not
    // be ignored (a closed position used to linger until the next full
    // download).
    // IBKR's averageCost is PER CONTRACT (multiplier-baked: an option bought
    // at 1.03 reports averageCost 103) while marketPrice is per unit. Every
    // downstream consumer that recomputes PnL as (mark − avg) × mult would
    // produce inverted, ~100x-wrong numbers for derivatives (the community
    // "option PnL direction is flipped" report). Normalize to per-unit here.
    const multDec = new Decimal(contract.multiplier || '1')
    const avgPerUnit = multDec.gt(1) ? new Decimal(averageCost).div(multDec).toString() : averageCost
    const row = position.isZero() ? null : buildPosition({
      contract,
      currency: contract.currency || 'USD',
      side: position.greaterThan(0) ? 'long' : 'short',
      quantity: position.abs(),
      avgCost: avgPerUnit,
      marketPrice,
      // TWS already bakes contract.multiplier into the values it reports
      // here — pass through as-is (don't re-derive). multiplier is surfaced
      // as metadata for downstream consumers.
      marketValue: new Decimal(marketValue).abs().toString(),
      unrealizedPnL: unrealizedPNL,
      realizedPnL: realizedPNL,
      multiplier: contract.multiplier || '1',
    })

    if (this.accountCachePending_) this.upsertPosition(this.accountCachePending_.positions, contract, row)
    if (this.accountCache_) this.upsertPosition(this.accountCache_.positions, contract, row)
  }

  override updateAccountValue(key: string, val: string, currency: string, _accountName: string): void {
    // Multi-currency families (CashBalance, NetLiquidationByCurrency,
    // ExchangeRate, …) arrive once PER CURRENCY plus a consolidated BASE
    // line. Store the composite key always; the plain key is reserved for
    // the consolidated value — BASE wins it and, once written, a
    // per-currency line can never overwrite it (issue #295: last-write-wins
    // left whichever currency arrived last in the plain slot).
    const apply = (m: Map<string, string>): void => {
      if (currency) m.set(`${key}:${currency}`, val)
      if (!currency || currency === 'BASE' || !m.has(`${key}:BASE`)) m.set(key, val)
    }
    if (this.accountCachePending_) apply(this.accountCachePending_.values)
    // Deltas must be visible immediately, not at the next downloadEnd swap.
    if (this.accountCache_) apply(this.accountCache_.values)
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

    // Delayed variants (66-73) arrive instead of live ticks when the
    // account has no live subscription and reqMarketDataType(3) is set —
    // paper accounts live here. Same field, 15-min-delayed value.
    switch (tickType) {
      case TickTypeEnum.BID:
      case TickTypeEnum.DELAYED_BID: snap.bid = price; break
      case TickTypeEnum.ASK:
      case TickTypeEnum.DELAYED_ASK: snap.ask = price; break
      case TickTypeEnum.LAST:
      case TickTypeEnum.DELAYED_LAST: snap.last = price; break
      case TickTypeEnum.HIGH:
      case TickTypeEnum.DELAYED_HIGH: snap.high = price; break
      case TickTypeEnum.LOW:
      case TickTypeEnum.DELAYED_LOW: snap.low = price; break
    }

    if (
      this.snapshotResolveOnBidAsk.has(reqId)
      && snap.bid != null && snap.bid > 0
      && snap.ask != null && snap.ask > 0
    ) {
      this.resolveRequest(reqId, { ...snap })
    }
  }

  override tickSize(reqId: number, tickType: number, size: Decimal): void {
    const snap = this.snapshots.get(reqId)
    if (!snap) return

    if (tickType === TickTypeEnum.VOLUME || tickType === TickTypeEnum.DELAYED_VOLUME) {
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
    this.currentTimePending.resolve(time)
  }
}
