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

interface OrderBatchWaiter {
  resolve: (orders: CollectedOpenOrder[]) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface OrderBatch {
  orders: CollectedOpenOrder[]
  waiters: OrderBatchWaiter[]
}

interface CurrentTimeWaiter {
  resolve: (time: number) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * How long a reply is still assumed to belong to an already-expired currentTime
 * probe. Past this window the credit is dropped, or a reply the gateway never
 * sends starves every later probe.
 */
const CURRENT_TIME_REPLY_GRACE_MS = 30_000

const DEFAULT_TIMEOUT_MS = 10_000
const SNAPSHOT_TIMEOUT_MS = 12_500
const ACCOUNT_READY_TIMEOUT_MS = 20_000

/**
 * How long an `Inactive` status is parked before it is accepted as the answer.
 * TWS uses `Inactive` for both a reject and a legitimate hold, so the window
 * lets a reject's `error()` arrive first.
 */
const INACTIVE_GRACE_MS = 1_500

const acceptsLiveStatus = (status: string): boolean => status !== 'Inactive'

/**
 * A cancel must not be completed by `Submitted`/`Filled`/`PreSubmitted`, or a
 * fill that beat the cancel is recorded as a cancel.
 */
const CANCEL_CONFIRMING_STATUSES = new Set(['Cancelled', 'ApiCancelled', 'PendingCancel'])
export const acceptsCancelStatus = (status: string): boolean =>
  CANCEL_CONFIRMING_STATUSES.has(status)

interface PendingOrderRequest extends PendingRequest<CollectedOpenOrder> {
  /** Which callback status completes this request. */
  accepts: (status: string) => boolean
  /** Deferred `Inactive` answer, resolved if nothing better arrives. */
  hold?: { value: CollectedOpenOrder; timer: ReturnType<typeof setTimeout> }
}

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
  private orderPending = new Map<number, PendingOrderRequest>()

  // ---- Mode C: single-flight batch collectors ----
  // One in-flight sweep per kind, joined by every concurrent caller. Each
  // waiter keeps its own deadline; a waiter timing out never clobbers the
  // batch that the others are still collecting.
  private openOrdersBatch: OrderBatch | null = null
  private completedOrdersBatch: OrderBatch | null = null

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
  private sawNextValidId_ = false
  private sawManagedAccounts_ = false

  // ---- Current time probes (FIFO) ----
  // currentTime carries no request id, so replies are matched to probes in
  // send order. Each probe owns its deadline; replies owed to already-expired
  // probes are discarded instead of resolving a later probe with a stale
  // timestamp.
  private currentTimeWaiters: CurrentTimeWaiter[] = []
  private currentTimeExpired_: ReturnType<typeof setTimeout>[] = []

  // ---- Inbound activity ----
  private lastInboundAt_ = 0

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
    this.sawNextValidId_ = false
    this.sawManagedAccounts_ = false
    this.clearCurrentTimeCredits()

    if (this.connectReject) {
      this.rejectConnect(new BrokerError('NETWORK', 'Previous TWS/Gateway connection attempt was superseded'))
    }

