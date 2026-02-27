import { fetchJson } from './client'
import type { CryptoAccount, CryptoPosition, SecAccount, SecHolding, WalletCommitLog, ReconnectResult } from './types'

export const tradingApi = {
  // ==================== Reconnect ====================

  async reconnectCrypto(): Promise<ReconnectResult> {
    const res = await fetch('/api/crypto/reconnect', { method: 'POST' })
    return res.json()
  },

  async reconnectSecurities(): Promise<ReconnectResult> {
    const res = await fetch('/api/securities/reconnect', { method: 'POST' })
    return res.json()
  },

  // ==================== Crypto Data ====================

  async cryptoAccount(): Promise<CryptoAccount> {
    return fetchJson('/api/crypto/account')
  },

  async cryptoPositions(): Promise<{ positions: CryptoPosition[] }> {
    return fetchJson('/api/crypto/positions')
  },

  async cryptoOrders(): Promise<{ orders: unknown[] }> {
    return fetchJson('/api/crypto/orders')
  },

  async cryptoWalletLog(limit = 20, symbol?: string): Promise<{ commits: WalletCommitLog[] }> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (symbol) params.set('symbol', symbol)
    return fetchJson(`/api/crypto/wallet/log?${params}`)
  },

  async cryptoWalletShow(hash: string): Promise<unknown> {
    return fetchJson(`/api/crypto/wallet/show/${hash}`)
  },

  // ==================== Securities Data ====================

  async secAccount(): Promise<SecAccount> {
    return fetchJson('/api/securities/account')
  },

  async secPortfolio(): Promise<{ holdings: SecHolding[] }> {
    return fetchJson('/api/securities/portfolio')
  },

  async secOrders(): Promise<{ orders: unknown[] }> {
    return fetchJson('/api/securities/orders')
  },

  async secMarketClock(): Promise<{ isOpen: boolean; nextOpen: string; nextClose: string }> {
    return fetchJson('/api/securities/market-clock')
  },

  async secWalletLog(limit = 20, symbol?: string): Promise<{ commits: WalletCommitLog[] }> {
    const params = new URLSearchParams({ limit: String(limit) })
    if (symbol) params.set('symbol', symbol)
    return fetchJson(`/api/securities/wallet/log?${params}`)
  },

  async secWalletShow(hash: string): Promise<unknown> {
    return fetchJson(`/api/securities/wallet/show/${hash}`)
  },
}
