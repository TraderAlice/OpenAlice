import { fetchJson } from './client'
import type { TradingAccount, AccountSummary, AccountInfo, Position, WalletCommitLog, ReconnectResult, PlatformConfig, AccountConfig, WalletStatus, WalletPushResult, WalletRejectResult, TestConnectionResult } from './types'

// ==================== Unified Trading API ====================

export const tradingApi = {
  // ==================== Accounts ====================

  async listAccounts(): Promise<{ accounts: TradingAccount[] }> {
    return fetchJson('/api/trading/accounts')
  },

  async listAccountSummaries(): Promise<{ accounts: AccountSummary[] }> {
    return fetchJson('/api/trading/accounts')
  },

  async equity(): Promise<{ totalEquity: number; totalCash: number; totalUnrealizedPnL: number; totalRealizedPnL: number; accounts: Array<{ id: string; label: string; equity: number; cash: number }> }> {
    return fetchJson('/api/trading/equity')
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

  // ==================== Trading Config CRUD ====================

  async loadTradingConfig(): Promise<{ platforms: PlatformConfig[]; accounts: AccountConfig[] }> {
    return fetchJson('/api/trading/config')
  },

  async upsertPlatform(platform: PlatformConfig): Promise<PlatformConfig> {
    const res = await fetch(`/api/trading/config/platforms/${platform.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(platform),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Failed to save platform (${res.status})`)
    }
    return res.json()
  },

  async deletePlatform(id: string): Promise<void> {
    const res = await fetch(`/api/trading/config/platforms/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Failed to delete platform (${res.status})`)
    }
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

  async testConnection(platform: PlatformConfig, credentials: { apiKey: string; apiSecret: string; password?: string }): Promise<TestConnectionResult> {
    const res = await fetch('/api/trading/config/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, credentials }),
    })
    return res.json()
  },
}
