/**
 * UnifiedTradingAccount (UTA) — the business entity for trading.
 *
 * Owns: broker connection (IBroker), operation history (TradingGit), and strategy guards.
 * AI and frontend interact with this class, never with IBroker directly.
 *
 * Analogous to a git repository: each UTA maintains its own commit history.
 */

import Decimal from 'decimal.js'
import { Contract, Order, ContractDescription, ContractDetails, UNSET_DECIMAL, UNSET_INTEGER, UNSET_DOUBLE } from '@traderalice/ibkr'
import { BrokerError, type IBroker, type AccountInfo, type Position, type OpenOrder, type PlaceOrderResult, type Quote, type MarketClock, type AccountCapabilities, type BrokerHealth, type BrokerHealthInfo, type BrokerConnectionStateEvent, type UTAReach, type UTATier, type TpSlParams, type Bar, type BarParams, type ExpandContractFilters, type ContractExpansion, type SubAccountRef } from './brokers/types.js'

const REACH_RANK: Record<UTAReach, number> = { down: 0, connected: 1, readable: 2 }
import { TradingGit } from './git/TradingGit.js'
import { recomputeCostBasisFromCommits } from './cost-basis.js'
import { projectOrderHistory, projectTradeHistory } from './order-history.js'
import type { OrderHistoryEntry, TradeHistoryEntry } from '@traderalice/uta-protocol'
import { pnlOf } from './position-math.js'
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
  /** Refuse external account mutations. Proposal staging stays local; push is blocked. Implied by keyless. */
  readOnly?: boolean
  /** Public-data-only account (no key) — no account/positions; excluded from
   *  equity aggregation. Implies readOnly. */
  keyless?: boolean
  /** Whether this UTA participates in broker-backed market-data discovery. */
  asVendor?: boolean
}

// ==================== Stage param types ====================

/**
 * All numeric fields are strings — Decimal precision must be
 * preserved through the staging layer into the persisted git
 * operation records. Callers (AI tools, HTTP routes) that have a
 * number must convert via `String(x)` at the boundary; that's
 * deliberate friction so the precision-loss point is explicit.
 */
// Stage param types live in `@traderalice/uta-protocol` (the SDK
// contract surface). Re-exported here so existing callers within
// `domain/trading/**` keep their relative imports working.
export type {
  StagePlaceOrderParams,
  StageModifyOrderParams,
  StageClosePositionParams,
} from '@traderalice/uta-protocol'
import type {
  StagePlaceOrderParams,
  StageModifyOrderParams,
  StageClosePositionParams,
} from '@traderalice/uta-protocol'

// ==================== UnifiedTradingAccount ====================

export class UnifiedTradingAccount {
  readonly id: string
  readonly label: string
  readonly broker: IBroker
  readonly git: TradingGit
  /** Public-data-only (no key, no account/positions, excluded from equity agg). */
  readonly keyless: boolean
  /** External account mutations refused (implied by keyless). */
  readonly readOnly: boolean
  /** Broker-backed market-data discovery participation. */
  readonly asVendor: boolean

  private readonly _getState: () => Promise<GitState>
  private readonly _onHealthChange?: (accountId: string, health: BrokerHealthInfo) => void
  private readonly _onPostPush?: (accountId: string) => void | Promise<void>
  private readonly _onPostReject?: (accountId: string) => void | Promise<void>

  // ---- Health tracking ----
  private static readonly DEGRADED_THRESHOLD = 3
  private static readonly OFFLINE_THRESHOLD = 6
  private static readonly RECOVERY_BASE_MS = 5_000
  private static readonly RECOVERY_MAX_MS = 60_000
  /** Grace a read gives the INITIAL connect before it fast-fails with CONNECTING.
   *  An instantly-connecting broker (mock, warm cache) settles within this and
   *  serves real data; a slow one (CCXT loadMarkets, tens of seconds) blows past
   *  it and the read returns "connecting" instead of blocking on the whole init.
   *  Bounds the cold-start first-read to this, not the full connect time. */
  private static readonly CONNECT_GRACE_MS = 1_500

  private _consecutiveFailures = 0
  private _lastError?: string
  private _lastSuccessAt?: Date
  private _lastFailureAt?: Date
  private _recoveryTimer?: ReturnType<typeof setTimeout>
  private _recovering = false
  private _disabled = false
  /** True while the INITIAL broker connect is in flight (e.g. CCXT loadMarkets,
   *  which can take tens of seconds). Reads during this window return fast with
   *  a transient CONNECTING error instead of blocking on the slow connect — the
   *  bug that made the whole UI hang ~30s on cold start while the optimistic
   *  reach (below) reported "healthy". Flips false when `_connectPromise`
   *  settles; never set true again (re-connects go through the recovery loop,
   *  which has its own gate). Orthogonal to `_recovering`. */
  private _connecting = true
  /** Current rung on the capability ladder. Updated by every connect/recovery
   *  probe and by live broker-call success/failure. */
  private _currentReach: UTAReach = 'down'
  private _connectPromise: Promise<void>
  /** Sub-account (wallet) list, cached from the broker once it connects. Null
   *  until first probed. Static per connection (CCXT derives it from venue
   *  overrides — network-independent), so caching can't go stale. Drives the
   *  write-disambiguation guard. */
  private _subAccounts: SubAccountRef[] | null = null
  /** Sub-account ids declared by writes staged-but-not-yet-committed, parallel
   *  to the git staging area. Stamped into the commit message at commit time
   *  (the ledger records the wallet without touching the Operation schema),
   *  then cleared. */
  private _stagedSubAccountIds: string[] = []

