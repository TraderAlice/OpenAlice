/**
 * IbkrBroker — IBroker adapter for Interactive Brokers TWS/Gateway.
 *
 * Bridges the callback-based @traderalice/ibkr SDK to the Promise-based
 * IBroker interface via RequestBridge.
 *
 * Key differences from Alpaca/CCXT brokers:
 * - Single TCP socket with reqId multiplexing (not REST)
 * - No API key — auth handled by TWS/Gateway GUI login
 * - IBKR Contract/Order types ARE our native types — zero translation
 * - Order IDs are numeric, assigned by TWS (nextValidId)
 */

import { z } from 'zod'
import Decimal from 'decimal.js'
import {
  EClient,
  Contract,
  ComboLeg,
  DeltaNeutralContract,
  Order,
  OrderCancel,
  OrderState,
  ContractDescription,
  type ContractDetails,
} from '@traderalice/ibkr'
import {
  BrokerError,
  type IBroker,
  type AccountCapabilities,
  type AccountInfo,
  type Position,
  type PlaceOrderResult,
  type OpenOrder,
  type Quote,
  type MarketClock,
  type BrokerConfigField,
  type BrokerConnectionStateEvent,
  type TpSlParams,
  type ExpandContractFilters,
  type ContractExpansion,
} from '../types.js'
import '../../contract-ext.js'
import { derivePositionMath } from '../../position-math.js'
import { RequestBridge } from './request-bridge.js'
import { resolveSymbol } from './ibkr-contracts.js'
import type { IbkrBrokerConfig } from './ibkr-types.js'

const WRITE_LIVENESS_TIMEOUT_MS = 3_000
const OPTION_MARK_SUCCESS_TTL_MS = 15_000
const OPTION_MARK_FAILURE_TTL_MS = 60_000
const OPTION_MARK_CONCURRENCY = 8

interface OptionMarkOverlay {
  marketPrice: string
  marketValue: string
  unrealizedPnL: string
}

/** IBKR models are mutable because the wire decoder fills them field by field.
 * Broker routing must not let a caller mutate a cached canonical contract (or
 * let routing defaults mutate a staged/ledger contract), so clone at the
 * boundary where contracts change ownership. */
function cloneContract(contract: Contract): Contract {
  const clone = Object.assign(new Contract(), contract)
  clone.comboLegs = (contract.comboLegs ?? []).map(leg => Object.assign(new ComboLeg(), leg))
  clone.deltaNeutralContract = contract.deltaNeutralContract
    ? Object.assign(new DeltaNeutralContract(), contract.deltaNeutralContract)
    : null
  return clone
}

export class IbkrBroker implements IBroker {
  // ---- Self-registration ----

