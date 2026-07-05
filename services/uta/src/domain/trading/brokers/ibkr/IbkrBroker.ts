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
  type TpSlParams,
  type ExpandContractFilters,
  type ContractExpansion,
} from '../types.js'
import '../../contract-ext.js'
import { aggregateAccountFromPositions } from '../../position-math.js'
import { RequestBridge } from './request-bridge.js'
import { resolveSymbol } from './ibkr-contracts.js'
import type { IbkrBrokerConfig } from './ibkr-types.js'

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

  readonly id: string
  readonly label: string

  private bridge: RequestBridge
  private client: EClient
  private readonly config: IbkrBrokerConfig
  private accountId: string | null = null

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

  private startHeartbeat(): void {
    if (this.heartbeatTimer_) clearInterval(this.heartbeatTimer_)
    this.heartbeatTimer_ = setInterval(() => {
      if (this.bridge.connectionDead) return
      this.bridge.requestCurrentTime(5000).catch(() => {
        console.warn(`IbkrBroker[${this.id}]: heartbeat failed — marking connection dead`)
        this.bridge.markDead()
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
    // Routing defaults are for SYMBOL-form STK queries only. A conId (or
    // issuerId) resolves globally, and non-STK secTypes don't live on SMART
    // (EUR.USD is on IDEALPRO; conId+SMART → TWS error 200, found live).
    // Forcing USD would also narrow a CASH family query to one pair.
    if (!query.conId && !query.issuerId && (!query.secType || query.secType === 'STK')) {
      if (!query.exchange) query.exchange = 'SMART'
      if (!query.currency) query.currency = 'USD'
    }

    const reqId = this.bridge.allocReqId()
    const promise = this.bridge.requestCollector<ContractDetails>(reqId)
    this.client.reqContractDetails(reqId, query)
    return promise
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
    // TWS requires exchange and currency on the contract. Upstream layers
    // (staging, AI tools) typically only populate symbol + secType.
    // Default to SMART routing. Currency defaults to USD — non-USD markets
    // (LSE/GBP, TSE/JPY) and forex (CASH secType) will need the caller
    // to specify currency explicitly.
    if (!contract.exchange) contract.exchange = 'SMART'
    if (!contract.currency) contract.currency = 'USD'

    try {
      this._ensureAlive()
      const orderId = this.bridge.getNextOrderId()
      const promise = this.bridge.requestOrder(orderId)
      this.client.placeOrder(orderId, contract, order)
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

      const numericId = parseInt(orderId, 10)
      const promise = this.bridge.requestOrder(numericId)
      this.client.placeOrder(numericId, original.contract, mergedOrder)
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
      this._ensureAlive()
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

    // Use the position's contract (has conId etc.) but route via SMART
    const closeContract = pos.contract
    closeContract.exchange = 'SMART'
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
   * netLiquidation is reconstructed from cash + Σ(position.marketValue)
   * because TWS's account-level NetLiquidation tag is cached server-side
   * and refreshes less frequently than position-level data.
   *
   * Note: position marketPrice comes from updatePortfolio() callbacks,
   * which TWS stops pushing after ~20:00 ET (see README.md "TWS Market
   * Data Channels"). During overnight hours, the reconstructed netLiq
   * will be stale even though Blue Ocean ATS prices may be moving.
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

    // Position-derived account math is only currency-safe when every line is
    // in the base currency. Mixed books (HKD stock + USD stock) used to
    // blind-sum different units (ANG-101: HKD -4767 + USD +369 reported as
    // USD -4398). TWS hands us per-currency ExchangeRate tags — convert per
    // position; if a rate is missing, fall back to TWS's own consolidated
    // NetLiquidation tag (already FX-correct) rather than summing garbage.
    const mixed = download.positions.some((pos) => (pos.currency || baseCurrency) !== baseCurrency)

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

    const brokerNetLiq = new Decimal(download.values.get('NetLiquidation') ?? '0')
    // Freshness-vs-authority: same-currency books keep the reconstructed
    // value (position marks refresh faster than the server-cached tag, see
    // docstring above). Mixed books prefer the broker tag (issue #314) —
    // reconstruction is rate-converted and only used when the tag is absent.
    const reconstructedNetLiq = positionMarketValue !== null
      ? totalCashValue.plus(positionMarketValue)
      : null
    const netLiquidation = download.positions.length === 0 ? brokerNetLiq
      : mixed ? (brokerNetLiq.isZero() ? (reconstructedNetLiq ?? brokerNetLiq) : brokerNetLiq)
      : aggregateAccountFromPositions(totalCashValue, download.positions).netLiquidation

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
    return download.positions
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
  /** conId → resolved full contract, so by-conId quotes pay reqContractDetails once. */
  private readonly conIdContracts = new Map<number, Contract>()

  async getQuote(contract: Contract): Promise<Quote> {
    // Enrichment must run BEFORE routing defaults: a premature SMART poisons
    // the conId details lookup for anything not on SMART (EUR.USD@IDEALPRO).
    // The enriched contract carries its real exchange/currency.

    // TWS rejects reqMktData on a bare conId (error 321: symbol/localSymbol/
    // secId required) even though the wire carries conId — resolution by
    // conId is only honoured via reqContractDetails. Enrich once and cache.
    if (contract.conId && !contract.symbol && !contract.localSymbol) {
      let full = this.conIdContracts.get(contract.conId)
      if (!full) {
        const details = await this.getContractDetails(contract)
        if (!details?.contract) {
          throw new BrokerError('EXCHANGE', `conId ${contract.conId} did not resolve to a contract`)
        }
        full = details.contract
        this.conIdContracts.set(contract.conId, full)
      }
      contract = full
    }

    if (!contract.exchange) contract.exchange = 'SMART'
    if (!contract.currency) contract.currency = 'USD'

    const reqId = this.bridge.allocReqId()
    const promise = this.bridge.requestSnapshot(reqId)
    this.client.reqMktData(reqId, contract, '', true, false, [])
    const snap = await promise

    return {
      contract,
      last: String(snap.last ?? 0),
      bid: String(snap.bid ?? 0),
      ask: String(snap.ask ?? 0),
      volume: String(snap.volume ?? 0),
      high: snap.high != null ? String(snap.high) : undefined,
      low: snap.low != null ? String(snap.low) : undefined,
      timestamp: snap.lastTimestamp ? new Date(snap.lastTimestamp * 1000) : new Date(),
    }
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
