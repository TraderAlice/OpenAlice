import { fetchJson } from './client'
import type { TradingAccount, UTASummary, AccountInfo, Position, WalletCommitLog, ReconnectResult, UTAConfig, WalletStatus, WalletPushResult, WalletRejectResult, TestConnectionResult, BrokerPreset, UTASnapshotSummary, EquityCurvePoint, PlaceOrderRequest, ClosePositionRequest, CancelOrderRequest, OrderErrorResponse } from './types'

/** Thrown by the one-shot order endpoints when the server returns non-2xx. Carries the phase. */
export class OrderEntryError extends Error {
  constructor(public readonly status: number, public readonly response: OrderErrorResponse) {
    super(response.error)
  }
}

/** One contract returned by the broker-side fuzzy search. Shape mirrors what
 *  the AI tool emits — same canonical aliceId for downstream order routing. */
export interface ContractSearchHit {
  source: string
  contract: {
    aliceId?: string
    symbol?: string
    secType?: string
    exchange?: string
    primaryExchange?: string
    currency?: string
    localSymbol?: string
    description?: string
    [key: string]: unknown
  }
  derivativeSecTypes: string[]
}

export interface ContractSearchResponse {
  results: ContractSearchHit[]
  count: number
  /** 0 when no UTAs are configured; lets the UI nudge towards /trading. */
  utasConfigured?: number
}

// ==================== Unified Trading API ====================

