/**
 * Manager-level wire types — summaries / aggregations that the UTA
 * service exposes for Alice's SDK to consume. These predate UTA-split
 * (they used to live in `domain/trading/uta-manager.ts`) but were
 * lifted to the shared protocol package so both processes type-check
 * against the same shapes.
 */

import type { AccountCapabilities, BrokerHealth, BrokerHealthInfo } from './broker.js'
import type { ContractDescription } from '@traderalice/ibkr'

export interface UTASummary {
  id: string
  label: string
  /** Whether this UTA participates in broker-backed market-data discovery. */
  asVendor: boolean
  capabilities: AccountCapabilities
  health: BrokerHealthInfo
}

export interface AggregatedEquity {
  totalEquity: string
  totalCash: string
  totalUnrealizedPnL: string
  totalRealizedPnL: string
  /** Present when one or more accounts used fallback FX rates. */
  fxWarnings?: string[]
  accounts: Array<{
    id: string
    label: string
    baseCurrency: string
    equity: string
    cash: string
    unrealizedPnL: string
    health: BrokerHealth
  }>
}

export interface ContractSearchResult {
  accountId: string
  results: ContractDescription[]
}

/**
 * One flat contract-search hit as actually returned by
 * `GET /api/trading/contracts/search` (aggregated across accounts).
 * `contract.aliceId` is the operational identity downstream order / quote /
 * bar APIs expect. (Distinct from the grouped `ContractSearchResult` above.)
 */
export interface ContractSearchHit {
  /** UTA account id the contract lives on (e.g. "alpaca-paper"). */
  source: string
  contract: ContractDescription['contract']
  derivativeSecTypes: string[]
  /** Venue-decided asset class (the broker's `assetClassFor`) — authoritative
   *  over a secType heuristic. Absent ⇒ consumer falls back to secType. */
  assetClass?: 'equity' | 'crypto' | 'currency' | 'commodity' | 'unknown'
}