  static configSchema = z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().default(7497),
    clientId: z.number().int().default(0),
    accountId: z.string().optional(),
    paper: z.boolean().default(true),
  })

  static configFields: BrokerConfigField[] = [
    { name: 'host', type: 'text', label: 'Host', default: '127.0.0.1', placeholder: '127.0.0.1' },
    { name: 'port', type: 'number', label: 'Port', default: 7497 },
    { name: 'clientId', type: 'number', label: 'Client ID', default: 0 },
    { name: 'accountId', type: 'text', label: 'Account ID', placeholder: 'Auto-detected from TWS' },
    { name: 'paper', type: 'boolean', label: 'Paper Trading', default: true, description: 'Authentication is handled by TWS/Gateway login — no API keys needed.' },
  ]

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): IbkrBroker {
    const bc = IbkrBroker.configSchema.parse(config.brokerConfig)
    return new IbkrBroker({
      id: config.id,
      label: config.label,
      host: bc.host,
      port: bc.port,
      clientId: bc.clientId,
      accountId: bc.accountId,
    })
  }

  // ---- Instance ----

  readonly brokerEngine = 'ibkr'
  readonly id: string
  readonly label: string

  private bridge: RequestBridge
  private client: EClient
  private readonly config: IbkrBrokerConfig
  private accountId: string | null = null
  /** A promise cache deduplicates simultaneous quote/order resolution for the
   * same conId. Cached contracts are canonical TWS values; callers get clones. */
  private readonly conIdContracts = new Map<number, Promise<Contract>>()
  /** Briefly cache successful marks and failed-entitlement attempts so a UI
   * poll cannot create an unbounded snapshot-request loop. */
  private readonly optionMarkCache = new Map<number, {
    expiresAt: number
    overlay: OptionMarkOverlay | null
  }>()
  private readonly optionMarkRequests = new Map<number, Promise<OptionMarkOverlay | null>>()

  constructor(config: IbkrBrokerConfig) {
    this.config = config
    this.id = config.id ?? 'ibkr'
    this.label = config.label ?? 'Interactive Brokers'
    this.bridge = new RequestBridge()
    this.client = new EClient(this.bridge)
  }

  // ==================== Lifecycle ====================

  /** Periodic socket probe — see _ensureAlive / issue #294. */
  private heartbeatTimer_: ReturnType<typeof setInterval> | null = null

  /** Loud-refuse on a known-dead connection. The account surface is
   *  cache-backed, so without this gate a dead socket serves stale reads
   *  and accepts orders that never transmit (issue #294). */
  private _ensureAlive(): void {
    if (this.bridge?.connectionDead) {
      throw new BrokerError('NETWORK',
        'TWS/Gateway connection lost — reconnect pending. Cached data may be stale; orders will NOT transmit.')
    }
  }

  /** Confirm liveness on the same ordered socket immediately before a broker
   * write. The 45s heartbeat is sufficient for stale-read containment but
   * leaves a blind window that is unacceptable for place/modify/cancel. */
  private async _ensureWriteAlive(): Promise<void> {
    this._ensureAlive()
    try {
      await this.bridge.requestCurrentTime(WRITE_LIVENESS_TIMEOUT_MS)
      this._ensureAlive()
    } catch (err) {
      this.bridge.markDead('Write-path liveness probe failed')
      throw new BrokerError(
        'NETWORK',
        `TWS/Gateway write-path liveness check failed; order was not transmitted: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  setConnectionStateListener(listener: ((event: BrokerConnectionStateEvent) => void) | null): void {
    this.bridge.setConnectionStateListener(listener)
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer_) clearInterval(this.heartbeatTimer_)
    this.heartbeatTimer_ = setInterval(() => {
      if (this.bridge.connectionDead) return
      this.bridge.requestCurrentTime(5000).catch(() => {
        console.warn(`IbkrBroker[${this.id}]: heartbeat failed — marking connection dead`)
        this.bridge.markDead('TWS/Gateway heartbeat timed out')
      })
    }, 45_000)
    // Don't hold the process open for the probe
    this.heartbeatTimer_.unref?.()
  }

  async init(): Promise<void> {
    // A half-open socket still reports isConnected() — when the heartbeat
    // (or connectionClosed) flagged it dead, force a teardown so the
    // recovery loop's re-init actually reconnects instead of no-opping.
    if (this.bridge.connectionDead && this.client.isConnected()) {
      try { this.client.disconnect() } catch { /* already torn down */ }
    }
    // Idempotent — skip if already connected (e.g. UTA re-wrapping a shared broker)
    if (this.client.isConnected()) return

    const host = this.config.host ?? '127.0.0.1'
    const port = this.config.port ?? 7497
    const clientId = this.config.clientId ?? 0

    try {
      await this.bridge.waitForConnect(this.client, host, port, clientId)
    } catch (err) {
      throw BrokerError.from(err, 'NETWORK')
    }

    // Delayed-data fallback: without this, a snapshot on an unsubscribed
    // symbol (every paper account) gets neither ticks nor an error — the
    // request just times out. Type 3 = live when entitled, delayed otherwise.
    this.client.reqMarketDataType(3)

    // Resolve account ID
    this.accountId = this.config.accountId ?? this.bridge.getAccountId()
    if (!this.accountId) {
      throw new BrokerError('CONFIG', 'No account detected from TWS/Gateway. Set accountId in config for multi-account setups.')
    }

    // Start persistent account subscription and wait for first download
    try {
      this.bridge.startAccountSubscription(this.accountId)
      await this.bridge.waitForAccountReady()
      this.bridge.markAlive()
      this.startHeartbeat()
      console.log(`IbkrBroker[${this.id}]: connected (account=${this.accountId}, host=${host}:${port}, clientId=${clientId})`)
    } catch (err) {
      throw BrokerError.from(err, 'NETWORK')
    }
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer_) { clearInterval(this.heartbeatTimer_); this.heartbeatTimer_ = null }
    this.bridge.stopAccountSubscription()
    this.client.disconnect()
  }

  // ==================== Contract search ====================

  /**
   * Symbol search, hub-aware. TWS's reqMatchingSymbols returns ENTITIES, not
   * always contracts: stock rows carry their conId (1:1 with a contract), but
   * FX rows are a currency FAMILY (conId=0, no quote currency yet) and BOND
   * rows are an ISSUER directory (conId=0, identity = issuerId). Leaves pass
   * through; CASH hubs are expanded inline into concrete pairs (small
   * fan-out, optionally narrowed by a ".USD" pattern suffix); BOND issuer
   * hubs pass through and become `issuer:` aliceIds (expand explicitly).
   */
  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    if (!pattern) return []
    const reqId = this.bridge.allocReqId()
    const promise = this.bridge.request<ContractDescription[]>(reqId)
    // TWS matches on the base symbol — strip an FX-style ".USD" suffix for
    // the request, keep it as a pair filter for the expansion below.
    const dot = pattern.indexOf('.')
    const base = dot > 0 ? pattern.slice(0, dot) : pattern
    const pairCurrency = dot > 0 ? pattern.slice(dot + 1).toUpperCase() : ''
    this.client.reqMatchingSymbols(reqId, base)
    const rows = await promise

    const out: ContractDescription[] = []
    for (const row of rows) {
      const c = row.contract
      if (c.secType === 'CASH' && !c.conId) {
        out.push(...await this.expandCashHub(c, pairCurrency))
        continue
      }
      // Everything else passes through — leaves carry conId; BOND issuer
      // hubs carry issuerId (addressable, not tradeable); anything without
      // either stays visible rather than being silently dropped.
      out.push(row)
    }
    return out
  }

  /** CASH family row → concrete currency pairs (each with its own conId). */
  private async expandCashHub(hub: Contract, pairCurrency: string): Promise<ContractDescription[]> {
    const q = new Contract()
    q.symbol = hub.symbol
    q.secType = 'CASH'
    if (pairCurrency) q.currency = pairCurrency
    try {
      const details = await this.contractDetailsQuery(q)
      return details.map((d) => {
        const cd = new ContractDescription()
        cd.contract = d.contract
        cd.derivativeSecTypes = []
        return cd
      })
    } catch (err) {
      console.warn(`IbkrBroker[${this.id}]: CASH hub expansion failed for ${hub.symbol}: ${err instanceof Error ? err.message : err}`)
      return []
    }
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    const results = await this.contractDetailsQuery(query)
    return results[0] ?? null
  }

  /** All matching contract details (a conId resolves to one; a family query
   *  like EUR/CASH or an issuerId resolves to many). */
  private async contractDetailsQuery(query: Contract): Promise<ContractDetails[]> {
    const requestContract = cloneContract(query)
    // Routing defaults are for SYMBOL-form STK queries only. A conId (or
    // issuerId) resolves globally, and non-STK secTypes don't live on SMART
    // (EUR.USD is on IDEALPRO; conId+SMART → TWS error 200, found live).
    // Forcing USD would also narrow a CASH family query to one pair.
    if (!requestContract.conId && !requestContract.issuerId && (!requestContract.secType || requestContract.secType === 'STK')) {
      if (!requestContract.exchange) requestContract.exchange = 'SMART'
      if (!requestContract.currency) requestContract.currency = 'USD'
    }

    const reqId = this.bridge.allocReqId()
    const promise = this.bridge.requestCollector<ContractDetails>(reqId)
    this.client.reqContractDetails(reqId, requestContract)
    const details = await promise
    for (const detail of details) this.rememberCanonicalContract(detail.contract)
    return details
  }

  /** Seed the cache from any authoritative ContractDetails response. Do not
   * replace an in-flight lookup for the same conId. */
  private rememberCanonicalContract(contract: Contract): void {
    if (!contract.conId || this.conIdContracts.has(contract.conId)) return
    this.conIdContracts.set(contract.conId, Promise.resolve(cloneContract(contract)))
  }

  /** Resolve a conId with a deliberately clean request. conId is authoritative
   * identity; caller-provided routing fields must not narrow this lookup. */
  private async resolveConIdContract(conId: number): Promise<Contract> {
    let pending = this.conIdContracts.get(conId)
    if (!pending) {
      pending = (async () => {
        const query = new Contract()
        query.conId = conId
        const details = await this.contractDetailsQuery(query)
        const canonical = details.find(item => item.contract.conId === conId)?.contract
        if (!canonical) {
          throw new BrokerError('EXCHANGE', `IBKR conId ${conId} did not resolve to a canonical contract`)
        }
        return cloneContract(canonical)
      })()
      this.conIdContracts.set(conId, pending)
    }

    try {
      return cloneContract(await pending)
    } catch (err) {
      // A transient TWS/network failure must not become a permanent rejected
      // cache entry. Only delete the promise that this caller observed.
      if (this.conIdContracts.get(conId) === pending) this.conIdContracts.delete(conId)
      throw err
    }
  }

  /** Convert an identity/display contract into a contract safe to send to a
   * TWS quote or order request. */
  private async resolveRoutableContract(contract: Contract): Promise<Contract> {
    if (contract.conId) {
      const canonical = await this.resolveConIdContract(contract.conId)
      if (contract.aliceId) canonical.aliceId = contract.aliceId
      return canonical
    }

    const routed = cloneContract(contract)
    // Bare symbols are the one supported convenience form. They mean a US
    // stock unless the caller supplied a different secType explicitly.
    if (!routed.secType && routed.symbol) routed.secType = 'STK'
    if (routed.secType === 'STK') {
      if (!routed.exchange) routed.exchange = 'SMART'
      if (!routed.currency) routed.currency = 'USD'
      return routed
    }

    const missing: string[] = []
    if (!routed.secType) missing.push('secType')
    if (!routed.exchange) missing.push('exchange')
    if (!routed.currency) missing.push('currency')
    if (!routed.symbol && !routed.localSymbol) missing.push('symbol/localSymbol')
    if (missing.length > 0) {
      throw new BrokerError(
        'EXCHANGE',
        `IBKR contract without conId is missing ${missing.join(', ')}. ` +
        'Resolve it through contract search/expand before requesting a quote or order.',
      )
    }
    return routed
  }

  /**
   * Hub → leaves expansion (see nativeKey grammar at getNativeKey):
   *   issuer:eXXX        → the issuer's individual bonds (each conId-keyed)
   *   <conId> (no expiry) → option-chain parameter grid for the underlying
   *   <conId> + expiry    → concrete option contracts for that expiry
   *   <conId> secType=FUT → futures contract months
   */
  async expandContract(nativeKey: string, filters: ExpandContractFilters = {}): Promise<ContractExpansion> {
    const limit = Math.max(1, Math.min(filters.limit ?? 60, 200))

    if (nativeKey.startsWith('issuer:')) {
      const q = new Contract()
      q.secType = 'BOND'
      q.issuerId = nativeKey.slice('issuer:'.length)
      const details = await this.contractDetailsQuery(q)
      // A bond Contract's own fields are opaque (localSymbol "IBCID…") —
      // the human identity (coupon, maturity) lives on ContractDetails.
      const all = details.map((d) => {
        const c = d.contract
        if (!c.description) {
          const coupon = d.coupon ? `${d.coupon}%` : ''
          const maturity = d.maturity ? ` ${d.maturity}` : ''
          const label = `${coupon}${maturity}`.trim()
          if (label) c.description = label
        }
        if (d.maturity && !c.lastTradeDateOrContractMonth) c.lastTradeDateOrContractMonth = d.maturity
        return c
      })
      all.sort((a, b) => (a.lastTradeDateOrContractMonth || '').localeCompare(b.lastTradeDateOrContractMonth || ''))
      return {
        kind: 'contracts',
        contracts: all.slice(0, limit),
        total: all.length,
        ...(all.length > limit ? { hint: `${all.length} bonds match; showing the first ${limit}. Raise limit to see more.` } : {}),
      }
    }

    const asNum = parseInt(nativeKey, 10)
    if (isNaN(asNum) || String(asNum) !== nativeKey) {
      throw new BrokerError('EXCHANGE',
        `Cannot expand "${nativeKey}" — expansion takes a conId aliceId (an underlying from search) or an issuer: directory key.`)
    }
    const underlying = await this.getContractDetails(Object.assign(new Contract(), { conId: asNum }))
    if (!underlying?.contract) {
      throw new BrokerError('EXCHANGE', `conId ${asNum} did not resolve to a contract`)
    }
    const u = underlying.contract

    const famSecType = filters.secType ?? 'OPT'
    if (famSecType === 'FUT' || filters.expiry) {
      // Concrete leaves for one family/expiry
      const q = new Contract()
      q.symbol = u.symbol
      q.secType = famSecType
      q.currency = u.currency
      if (famSecType === 'OPT') q.exchange = 'SMART'
      if (filters.expiry) q.lastTradeDateOrContractMonth = filters.expiry
      if (filters.right) q.right = filters.right
      const details = await this.contractDetailsQuery(q)
      let all = details.map((d) => d.contract)
      if (filters.strikeMin != null) all = all.filter((c) => c.strike >= filters.strikeMin!)
      if (filters.strikeMax != null) all = all.filter((c) => c.strike <= filters.strikeMax!)
      all.sort((a, b) =>
        (a.lastTradeDateOrContractMonth || '').localeCompare(b.lastTradeDateOrContractMonth || '')
        || (a.strike - b.strike)
        || (a.right || '').localeCompare(b.right || ''))
      return {
        kind: 'contracts',
        contracts: all.slice(0, limit),
        total: all.length,
        ...(all.length > limit ? { hint: `${all.length} contracts match; showing the first ${limit}. Narrow with right/strikeMin/strikeMax or raise limit.` } : {}),
      }
    }

    // OPT without expiry → parameter grid (expirations × strikes per exchange)
    const reqId = this.bridge.allocReqId()
    const promise = this.bridge.requestCollector<{
      exchange: string; underlyingConId: number; tradingClass: string;
      multiplier: string; expirations: string[]; strikes: number[]
    }>(reqId)
    this.client.reqSecDefOptParams(reqId, u.symbol, '', u.secType, u.conId)
    const grids = await promise
    if (grids.length === 0) {
      return { kind: 'optionGrid', grid: [], hint: `No option chain found for ${u.symbol}.` }
    }
    // SMART grid first — it aggregates the listings an order would route to.
    grids.sort((a, b) => Number(b.exchange === 'SMART') - Number(a.exchange === 'SMART'))
    return {
      kind: 'optionGrid',
      grid: grids,
      hint: 'Pick an expiry (and optionally right / strike range), then expand again with expiry to get tradeable contracts.',
    }
  }

  // ==================== Trading operations ====================

  async placeOrder(contract: Contract, order: Order, tpsl?: TpSlParams): Promise<PlaceOrderResult> {
    // Attached TP/SL: not implemented yet (native path = parent + child
    // orders with parentId + transmit chain — see ANG-103 batch). Refuse
    // loudly rather than silently placing an unprotected entry; the ledger
    // would otherwise record protection the venue never received.
    if (tpsl?.takeProfit || tpsl?.stopLoss) {
      return {
        success: false,
        error: 'IBKR attached TP/SL (bracket) is not implemented yet — refusing to place a naked entry. Place the entry first, then a standalone STP/LMT protective order.',
      }
    }
    try {
      this._ensureAlive()
      const routedContract = await this.resolveRoutableContract(contract)
      await this._ensureWriteAlive()
      const orderId = this.bridge.getNextOrderId()
      const promise = this.bridge.requestOrder(orderId)
      this.client.placeOrder(orderId, routedContract, order)
      const result = await promise
      return {
        success: true,
        orderId: String(orderId),
        orderState: result.orderState,
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult> {
    try {
      this._ensureAlive()
      // IBKR modifies orders by re-calling placeOrder with the same orderId
      const original = await this.getOrder(orderId)
      if (!original) {
        return { success: false, error: `Order ${orderId} not found` }
      }

      // Merge changes into the original order
      const mergedOrder = original.order
      if (changes.totalQuantity != null) mergedOrder.totalQuantity = changes.totalQuantity
      if (changes.lmtPrice != null) mergedOrder.lmtPrice = changes.lmtPrice
      if (changes.auxPrice != null) mergedOrder.auxPrice = changes.auxPrice
      if (changes.tif) mergedOrder.tif = changes.tif
      if (changes.orderType) mergedOrder.orderType = changes.orderType
      if (changes.trailingPercent != null) mergedOrder.trailingPercent = changes.trailingPercent
      if (changes.trailStopPrice != null) mergedOrder.trailStopPrice = changes.trailStopPrice

      const routedContract = await this.resolveRoutableContract(original.contract)
      await this._ensureWriteAlive()
      const numericId = parseInt(orderId, 10)
      const promise = this.bridge.requestOrder(numericId)
      this.client.placeOrder(numericId, routedContract, mergedOrder)
      const result = await promise

      return {
        success: true,
        orderId,
        orderState: result.orderState,
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async cancelOrder(orderId: string, orderCancel?: OrderCancel): Promise<PlaceOrderResult> {
    try {
      await this._ensureWriteAlive()
      const numericId = parseInt(orderId, 10)
      const promise = this.bridge.requestOrder(numericId)
      this.client.cancelOrder(numericId, orderCancel ?? new OrderCancel())
      await promise

      const os = new OrderState()
      os.status = 'Cancelled'
      return { success: true, orderId, orderState: os }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult> {
    const symbol = resolveSymbol(contract)

    // Find current position to determine side
    const positions = await this.getPositions()
    const pos = positions.find(p =>
      (contract.conId && p.contract.conId === contract.conId) ||
      (symbol && resolveSymbol(p.contract) === symbol),
    )
    if (!pos) {
      return { success: false, error: `No position for ${symbol ?? `conId=${contract.conId}`}` }
    }

    // The position contract came from TWS and may live somewhere other than
    // SMART (for example CASH on IDEALPRO). Do not mutate or override it;
    // placeOrder will canonicalize the conId again at the write boundary.
    const closeContract = cloneContract(pos.contract)
    const order = new Order()
    order.action = pos.side === 'long' ? 'SELL' : 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = quantity ?? pos.quantity
    order.tif = 'DAY'

    return this.placeOrder(closeContract, order)
  }

  // ==================== Queries ====================

  /**
   * Get account summary.
   *
   * Data source: reqAccountUpdates → accountDownloadEnd callback.
   *
   * NetLiquidation is the broker's account-level value whenever present.
   * Position-derived reconstruction is fallback-only, so adding a foreign-
   * currency holding cannot silently change the meaning of the field.
   */
  /** TWS-provided FX rate (currency → base) from the ExchangeRate account
   *  tags. Returns null when TWS didn't send one for this currency. */
  private fxRate(values: Map<string, string>, currency: string): Decimal | null {
    const raw = values.get(`ExchangeRate:${currency}`)
    if (raw == null) return null
    try { return new Decimal(raw) } catch { return null }
  }

  async getAccount(): Promise<AccountInfo> {
    this._ensureAlive()
    const download = this.bridge.getAccountCache()
    if (!download) throw new BrokerError('NETWORK', 'Account data not yet available')

    const baseCurrency = download.values.get('BaseCurrency') ?? 'USD'
    const totalCashValue = new Decimal(download.values.get('TotalCashValue') ?? '0')

    let positionUnrealizedPnL: Decimal | null = new Decimal(0)
    let positionMarketValue: Decimal | null = new Decimal(0)
    for (const pos of download.positions) {
      const ccy = pos.currency || baseCurrency
      const rate = ccy === baseCurrency ? new Decimal(1) : this.fxRate(download.values, ccy)
      if (rate === null) { positionUnrealizedPnL = null; positionMarketValue = null; break }
      positionUnrealizedPnL = positionUnrealizedPnL!.plus(new Decimal(pos.unrealizedPnL).mul(rate))
      // marketValue is always-positive by convention (side carried apart) —
      // shorts must SUBTRACT from equity (see aggregateAccountFromPositions).
      const sided = pos.side === 'short' ? new Decimal(pos.marketValue).neg() : new Decimal(pos.marketValue)
      positionMarketValue = positionMarketValue!.plus(sided.mul(rate))
    }

    const brokerNetLiqRaw = download.values.get('NetLiquidation')
    let brokerNetLiq: Decimal | null = null
    if (brokerNetLiqRaw != null) {
      try {
        const parsed = new Decimal(brokerNetLiqRaw)
        if (parsed.isFinite()) brokerNetLiq = parsed
      } catch { /* fall back below */ }
    }
    // NetLiquidation is an account-level broker fact. Do not make the same
    // field switch semantics based on whether the user happens to hold a
    // foreign-currency position. Local reconstruction is fallback-only.
    const reconstructedNetLiq = positionMarketValue !== null
      ? totalCashValue.plus(positionMarketValue)
      : null
    const netLiquidation = brokerNetLiq ?? reconstructedNetLiq ?? new Decimal(0)

    const unrealizedPnL = download.positions.length > 0 && positionUnrealizedPnL !== null
      ? positionUnrealizedPnL
      : new Decimal(download.values.get('UnrealizedPnL') ?? '0')

    return {
      baseCurrency,
      netLiquidation: netLiquidation.toString(),
      totalCashValue: totalCashValue.toString(),
      unrealizedPnL: unrealizedPnL.toString(),
      realizedPnL: new Decimal(download.values.get('RealizedPnL') ?? '0').toString(),
      buyingPower: new Decimal(download.values.get('BuyingPower') ?? '0').toString(),
      initMarginReq: new Decimal(download.values.get('InitMarginReq') ?? '0').toString(),
      maintMarginReq: new Decimal(download.values.get('MaintMarginReq') ?? '0').toString(),
      ...(download.values.has('DayTradesRemaining')
        ? { dayTradesRemaining: parseInt(download.values.get('DayTradesRemaining')!, 10) }
        : {}),
    }
  }

  /**
   * Get current positions with market prices.
   *
   * Data source: reqAccountUpdates → updatePortfolio() callbacks.
   * Each position's marketPrice/marketValue comes from TWS's internal
   * portfolio valuation, NOT from a real-time market data subscription.
   *
   * TWS controls the push frequency. During regular hours (09:30-16:00 ET)
   * updates come every few seconds. After ~20:00 ET, updatePortfolio()
   * stops pushing entirely — prices freeze even though overnight trading
   * (Blue Ocean ATS) may be active. See README.md for details.
   *
   * To get fresher prices, use getQuote() which calls reqMktData in
   * snapshot mode and can see overnight session data.
   */
  async getPositions(): Promise<Position[]> {
    this._ensureAlive()
    const download = this.bridge.getAccountCache()
    if (!download) throw new BrokerError('NETWORK', 'Account data not yet available')
    const output = [...download.positions]
    const optionIndexes = output
      .map((position, index) => ({ position, index }))
      .filter(({ position }) => position.contract.secType === 'OPT' || position.contract.secType === 'FOP')
    if (optionIndexes.length === 0) return output

    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < optionIndexes.length) {
        const item = optionIndexes[cursor++]
        output[item.index] = await this.refreshOptionPosition(item.position)
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(OPTION_MARK_CONCURRENCY, optionIndexes.length) },
      () => worker(),
    ))
    return output
  }

  private async refreshOptionPosition(position: Position): Promise<Position> {
    const conId = position.contract.conId
    if (!conId) return position

    const now = Date.now()
    const cached = this.optionMarkCache.get(conId)
    if (cached && cached.expiresAt > now) {
      return cached.overlay ? { ...position, ...cached.overlay } : position
    }

    let pending = this.optionMarkRequests.get(conId)
    if (!pending) {
      pending = this.fetchOptionMark(position)
      this.optionMarkRequests.set(conId, pending)
    }
    try {
      const overlay = await pending
      return overlay ? { ...position, ...overlay } : position
    } finally {
      if (this.optionMarkRequests.get(conId) === pending) this.optionMarkRequests.delete(conId)
    }
  }

  private async fetchOptionMark(position: Position): Promise<OptionMarkOverlay | null> {
    const conId = position.contract.conId
    try {
      const { snap } = await this.requestSnapshot(position.contract, { resolveOnBidAsk: true })
      const bid = new Decimal(snap.bid ?? 0)
      const ask = new Decimal(snap.ask ?? 0)
      if (!bid.isFinite() || !ask.isFinite() || bid.lte(0) || ask.lte(0)) {
        throw new BrokerError('EXCHANGE', 'IBKR option snapshot did not include a positive bid and ask')
      }
      const marketPrice = bid.plus(ask).div(2).toString()
      const derived = derivePositionMath({
        quantity: position.quantity,
        marketPrice,
        avgCost: position.avgCost,
        multiplier: position.multiplier,
        side: position.side,
      })
      const overlay: OptionMarkOverlay = { marketPrice, ...derived }
      this.optionMarkCache.set(conId, {
        expiresAt: Date.now() + OPTION_MARK_SUCCESS_TTL_MS,
        overlay,
      })
      return overlay
    } catch {
      // Missing market-data entitlement and closed-market snapshots are normal
      // fallbacks. Preserve the broker's updatePortfolio values and suppress
      // repeated requests briefly instead of turning a read into an outage.
      this.optionMarkCache.set(conId, {
        expiresAt: Date.now() + OPTION_MARK_FAILURE_TTL_MS,
        overlay: null,
      })
      return null
    }
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    const allOrders = await this.bridge.requestOpenOrders()
    return allOrders
      .filter(o => orderIds.includes(String(o.order.orderId)))
      .map(o => this.enrichWithFillData(o))
  }

  /**
   * All open orders placed through this client — external-order observation
   * + listing-driven sync surface. NOTE: reqOpenOrders only returns THIS
   * clientId's orders; manual TWS-UI orders need reqAllOpenOrders + permId
   * identity (deferred — tracked in Linear).
   */
  async getOpenOrders(): Promise<OpenOrder[]> {
    const allOrders = await this.bridge.requestOpenOrders()
    return allOrders.map(o => this.enrichWithFillData(o))
  }

  async getOrder(orderId: string): Promise<OpenOrder | null> {
    // Try open orders first
    const results = await this.getOrders([orderId])
    if (results[0]) return results[0]

    // Fallback to completed orders (filled/cancelled orders leave the open list)
    const completed = await this.bridge.requestCompletedOrders()
    const match = completed.find(o => String(o.order.orderId) === orderId)
    return match ? this.enrichWithFillData(match) : null
  }

  /** Attach avgFillPrice from cached orderStatus data if available. */
  private enrichWithFillData(o: import('./ibkr-types.js').CollectedOpenOrder): OpenOrder {
    const fillData = this.bridge.getFillData(o.order.orderId)
    const rawAvg = fillData?.avgFillPrice ?? o.avgFillPrice
    return {
      contract: o.contract,
      order: o.order,
      orderState: o.orderState,
      avgFillPrice: rawAvg != null ? String(rawAvg) : undefined,
    }
  }

  /**
   * Get a one-time market data snapshot for a contract.
   *
   * Data source: reqMktData with snapshot=true → tickPrice/tickSize/
   * tickSnapshotEnd callbacks. Unlike updatePortfolio(), this channel
   * CAN return overnight session prices (Blue Ocean ATS) and is not
   * limited to positions in the account.
   *
   * Each call briefly occupies one TWS market data line (limit ~100),
   * auto-released after tickSnapshotEnd.
   */
  async getQuote(contract: Contract): Promise<Quote> {
    this._ensureAlive()
    const { routedContract, snap } = await this.requestSnapshot(contract)

    return {
      contract: routedContract,
      last: String(snap.last ?? 0),
      bid: String(snap.bid ?? 0),
      ask: String(snap.ask ?? 0),
      volume: String(snap.volume ?? 0),
      high: snap.high != null ? String(snap.high) : undefined,
      low: snap.low != null ? String(snap.low) : undefined,
      timestamp: snap.lastTimestamp ? new Date(snap.lastTimestamp * 1000) : new Date(),
    }
  }

  private async requestSnapshot(
    contract: Contract,
    options: { resolveOnBidAsk?: boolean } = {},
  ): Promise<{ routedContract: Contract; snap: import('./ibkr-types.js').TickSnapshot }> {
    const routedContract = await this.resolveRoutableContract(contract)
    const reqId = this.bridge.allocReqId()
    const promise = this.bridge.requestSnapshot(reqId, undefined, options)
    // `regulatorySnapshot=false`: never opt the account into per-request paid
    // US regulatory snapshots. Live entitlement or free delayed data may still
    // satisfy the ordinary snapshot; otherwise callers retain cached marks.
    this.client.reqMktData(reqId, routedContract, '', true, false, [])
    return { routedContract, snap: await promise }
  }

  async getMarketClock(): Promise<MarketClock> {
    // TODO: per-contract trading hours via ContractDetails.tradingHours
    // For now, use local time with NYSE schedule as a baseline.
    let now: Date
    try {
      const serverTime = await this.bridge.requestCurrentTime(3000)
      now = new Date(serverTime * 1000)
    } catch {
      now = new Date()
    }

    // NYSE hours: Mon-Fri 9:30-16:00 ET
    const etParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(now)

    const weekday = etParts.find(p => p.type === 'weekday')?.value
    const hour = parseInt(etParts.find(p => p.type === 'hour')?.value ?? '0', 10)
    const minute = parseInt(etParts.find(p => p.type === 'minute')?.value ?? '0', 10)

    const isWeekday = !['Sat', 'Sun'].includes(weekday ?? '')
    const timeMinutes = hour * 60 + minute
    const isOpen = isWeekday && timeMinutes >= 570 && timeMinutes < 960 // 9:30-16:00

    return { isOpen, timestamp: now }
  }

  // ==================== Capabilities ====================

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['STK', 'OPT', 'FUT', 'FOP', 'CASH', 'WAR', 'BOND'],
      supportedOrderTypes: ['MKT', 'LMT', 'STP', 'STP LMT', 'TRAIL', 'MOC', 'LOC', 'REL'],
    }
  }

  // ==================== Contract identity ====================

  /**
   * IBKR nativeKey grammar (the broker's uniqueness primitives, layered):
   *   "265598"          conId — canonical for every tradeable contract
   *   "issuer:e1400789" bond-issuer DIRECTORY — addressable, NOT tradeable
   *   "AAPL"            bare symbol — STK convenience for hand-typed ids
   * Hubs (directories) live in their own prefixed namespace so trading
   * surfaces can refuse them loudly instead of mis-resolving.
   */
  getNativeKey(contract: Contract): string {
    // conId is IBKR's globally unique contract identifier
    if (contract.conId) return String(contract.conId)
    if (contract.secType === 'BOND' && contract.issuerId) return `issuer:${contract.issuerId}`
    return contract.symbol
  }

  resolveNativeKey(nativeKey: string): Contract {
    if (nativeKey.startsWith('issuer:')) {
      throw new Error(
        `"${nativeKey}" is a bond-issuer directory, not a tradeable contract — ` +
        `expand it (contract expand) to list the issuer's individual bonds; each bond has its own conId aliceId.`,
      )
    }
    const c = new Contract()
    const asNum = parseInt(nativeKey, 10)
    if (!isNaN(asNum) && String(asNum) === nativeKey) {
      // Numeric nativeKey = conId — TWS resolves everything else from this
      c.conId = asNum
    } else {
      // String nativeKey = symbol — fill in routing defaults.
      // Assumes STK; other secTypes should use conId for unambiguous resolution.
      c.symbol = nativeKey
      c.secType = 'STK'
      c.exchange = 'SMART'
      c.currency = 'USD'
    }
    return c
  }

}
