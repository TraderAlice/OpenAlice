/**
 * UTAAccountSDK — HTTP-backed adapter that mimics
 * `UnifiedTradingAccount`'s public surface so Alice consumers
 * (telegram-plugin, tool/trading, etc.) keep working unchanged after
 * UTA-split v1.
 *
 * Each method delegates to the matching `/api/trading/uta/:id/*` route
 * on the co-located UTA service. Methods that require routes not yet
 * implemented on UTA throw `NotImplementedInSDK` — those routes land in
 * a follow-up commit before the SDK swap is wired into `main.ts`.
 */

import type {
  UTAClient,
  AccountInfo,
  Position,
  OpenOrder,
  Quote,
  MarketClock,
  BrokerHealth,
  BrokerHealthInfo,
  AccountCapabilities,
  GitState,
  GitStatus,
  GitCommit,
  CommitLogEntry,
  CommitPrepareResult,
  PushResult,
  RejectResult,
  SyncResult,
  PriceChangeInput,
  SimulatePriceChangeResult,
  GitExportState,
} from '@traderalice/uta-protocol'
import type { Contract, ContractDescription, ContractDetails } from '@traderalice/ibkr'

export class NotImplementedInSDK extends Error {
  constructor(method: string, neededRoute: string) {
    super(`${method} is not yet wired through the UTA HTTP boundary — needs route ${neededRoute}. Tracked under Step 6 follow-up routes.`)
    this.name = 'NotImplementedInSDK'
  }
}

export interface UTAAccountSDKDeps {
  client: UTAClient
  id: string
}

/**
 * Proxy implementation. NOT a subclass of `UnifiedTradingAccount` — the
 * SDK lives in Alice and `UnifiedTradingAccount` lives in UTA after the
 * physical move. They share method *shapes*, not class identity.
 */
export class UTAAccountSDK {
  readonly id: string
  private readonly client: UTAClient

  constructor(deps: UTAAccountSDKDeps) {
    this.id = deps.id
    this.client = deps.client
  }

  // ==================== Health / state readouts ====================

  /** SDK is HTTP-bound; if UTA is up we treat the account as healthy.
   *  Real health is on UTA's side via `BrokerHealthInfo`. */
  get health(): BrokerHealth {
    return 'healthy'
  }

  get disabled(): boolean {
    return false
  }

  async getHealthInfo(): Promise<BrokerHealthInfo> {
    // UTA exposes account-level health implicitly via the `/uta` list
    // (each list entry carries health info). For now return a minimal
    // optimistic shape; tighten once Alice's SDK caches per-UTA state.
    return {
      status: 'healthy',
      consecutiveFailures: 0,
      recovering: false,
      disabled: false,
    }
  }

  waitForConnect(): Promise<void> {
    // SDK has no local connection state — UTA handles it.
    return Promise.resolve()
  }

  getCapabilities(): AccountCapabilities {
    // TODO: surface via /uta list entry once SDK caches it. Default to
    // an empty capability set — callers should check `listUTAs()[i]` for
    // the authoritative shape.
    return { supportedSecTypes: [], supportedOrderTypes: [] }
  }

  // ==================== Reads (existing routes) ====================

  getAccount(): Promise<AccountInfo> {
    return this.client.get<AccountInfo>(`/api/trading/uta/${encodeURIComponent(this.id)}/account`)
  }

  getPositions(): Promise<Position[]> {
    return this.client.get<Position[]>(`/api/trading/uta/${encodeURIComponent(this.id)}/positions`)
  }

  getOrders(orderIds: string[] = []): Promise<OpenOrder[]> {
    const params = orderIds.length > 0 ? { orderIds: orderIds.join(',') } : undefined
    return this.client.get<OpenOrder[]>(`/api/trading/uta/${encodeURIComponent(this.id)}/orders`, params)
  }

  getQuote(contract: Contract): Promise<Quote> {
    const symbol = contract.localSymbol ?? contract.symbol ?? ''
    return this.client.get<Quote>(`/api/trading/uta/${encodeURIComponent(this.id)}/quote/${encodeURIComponent(symbol)}`)
  }

  getMarketClock(): Promise<MarketClock> {
    return this.client.get<MarketClock>(`/api/trading/uta/${encodeURIComponent(this.id)}/market-clock`)
  }

