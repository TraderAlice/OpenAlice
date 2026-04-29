/**
 * Fuzzy ranking for broker catalog entries.
 *
 * Brokers that expose their full catalog (Alpaca via /v2/assets, every CCXT
 * exchange via loadMarkets, Mock via a hardcoded list) implement
 * `searchContracts` as "score each cached entry against the query, sort by
 * score, return the top N". This is the scoring function they share.
 *
 * Brokers that ship with a server-side fuzzy endpoint (IBKR's
 * reqMatchingSymbols) bypass this entirely — they're SearchingCatalogs
 * and trust the broker's own ranking.
 *
 * Scoring is intentionally a small bag of tiers rather than something
 * subtler — predictable beats clever for a function that has to debug-by-
 * eyeball when a broker's data changes shape.
 */

import { ContractDescription, Contract } from '@traderalice/ibkr'

export interface FuzzyRankInput {
  /** Catalog entries to rank. Anything with at least a symbol works. */
  contract: Pick<Contract, 'symbol' | 'localSymbol' | 'description' | 'currency' | 'secType'>
  /** Optional broker-derived hints. CCXT splits its symbol into base/quote;
   *  Alpaca stores the long company name on the asset. Both contribute to
   *  ranking but neither is required. */
  base?: string
  quote?: string
  name?: string
}

export interface FuzzyRankOptions {
  /** Cap the result count. Default 50; broker UIs can't usefully render more. */
  limit?: number
}

/**
 * Score a catalog entry against the query. Higher is better.
 *
 *   100 — exact match on symbol, base, or name
 *    80 — symbol/base startsWith query
 *    70 — name starts at a word boundary with the query
 *    50 — name has the query as a whole word
 *    30 — symbol/name contains the query as a substring
 *     0 — no signal; entry is dropped
 *
 * Mirrors the scoring used by aggregateSymbolSearch on the data side, so
 * "type partial keyword" feels the same in both halves of the workbench.
 */
function score(query: string, entry: FuzzyRankInput): number {
  const q = query.toLowerCase()
  if (!q) return 0

  const sym = (entry.contract.symbol ?? '').toLowerCase()
  const local = (entry.contract.localSymbol ?? '').toLowerCase()
  const base = (entry.base ?? '').toLowerCase()
  const quote = (entry.quote ?? '').toLowerCase()
  const name = (entry.name ?? entry.contract.description ?? '').toLowerCase()

  if (sym === q || base === q || name === q) return 100
  if ((sym && sym.startsWith(q)) || (base && base.startsWith(q))) return 80
  if (name.startsWith(q) && (name.length === q.length || !/[a-z0-9]/i.test(name[q.length]))) return 70

  // Build a regex once per call — escape user input so symbols like `BRK.B`
  // don't accidentally turn into regex metacharacters.
  const wbRe = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  if (name && wbRe.test(name)) return 50

  if (sym.includes(q) || local.includes(q) || name.includes(q)) return 30
  // Quote currency match is the weakest signal — only triggers if nothing
  // else fits, so "USDT" doesn't dominate the result list.
  if (quote === q) return 20
  return 0
}

export function fuzzyRankContracts(
  entries: FuzzyRankInput[],
  query: string,
  options: FuzzyRankOptions = {},
): ContractDescription[] {
  const q = query.trim()
  if (!q) return []

  // Precompute scores once; stable-sort by (-score, original index) so
  // upstream broker order acts as a tiebreaker — useful for CCXT where the
  // exchange returns markets in a roughly liquidity-ordered way.
  const scored = entries
    .map((e, i) => ({ e, i, s: score(q, e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))

  const limit = options.limit ?? 50
  const top = scored.slice(0, limit)

  return top.map((x) => {
    const desc = new ContractDescription()
    desc.contract = Object.assign(new Contract(), x.e.contract)
    return desc
  })
}
