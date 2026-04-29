/**
 * UnifiedTradingAccount (UTA) — the business entity for trading.
 *
 * Owns: broker connection (IBroker), operation history (TradingGit), and strategy guards.
 * AI and frontend interact with this class, never with IBroker directly.
 *
 * Analogous to a git repository: each UTA maintains its own commit history.
 */

import Decimal from 'decimal.js'
import { Contract, Order, ContractDescription, ContractDetails, UNSET_DECIMAL } from '@traderalice/ibkr'
import { BrokerError, type IBroker, type AccountInfo, type Position, type OpenOrder, type PlaceOrderResult, type Quote, type MarketClock, type AccountCapabilities, type BrokerHealth, type BrokerHealthInfo, type TpSlParams } from './brokers/types.js'
import { TradingGit } from './git/TradingGit.js'
import type {
  Operation,
  AddResult,
  CommitPrepareResult,
  PushResult,
  RejectResult,
  GitStatus,
  GitCommit,
  GitState,
  GitExportState,
  CommitLogEntry,
  PriceChangeInput,
  SimulatePriceChangeResult,
  OrderStatusUpdate,
  SyncResult,
} from './git/types.js'
import { createGuardPipeline, resolveGuards } from './guards/index.js'
import './contract-ext.js'

// ==================== Options ====================

export interface UnifiedTradingAccountOptions {
  guards?: Array<{ type: string; options?: Record<string, unknown> }>
  savedState?: GitExportState
  onCommit?: (state: GitExportState) => void | Promise<void>
  onHealthChange?: (accountId: string, health: BrokerHealthInfo) => void
  onPostPush?: (accountId: string) => void | Promise<void>
  onPostReject?: (accountId: string) => void | Promise<void>
}

// ==================== Stage param types ====================

export interface StagePlaceOrderParams {
  aliceId: string
  symbol?: string
  action: 'BUY' | 'SELL'
  orderType: string
  totalQuantity?: number | string
  cashQty?: number | string
  lmtPrice?: number | string
  auxPrice?: number | string
  trailStopPrice?: number | string
  trailingPercent?: number | string
  tif?: string
  goodTillDate?: string
  outsideRth?: boolean
  parentId?: string
  ocaGroup?: string
  takeProfit?: { price: string }
  stopLoss?: { price: string; limitPrice?: string }
}

export interface StageModifyOrderParams {
  orderId: string
  totalQuantity?: number | string
  lmtPrice?: number | string
  auxPrice?: number | string
  trailStopPrice?: number | string
  trailingPercent?: number | string
  orderType?: string
  tif?: string
  goodTillDate?: string
}

export interface StageClosePositionParams {
  aliceId: string
  symbol?: string
  /** Accepts string (preferred — preserves Decimal precision) or number. Empty / undefined closes the full position. */
  qty?: number | string
}

// ==================== UnifiedTradingAccount ====================

export class UnifiedTradingAccount {
  readonly id: string
  readonly label: string
  readonly broker: IBroker
  readonly git: TradingGit

  private readonly _getState: () => Promise<GitState>
  private readonly _onHealthChange?: (accountId: string, health: BrokerHealthInfo) => void
  private readonly _onPostPush?: (accountId: string) => void | Promise<void>
  private readonly _onPostReject?: (accountId: string) => void | Promise<void>

  // ---- Health tracking ----
  private static readonly DEGRADED_THRESHOLD = 3
  private static readonly OFFLINE_THRESHOLD = 6
  private static readonly RECOVERY_BASE_MS = 5_000
  private static readonly RECOVERY_MAX_MS = 60_000

  private _consecutiveFailures = 0
  private _lastError?: string
  private _lastSuccessAt?: Date
  private _lastFailureAt?: Date
  private _recoveryTimer?: ReturnType<typeof setTimeout>
  private _recovering = false
  private _disabled = false
  private _connectPromise: Promise<void>

