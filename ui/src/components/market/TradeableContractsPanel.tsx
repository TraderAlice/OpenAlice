import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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

  return (
    <Card title={t('market.tradeableTitle')} info={t('market.tradeableInfo')}>
      {loading && <div className="text-[12px] text-muted-foreground">{t('market.tradeableSearching')}</div>}
      {error && !loading && <div className="text-[12px] text-destructive">{error}</div>}

      {!loading && !error && utasConfigured === 0 && (
        <div className="text-[12px] text-muted-foreground">
          <Trans
            i18nKey="market.tradeableNoAccounts"
            components={{
              tradingLink: <Link to="/trading" className="text-primary hover:underline" />,
            }}
          />
        </div>
      )}

      {!loading && !error && utasConfigured !== 0 && hits && hits.length === 0 && (
        <div className="text-[12px] text-muted-foreground">
          {t('market.tradeableNoMatches', { symbol })}
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
                className="mt-2 text-[11px] text-muted-foreground/70 hover:text-primary transition-colors cursor-pointer"
              >
                {expanded
                  ? t('market.tradeableShowFewer')
                  : t('market.tradeableShowMore', { hidden, total: sorted.length })}
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
  if (sec === 'STK') return 0
  if (sec === 'CRYPTO') return 1
  if (sec === 'CRYPTO_PERP') return 2
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
  const { t } = useTranslation()
  const c = hit.contract
  const aliceId = c.aliceId as string | undefined
  // Bridge to the UTA detail page's order entry — clicking jumps the
  // user from "I see this contract on this UTA" to "place an order
  // against it" with the alice id pre-filled.
  const orderHref = aliceId
    ? `/uta/${encodeURIComponent(hit.source)}?aliceId=${encodeURIComponent(aliceId)}`
    : null
  const description = [c.description || c.localSymbol, c.primaryExchange ?? c.exchange, c.currency]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2 text-[12px] transition-colors hover:bg-muted/40 sm:flex sm:items-baseline sm:gap-3">
      <span className="flex min-w-0 items-center gap-2 sm:contents">
        <span className="truncate font-mono font-semibold text-foreground">{c.symbol ?? '—'}</span>
        {c.secType && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {c.secType}
          </span>
        )}
      </span>

      <span className="col-span-2 min-w-0 truncate text-muted-foreground/70 sm:flex-1">
        {description}
      </span>

      <span className="col-span-2 flex min-w-0 items-center gap-2">
        <span className={`${aliceId ? 'hidden sm:inline' : ''} shrink-0 text-[10px] text-muted-foreground/60`}>
          {hit.source}
        </span>
        {aliceId && (
          <code
            className="min-w-0 max-w-full truncate font-mono text-[10px] text-muted-foreground sm:max-w-[260px]"
            title={aliceId}
          >
            {aliceId}
          </code>
        )}
      </span>

      {orderHref && (
        <Link
          to={orderHref}
          className="row-start-1 col-start-2 inline-flex min-h-8 shrink-0 items-center rounded-md px-2 text-[11px] text-primary hover:bg-primary/10 sm:min-h-0 sm:rounded-none sm:px-0 sm:hover:bg-transparent sm:hover:underline"
          title={t('market.tradeableOrderTitle')}
        >
          {t('market.tradeableOrder')} →
        </Link>
      )}
    </li>
  )
}