export const tradingApi = {
  // ==================== UTAs (listing + per-UTA reads) ====================

  async listUTAs(): Promise<{ utas: TradingAccount[] }> {
    return fetchJson('/api/trading/uta')
  },

  async listUTASummaries(): Promise<{ utas: UTASummary[] }> {
    return fetchJson('/api/trading/uta')
  },

  async equity(): Promise<{ totalEquity: string; totalCash: string; totalUnrealizedPnL: string; totalRealizedPnL: string; accounts: Array<{ id: string; label: string; equity: string; cash: string }> }> {
    return fetchJson('/api/trading/equity')
  },

  // ==================== FX rates ====================

  async fxRates(): Promise<{ rates: Array<{ currency: string; rate: number; source: string; updatedAt: string }> }> {
    return fetchJson('/api/trading/fx-rates')
  },

  // ==================== Per-UTA ====================

  async reconnectUTA(utaId: string): Promise<ReconnectResult> {
    const res = await fetch(`/api/trading/uta/${utaId}/reconnect`, { method: 'POST' })
    return res.json()
  },

  /** Broker-side account info (cash, equity, margin) for a given UTA.
   *  Note `account` here is the *broker* account, distinct from the UTA. */
  async utaAccount(utaId: string): Promise<AccountInfo> {
    return fetchJson(`/api/trading/uta/${utaId}/account`)
  },

  async utaPositions(utaId: string): Promise<{ positions: Position[] }> {
    return fetchJson(`/api/trading/uta/${utaId}/positions`)
  },

  async utaOrders(utaId: string): Promise<{ orders: unknown[] }> {
    return fetchJson(`/api/trading/uta/${utaId}/orders`)
  },

  async marketClock(utaId: string): Promise<{ isOpen: boolean; nextOpen: string; nextClose: string }> {
    return fetchJson(`/api/trading/uta/${utaId}/market-clock`)
  },

  async walletLog(utaId: string, limit = 20, symbol?: string): Promise<{ commits: WalletCommitLog[] }> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (symbol) params.set('symbol', symbol)
    return fetchJson(`/api/trading/uta/${utaId}/wallet/log?${params}`)
  },

  async walletShow(utaId: string, hash: string): Promise<unknown> {
    return fetchJson(`/api/trading/uta/${utaId}/wallet/show/${hash}`)
  },

  // ==================== Wallet operations ====================

  async walletStatus(utaId: string): Promise<WalletStatus> {
    return fetchJson(`/api/trading/uta/${utaId}/wallet/status`)
  },

  async walletReject(utaId: string, reason?: string): Promise<WalletRejectResult> {
    const res = await fetch(`/api/trading/uta/${utaId}/wallet/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reason ? { reason } : {}),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Reject failed (${res.status})`)
    }
    return res.json()
  },

  async walletPush(utaId: string): Promise<WalletPushResult> {
    const res = await fetch(`/api/trading/uta/${utaId}/wallet/push`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Push failed (${res.status})`)
    }
    return res.json()
  },

  // ==================== One-shot order entry (manual frontend surface) ====================
  //
  // Each call combines stage → commit → push on the backend. Returns
  // the full WalletPushResult; on failure throws OrderEntryError with
  // a `phase` indicating which step blew up.

  async placeOrder(utaId: string, body: PlaceOrderRequest): Promise<WalletPushResult> {
    return postOrder(`/api/trading/uta/${utaId}/wallet/place-order`, body)
  },

  async closePosition(utaId: string, body: ClosePositionRequest): Promise<WalletPushResult> {
    return postOrder(`/api/trading/uta/${utaId}/wallet/close-position`, body)
  },

  async cancelOrder(utaId: string, body: CancelOrderRequest): Promise<WalletPushResult> {
    return postOrder(`/api/trading/uta/${utaId}/wallet/cancel-order`, body)
  },

  // ==================== Broker Presets ====================

  async getBrokerPresets(): Promise<{ presets: BrokerPreset[] }> {
    return fetchJson('/api/trading/config/broker-presets')
  },

  // ==================== Trading Config CRUD ====================

  async loadTradingConfig(): Promise<{ utas: UTAConfig[] }> {
    return fetchJson('/api/trading/config')
  },

  async upsertUTA(uta: UTAConfig): Promise<UTAConfig> {
    const res = await fetch(`/api/trading/config/uta/${uta.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uta),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Failed to save UTA (${res.status})`)
    }
    return res.json()
  },

  async deleteUTA(id: string): Promise<void> {
    const res = await fetch(`/api/trading/config/uta/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Failed to delete UTA (${res.status})`)
    }
  },

  // ==================== Snapshots ====================

  async snapshots(utaId: string, opts?: { limit?: number; startTime?: string; endTime?: string }): Promise<{ snapshots: UTASnapshotSummary[] }> {
    const params = new URLSearchParams()
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.startTime) params.set('startTime', opts.startTime)
    if (opts?.endTime) params.set('endTime', opts.endTime)
    return fetchJson(`/api/trading/uta/${utaId}/snapshots?${params}`)
  },

  async deleteSnapshot(utaId: string, timestamp: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/trading/uta/${utaId}/snapshots/${encodeURIComponent(timestamp)}`, { method: 'DELETE' })
    return res.json()
  },

  async equityCurve(opts?: { startTime?: string; endTime?: string; limit?: number }): Promise<{ points: EquityCurvePoint[] }> {
    const params = new URLSearchParams()
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.startTime) params.set('startTime', opts.startTime)
    if (opts?.endTime) params.set('endTime', opts.endTime)
    return fetchJson(`/api/trading/snapshots/equity-curve?${params}`)
  },

  // ==================== Contract search ====================

  /**
   * Heuristic broker-side search across all configured UTAs. Used by the
   * Market workbench to surface tradeable contracts matching a data-vendor
   * symbol — the bridge is intentionally fuzzy / display-only.
   */
  async searchContracts(
    pattern: string,
    assetClass?: 'equity' | 'crypto' | 'currency' | 'commodity',
  ): Promise<ContractSearchResponse> {
    const qs = new URLSearchParams({ pattern })
    if (assetClass) qs.set('assetClass', assetClass)
    return fetchJson(`/api/trading/contracts/search?${qs}`)
  },

  // ==================== Connection Testing ====================

  async testConnection(uta: UTAConfig): Promise<TestConnectionResult> {
    const res = await fetch('/api/trading/config/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uta),
    })
    return res.json()
  },
}

// ==================== Internal helpers ====================

async function postOrder(url: string, body: unknown): Promise<WalletPushResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as OrderErrorResponse
    throw new OrderEntryError(res.status, { error: json.error ?? `Request failed (${res.status})`, phase: json.phase })
  }
  return res.json()
}