  constructor(broker: IBroker, options: UnifiedTradingAccountOptions = {}) {
    this.broker = broker
    this.id = broker.id
    this.label = broker.label
    this._onHealthChange = options.onHealthChange
    this._onPostPush = options.onPostPush
    this._onPostReject = options.onPostReject

    // Wire internals
    this._getState = async (): Promise<GitState> => {
      const pendingIds = this.git.getPendingOrderIds().map(p => p.orderId)
      const [accountInfo, positions, orders] = await this._callBroker(() =>
        Promise.all([
          broker.getAccount(),
          broker.getPositions(),
          broker.getOrders(pendingIds),
        ]),
      )
      // Stamp aliceId on all contracts returned by broker
      for (const p of positions) this.stampAliceId(p.contract)
      for (const o of orders) this.stampAliceId(o.contract)
      return {
        netLiquidation: accountInfo.netLiquidation,
        totalCashValue: accountInfo.totalCashValue,
        unrealizedPnL: accountInfo.unrealizedPnL,
        realizedPnL: accountInfo.realizedPnL ?? '0',
        positions,
        pendingOrders: orders.filter(o => o.orderState.status === 'Submitted' || o.orderState.status === 'PreSubmitted'),
      }
    }

    const dispatcher = async (op: Operation): Promise<unknown> => {
      switch (op.action) {
        case 'placeOrder':
          return broker.placeOrder(op.contract, op.order, op.tpsl)
        case 'modifyOrder':
          return broker.modifyOrder(op.orderId, op.changes)
        case 'closePosition':
          return broker.closePosition(op.contract, op.quantity)
        case 'cancelOrder':
          return broker.cancelOrder(op.orderId, op.orderCancel)
        default:
          throw new Error(`Unknown operation action: ${(op as { action: string }).action}`)
      }
    }
    const guards = resolveGuards(options.guards ?? [])
    const guardedDispatcher = createGuardPipeline(dispatcher, broker, guards)

    const gitConfig = {
      executeOperation: guardedDispatcher,
      getGitState: this._getState,
      onCommit: options.onCommit,
    }

    this.git = options.savedState
      ? TradingGit.restore(options.savedState, gitConfig)
      : new TradingGit(gitConfig)

    // Kick off broker connection asynchronously — UTA is usable immediately,
    // broker queries will fail (tracked by health) until init succeeds.
    const p = this._connect()
    // Silence unhandled rejection in fire-and-forget path.
    // waitForConnect() returns the raw promise so callers can observe failures.
    p.catch(() => {})
    this._connectPromise = p

  }

  /** Await initial broker connection. Resolves on success, rejects on failure. */
  waitForConnect(): Promise<void> {
    return this._connectPromise
  }

  // ==================== Health ====================

  get health(): BrokerHealth {
    if (this._disabled) return 'offline'
    if (this._consecutiveFailures >= UnifiedTradingAccount.OFFLINE_THRESHOLD) return 'offline'
    if (this._consecutiveFailures >= UnifiedTradingAccount.DEGRADED_THRESHOLD) return 'degraded'
    return 'healthy'
  }

  get disabled(): boolean {
    return this._disabled
  }

  getHealthInfo(): BrokerHealthInfo {
    return {
      status: this.health,
      consecutiveFailures: this._consecutiveFailures,
      lastError: this._lastError,
      lastSuccessAt: this._lastSuccessAt,
      lastFailureAt: this._lastFailureAt,
      recovering: this._recovering,
      disabled: this._disabled,
    }
  }

