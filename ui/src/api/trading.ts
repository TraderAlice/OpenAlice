import { fetchJson } from './client'
import type { TradingAccount, AccountSummary, AccountInfo, Position, WalletCommitLog, ReconnectResult, AccountConfig, WalletStatus, WalletPushResult, WalletRejectResult, TestConnectionResult, BrokerTypeInfo, BrokerConfigField, UTASnapshotSummary, EquityCurvePoint } from './types'

// ==================== Unified Trading API ====================

export const tradingApi = {
  // ==================== Accounts ====================

  async listAccounts(): Promise<{ accounts: TradingAccount[] }> {
    return fetchJson('/api/trading/accounts')
  },

  async listAccountSummaries(): Promise<{ accounts: AccountSummary[] }> {
    return fetchJson('/api/trading/accounts')
  },

  async equity(): Promise<{ totalEquity: string; totalCash: string; totalUnrealizedPnL: string; totalRealizedPnL: string; accounts: Array<{ id: string; label: string; equity: string; cash: string }> }> {
    return fetchJson('/api/trading/equity')
  },

  // ==================== FX rates ====================

  async fxRates(): Promise<{ rates: Array<{ currency: string; rate: number; source: string; updatedAt: string }> }> {
    return fetchJson('/api/trading/fx-rates')
  },

  // ==================== Per-account ====================

  async reconnectAccount(accountId: string): Promise<ReconnectResult> {
    const res = await fetch(`/api/trading/accounts/${accountId}/reconnect`, { method: 'POST' })
    return res.json()
  },

  async accountInfo(accountId: string): Promise<AccountInfo> {
    return fetchJson(`/api/trading/accounts/${accountId}/account`)
  },

  async positions(accountId: string): Promise<{ positions: Position[] }> {
    return fetchJson(`/api/trading/accounts/${accountId}/positions`)
  },

  async orders(accountId: string): Promise<{ orders: unknown[] }> {
    return fetchJson(`/api/trading/accounts/${accountId}/orders`)
  },

  async marketClock(accountId: string): Promise<{ isOpen: boolean; nextOpen: string; nextClose: string }> {
    return fetchJson(`/api/trading/accounts/${accountId}/market-clock`)
  },

  async walletLog(accountId: string, limit = 20, symbol?: string): Promise<{ commits: WalletCommitLog[] }> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (symbol) params.set('symbol', symbol)
    return fetchJson(`/api/trading/accounts/${accountId}/wallet/log?${params}`)
  },

  async walletShow(accountId: string, hash: string): Promise<unknown> {
    return fetchJson(`/api/trading/accounts/${accountId}/wallet/show/${hash}`)
  },

  // ==================== Wallet operations ====================

  async walletStatus(accountId: string): Promise<WalletStatus> {
    return fetchJson(`/api/trading/accounts/${accountId}/wallet/status`)
  },

  async walletReject(accountId: string, reason?: string): Promise<WalletRejectResult> {
    const res = await fetch(`/api/trading/accounts/${accountId}/wallet/reject`, {
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

  async walletPush(accountId: string): Promise<WalletPushResult> {
    const res = await fetch(`/api/trading/accounts/${accountId}/wallet/push`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Push failed (${res.status})`)
    }
    return res.json()
  },

  // ==================== Broker Types ====================

  async getBrokerTypes(): Promise<{ brokerTypes: BrokerTypeInfo[] }> {
    return fetchJson('/api/trading/config/broker-types')
  },

  async getCcxtExchanges(): Promise<{ exchanges: string[] }> {
    return fetchJson('/api/trading/config/ccxt/exchanges')
  },

  async getCcxtCredentialFields(exchange: string): Promise<{ fields: BrokerConfigField[] }> {
    return fetchJson(`/api/trading/config/ccxt/exchanges/${encodeURIComponent(exchange)}/credentials`)
  },

  // ==================== Trading Config CRUD ====================

  async loadTradingConfig(): Promise<{ accounts: AccountConfig[] }> {
    return fetchJson('/api/trading/config')
  },

  async upsertAccount(account: AccountConfig): Promise<AccountConfig> {
    const res = await fetch(`/api/trading/config/accounts/${account.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(account),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Failed to save account (${res.status})`)
    }
    return res.json()
  },

  async deleteAccount(id: string): Promise<void> {
    const res = await fetch(`/api/trading/config/accounts/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Failed to delete account (${res.status})`)
    }
  },

  // ==================== Snapshots ====================

  async snapshots(accountId: string, opts?: { limit?: number; startTime?: string; endTime?: string }): Promise<{ snapshots: UTASnapshotSummary[] }> {
    const params = new URLSearchParams()
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.startTime) params.set('startTime', opts.startTime)
    if (opts?.endTime) params.set('endTime', opts.endTime)
    return fetchJson(`/api/trading/accounts/${accountId}/snapshots?${params}`)
  },

  async deleteSnapshot(accountId: string, timestamp: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/trading/accounts/${accountId}/snapshots/${encodeURIComponent(timestamp)}`, { method: 'DELETE' })
    return res.json()
  },

  async equityCurve(opts?: { startTime?: string; endTime?: string; limit?: number }): Promise<{ points: EquityCurvePoint[] }> {
    const params = new URLSearchParams()
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.startTime) params.set('startTime', opts.startTime)
    if (opts?.endTime) params.set('endTime', opts.endTime)
    return fetchJson(`/api/trading/snapshots/equity-curve?${params}`)
  },

  // ==================== Connection Testing ====================

  async testConnection(account: AccountConfig): Promise<TestConnectionResult> {
    const res = await fetch('/api/trading/config/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(account),
    })
    return res.json()
  },
}