  constructor(broker: IBroker, options: UnifiedTradingAccountOptions = {}) {
    this.broker = broker
    this.id = broker.id
    this.label = broker.label
    this.keyless = options.keyless ?? false
    this.readOnly = options.readOnly ?? options.keyless ?? false
    this.asVendor = options.asVendor ?? true
    // Optimistically assume we'll reach this account's target until the first
    // probe says otherwise — preserves "usable immediately after construction"
    // (the probe corrects/demotes within ms).
    this._currentReach = this.targetReach
    this._onHealthChange = options.onHealthChange
    this._onPostPush = options.onPostPush
    this._onPostReject = options.onPostReject
    this.broker.setConnectionStateListener?.((event) => this._onBrokerConnectionState(event))

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
      this._assertCanMutateAccount(op.action)
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

    // Kick off broker connection asynchronously — UTA is usable immediately;
    // reads during the connect window return a fast transient CONNECTING marker
    // (see `_connecting` / `_callBroker`) rather than blocking on init.
    // `_connecting` is cleared INSIDE _connect() (right after the connect probe
    // settles, before the health-change emit) so the first emitted health diff
    // already carries connecting:false — clearing it here in a .finally would
    // run after that emit and leave the UI stuck on "connecting".
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

  /** What this account is for (static): keyless → data, funded+readOnly →
   *  account, funded+writable → trading. */
  get tier(): UTATier {
    if (this.keyless) return 'data'
    return this.readOnly ? 'account' : 'trading'
  }

  /** The reach the recovery loop aims for. A data account is done at 'connected'
   *  (public data, no key); funded accounts want 'readable' (account read). */
  get targetReach(): UTAReach {
    return this.tier === 'data' ? 'connected' : 'readable'
  }

  get reach(): UTAReach {
    return this._currentReach
  }

  private _reachedTarget(): boolean {
    return REACH_RANK[this._currentReach] >= REACH_RANK[this.targetReach]
  }

  get health(): BrokerHealth {
    if (this._disabled) return 'offline'
    if (this._currentReach === 'down') return 'offline'
    if (this._consecutiveFailures >= UnifiedTradingAccount.OFFLINE_THRESHOLD) return 'offline'
    // Reachable but below the account's target (e.g. funded account: markets up
    // but account-read failing) → degraded, NOT a full outage. This is the fix
    // for "a transient getAccount blip nukes a healthy connection".
    if (!this._reachedTarget()) return 'degraded'
    if (this._consecutiveFailures >= UnifiedTradingAccount.DEGRADED_THRESHOLD) return 'degraded'
    return 'healthy'
  }

  get disabled(): boolean {
    return this._disabled
  }

  getHealthInfo(): BrokerHealthInfo {
    return {
      status: this.health,
      reach: this._currentReach,
      tier: this.tier,
      consecutiveFailures: this._consecutiveFailures,
      lastError: this._lastError,
      lastSuccessAt: this._lastSuccessAt,
      lastFailureAt: this._lastFailureAt,
      recovering: this._recovering,
      connecting: this._connecting,
      disabled: this._disabled,
    }
  }

  /** Probe the capability ladder up to this account's target reach. Stages:
   *  L1 `broker.init()` (transport + public data) → 'connected'; for funded
   *  accounts only, L2 `broker.getAccount()` (private read) → 'readable'. A
   *  keyless data account stops at L1 and NEVER calls getAccount — so it can't
   *  loop on "requires apiKey". Sets `_disabled` on a permanent config error. */
  private async _attemptReach(): Promise<UTAReach> {
    try {
      await this.broker.init()
    } catch (err) {
      this._notePermanent(err)
      this._noteFailure(err)
      return 'down'
    }
    if (this.targetReach === 'connected') {
      this._lastSuccessAt = new Date()
      return 'connected'
    }
    try {
      await this.broker.getAccount()
      this._lastSuccessAt = new Date()
      return 'readable'
    } catch (err) {
      this._notePermanent(err)
      this._noteFailure(err)
      return 'connected' // transport up, but private read failing
    }
  }

  private _notePermanent(err: unknown): void {
    // Broker packs may carry their own physical copy of uta-protocol. Preserve
    // the structured BrokerError contract across that module boundary instead
    // of relying exclusively on class identity.
    if (
      err instanceof BrokerError
      ? err.permanent
      : !!err && typeof err === 'object'
        && (err as { name?: unknown }).name === 'BrokerError'
        && (err as { permanent?: unknown }).permanent === true
    ) this._disabled = true
  }
  private _noteFailure(err: unknown): void {
    this._lastError = err instanceof Error ? err.message : String(err)
    this._lastFailureAt = new Date()
  }

  /** A broker heartbeat knows more than passive failure counting: once the
   * transport is explicitly dead, serving a green health badge is unsafe.
   * Recovery still has to pass the normal capability ladder before the UTA is
   * marked healthy again. */
  private _onBrokerConnectionState(event: BrokerConnectionStateEvent): void {
    if (event.state === 'alive') return
    if (event.state === 'restored') {
      this.nudgeRecovery()
      return
    }
    if (this._disabled) return

    this._currentReach = 'down'
    this._consecutiveFailures = UnifiedTradingAccount.OFFLINE_THRESHOLD
    this._lastError = event.error ?? 'Broker transport reported a dead connection'
    this._lastFailureAt = new Date()

    // During the initial handshake, _connect owns the transition into recovery
    // and will emit the first settled health snapshot.
    if (this._connecting) return
    if (!this._recovering) this._startRecovery()
    else this._emitHealthChange()
  }

  /** Initial broker connection — fire-and-forget from constructor. */
  private async _connect(): Promise<void> {
    // Timed + logged: the connect duration is the cold-start cost this whole
    // non-blocking path exists to absorb, so surface it on the console (a slow
    // CCXT loadMarkets is otherwise an invisible ~30s stall).
    const startedAt = Date.now()
    console.log(`UTA[${this.id}]: connecting (target ${this.targetReach})…`)
    this._currentReach = await this._attemptReach()
    // Initial connect has settled (reached, down, or disabled — _attemptReach
    // never throws). Clear the connecting gate now, BEFORE any _emitHealthChange
    // below, so the first health diff the UI receives reflects the real state.
    // Re-connections go through the recovery loop, which has its own gating.
    this._connecting = false
    // Warm the sub-account cache once the transport is up, so the (sync)
    // write-disambiguation guard has the list before any staging. Best-effort:
    // a failure here must not break connection.
    if (!this._disabled && this._currentReach !== 'down') {
      try { await this._ensureSubAccounts() } catch { /* guard falls back to single-default */ }
    }
    if (this._disabled) {
      console.warn(`UTA[${this.id}]: disabled — ${this._lastError}`)
      this._emitHealthChange()
      throw new BrokerError('CONFIG', this._lastError ?? `Account "${this.label}" disabled`)
    }
    if (this._reachedTarget()) {
      this._onSuccess()
      this._emitHealthChange()
      console.log(`UTA[${this.id}]: ${this._currentReach} (${this.tier}) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
      return
    }
    // Below target → recover toward it.
    if (this._currentReach === 'down') this._consecutiveFailures = UnifiedTradingAccount.OFFLINE_THRESHOLD
    this._startRecovery()
    this._emitHealthChange()
    if (this._currentReach === 'down') {
      console.warn(`UTA[${this.id}]: unreachable after ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${this._lastError ?? 'no detail'} (recovering)`)
      throw new BrokerError('NETWORK', this._lastError ?? `Account "${this.label}" unreachable`)
    }
    // 'connected' but funded wants 'readable' — partial; recovery pursues it.
  }

  /** Race the initial connect against a short grace window. Resolves as soon as
   *  the connect settles (an instant broker wins via microtask, well before the
   *  timer) or the grace elapses (a slow broker). The caller re-checks
   *  `_connecting` afterwards to decide whether to proceed or fast-fail. */
  private _awaitConnectOrGrace(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, UnifiedTradingAccount.CONNECT_GRACE_MS)
      timer.unref?.()
    })
    return Promise.race([this._connectPromise.catch(() => {}), grace])
      .finally(() => { if (timer) clearTimeout(timer) })
  }

  private async _callBroker<T>(fn: () => Promise<T>): Promise<T> {
    if (this._disabled) {
      throw new BrokerError('CONFIG', `Account "${this.label}" is disabled due to configuration error: ${this._lastError}`)
    }
    // Initial connect still in flight (e.g. CCXT loadMarkets). Give it a short
    // grace: an instant broker settles within it and the read proceeds with real
    // data; a slow one is still connecting afterwards and we return FAST instead
    // of blocking on the whole init. Thrown BEFORE the try block, so it never
    // reaches _onFailure: no failure counter, no health degrade, no premature
    // recovery. The background connect keeps going; a later read gets real data.
    // This is the fix for the ~30s cold-start hang.
    if (this._connecting) {
      await this._awaitConnectOrGrace()
      if (this._connecting) {
        throw new BrokerError('CONNECTING', `Account "${this.label}" is still connecting to the broker. Data will be available shortly.`)
      }
    }
    if (this.health === 'offline' && this._recovering) {
      throw new BrokerError('CONNECTING', `Account "${this.label}" is offline and reconnecting. Try again shortly.`)
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
    }
    this._recovering = false
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
    this._scheduleRecoveryAttempt(0, 0)
  }

  private _startRecovery(): void {
    if (this._recovering) return
    this._recovering = true
    this._emitHealthChange()
    console.log(`UTA[${this.id}]: offline, starting auto-recovery...`)
    this._scheduleRecoveryAttempt(0)
  }

  private _scheduleRecoveryAttempt(attempt: number, delayOverride?: number): void {
    const delay = delayOverride ?? Math.min(
      UnifiedTradingAccount.RECOVERY_BASE_MS * 2 ** attempt,
      UnifiedTradingAccount.RECOVERY_MAX_MS,
    )
    this._recoveryTimer = setTimeout(async () => {
      this._recoveryTimer = undefined
      this._currentReach = await this._attemptReach()
      if (this._disabled) {
        this._recovering = false
        console.warn(`UTA[${this.id}]: disabled — ${this._lastError}`)
        this._emitHealthChange()
        return
      }
      if (this._reachedTarget()) {
        this._onSuccess() // resets failures, clears timer + _recovering, emits
        console.log(`UTA[${this.id}]: auto-recovery succeeded (${this._currentReach})`)
      } else {
        console.warn(`UTA[${this.id}]: recovery attempt ${attempt + 1} reached "${this._currentReach}" (target "${this.targetReach}"): ${this._lastError ?? 'below target'}`)
        this._emitHealthChange() // reflect partial progress (down → connected)
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

  /**
   * Reverse of `stampAliceId`: parse an aliceId, verify it belongs to this
   * UTA, and rebuild the full Contract via the broker's native-key resolver.
   * Throws on malformed input or cross-UTA mismatch — those are caller bugs
   * (AI passing an aliceId from a different account, or stale state) and
   * should surface loudly rather than silently no-op.
   *
   * Use this whenever an AI tool or HTTP route receives an aliceId from the
   * outside and needs to call a broker read API (getQuote, getOrderBook,
   * getFundingRate, getContractDetails). The staging methods below also
   * funnel through here for consistency.
   */
  contractFromAliceId(aliceId: string): Contract {
    const parsed = UnifiedTradingAccount.parseAliceId(aliceId)
    if (!parsed) {
      throw new Error(`Invalid aliceId "${aliceId}". Use searchContracts to get a valid contract identifier (expected format: "accountId|nativeKey").`)
    }
    if (parsed.utaId !== this.id) {
      throw new Error(`aliceId "${aliceId}" belongs to UTA "${parsed.utaId}", not "${this.id}".`)
    }
    const contract = this.broker.resolveNativeKey(parsed.nativeKey)
    contract.aliceId = aliceId
    return contract
  }

  // ==================== Stage operations ====================

  /** Loud-refuse proposal staging on a keyless public-data source. */
  private _assertCanCreateProposal(): void {
    if (this.keyless) {
      throw new BrokerError('CONFIG',
        `Account "${this.label}" is a keyless public-data account — trading proposals require a funded account.`)
    }
  }

  /** Loud-refuse broker-side account mutations on read-only / keyless accounts. */
  private _assertCanMutateAccount(action: string): void {
    if (this.readOnly) {
      throw new BrokerError('CONFIG',
        `Account "${this.label}" is read-only${this.keyless ? ' (keyless public-data account)' : ''} — ${action} would mutate the external account, which is not allowed.`)
    }
  }

  /**
   * Per-orderType required-field gate, enforced at stage time so a broken
   * order can never reach staging/commit. Without this, a caller that loses
   * fields on the way in (e.g. a CLI typo like --quantity for --totalQuantity)
   * stages a quantity-less LMT order that looks perfectly committable.
   */
  private _validatePlaceOrderParams(p: StagePlaceOrderParams): void {
    const fail = (msg: string): never => {
      throw new Error(`placeOrder (${p.orderType}): ${msg}`)
    }
    const has = (v: unknown): boolean => v != null && String(v) !== ''
    const qty = has(p.totalQuantity)
    const cash = has(p.cashQty)
    if (qty && cash) fail('totalQuantity and cashQty are mutually exclusive — provide exactly one.')
    if (p.orderType === 'MKT') {
      if (!qty && !cash) fail('requires totalQuantity (shares) or cashQty (notional).')
    } else {
      if (cash) fail('cashQty (notional) is only supported for MKT orders — use totalQuantity.')
      if (!qty) fail('requires totalQuantity.')
    }
    switch (p.orderType) {
      case 'LMT':
        if (!has(p.lmtPrice)) fail('requires lmtPrice.')
        break
      case 'STP':
        if (!has(p.auxPrice)) fail('requires auxPrice (stop trigger price).')
        break
      case 'STP LMT':
        if (!has(p.auxPrice)) fail('requires auxPrice (stop trigger price).')
        if (!has(p.lmtPrice)) fail('requires lmtPrice.')
        break
      case 'TRAIL':
      case 'TRAIL LIMIT': {
        const aux = has(p.auxPrice)
        const pct = has(p.trailingPercent)
        if (aux && pct) fail('auxPrice and trailingPercent are mutually exclusive — provide exactly one.')
        if (!aux && !pct) fail('requires auxPrice (trailing offset) or trailingPercent.')
        if (p.orderType === 'TRAIL LIMIT' && !has(p.lmtPrice)) fail('requires lmtPrice.')
        break
      }
    }
  }

  // ==================== Sub-accounts ====================

  /** Fetch (and memoize) the broker's sub-account list. Brokers that don't
   *  implement `listSubAccounts` collapse to a single implicit 'default'. */
  private async _ensureSubAccounts(): Promise<SubAccountRef[]> {
    if (this._subAccounts) return this._subAccounts
    const list = this.broker.listSubAccounts ? await this.broker.listSubAccounts() : null
    this._subAccounts = list && list.length ? list : [{ id: 'default', label: this.label, kind: 'unified' }]
    return this._subAccounts
  }

  /** The sub-accounts (wallets) this connection spans. One element for ordinary
   *  brokers; >1 only for separate-wallet venues (CCXT Binance: spot / futures). */
  async listSubAccounts(): Promise<SubAccountRef[]> {
    return this._ensureSubAccounts()
  }

  /**
   * Resolve + validate the target sub-account for a proposed account mutation. When the connection
   * spans >1 sub-account, an explicit selector is REQUIRED (placing an order is
   * irreversible — we never guess a wallet). The selector is also checked
   * against the instrument: "place this on spot" with a perp contract
   * loud-refuses. Returns the resolved id to stamp into the commit message, or
   * undefined for single-sub-account brokers (nothing to disambiguate or stamp).
   */
  private _resolveWriteSubAccount(contract: Contract, requested?: string): string | undefined {
    const subs = this._subAccounts ?? []
    if (subs.length <= 1) return undefined  // single (or not-yet-probed) → nothing to disambiguate

    const valid = subs.map(s => s.id).join(', ')
    const expected = this.broker.subAccountForContract?.(contract)
    const instr = contract.secType || 'this instrument'

    if (!requested) {
      throw new BrokerError('CONFIG',
        `Account "${this.label}" has multiple sub-accounts (${subs.map(s => `${s.id} [${s.kind}]`).join(', ')}). ` +
        `Re-issue this write with subAccountId` +
        (expected ? `="${expected}" (where ${instr} trades).` : ` set to one of: ${valid}.`))
    }
    if (!subs.some(s => s.id === requested)) {
      throw new BrokerError('CONFIG',
        `Account "${this.label}": unknown sub-account "${requested}". Valid sub-accounts: ${valid}.`)
    }
    if (expected && expected !== requested) {
      throw new BrokerError('CONFIG',
        `Account "${this.label}": ${instr} trades in sub-account "${expected}", not "${requested}". ` +
        `Re-issue with subAccountId="${expected}".`)
    }
    return requested
  }

  // ==================== Staging ====================

  stagePlaceOrder(params: StagePlaceOrderParams): AddResult {
    this._assertCanCreateProposal()
    this._validatePlaceOrderParams(params)
    // Resolve aliceId → full contract via broker (fills secType, exchange, currency, conId, etc.)
    const contract = this.contractFromAliceId(params.aliceId)
    if (params.symbol) contract.symbol = params.symbol

    const subAccountId = this._resolveWriteSubAccount(contract, params.subAccountId)
    if (subAccountId) this._stagedSubAccountIds.push(subAccountId)

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
    this._assertCanCreateProposal()
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
    this._assertCanCreateProposal()
    const contract = this.contractFromAliceId(params.aliceId)
    if (params.symbol) contract.symbol = params.symbol

    const subAccountId = this._resolveWriteSubAccount(contract, params.subAccountId)
    if (subAccountId) this._stagedSubAccountIds.push(subAccountId)

    return this.git.add({
      action: 'closePosition',
      contract,
      quantity: params.qty != null ? new Decimal(String(params.qty)) : undefined,
    })
  }

  stageCancelOrder(params: { orderId: string }): AddResult {
    this._assertCanCreateProposal()
    return this.git.add({ action: 'cancelOrder', orderId: params.orderId })
  }

  // ==================== Git flow ====================

  commit(message: string): CommitPrepareResult {
    const result = this.git.commit(this._stampSubAccount(message))
    // Sub-account intent is now baked into the persisted message — clear the
    // transient tracker so the next staging batch starts clean.
    this._stagedSubAccountIds = []
    return result
  }

  /** Append a `[sub:…]` tag to the commit message recording which wallet(s) the
   *  staged writes targeted. The ONLY place the sub-account is persisted — the
   *  Operation / GitCommit schema is deliberately left untouched. No-op when no
   *  multi-sub-account write was staged. */
  private _stampSubAccount(message: string): string {
    const ids = [...new Set(this._stagedSubAccountIds)]
    return ids.length ? `${message} [sub:${ids.join(',')}]` : message
  }

  async push(): Promise<PushResult> {
    this._assertCanMutateAccount('push')
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
    this._stagedSubAccountIds = []
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

  /**
   * Sync cost model — two strategies, picked by broker capability:
   *
   * LISTING (broker has getOpenOrders): ONE listing call covers every
   * pending order. An order still present is alive — zero further calls,
   * no matter how long it hangs (stop-loss / take-profit orders can sit
   * for weeks; per-order polling would be 8.6k calls/day EACH). An order
   * ABSENT from the listing transitioned — only then is getOrder spent to
   * confirm the terminal state + execution data. Absence alone is never
   * trusted as terminal: conditional/algo orders on some venues live in a
   * different listing namespace, so a vanished-but-still-Submitted confirm
   * is treated as "still working".
   *
   * PER-ORDER (no listing capability): poll each pending order with
   * age-based backoff — fresh orders (likely marketable) every pass, then
   * 1m, then 5m once they've proven to be hangers.
   */
  async sync(opts?: { delayMs?: number }): Promise<SyncResult> {
    const pendingOrders = this.git.getPendingOrderIds()
    if (pendingOrders.length === 0) {
      return { hash: '', updatedCount: 0, updates: [] }
    }

    // Optional delay — gives exchange APIs time to settle before querying
    if (opts?.delayMs) await new Promise(r => setTimeout(r, opts.delayMs))

    let candidates = pendingOrders
    if (this.broker.getOpenOrders) {
      const listing = await this._callBroker(() => this.broker.getOpenOrders!())
      const openIds = new Set(listing.map((o) => o.orderId).filter(Boolean))
      // Present in the listing → alive, skip. (A just-placed order missing
      // due to listing lag is also safe: its confirm returns Submitted.)
      candidates = pendingOrders.filter((p) => !openIds.has(p.orderId))
    } else {
      candidates = pendingOrders.filter((p) => this._pollBackoffDue(p.orderId))
    }

    if (candidates.length === 0) {
      return { hash: '', updatedCount: 0, updates: [] }
    }

    const updates: OrderStatusUpdate[] = []

    for (const { orderId, symbol, localSymbol } of candidates) {
      const brokerOrder = await this._callBroker(() => this.broker.getOrder(orderId, localSymbol))
      if (!brokerOrder) continue

      const status = brokerOrder.orderState.status
      if (status !== 'Submitted' && status !== 'PreSubmitted') {
        // Extract fill data when available — `.toFixed()` (not
        // `.toNumber()`) so sub-satoshi qty (OKX-style accounting)
        // round-trips into the persisted git operation record without
        // IEEE-754 truncation.
        const orderFilledQty = brokerOrder.order.filledQuantity
        const filledQty = orderFilledQty && !orderFilledQty.equals(UNSET_DECIMAL)
          ? orderFilledQty.toFixed()
          : undefined

        const currentStatus =
          status === 'Filled' ? 'filled' : status === 'Cancelled' ? 'cancelled' : 'rejected'
        if (currentStatus === 'filled' && (!filledQty || !brokerOrder.avgFillPrice)) {
          // Loud, not fatal: a fill without qty/price still advances the
          // state machine, but cost-basis reconstruction downstream will be
          // missing data — that must be visible, not silent.
          console.warn(
            `UTA[${this.id}]: order ${orderId} (${symbol}) synced to filled but broker omitted ` +
            `${!filledQty ? 'filledQuantity' : ''}${!filledQty && !brokerOrder.avgFillPrice ? ' and ' : ''}` +
            `${!brokerOrder.avgFillPrice ? 'avgFillPrice' : ''} — cost basis for this fill may be incomplete`,
          )
        }

        updates.push({
          orderId,
          symbol,
          previousStatus: 'submitted',
          currentStatus,
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

  getPendingOrderIds(): Array<{ orderId: string; symbol: string; localSymbol?: string }> {
    return this.git.getPendingOrderIds()
  }

  /** Exchange-frontend projection — same translation the UI and routes use. */
  async orderHistory(limit = 50): Promise<OrderHistoryEntry[]> {
    return projectOrderHistory(this.git.exportState().commits, { limit })
  }

  /** Exchange-frontend projection — fills only. */
  async tradeHistory(limit = 50): Promise<TradeHistoryEntry[]> {
    return projectTradeHistory(this.git.exportState().commits, { limit })
  }

  /** firstSeen/lastPolled per pending order — drives the per-order polling
   *  backoff for brokers without a listing API. In-memory only: a restart
   *  resets every order to "fresh", which just means one eager poll. */
  private _pollState = new Map<string, { firstSeenAt: number; lastPolledAt: number }>()

  private _pollBackoffDue(orderId: string): boolean {
    const now = Date.now()
    const state = this._pollState.get(orderId)
    if (!state) {
      this._pollState.set(orderId, { firstSeenAt: now, lastPolledAt: now })
      return true
    }
    const age = now - state.firstSeenAt
    // <2min old: every pass (marketable orders resolve here). <1h: every
    // 60s. Older: every 5min — it's a hanger (stop/take-profit), awareness
    // latency of minutes changes nothing about the execution itself.
    const interval = age < 2 * 60_000 ? 0 : age < 60 * 60_000 ? 60_000 : 5 * 60_000
    if (now - state.lastPolledAt < interval) return false
    state.lastPolledAt = now
    return true
  }

  /**
   * Faithful-record pass for orders Alice didn't place: diff the broker's
   * open orders against every orderId the log has ever seen, and squash the
   * unknowns into one [observed] commit. The log is the narrative, not the
   * state engine — this exists so "怎么回事" is always answerable from the
   * log. Once recorded (orderId + submitted), the regular pending scanner
   * and sync poller track the order's fill/cancel like any other.
   *
   * No-op (0 broker calls beyond the listing) when the broker can't
   * enumerate open orders or everything is already known.
   */
  async observeExternalOrders(): Promise<{ observed: number }> {
    if (!this.broker.getOpenOrders) return { observed: 0 }
    const open = await this._callBroker(() => this.broker.getOpenOrders!())
    if (open.length === 0) return { observed: 0 }

    const known = this.git.getKnownOrderIds()
    const unknown = open.filter((o) => o.orderId && !known.has(o.orderId))
    if (unknown.length === 0) return { observed: 0 }

    for (const o of unknown) this.stampAliceId(o.contract)
    const stateAfter = await this._getState()
    await this.git.recordObservedOrders({
      observed: unknown.map((o) => ({ contract: o.contract, order: o.order, orderId: o.orderId! })),
      stateAfter,
    })
    console.warn(`UTA[${this.id}]: recorded ${unknown.length} external order(s) not placed through Alice`)
    return { observed: unknown.length }
  }

  simulatePriceChange(priceChanges: PriceChangeInput[]): Promise<SimulatePriceChangeResult> {
    return this.git.simulatePriceChange(priceChanges)
  }

  setCurrentRound(round: number): void {
    this.git.setCurrentRound(round)
  }

  // ==================== Broker queries (delegation) ====================

  /**
   * Account info with the UTA-layer invariant enforced: account-level
   * unrealizedPnL ALWAYS equals the sum over reconciled positions. Brokers
   * can't uphold this themselves — wallet-sourced spot positions (CCXT
   * synthesis from fetchBalance) carry a placeholder unrealizedPnL of '0'
   * at the broker layer because cost basis lives in Alice's order log, not
   * on the exchange. Trusting broker-reported account PnL therefore shows
   * 0 for spot-only accounts while the positions surface shows real PnL
   * (the Bybit-demo aggregation bug). Deriving from positions makes the
   * two surfaces agree by construction, at the cost of one extra broker
   * round-trip per account read (a 60s-poll path, not a hot path).
   */
  async getAccount(subAccountId?: string): Promise<AccountInfo> {
    const account = await this._callBroker(() => this.broker.getAccount(subAccountId))
    const positions = await this.getPositions(subAccountId)
    // Currency guard: position PnLs can only be summed when they all share
    // the account's base currency. Mixed-currency books (IBKR holding HKD +
    // USD lines) would otherwise blind-sum different units — the exact bug
    // aggregateAccountFromPositions has today. Those accounts keep the
    // broker-reported value until the currency-aware FX aggregation lands.
    const summable = positions.every(
      (p) => (p.currency || account.baseCurrency) === account.baseCurrency,
    )
    if (summable) {
      let unrealized = new Decimal(0)
      for (const p of positions) {
        unrealized = unrealized.plus(new Decimal(p.unrealizedPnL || '0'))
      }
      account.unrealizedPnL = unrealized.toString()
    }
    return account
  }

  async getPositions(subAccountId?: string): Promise<Position[]> {
    const positions = await this._callBroker(() => this.broker.getPositions(subAccountId))
    for (const p of positions) this.stampAliceId(p.contract)
    await this._reconcileWalletPositions(positions)
    return positions
  }

  /**
   * For positions whose broker doesn't supply an authoritative avgCost
   * (CCXT spot synthesis), reconstruct cost basis from Alice's order log
   * — bootstrapping any quantity drift via a synthesized `reconcileBalance`
   * commit at observed markPrice. Mutates `positions` in place: replaces
   * the placeholder avgCost and recomputes unrealizedPnL.
   */
  private async _reconcileWalletPositions(positions: Position[]): Promise<void> {
    const walletPositions = positions.filter(p => p.avgCostSource === 'wallet')
    if (walletPositions.length === 0) return

    // Race guard (observed live as commit dfb01435): a fill can land on the
    // exchange between the broker's position read and the poller's sync
    // pass. The position already shows the new quantity, but the projection
    // doesn't include the fill yet — naive drift detection would book it as
    // a reconcileBalance at the OBSERVATION-TIME mark price, polluting cost
    // basis with the wrong price and double-counting once sync records the
    // real execution. While an aliceId has in-flight orders, its drift
    // belongs to sync; reconcile only what no pending order can explain.
    // True residuals (fee-in-kind dust, external transfers racing an open
    // order) get reconciled on the next pass after the order settles.
    const inFlight = new Set(
      this.git.getPendingOrderIds().map((p) => p.aliceId).filter(Boolean),
    )

    for (const p of walletPositions) {
      const aliceId = p.contract.aliceId
      if (!aliceId) continue

      const commits = this.git.exportState().commits
      const projected = recomputeCostBasisFromCommits(commits, aliceId)
      const projectedQty = projected?.qty ?? new Decimal(0)
      const drift = p.quantity.minus(projectedQty)

      // Tolerance: dust-level differences (sub-1e-8) come from precision
      // round-trips, not from real balance changes. The in-flight guard
      // only suppresses RECORDING — the avgCost/PnL projection below still
      // applies, so a position with a weeks-long hanging stop order keeps
      // its real cost basis on screen throughout.
      if (!inFlight.has(aliceId) && drift.abs().gt(new Decimal('1e-8'))) {
        // Bootstrap price: prefer broker-reported avgCost when non-zero
        // (Mock externalTrade, future CCXT-with-fetchMyTrades, anything
        // that observed a real fill price). Fall back to markPrice only
        // when the broker has nothing — current CCXT spot synthesis sets
        // avgCost equal to markPrice anyway, so the fallback case
        // produces identical behavior there.
        const brokerAvgCost = p.avgCost ? new Decimal(p.avgCost) : new Decimal(0)
        const bootstrapPrice = brokerAvgCost.gt(0) ? brokerAvgCost : new Decimal(p.marketPrice)
        await this.git.recordReconcile({
          aliceId,
          quantityDelta: drift,
          markPrice: bootstrapPrice,
          stateAfter: this._buildReconcileStateAfter(positions),
        })
      }

      // Recompute (post-reconcile if drift was applied; otherwise unchanged).
      const finalCommits = this.git.exportState().commits
      const final = recomputeCostBasisFromCommits(finalCommits, aliceId)
      if (!final) continue  // Should be unreachable — reconcile would seed it.

      p.avgCost = final.avgCost.toString()
      // Cost-basis WAC operates on per-unit prices; the IBroker.Position
      // contract requires unrealizedPnL to be multiplier-applied.
      // `pnlOf` enforces the rule (defaults multiplier to '1' if absent).
      p.unrealizedPnL = pnlOf({
        quantity: p.quantity,
        marketPrice: p.marketPrice,
        avgCost: final.avgCost,
        multiplier: p.multiplier || '1',
        side: p.side,
      })
    }
  }

  /**
   * Build a minimal GitState for a synthesized reconcile commit. The cost-
   * basis pipeline doesn't read stateAfter (it walks operations + results),
   * but the field is required by GitCommit and downstream snapshot code may
   * inspect it. We avoid recursing through `_getState` (which would refetch
   * broker positions) by reusing the in-flight positions array.
   */
  private _buildReconcileStateAfter(positions: Position[]): GitState {
    return {
      netLiquidation: '0',
      totalCashValue: '0',
      unrealizedPnL: '0',
      realizedPnL: '0',
      positions,
      pendingOrders: [],
    }
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    const orders = await this._callBroker(() => this.broker.getOrders(orderIds))
    for (const o of orders) this.stampAliceId(o.contract)
    return orders
  }

  async getQuote(contract: Contract): Promise<Quote> {
    const resolved = this._expandAliceIdIfNeeded(contract)
    const quote = await this._callBroker(() => this.broker.getQuote(resolved))
    this.stampAliceId(quote.contract)
    return quote
  }

  /**
   * Historical OHLCV bars. Loud-refuses (CONFIG error, not a silent `[]`) when
   * the broker has no `getHistorical`. Expands an aliceId-only stub to a
   * trade-ready contract first, same as getQuote. Bars carry no contract, so
   * there is no return-side aliceId stamping — the caller already holds it.
   */
  async getHistorical(contract: Contract, params: BarParams): Promise<Bar[]> {
    if (typeof this.broker.getHistorical !== 'function') {
      throw new BrokerError('CONFIG', `Account "${this.label}" does not support historical bars.`)
    }
    const resolved = this._expandAliceIdIfNeeded(contract)
    return this._callBroker(() => this.broker.getHistorical!(resolved, params))
  }

  getMarketClock(): Promise<MarketClock> {
    return this._callBroker(() => this.broker.getMarketClock())
  }

  /**
   * Hub → leaves expansion (bond issuers, option chains, futures months).
   * Loud-refuses when the broker has no hub semantics. Accepts a full
   * aliceId; hub keys (issuer:…) are passed to the broker verbatim — they
   * deliberately do NOT go through resolveNativeKey, which refuses them
   * (directories are not tradeable contracts).
   */
  async expandContract(aliceId: string, filters?: ExpandContractFilters): Promise<ContractExpansion> {
    if (typeof this.broker.expandContract !== 'function') {
      throw new BrokerError('CONFIG', `Account "${this.label}" does not support contract expansion.`)
    }
    const parsed = UnifiedTradingAccount.parseAliceId(aliceId)
    if (!parsed) {
      throw new Error(`Invalid aliceId "${aliceId}" — expected format: accountId|nativeKey`)
    }
    if (parsed.utaId !== this.id) {
      throw new Error(`aliceId "${aliceId}" belongs to UTA "${parsed.utaId}", not "${this.id}".`)
    }
    const result = await this._callBroker(() => this.broker.expandContract!(parsed.nativeKey, filters))
    for (const c of result.contracts ?? []) this.stampAliceId(c)
    return result
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
    const resolved = this._expandAliceIdIfNeeded(query)
    const details = await this._callBroker(() => this.broker.getContractDetails(resolved))
    if (details) this.stampAliceId(details.contract)
    return details
  }

  /** Internal: if the caller passed `{ aliceId, ...overrides }` without a
   *  populated symbol/localSymbol, expand via the broker's native-key
   *  decoder and overlay any explicit overrides. Keeps the in-process
   *  callers (AI tool, ad-hoc scripts) and the HTTP route layer on the
   *  same expansion path so brokers never see an aliceId-only stub. */
  private _expandAliceIdIfNeeded(contract: Contract): Contract {
    const hasNative = !!(contract.symbol || contract.localSymbol)
    if (!contract.aliceId || hasNative) return contract
    const expanded = this.contractFromAliceId(contract.aliceId)
    const src = contract as unknown as Record<string, unknown>
    const dst = expanded as unknown as Record<string, unknown>
    // Skip aliceId (already on expanded) and Contract default values —
    // `new Contract()` populates every string field with `''`, so a
    // blanket copy would clobber the expanded symbol/localSymbol with
    // the caller's defaults. The override semantics only matter for
    // fields the caller actually set to a non-default value.
    for (const key of Object.keys(src)) {
      const value = src[key]
      if (key === 'aliceId') continue
      if (value === undefined || value === '' || value === null) continue
      // Numeric defaults are defaults too: `new Contract()` sets conId=0 and
      // sentinel numbers (UNSET_DOUBLE/UNSET_INTEGER) on numeric fields. A
      // blanket copy clobbered the expanded conId back to 0 — the broker got
      // an all-empty contract and TWS rejected with error 321 (the by-conId
      // quote path was dead in production while direct broker calls worked).
      // No numeric Contract field carries signal at 0 or at a sentinel.
      if (typeof value === 'number' && (value === 0 || value === UNSET_INTEGER || value === UNSET_DOUBLE)) continue
      dst[key] = value
    }
    return expanded
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
    this.broker.setConnectionStateListener?.(null)
    if (this._recoveryTimer) {
      clearTimeout(this._recoveryTimer)
      this._recoveryTimer = undefined
      this._recovering = false
    }
    return this.broker.close()
  }
}
