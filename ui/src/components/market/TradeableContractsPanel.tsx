import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { tradingApi, type ContractSearchHit } from '../../api/trading'
import type { AssetClass } from '../../api/market'
import { Card } from './Card'

interface Props {
  /** The data-vendor symbol the user is currently viewing. */
  symbol: string
  /** Asset class hint forwarded to the broker-side search rule set. */
  assetClass: AssetClass
}

/**
 * Bridges the analysis surface to the trading surface without merging
 * their identities. Searches every configured UTA's broker for contracts
 * matching the data-side symbol heuristically and lists them with their
 * canonical alice ids so a curious user can answer "if I wanted to act
 * on this, where would I do it?" — and so we get a non-AI inspection
 * window into UTA contract state for debugging.
 */
const COLLAPSED_LIMIT = 3

export function TradeableContractsPanel({ symbol, assetClass }: Props) {
  const [hits, setHits] = useState<ContractSearchHit[] | null>(null)
  const [utasConfigured, setAccountsConfigured] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setExpanded(false)  // collapse on symbol/asset change
    tradingApi.searchContracts(symbol, assetClass)
      .then((res) => {
        if (cancelled) return
        setHits(res.results)
        setAccountsConfigured(res.utasConfigured ?? null)
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [symbol, assetClass])

  const info = [
    'Endpoint: /api/trading/contracts/search',
    'Heuristic broker-side fuzzy match — symbol on the analysis side is just a query string here, not the canonical id.',
    'Tradeable identity is the broker\u2019s aliceId (alias:broker:exchange-id). Use it to actually place orders.',
  ].join('\n')

  return (
    <Card title="Tradeable on configured brokers" info={info}>
      {loading && <div className="text-[12px] text-text-muted">Searching brokers…</div>}
      {error && !loading && <div className="text-[12px] text-red-400">{error}</div>}

      {!loading && !error && utasConfigured === 0 && (
        <div className="text-[12px] text-text-muted">
          No trading accounts configured.{' '}
          <Link to="/trading" className="text-accent hover:underline">
            Add one in Trading
          </Link>
          {' '}to see matching contracts here.
        </div>
      )}

      {!loading && !error && utasConfigured !== 0 && hits && hits.length === 0 && (
        <div className="text-[12px] text-text-muted">
          No tradeable contracts matching <span className="font-mono">{symbol}</span> on your configured brokers.
        </div>
      )}

      {!loading && !error && hits && hits.length > 0 && (() => {
        const sorted = [...hits].sort(byInstrumentFamiliarity)
        const overflow = sorted.length > COLLAPSED_LIMIT
        const visible = expanded || !overflow ? sorted : sorted.slice(0, COLLAPSED_LIMIT)
        const hidden = sorted.length - visible.length
        return (
          <>
            <ul className="flex flex-col divide-y divide-border/40 -mx-3">
              {visible.map((h, i) => (
                <ContractRow key={`${h.source}:${h.contract.aliceId ?? i}`} hit={h} />
              ))}
            </ul>
            {overflow && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 text-[11px] text-text-muted/70 hover:text-accent transition-colors cursor-pointer"
              >
                {expanded ? `Show fewer` : `Show ${hidden} more (${sorted.length} total)`}
              </button>
            )}
          </>
        )
      })()}
    </Card>
  )
}

/**
 * Order rows by how directly they relate to the asset the analysis page is
 * about — stocks first (a user looking at AAPL almost always wants the stock,
 * not a derivative), then spot, then perpetuals, then dated futures, then
 * options. Brokers report their own preferred order (CCXT prioritizes swaps
 * because they're the most-traded products); we override that for the UI.
 */
function instrumentTier(hit: ContractSearchHit): number {
  const c = hit.contract
  const sec = (c.secType ?? '').toUpperCase()
  const local = (c.localSymbol ?? c.aliceId ?? '') as string
  if (sec === 'STK') return 0
  if (sec === 'CRYPTO') {
    // CCXT marks both spot and perpetual swaps as CRYPTO. Spot has no `:`
    // settlement-currency suffix; perpetuals have `:` but no trailing
    // `-YYMMDD` expiry.
    if (!local.includes(':')) return 1
    return 2
  }
  if (sec === 'FUT') return 3
  if (sec === 'OPT') return 4
  return 5
}

function byInstrumentFamiliarity(a: ContractSearchHit, b: ContractSearchHit): number {
  const t = instrumentTier(a) - instrumentTier(b)
  if (t !== 0) return t
  // Within the same tier, keep upstream broker order — that already encodes
  // each broker's "preferred quote currency" / liquidity heuristic.
  return 0
}

function ContractRow({ hit }: { hit: ContractSearchHit }) {
  const c = hit.contract
  const aliceId = c.aliceId as string | undefined
  // Bridge to the UTA detail page's order entry — clicking jumps the
  // user from "I see this contract on this UTA" to "place an order
  // against it" with the alice id pre-filled.
  const orderHref = aliceId
    ? `/uta/${encodeURIComponent(hit.source)}?aliceId=${encodeURIComponent(aliceId)}`
    : null
  return (
    <li className="px-3 py-2 flex items-baseline gap-3 text-[12px] hover:bg-bg-tertiary/40 transition-colors">
      <span className="font-mono font-semibold text-text">{c.symbol ?? '—'}</span>
      {c.secType && (
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted font-medium">
          {c.secType}
        </span>
      )}
      <span className="text-text-muted/70 truncate flex-1">
        {[c.description || c.localSymbol, c.primaryExchange ?? c.exchange, c.currency]
          .filter(Boolean)
          .join(' · ')}
      </span>
      <span className="text-[10px] text-text-muted/60 shrink-0">{hit.source}</span>
      {aliceId && (
        <code
          className="text-[10px] font-mono text-text-muted truncate max-w-[260px]"
          title={aliceId}
        >
          {aliceId}
        </code>
      )}
      {orderHref && (
        <Link
          to={orderHref}
          className="text-[11px] text-accent hover:underline shrink-0"
          title="Open order entry on the UTA"
        >
          Order →
        </Link>
      )}
    </li>
  )
}
