import { useEffect, useState } from 'react'
import { marketApi, type KeyMetrics, type FinancialRatios } from '../../api/market'
import { Card } from './Card'
import { fmtNumber, fmtPercent, fmtMoneyShort } from './format'

interface Props {
  symbol: string
}

type Loaded = { metrics: KeyMetrics | null; ratios: FinancialRatios | null }

export function KeyMetricsPanel({ symbol }: Props) {
  const [data, setData] = useState<Loaded | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetch = (isInitial: boolean) => {
      if (isInitial) setLoading(true)
      if (isInitial) setError(null)
      // Metrics and ratios both feed this panel, but ratios isn't implemented
      // on every provider (yfinance 500s with "Fetcher not found"). Use
      // allSettled so a single rejection doesn't discard the other source.
      Promise.allSettled([marketApi.equity.metrics(symbol), marketApi.equity.ratios(symbol)])
        .then(([mRes, rRes]) => {
          if (cancelled) return
          const m = mRes.status === 'fulfilled' ? mRes.value : null
          const r = rRes.status === 'fulfilled' ? rRes.value : null
          const metrics = m?.results?.[0] ?? null
          const ratios = r?.results?.[0] ?? null
          if (!metrics && !ratios) {
            const rejectMsg = (x: PromiseSettledResult<unknown>) =>
              x.status === 'rejected' ? (x.reason instanceof Error ? x.reason.message : String(x.reason)) : undefined
            setError(rejectMsg(mRes) ?? m?.error ?? rejectMsg(rRes) ?? r?.error ?? 'No data')
            return
          }
          setData({ metrics, ratios })
          setProvider(m?.provider ?? r?.provider ?? null)
        })
        .finally(() => { if (!cancelled && isInitial) setLoading(false) })
    }
    fetch(true)
    // Market cap / valuation ratios move with price; refresh every 5 min so
    // an overnight-open tab doesn't show stale numbers. Less aggressive than
    // the quote header because these fields are less price-immediate.
    const timer = setInterval(() => fetch(false), 300_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [symbol])

  const m = data?.metrics ?? {}
  const r = data?.ratios ?? {}
  // Ratios gives us valuation + margins; metrics gives market_cap, EV, ROE/ROA.
  // Merge with metrics winning where both have a key.
  const both = { ...r, ...m } as Record<string, unknown>

  // Curated list of what most investors glance at. FMP's live schema uses
  // snake_case for canonical fields and *TTM camelCase for trailing variants;
  // we pick snake_case first and fall back where the canonical is missing.
  const rows: Array<[string, string]> = [
    ['P/E',           fmtNumber(both.price_to_earnings)],
    ['PEG',           fmtNumber(both.priceToEarningsGrowthRatioTTM)],
    ['P/S',           fmtNumber(both.price_to_sales)],
    ['P/B',           fmtNumber(both.price_to_book)],
    ['EV/EBITDA',     fmtNumber(both.ev_to_ebitda)],
    ['EV/Sales',      fmtNumber(both.ev_to_sales)],
    ['Div Yield',     fmtPercent(both.dividend_yield)],
    ['ROE',           fmtPercent(both.return_on_equity)],
    ['ROA',           fmtPercent(both.return_on_assets)],
    ['Gross Margin',  fmtPercent(both.gross_profit_margin)],
    ['Op Margin',     fmtPercent(both.operating_profit_margin)],
    ['Net Margin',    fmtPercent(both.net_profit_margin)],
    ['Debt/Equity',   fmtNumber(both.debt_to_equity)],
    ['Current Ratio', fmtNumber(both.current_ratio)],
    ['Market Cap',    fmtMoneyShort(both.marketCap ?? both.market_cap)],
    ['Enterprise V',  fmtMoneyShort(both.enterprise_value)],
  ]

  // Compose a hover hint that explains where the numbers came from, which
  // endpoints were merged, and flags provider-specific gaps the user is
  // most likely to notice. Extend when more caveats earn a mention.
  const infoLines: string[] = [
    provider ? `Source: ${provider}` : 'Source: (unknown)',
    'Endpoints: /equity/fundamental/metrics + /equity/fundamental/ratios',
    'Values are trailing-twelve-months where applicable; market cap is live.',
  ]
  if (data && !data.ratios && data.metrics) {
    infoLines.push('Note: ratios endpoint not implemented by this provider — showing metrics only.')
  }
  const info = infoLines.join('\n')

  return (
    <Card title="Key Metrics" info={info}>
      {loading && <div className="text-[12px] text-text-muted">Loading…</div>}
      {error && !loading && <div className="text-[12px] text-red-400">{error}</div>}
      {!loading && !error && data && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between border-b border-border/30 py-1 last:border-b-0">
              <dt className="text-text-muted/70">{k}</dt>
              <dd className="font-mono text-text tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  )
}
