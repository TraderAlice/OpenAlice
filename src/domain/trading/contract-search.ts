/**
 * Aggregate broker-side contract search across all configured UTAs.
 *
 * Shared by the AI tool (`searchContracts`) and the HTTP route
 * (`GET /api/trading/contracts/search`) — both surfaces must return the
 * same shape so a Market workbench card and an LLM see exactly what the
 * other one would.
 *
 * Important — this is the **trading**-side identity layer. The pattern
 * is matched fuzzy / heuristically against each broker's catalogue and
 * the returned `aliceId` is the canonical identifier downstream order
 * APIs expect. Don't try to bridge the resulting symbol back to a
 * data-vendor identity (that's structurally a different namespace).
 */

import type { ContractDescription } from '@traderalice/ibkr'
import type { UTAManager } from './uta-manager.js'
import {
  normalizeBrokerSearchPattern,
  type AssetClassHint,
} from './contract-search-rules.js'

export interface ContractSearchHit {
  /** UTA account id that the contract lives on (e.g. "alpaca-paper"). */
  source: string
  contract: ContractDescription['contract']
  derivativeSecTypes: string[]
}

export async function searchTradeableContracts(
  manager: UTAManager,
  pattern: string,
  assetClass: AssetClassHint = 'unknown',
): Promise<ContractSearchHit[]> {
  // Translate data-vendor symbol to a broker-friendly pattern. The rule set
  // and its rationale live in `./contract-search-rules.md` — read that
  // before changing what gets normalized.
  const brokerPattern = normalizeBrokerSearchPattern(pattern, assetClass)
  if (!brokerPattern) return []

  const targets = manager.resolve()
  if (targets.length === 0) return []

  const hits: ContractSearchHit[] = []
  // Settle individually so a single broker's failure doesn't take down the
  // whole sweep — the original AI tool used try/catch in a for-loop for the
  // same reason. Promise.allSettled lets it run concurrently.
  const settled = await Promise.allSettled(
    targets.map(async (uta) => ({ id: uta.id, results: await uta.searchContracts(brokerPattern) })),
  )
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    for (const desc of r.value.results) {
      hits.push({
        source: r.value.id,
        contract: desc.contract,
        derivativeSecTypes: desc.derivativeSecTypes,
      })
    }
  }
  return hits
}