  /** Initial broker connection — fire-and-forget from constructor. */
  private async _connect(): Promise<void> {
    try {
      await this.broker.init()
      await this.broker.getAccount()
      this._onSuccess()
      this._emitHealthChange()
      console.log(`UTA[${this.id}]: connected`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (err instanceof BrokerError && err.permanent) {
        console.warn(`UTA[${this.id}]: disabled — ${msg}`)
        this._disabled = true
        this._lastError = msg
        this._emitHealthChange()
        throw err
      }
      console.warn(`UTA[${this.id}]: initial connect failed: ${msg}`)
      this._consecutiveFailures = UnifiedTradingAccount.OFFLINE_THRESHOLD
      this._lastError = msg
      this._lastFailureAt = new Date()
      this._startRecovery()
      throw err
    }
  }

  private async _callBroker<T>(fn: () => Promise<T>): Promise<T> {
    if (this._disabled) {
      throw new BrokerError('CONFIG', `Account "${this.label}" is disabled due to configuration error: ${this._lastError}`)
    }
    if (this.health === 'offline' && this._recovering) {
      throw new BrokerError('NETWORK', `Account "${this.label}" is offline and reconnecting. Try again shortly.`)
    }
    try {
      const result = await fn()
      this._onSuccess()
      return result
    } catch (err) {
      const brokerErr = BrokerError.from(err)
      this._onFailure(brokerErr)
      throw brokerErr
    }
  }

  private _emitHealthChange(): void {
    this._onHealthChange?.(this.id, this.getHealthInfo())
  }

  private _onSuccess(): void {
    const prev = this.health
    this._consecutiveFailures = 0
    this._lastSuccessAt = new Date()
    if (this._recoveryTimer) {
      clearTimeout(this._recoveryTimer)
      this._recoveryTimer = undefined
      this._recovering = false
    }
    if (prev !== this.health) this._emitHealthChange()
  }

  private _onFailure(err: unknown): void {
    const prev = this.health
    this._consecutiveFailures++
    this._lastError = err instanceof Error ? err.message : String(err)
    this._lastFailureAt = new Date()
    if (this.health === 'offline' && !this._recovering) {
      this._startRecovery()
    }
    if (prev !== this.health) this._emitHealthChange()
  }

  /** Nudge the recovery loop to retry immediately (e.g., when a data request finds this UTA offline). */
  nudgeRecovery(): void {
    if (!this._recovering || this._disabled) return
    if (this._recoveryTimer) clearTimeout(this._recoveryTimer)
    this._scheduleRecoveryAttempt(0)
  }

  private _startRecovery(): void {
    if (this._recovering) return
    this._recovering = true
    this._emitHealthChange()
    console.log(`UTA[${this.id}]: offline, starting auto-recovery...`)
    this._scheduleRecoveryAttempt(0)
  }

  private _scheduleRecoveryAttempt(attempt: number): void {
    const delay = Math.min(
      UnifiedTradingAccount.RECOVERY_BASE_MS * 2 ** attempt,
      UnifiedTradingAccount.RECOVERY_MAX_MS,
    )
    this._recoveryTimer = setTimeout(async () => {
      try {
        await this.broker.init()
        await this.broker.getAccount()
        this._onSuccess()
        console.log(`UTA[${this.id}]: auto-recovery succeeded`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (err instanceof BrokerError && err.permanent) {
          console.warn(`UTA[${this.id}]: disabled — ${msg}`)
          this._disabled = true
          this._recovering = false
          this._emitHealthChange()
          return
        }
        console.warn(`UTA[${this.id}]: recovery attempt ${attempt + 1} failed: ${msg}`)
        this._scheduleRecoveryAttempt(attempt + 1)
      }
    }, delay)
  }

  // ==================== aliceId management ====================

  /** Construct aliceId: "{utaId}|{nativeKey}" using broker's native identity. */
  private stampAliceId(contract: Contract): void {
    const nativeKey = this.broker.getNativeKey(contract)
    contract.aliceId = `${this.id}|${nativeKey}`
  }

  /** Parse aliceId → { utaId, nativeKey }, or null if invalid. */
  static parseAliceId(aliceId: string): { utaId: string; nativeKey: string } | null {
    const sep = aliceId.indexOf('|')
    if (sep === -1) return null
    return { utaId: aliceId.slice(0, sep), nativeKey: aliceId.slice(sep + 1) }
  }

  // ==================== Stage operations ====================

  stagePlaceOrder(params: StagePlaceOrderParams): AddResult {
    // Resolve aliceId → full contract via broker (fills secType, exchange, currency, conId, etc.)
    const parsed = UnifiedTradingAccount.parseAliceId(params.aliceId)
    if (!parsed) {
      throw new Error(`Invalid aliceId "${params.aliceId}". Use searchContracts to get a valid contract identifier (expected format: "accountId|nativeKey").`)
    }
    const contract = this.broker.resolveNativeKey(parsed.nativeKey)
    contract.aliceId = params.aliceId
    if (params.symbol) contract.symbol = params.symbol

    const order = new Order()
    order.action = params.action
    order.orderType = params.orderType
    order.tif = params.tif ?? 'DAY'

    if (params.totalQuantity != null) order.totalQuantity = new Decimal(String(params.totalQuantity))
    if (params.cashQty != null) order.cashQty = new Decimal(String(params.cashQty))
    if (params.lmtPrice != null) order.lmtPrice = new Decimal(String(params.lmtPrice))
    if (params.auxPrice != null) order.auxPrice = new Decimal(String(params.auxPrice))
    if (params.trailStopPrice != null) order.trailStopPrice = new Decimal(String(params.trailStopPrice))
    if (params.trailingPercent != null) order.trailingPercent = new Decimal(String(params.trailingPercent))
    if (params.goodTillDate != null) order.goodTillDate = params.goodTillDate
    if (params.outsideRth) order.outsideRth = true
    if (params.parentId != null) order.parentId = parseInt(params.parentId, 10) || 0
    if (params.ocaGroup != null) order.ocaGroup = params.ocaGroup

    const tpsl: TpSlParams | undefined =
      (params.takeProfit || params.stopLoss)
        ? { takeProfit: params.takeProfit, stopLoss: params.stopLoss }
        : undefined

    return this.git.add({ action: 'placeOrder', contract, order, tpsl })
  }

  stageModifyOrder(params: StageModifyOrderParams): AddResult {
    const changes: Partial<Order> = {}
    if (params.totalQuantity != null) changes.totalQuantity = new Decimal(String(params.totalQuantity))
    if (params.lmtPrice != null) changes.lmtPrice = new Decimal(String(params.lmtPrice))
    if (params.auxPrice != null) changes.auxPrice = new Decimal(String(params.auxPrice))
    if (params.trailStopPrice != null) changes.trailStopPrice = new Decimal(String(params.trailStopPrice))
    if (params.trailingPercent != null) changes.trailingPercent = new Decimal(String(params.trailingPercent))
    if (params.orderType != null) changes.orderType = params.orderType
    if (params.tif != null) changes.tif = params.tif
    if (params.goodTillDate != null) changes.goodTillDate = params.goodTillDate

    return this.git.add({ action: 'modifyOrder', orderId: params.orderId, changes })
  }

  stageClosePosition(params: StageClosePositionParams): AddResult {
    const parsed = UnifiedTradingAccount.parseAliceId(params.aliceId)
    if (!parsed) {
      throw new Error(`Invalid aliceId "${params.aliceId}". Use searchContracts to get a valid contract identifier (expected format: "accountId|nativeKey").`)
    }
    const contract = this.broker.resolveNativeKey(parsed.nativeKey)
    contract.aliceId = params.aliceId
    if (params.symbol) contract.symbol = params.symbol

    return this.git.add({
      action: 'closePosition',
      contract,
      quantity: params.qty != null ? new Decimal(String(params.qty)) : undefined,
    })
  }

  stageCancelOrder(params: { orderId: string }): AddResult {
    return this.git.add({ action: 'cancelOrder', orderId: params.orderId })
  }

  // ==================== Git flow ====================

  commit(message: string): CommitPrepareResult {
    return this.git.commit(message)
  }

  async push(): Promise<PushResult> {
    if (this._disabled) {
      throw new BrokerError('CONFIG', `Account "${this.label}" is disabled due to configuration error.`)
    }
    if (this.health === 'offline') {
      throw new Error(`Account "${this.label}" is offline. Cannot execute trades.`)
    }
    const result = await this.git.push()
    Promise.resolve(this._onPostPush?.(this.id)).catch(() => {})
    return result
  }

  async reject(reason?: string): Promise<RejectResult> {
    const result = await this.git.reject(reason)
    Promise.resolve(this._onPostReject?.(this.id)).catch(() => {})
    return result
  }

  // ==================== Git queries ====================

  log(options?: { limit?: number; symbol?: string }): CommitLogEntry[] {
    return this.git.log(options)
  }

  show(hash: string): GitCommit | null {
    return this.git.show(hash)
  }

  status(): GitStatus {
    return this.git.status()
  }

  async sync(opts?: { delayMs?: number }): Promise<SyncResult> {
    const pendingOrders = this.git.getPendingOrderIds()
    if (pendingOrders.length === 0) {
      return { hash: '', updatedCount: 0, updates: [] }
    }

    // Optional delay — gives exchange APIs time to settle before querying
    if (opts?.delayMs) await new Promise(r => setTimeout(r, opts.delayMs))

    const updates: OrderStatusUpdate[] = []

    for (const { orderId, symbol } of pendingOrders) {
      const brokerOrder = await this._callBroker(() => this.broker.getOrder(orderId))
      if (!brokerOrder) continue

      const status = brokerOrder.orderState.status
      if (status !== 'Submitted' && status !== 'PreSubmitted') {
        // Extract fill data when available
        const orderFilledQty = brokerOrder.order.filledQuantity
        const filledQty = orderFilledQty && !orderFilledQty.equals(UNSET_DECIMAL)
          ? orderFilledQty.toNumber()
          : undefined

        updates.push({
          orderId,
          symbol,
          previousStatus: 'submitted',
          currentStatus: status === 'Filled' ? 'filled' : status === 'Cancelled' ? 'cancelled' : 'rejected',
          filledQty,
          filledPrice: brokerOrder.avgFillPrice,
        })
      }
    }

    if (updates.length === 0) {
      return { hash: '', updatedCount: 0, updates: [] }
    }

    const state = await this._getState()
    return this.git.sync(updates, state)
  }

  getPendingOrderIds(): Array<{ orderId: string; symbol: string }> {
    return this.git.getPendingOrderIds()
  }

  simulatePriceChange(priceChanges: PriceChangeInput[]): Promise<SimulatePriceChangeResult> {
    return this.git.simulatePriceChange(priceChanges)
  }

  setCurrentRound(round: number): void {
    this.git.setCurrentRound(round)
  }

  // ==================== Broker queries (delegation) ====================

  getAccount(): Promise<AccountInfo> {
    return this._callBroker(() => this.broker.getAccount())
  }

  async getPositions(): Promise<Position[]> {
    const positions = await this._callBroker(() => this.broker.getPositions())
    for (const p of positions) this.stampAliceId(p.contract)
    return positions
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    const orders = await this._callBroker(() => this.broker.getOrders(orderIds))
    for (const o of orders) this.stampAliceId(o.contract)
    return orders
  }

  async getQuote(contract: Contract): Promise<Quote> {
    const quote = await this._callBroker(() => this.broker.getQuote(contract))
    this.stampAliceId(quote.contract)
    return quote
  }

  getMarketClock(): Promise<MarketClock> {
    return this._callBroker(() => this.broker.getMarketClock())
  }

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    const results = await this._callBroker(() => this.broker.searchContracts(pattern))
    for (const desc of results) this.stampAliceId(desc.contract)
    return results
  }

  /**
   * Optional broker-side catalog refresh (Alpaca, CCXT, Mock — those that
   * cache an enumerable list locally). No-op for brokers that source search
   * server-side (IBKR). Caller — typically a cron job — gets a resolved
   * promise either way and a thrown exception if the broker tried and
   * failed to refresh.
   */
  async refreshCatalog(): Promise<void> {
    if (typeof this.broker.refreshCatalog !== 'function') return
    await this._callBroker(() => this.broker.refreshCatalog!())
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    const details = await this._callBroker(() => this.broker.getContractDetails(query))
    if (details) this.stampAliceId(details.contract)
    return details
  }

  getCapabilities(): AccountCapabilities {
    return this.broker.getCapabilities()
  }

  // ==================== State ====================

  getState(): Promise<GitState> {
    return this._getState()
  }

  exportGitState(): GitExportState {
    return this.git.exportState()
  }

  // ==================== Lifecycle ====================

  async close(): Promise<void> {
    if (this._recoveryTimer) {
      clearTimeout(this._recoveryTimer)
      this._recoveryTimer = undefined
      this._recovering = false
    }
    return this.broker.close()
  }
}
