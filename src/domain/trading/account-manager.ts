/**
 * AccountManager — multi-UTA registry and aggregation
 *
 * Holds all UnifiedTradingAccount instances, provides cross-account operations
 * like aggregated equity, global contract search, and source routing.
 */

import type { Contract, ContractDescription, ContractDetails } from '@traderalice/ibkr'
import type { AccountCapabilities } from './brokers/types.js'
import type { UnifiedTradingAccount } from './UnifiedTradingAccount.js'
import './contract-ext.js'

// ==================== Account summary ====================

export interface AccountSummary {
  id: string
  provider: string
  label: string
  platformId?: string
  capabilities: AccountCapabilities
}

// ==================== Aggregated equity ====================

export interface AggregatedEquity {
  totalEquity: number
  totalCash: number
  totalUnrealizedPnL: number
  totalRealizedPnL: number
  accounts: Array<{
    id: string
    label: string
    equity: number
    cash: number
    unrealizedPnL: number
  }>
}

// ==================== Contract search result ====================

export interface ContractSearchResult {
  accountId: string
  results: ContractDescription[]
}

// ==================== AccountManager ====================

export class AccountManager {
  private entries = new Map<string, UnifiedTradingAccount>()

  // ---- Registration ----

  add(uta: UnifiedTradingAccount): void {
    if (this.entries.has(uta.id)) {
      throw new Error(`Account "${uta.id}" already registered`)
    }
    this.entries.set(uta.id, uta)
  }

  remove(id: string): void {
    this.entries.delete(id)
  }

  // ---- Lookups ----

  get(id: string): UnifiedTradingAccount | undefined {
    return this.entries.get(id)
  }

  listAccounts(): AccountSummary[] {
    return Array.from(this.entries.values()).map((uta) => ({
      id: uta.id,
      provider: uta.provider,
      label: uta.label,
      platformId: uta.platformId,
      capabilities: uta.getCapabilities(),
    }))
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  get size(): number {
    return this.entries.size
  }

  // ---- Source routing ----

  /**
   * Resolve a source string to matching UTAs.
   * - If omitted, returns all.
   * - Tries id match first, then provider match.
   */
  resolve(source?: string): UnifiedTradingAccount[] {
    if (!source) {
      return Array.from(this.entries.values())
    }
    // Try id match first
    const byId = this.entries.get(source)
    if (byId) return [byId]

    // Then provider match
    return Array.from(this.entries.values()).filter((uta) => uta.provider === source)
  }

  /**
   * Resolve to exactly one UTA. Throws if zero or multiple matches.
   */
  resolveOne(source: string): UnifiedTradingAccount {
    const results = this.resolve(source)
    if (results.length === 0) {
      throw new Error(`No account found matching source "${source}". Use listAccounts to see available accounts.`)
    }
    if (results.length > 1) {
      throw new Error(
        `Multiple accounts match source "${source}": ${results.map((r) => r.id).join(', ')}. Use account id for exact match.`,
      )
    }
    return results[0]
  }

  // ---- Cross-account aggregation ----

  /** Throttle: only warn once per account per 5 minutes */
  private equityWarnedAt = new Map<string, number>()
  private static readonly EQUITY_WARN_INTERVAL_MS = 5 * 60_000

  async getAggregatedEquity(): Promise<AggregatedEquity> {
    const results = await Promise.all(
      Array.from(this.entries.values()).map(async (uta) => {
        try {
          const info = await uta.getAccount()
          return { id: uta.id, label: uta.label, info }
        } catch (err) {
          const now = Date.now()
          const lastWarned = this.equityWarnedAt.get(uta.id) ?? 0
          if (now - lastWarned > AccountManager.EQUITY_WARN_INTERVAL_MS) {
            console.warn(`getAggregatedEquity: ${uta.id} failed, skipping:`, err)
            this.equityWarnedAt.set(uta.id, now)
          }
          return { id: uta.id, label: uta.label, info: null }
        }
      }),
    )

    let totalEquity = 0
    let totalCash = 0
    let totalUnrealizedPnL = 0
    let totalRealizedPnL = 0
    const accounts: AggregatedEquity['accounts'] = []

    for (const { id, label, info } of results) {
      if (!info) continue
      totalEquity += info.netLiquidation
      totalCash += info.totalCashValue
      totalUnrealizedPnL += info.unrealizedPnL
      totalRealizedPnL += info.realizedPnL
      accounts.push({
        id,
        label,
        equity: info.netLiquidation,
        cash: info.totalCashValue,
        unrealizedPnL: info.unrealizedPnL,
      })
    }

    return { totalEquity, totalCash, totalUnrealizedPnL, totalRealizedPnL, accounts }
  }

  // ---- Cross-account contract search ----

  async searchContracts(
    pattern: string,
    accountId?: string,
  ): Promise<ContractSearchResult[]> {
    const targets = accountId
      ? [this.entries.get(accountId)].filter(Boolean) as UnifiedTradingAccount[]
      : Array.from(this.entries.values())

    const results = await Promise.all(
      targets.map(async (uta) => {
        const descriptions = await uta.searchContracts(pattern)
        return { accountId: uta.id, results: descriptions }
      }),
    )

    return results.filter((r) => r.results.length > 0)
  }

  async getContractDetails(
    query: Contract,
    accountId: string,
  ): Promise<ContractDetails | null> {
    const uta = this.entries.get(accountId)
    if (!uta) return null
    return uta.getContractDetails(query)
  }

  // ---- Lifecycle ----

  async closeAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.entries.values()).map((uta) => uta.close()),
    )
    this.entries.clear()
  }
}