    const handshake = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject
      this.connectTimer = setTimeout(() => {
        const missing = [
          this.sawNextValidId_ ? null : 'nextValidId',
          this.sawManagedAccounts_ ? null : 'managedAccounts',
        ].filter(Boolean).join(' and ')
        this.rejectConnect(
          new BrokerError('NETWORK', `Connection to TWS/Gateway timed out after ${timeoutMs}ms (no ${missing})`),
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

  /**
   * Registers a pending order request. Cancels must pass `acceptsCancelStatus`
   * so a fill cannot be mistaken for a cancel.
   */
  requestOrder(
    orderId: number,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    accepts: (status: string) => boolean = acceptsLiveStatus,
  ): Promise<CollectedOpenOrder> {
    return new Promise<CollectedOpenOrder>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.clearOrderPending(orderId)
        reject(new BrokerError('NETWORK', `Order ${orderId} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.orderPending.set(orderId, { resolve, reject, timer, accepts })
    })
  }

  // ---- Mode C: single-slot requests ----

  /**
   * Join or start an order sweep. Concurrent callers share one in-flight
   * request and each receives the complete batch; a caller that gives up
   * early only removes its own waiter.
   */
  private joinOrderBatch(
    label: string,
    read: () => OrderBatch | null,
    write: (batch: OrderBatch | null) => void,
    send: () => void,
    timeoutMs: number,
  ): Promise<CollectedOpenOrder[]> {
    return new Promise<CollectedOpenOrder[]>((resolve, reject) => {
      const existing = read()
      const batch: OrderBatch = existing ?? { orders: [], waiters: [] }
      const waiter: OrderBatchWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const idx = batch.waiters.indexOf(waiter)
          if (idx >= 0) batch.waiters.splice(idx, 1)
          // The sweep is only abandoned once nobody is left waiting for it.
          if (batch.waiters.length === 0 && read() === batch) write(null)
          reject(new BrokerError('NETWORK', `${label} request timed out after ${timeoutMs}ms`))
        }, timeoutMs),
      }
      batch.waiters.push(waiter)
      if (existing) return

      write(batch)
      try {
        send()
      } catch (err) {
        write(null)
        this.settleOrderBatch(batch, BrokerError.from(err, 'NETWORK'))
      }
    })
  }

  private settleOrderBatch(batch: OrderBatch, error?: Error): void {
    const waiters = batch.waiters.splice(0)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      if (error) waiter.reject(error)
      else waiter.resolve(batch.orders)
    }
  }

  /** Request all open orders (batch collector). */
  requestOpenOrders(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CollectedOpenOrder[]> {
    return this.joinOrderBatch(
      'Open orders',
      () => this.openOrdersBatch,
      (batch) => { this.openOrdersBatch = batch },
      () => this.client_!.reqOpenOrders(),
      timeoutMs,
    )
  }

  /** Request completed orders (filled/cancelled). */
  requestCompletedOrders(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CollectedOpenOrder[]> {
    return this.joinOrderBatch(
      'Completed orders',
      () => this.completedOrdersBatch,
      (batch) => { this.completedOrdersBatch = batch },
      () => this.client_!.reqCompletedOrders(true),
      timeoutMs,
    )
  }

  /** Get cached fill data from orderStatus callbacks. */
  getFillData(orderId: number): { filled: Decimal; avgFillPrice: number } | undefined {
    return this.fillData_.get(orderId)
  }

  /** Request current TWS server time. */
  requestCurrentTime(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const waiter: CurrentTimeWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const idx = this.currentTimeWaiters.indexOf(waiter)
          if (idx < 0) return
          this.currentTimeWaiters.splice(idx, 1)
          // A reply may still be in flight, so remember that it is owed and
          // cannot be handed to a later probe as a fresh timestamp.
          const credit = setTimeout(() => {
            const at = this.currentTimeExpired_.indexOf(credit)
            if (at >= 0) this.currentTimeExpired_.splice(at, 1)
          }, CURRENT_TIME_REPLY_GRACE_MS)
          credit.unref?.()
          this.currentTimeExpired_.push(credit)
          reject(new BrokerError('NETWORK', `currentTime request timed out after ${timeoutMs}ms`))
        }, timeoutMs),
      }
      this.currentTimeWaiters.push(waiter)

      try {
        this.client_!.reqCurrentTime()
      } catch (err) {
        const idx = this.currentTimeWaiters.indexOf(waiter)
        if (idx >= 0) this.currentTimeWaiters.splice(idx, 1)
        clearTimeout(waiter.timer)
        reject(BrokerError.from(err, 'NETWORK'))
      }
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

  /** Drop every outstanding "a reply is still owed" credit. A connection that
   *  just died or just came up owes nothing. */
  private clearCurrentTimeCredits(): void {
    for (const credit of this.currentTimeExpired_.splice(0)) clearTimeout(credit)
  }

  /** Wall-clock (Date.now) reading of the last inbound TWS callback observed. */
  get lastInboundAt(): number { return this.lastInboundAt_ }

  /** Record inbound traffic so liveness policy can treat any reply from the
   *  gateway as evidence that the socket is still carrying data. */
  private noteInbound(): void {
    this.lastInboundAt_ = Date.now()
  }

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

  /** Drop a pending order request and every timer it owns. */
  private clearOrderPending(orderId: number): PendingOrderRequest | undefined {
    const entry = this.orderPending.get(orderId)
    if (!entry) return undefined
    clearTimeout(entry.timer)
    if (entry.hold) clearTimeout(entry.hold.timer)
    this.orderPending.delete(orderId)
    return entry
  }

  private resolveOrderRequest(orderId: number, value: CollectedOpenOrder): void {
    this.clearOrderPending(orderId)?.resolve(value)
  }

  private rejectOrderRequest(orderId: number, error: Error): void {
    this.clearOrderPending(orderId)?.reject(error)
  }

  /**
   * Routes an openOrder / orderStatus answer to its pending request. An
   * `Inactive` status is parked for `INACTIVE_GRACE_MS` so a reject's `error()`
   * or a later live status can win.
   */
  private answerOrderRequest(orderId: number, value: CollectedOpenOrder): void {
    const entry = this.orderPending.get(orderId)
    if (!entry) return
    if (entry.accepts(value.orderState.status)) {
      this.resolveOrderRequest(orderId, value)
      return
    }
    if (value.orderState.status !== 'Inactive' || entry.hold) return
    entry.hold = {
      value,
      timer: setTimeout(() => this.resolveOrderRequest(orderId, value), INACTIVE_GRACE_MS),
    }
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
      if (entry.hold) clearTimeout(entry.hold.timer)
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

    if (this.openOrdersBatch) {
      const batch = this.openOrdersBatch
      this.openOrdersBatch = null
      this.settleOrderBatch(batch, error)
    }

    if (this.completedOrdersBatch) {
      const batch = this.completedOrdersBatch
      this.completedOrdersBatch = null
      this.settleOrderBatch(batch, error)
    }

    for (const waiter of this.currentTimeWaiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.clearCurrentTimeCredits()
  }

  // ==================== EWrapper callback overrides ====================

  // ---- Connection ----

  override nextValidId(orderId: number): void {
    this.noteInbound()
    this.nextOrderId_ = orderId
    this.sawNextValidId_ = true
    this.maybeResolveConnect()
  }

  /**
   * A connection is only usable once both startApi replies have landed;
   * nextValidId alone leaves `getAccountId()` depending on callback ordering.
   */
  private maybeResolveConnect(): void {
    if (!this.sawNextValidId_ || !this.sawManagedAccounts_) return
    const resolve = this.connectResolve
    this.clearConnectWaiter()
    resolve?.()
  }

  override managedAccounts(accountsList: string): void {
    this.noteInbound()
    const accounts = accountsList.split(',').map(s => s.trim()).filter(Boolean)
    // TWS re-pushes managedAccounts on FA re-login, so an empty push must not
    // blank an id this session already has. Resolving connect on it would
    // surface as a non-retryable CONFIG error from init().
    const first = accounts[0]
    if (!first) return
    this.accountId_ = first
    this.sawManagedAccounts_ = true
    this.maybeResolveConnect()
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
    this.clearCurrentTimeCredits()
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
    this.noteInbound()
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
    this.noteInbound()
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
    this.noteInbound()
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
    this.noteInbound()
    const collected: CollectedOpenOrder = { contract, order, orderState }

    this.answerOrderRequest(orderId, collected)

    // Also collect for openOrders batch
    this.openOrdersBatch?.orders.push(collected)
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

    if (!this.orderPending.has(orderId)) return

    const os = new OrderStateClass()
    os.status = status
    this.answerOrderRequest(orderId, {
      contract: new ContractClass(),
      order: new OrderClass(),
      orderState: os,
    })
  }

  override openOrderEnd(): void {
    const batch = this.openOrdersBatch
    if (!batch) return
    this.openOrdersBatch = null
    this.settleOrderBatch(batch)
  }

  // ---- Completed orders ----

  override completedOrder(contract: Contract, order: Order, orderState: OrderState): void {
    this.completedOrdersBatch?.orders.push({ contract, order, orderState })
  }

  override completedOrdersEnd(): void {
    const batch = this.completedOrdersBatch
    if (!batch) return
    this.completedOrdersBatch = null
    this.settleOrderBatch(batch)
  }

  // ---- Current time ----

  override currentTime(time: number): void {
    this.noteInbound()
    // Handing a reply owed to an abandoned probe to the next one would report
    // a stale timestamp as fresh liveness evidence.
    const credit = this.currentTimeExpired_.shift()
    if (credit) {
      clearTimeout(credit)
      return
    }
    const waiter = this.currentTimeWaiters.shift()
    if (!waiter) return
    clearTimeout(waiter.timer)
    waiter.resolve(time)
  }
}