  searchContracts(pattern: string): Promise<ContractDescription[]> {
    // The existing `/api/trading/contracts/search` is aggregated across
    // accounts; per-account search isn't a route yet. Fall back to the
    // aggregated endpoint and filter by id. Route added in Step 6 follow-up.
    return this.client
      .get<{ results: Array<{ id: string; results: ContractDescription[] }> }>(
        `/api/trading/contracts/search`, { pattern })
      .then((r) => r.results.find((b) => b.id === this.id)?.results ?? [])
  }

  // ==================== Contract details ====================

  getContractDetails(query: Contract): Promise<ContractDetails | null> {
    // The route accepts a `Contract`-shaped body and hydrates back into a
    // Contract on the UTA side, so JSON-serializable fields ride along.
    return this.client.post<ContractDetails | null>(
      `/api/trading/uta/${encodeURIComponent(this.id)}/contracts/details`,
      query,
    )
  }

  // ==================== Git/wallet state ====================

  log(options: { limit?: number; symbol?: string } = {}): Promise<CommitLogEntry[]> {
    return this.client
      .get<{ commits: CommitLogEntry[] }>(`/api/trading/uta/${encodeURIComponent(this.id)}/wallet/log`, options)
      .then((r) => r.commits)
  }

  show(hash: string): Promise<GitCommit | null> {
    return this.client.get<GitCommit>(`/api/trading/uta/${encodeURIComponent(this.id)}/wallet/show/${encodeURIComponent(hash)}`)
      .catch((err: unknown) => {
        if (err instanceof Error && err.message.includes('Commit not found')) return null
        throw err
      })
  }

  status(): Promise<GitStatus> {
    return this.client.get<GitStatus>(`/api/trading/uta/${encodeURIComponent(this.id)}/wallet/status`)
  }

  getState(): Promise<GitState> {
    // Wallet status returns GitStatus (a projection of GitState); for now
    // synthesize a minimal GitState shape from status. Route gap tracked.
    throw new NotImplementedInSDK('getState', 'GET /api/trading/uta/:id/wallet/state')
  }

  exportGitState(): GitExportState {
    throw new NotImplementedInSDK('exportGitState', 'GET /api/trading/uta/:id/wallet/export')
  }

  // ==================== Write / lifecycle (existing routes) ====================

  push(): Promise<PushResult> {
    return this.client.post<PushResult>(`/api/trading/uta/${encodeURIComponent(this.id)}/wallet/push`)
  }

  reject(reason?: string): Promise<RejectResult> {
    return this.client.post<RejectResult>(
      `/api/trading/uta/${encodeURIComponent(this.id)}/wallet/reject`,
      reason !== undefined ? { reason } : undefined,
    )
  }

  // ==================== Write / lifecycle ====================

  commit(message: string): Promise<CommitPrepareResult> {
    return this.client.post<CommitPrepareResult>(
      `/api/trading/uta/${encodeURIComponent(this.id)}/wallet/commit`,
      { message },
    )
  }

  sync(opts?: { delayMs?: number }): Promise<SyncResult> {
    return this.client.post<SyncResult>(
      `/api/trading/uta/${encodeURIComponent(this.id)}/sync`,
      opts ?? {},
    )
  }

  simulatePriceChange(priceChanges: PriceChangeInput[]): Promise<SimulatePriceChangeResult> {
    return this.client.post<SimulatePriceChangeResult>(
      `/api/trading/uta/${encodeURIComponent(this.id)}/simulate-price`,
      { changes: priceChanges },
    )
  }

  refreshCatalog(): Promise<void> {
    // Catalog refresh happens internally inside UTA's 6h loop. Alice's
    // SDK no-ops to keep callers working without forcing a round-trip.
    return Promise.resolve()
  }

  // ==================== Helpers ====================

  contractFromAliceId(_aliceId: string): Contract {
    // Constructing a Contract requires broker-specific lookups; we'd need
    // a dedicated route. Tool layer that needs this re-derives from
    // contract search results today.
    throw new NotImplementedInSDK('contractFromAliceId', 'GET /api/trading/uta/:id/contract-by-alice-id')
  }

  nudgeRecovery(): void {
    // SDK has no local state to nudge; UTA's reconnect logic handles
    // recovery autonomously.
  }

  getPendingOrderIds(): Array<{ orderId: string; symbol: string }> {
    // Used internally by the snapshot builder which lives in UTA — Alice
    // shouldn't need this.
    return []
  }

  setCurrentRound(_round: number): void {
    // Heartbeat-driven simulation round number. UTA-internal concern.
  }

  async close(): Promise<void> {
    // No local state to close.
  }
}
