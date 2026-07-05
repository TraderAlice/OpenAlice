/**
 * UTAManagerSDK — HTTP-backed adapter mirroring `UTAManager`'s public
 * surface so Alice's `main.ts`, telegram-plugin, trading-config UI, and
 * tool layer keep working unchanged after UTA-split v1.
 *
 * Key design choices (memory:linear-vscode-hybrid, port-architecture-3-layers):
 *   - All formerly-sync methods (`resolve`, `get`, `size`, `listUTAs`)
 *     become async. Callsites add a single `await` keyword.
 *   - State-mutating calls (`reconnectUTA`, `removeUTA`) trigger the
 *     Guardian flag protocol — Guardian SIGTERMs UTA and respawns,
 *     picking up whatever Alice wrote to `accounts.json`.
 *   - Setup hooks (`setSnapshotHooks`, `setFxService`,
 *     `registerCcxtToolsIfNeeded`, `initUTA`, `closeAll`) become no-ops
 *     in Alice — UTA owns those concerns end-to-end.
 *
 * The SDK does NOT extend `UTAManager` (which lives in UTA's process,
 * not Alice's after the physical move). It mirrors the *shape* of the
 * public API only.
 */

import type {
  UTAClient,
  UTASummary,
  AggregatedEquity,
  ContractSearchHit,
} from '@traderalice/uta-protocol'
import type { ContractDescription, Contract, ContractDetails } from '@traderalice/ibkr'
import type { ReconnectResult } from '../../core/types.js'
import { triggerUTARestart } from '../uta-supervisor/restart-trigger.js'
import { UTAAccountSDK, NotImplementedInSDK } from './UTAAccountSDK.js'

export interface UTAManagerSDKDeps {
  client: UTAClient
}

export class UTAManagerSDK {
  private readonly client: UTAClient

  constructor(deps: UTAManagerSDKDeps) {
    this.client = deps.client
  }

  // ==================== Setup hooks — UTA owns these now ====================

  /** No-op on the Alice side; UTA bootstraps its own snapshot scheduler. */
  setSnapshotHooks(_hooks: unknown): void { /* no-op */ }

  /** No-op on the Alice side; UTA owns its own FxService. */
  setFxService(_fx: unknown): void { /* no-op */ }

  /** No-op on the Alice side; UTA owns the CCXT tool registration. */
  registerCcxtToolsIfNeeded(): void { /* no-op */ }

  /** No-op on the Alice side — UTA reads accounts.json on boot. Alice
   *  triggering "initUTA" actually means: write accounts.json, touch the
   *  restart flag, let Guardian respawn UTA. That flow lives in
   *  trading-config routes, not here. */
  async initUTA(_cfg: unknown): Promise<UTAAccountSDK> {
    throw new NotImplementedInSDK('initUTA', 'Alice does not bootstrap UTAs; write accounts.json + triggerUTARestart()')
  }

  /** No-op — Alice has no in-process broker connections to add. */
  add(_uta: unknown): void { /* no-op */ }

  /** No-op — Alice has no in-process broker connections to remove. */
  remove(_id: string): void { /* no-op */ }

  /** No-op shutdown — Alice has no broker connections. UTA's own
   *  SIGTERM handler closes its brokers. */
  async closeAll(): Promise<void> { /* no-op */ }

  // ==================== Reads (HTTP-backed) ====================

  async listUTAs(): Promise<UTASummary[]> {
    const res = await this.client.get<{ utas: UTASummary[] }>(`/api/trading/uta`)
    return res.utas
  }

  /** Async equivalent of `UTAManager.resolve(source?)`. Filters by id or
   *  provider prefix when `source` is given.
   *
   *  `tradingOnly` (used by the user-portfolio aggregations — account /
   *  portfolio / orders) drops keyless **'data'-tier** sources
   *  (binance-readonly, okx-readonly, bybit-readonly) from the no-source
   *  aggregate: they hold no user positions or orders, so including them only
   *  adds failure surface — a region-blocked public-data source must not blank
   *  the whole portfolio (issue #390). An explicit `source` still resolves a
   *  data-tier account (you can query it directly). */
  async resolve(source?: string, opts?: { tradingOnly?: boolean }): Promise<UTAAccountSDK[]> {
    const all = await this.listUTAs()
    let matches = source
      ? all.filter((u) => u.id === source || u.id.startsWith(`${source}-`))
      : all
    if (!source && opts?.tradingOnly) {
      matches = matches.filter((u) => u.health.tier !== 'data')
    }
    return matches.map((u) => new UTAAccountSDK({ client: this.client, id: u.id, label: u.label }))
  }

