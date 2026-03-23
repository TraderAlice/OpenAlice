/**
 * AccountManager — UTA lifecycle management, registry, and aggregation.
 *
 * Owns the full account lifecycle: create → register → reconnect → remove → close.
 * Also provides cross-account operations (aggregated equity, contract search).
 */

import type { Contract, ContractDescription, ContractDetails } from '@traderalice/ibkr'
import type { AccountCapabilities, BrokerHealth, BrokerHealthInfo } from './brokers/types.js'
import { CcxtBroker } from './brokers/ccxt/CcxtBroker.js'
import { createCcxtProviderTools } from './brokers/ccxt/ccxt-tools.js'
import { createBroker } from './brokers/factory.js'
import { UnifiedTradingAccount } from './UnifiedTradingAccount.js'
import { loadGitState, createGitPersister } from './git-persistence.js'
import { readAccountsConfig, type AccountConfig } from '../../core/config.js'
import type { EventLog } from '../../core/event-log.js'
import type { ToolCenter } from '../../core/tool-center.js'
import type { ReconnectResult } from '../../core/types.js'
import './contract-ext.js'

// ==================== Account summary ====================

export interface AccountSummary {
  id: string
  label: string
  capabilities: AccountCapabilities
  health: BrokerHealthInfo
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
    health: BrokerHealth
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
  private reconnecting = new Set<string>()

  private eventLog?: EventLog
  private toolCenter?: ToolCenter

  constructor(deps?: { eventLog: EventLog; toolCenter: ToolCenter }) {
    this.eventLog = deps?.eventLog
    this.toolCenter = deps?.toolCenter
  }

  // ==================== Lifecycle ====================

  /** Create a UTA from account config, register it, and start async broker connection. */
  async initAccount(accCfg: AccountConfig): Promise<UnifiedTradingAccount> {
    const broker = createBroker(accCfg)
    const savedState = await loadGitState(accCfg.id)
    const uta = new UnifiedTradingAccount(broker, {
      guards: accCfg.guards,
      savedState,
      onCommit: createGitPersister(accCfg.id),
      onHealthChange: (accountId, health) => {
        this.eventLog?.append('account.health', { accountId, ...health })
      },
    })
    this.add(uta)
    return uta
  }

  /** Reconnect an account: close old → re-read config → create new → verify connection. */
  async reconnectAccount(accountId: string): Promise<ReconnectResult> {
    if (this.reconnecting.has(accountId)) {
      return { success: false, error: 'Reconnect already in progress' }
    }
    this.reconnecting.add(accountId)
    try {
      // Re-read config to pick up credential/guard changes
      const freshAccounts = await readAccountsConfig()

      // Close old account
      await this.removeAccount(accountId)

      const accCfg = freshAccounts.find((a) => a.id === accountId)
      if (!accCfg) {
        return { success: true, message: `Account "${accountId}" not found in config (removed or disabled)` }
      }

      const uta = await this.initAccount(accCfg)

      // Wait for broker.init() + broker.getAccount() to verify the connection
      await uta.waitForConnect()

      // Re-register CCXT-specific tools if this is a CCXT account
      if (accCfg.type === 'ccxt') {
        this.toolCenter?.register(
          createCcxtProviderTools(this),
          'trading-ccxt',
        )
      }

      const label = uta.label ?? accountId
      console.log(`reconnect: ${label} online`)
      return { success: true, message: `${label} reconnected` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`reconnect: ${accountId} failed:`, msg)
      return { success: false, error: msg }
    } finally {
      this.reconnecting.delete(accountId)
    }
  }

  /** Close and deregister an account. No-op if account doesn't exist. */
  async removeAccount(accountId: string): Promise<void> {
    const uta = this.entries.get(accountId)
    if (!uta) return
    this.entries.delete(accountId)
    try { await uta.close() } catch { /* best effort */ }
  }

  /** Register CCXT provider tools if any CCXT accounts are present. */
  registerCcxtToolsIfNeeded(): void {
    const hasCcxt = this.resolve().some((uta) => uta.broker instanceof CcxtBroker)
    if (hasCcxt) {
      this.toolCenter?.register(createCcxtProviderTools(this), 'trading-ccxt')
      console.log('ccxt: provider tools registered')
    }
  }

  // ==================== Registration ====================

  add(uta: UnifiedTradingAccount): void {
    if (this.entries.has(uta.id)) {
      throw new Error(`Account "${uta.id}" already registered`)
    }
    this.entries.set(uta.id, uta)
  }

  remove(id: string): void {
    this.entries.delete(id)
  }

  // ==================== Lookups ====================

  get(id: string): UnifiedTradingAccount | undefined {
    return this.entries.get(id)
  }

  listAccounts(): AccountSummary[] {
    return Array.from(this.entries.values()).map((uta) => ({
      id: uta.id,
      label: uta.label,
      capabilities: uta.getCapabilities(),
      health: uta.getHealthInfo(),
    }))
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  get size(): number {
    return this.entries.size
  }

  // ==================== Source routing ====================

  resolve(source?: string): UnifiedTradingAccount[] {
    if (!source) {
      return Array.from(this.entries.values())
    }
    const byId = this.entries.get(source)
    if (byId) return [byId]
    return []
  }

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

  // ==================== Cross-account aggregation ====================

  async getAggregatedEquity(): Promise<AggregatedEquity> {
    const results = await Promise.all(
      Array.from(this.entries.values()).map(async (uta) => {
        if (uta.health !== 'healthy') {
          uta.nudgeRecovery()
          return { id: uta.id, label: uta.label, health: uta.health, info: null }
        }
        try {
          const info = await uta.getAccount()
          return { id: uta.id, label: uta.label, health: uta.health, info }
        } catch {
          return { id: uta.id, label: uta.label, health: uta.health, info: null }
        }
      }),
    )

    let totalEquity = 0
    let totalCash = 0
    let totalUnrealizedPnL = 0
    let totalRealizedPnL = 0
    const accounts: AggregatedEquity['accounts'] = []

    for (const { id, label, health, info } of results) {
      if (info) {
        totalEquity += info.netLiquidation
        totalCash += info.totalCashValue
        totalUnrealizedPnL += info.unrealizedPnL
        totalRealizedPnL += info.realizedPnL ?? 0
      }
      accounts.push({
        id,
        label,
        equity: info?.netLiquidation ?? 0,
        cash: info?.totalCashValue ?? 0,
        unrealizedPnL: info?.unrealizedPnL ?? 0,
        health,
      })
    }

    return { totalEquity, totalCash, totalUnrealizedPnL, totalRealizedPnL, accounts }
  }

  // ==================== Cross-account contract search ====================

  async searchContracts(
    pattern: string,
    accountId?: string,
  ): Promise<ContractSearchResult[]> {
    const targets = accountId
      ? [this.entries.get(accountId)].filter(Boolean) as UnifiedTradingAccount[]
      : Array.from(this.entries.values())

    const results = await Promise.all(
      targets.map(async (uta) => {
        if (uta.health !== 'healthy') {
          uta.nudgeRecovery()
          return { accountId: uta.id, results: [] as ContractDescription[] }
        }
        try {
          const descriptions = await uta.searchContracts(pattern)
          return { accountId: uta.id, results: descriptions }
        } catch {
          return { accountId: uta.id, results: [] as ContractDescription[] }
        }
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

  // ==================== Cleanup ====================

  async closeAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.entries.values()).map((uta) => uta.close()),
    )
    this.entries.clear()
  }
}