  /** Like `UTAManager.resolveOne(source)` but async and throws when
   *  resolution is ambiguous or empty. */
  async resolveOne(source: string): Promise<UTAAccountSDK> {
    const hits = await this.resolve(source)
    if (hits.length === 0) throw new Error(`No UTA matched source "${source}"`)
    if (hits.length > 1) {
      throw new Error(`Source "${source}" is ambiguous — ${hits.length} UTAs match. Use an explicit accountId.`)
    }
    return hits[0]
  }

  async get(id: string): Promise<UTAAccountSDK | undefined> {
    const all = await this.listUTAs()
    const match = all.find((u) => u.id === id)
    return match ? new UTAAccountSDK({ client: this.client, id: match.id, label: match.label }) : undefined
  }

  async has(id: string): Promise<boolean> {
    const all = await this.listUTAs()
    return all.some((u) => u.id === id)
  }

  /** sourceId → declared historical-bar quality, for the federated bar layer to
   *  report each broker's honest entitlement (Alpaca free = 'iex', CCXT =
   *  'realtime') rather than blanket-labeling broker sources 'realtime'. */
  async getBarCapabilities(): Promise<Record<string, 'realtime' | 'iex' | 'delayed' | 'subscription'>> {
    const all = await this.listUTAs()
    const out: Record<string, 'realtime' | 'iex' | 'delayed' | 'subscription'> = {}
    for (const u of all) {
      const q = u.capabilities.historicalBars?.quality
      if (q) out[u.id] = q
    }
    return out
  }

  /** UTAManager exposed `size` as a sync getter — SDK can't avoid the
   *  HTTP round-trip, so this is a method. Callsites become
   *  `await manager.size()`. */
  async size(): Promise<number> {
    return (await this.listUTAs()).length
  }

  async getAggregatedEquity(): Promise<AggregatedEquity> {
    return this.client.get<AggregatedEquity>(`/api/trading/equity`)
  }

  /** USD FX rates for the currencies currently in use across all active
   *  UTAs (collected server-side from positions + account base currency).
   *  Used by the AI portfolio tool for cross-currency percentage math. */
  async getFxRates(): Promise<Array<{ currency: string; rate: number; source: string; updatedAt: string }>> {
    const res = await this.client.get<{ rates: Array<{ currency: string; rate: number; source: string; updatedAt: string }> }>(`/api/trading/fx-rates`)
    return res.rates
  }

  // ==================== Lifecycle — via Guardian restart ====================

  /** Reconnect a single UTA. SDK-side: we don't have account granularity
   *  over the wire today, so this triggers a whole-UTA-process restart
   *  via Guardian. UTA reads fresh `accounts.json` on respawn.
   *
   *  v1 trade-off: a single broker rotation restarts all brokers. Users
   *  with multiple live UTAs see a brief reconnect window. Acceptable
   *  for v1; finer-grained reconnect can land alongside per-UTA hot
   *  reload in a future step. */
  async reconnectUTA(_id: string): Promise<ReconnectResult> {
    const r = await triggerUTARestart()
    if (r.triggered && r.ready) return { success: true, message: 'UTA restarted' }
    return { success: false, error: r.error ?? 'UTA restart did not complete' }
  }

  /** Same shape: triggers UTA restart so the new process picks up the
   *  caller-side write to `accounts.json`. */
  async removeUTA(_id: string): Promise<void> {
    await triggerUTARestart().catch((err) => {
      // Best-effort — config-route caller has already deleted from disk;
      // not blocking the response on UTA respawn completion.
      console.warn('[uta-sdk] removeUTA restart trigger failed:', err instanceof Error ? err.message : err)
    })
  }

  // ==================== Search ====================

  async searchContracts(
    pattern: string,
    _assetClass?: unknown,
  ): Promise<ContractSearchHit[]> {
    // The route returns flat per-account hits ({ source, contract,
    // derivativeSecTypes }), NOT the grouped ContractSearchResult shape.
    const res = await this.client.get<{ results: ContractSearchHit[] }>(
      `/api/trading/contracts/search`,
      { pattern },
    )
    return res.results
  }

  async getContractDetails(
    _aliceId: string,
    _query: Contract,
  ): Promise<ContractDetails | null> {
    throw new NotImplementedInSDK(
      'getContractDetails',
      'GET /api/trading/uta/:id/contracts/details',
    )
  }
}

export type { ContractDescription }
