import { useEffect, useState } from 'react'
import { marketApi, type EquityQuote } from '../../api/market'
import { Skeleton } from '../StateViews'
import { fmtNumber, fmtMoneyShort, fmtPercent, fmtInt } from './format'

interface Props {
  symbol: string
}

export function QuoteHeader({ symbol }: Props) {
  const [quote, setQuote] = useState<EquityQuote | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetch = () => {
      setError(null)
      marketApi.equity.quote(symbol).then((res) => {
        if (cancelled) return
        if (res.error) setError(res.error)
        setQuote(res.results?.[0] ?? null)
        setProvider(res.provider || null)
      }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    }
    fetch()
    // Quote is price-sensitive; re-poll every 60s so a tab left open overnight
    // doesn't show yesterday's last print as if it were live.
    const timer = setInterval(fetch, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [symbol])

  const name = quote?.name as string | undefined
  const exchange = quote?.exchange as string | undefined
  const lastPrice = quote?.last_price as number | undefined
  const change = quote?.change as number | undefined
  const changePct = quote?.change_percent as number | undefined
  const up = (change ?? 0) >= 0
  // First-load: no quote yet and no error → show skeletons in place of the
  // (otherwise dash-filled) value slots. `quote` stays set across the 60s
  // re-poll, so this won't flash on a background refetch.
  const loading = !quote && !error

  return (
    <section className="oa-data-surface flex flex-wrap items-stretch gap-x-5 gap-y-3 rounded-lg border px-4 py-3">
      <div className="flex min-w-[14rem] flex-col justify-center">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[20px] font-semibold text-foreground tracking-tight">{symbol}</span>
          {loading ? (
            <Skeleton className="h-3.5 w-28 rounded" />
          ) : (
            <>
              {name && <span className="text-[13px] text-muted-foreground truncate">{name}</span>}
              {exchange && (
                <span className="text-[11px] font-medium text-muted-foreground">
                  {exchange}
                </span>
              )}
              {provider && (
                <span className="text-[11px] font-medium text-muted-foreground">
                  {provider}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-baseline gap-3 mt-1">
          <span className="text-[22px] font-mono font-semibold text-foreground">
            {loading ? (
              <Skeleton className="inline-block h-6 w-28 rounded align-baseline" />
            ) : (
              fmtNumber(lastPrice)
            )}
          </span>
          {loading ? (
            <Skeleton className="h-3.5 w-24 rounded" />
          ) : (
            change != null &&
            changePct != null && (
              <span className={`text-[13px] font-medium ${up ? 'text-success' : 'text-destructive'}`}>
                {up ? '+' : ''}{fmtNumber(change)} ({up ? '+' : ''}{fmtPercent(changePct)})
              </span>
            )
          )}
        </div>
      </div>

      {/* Bid / ask intentionally omitted — they're real-time L1 quote data
          that belongs at the execution layer (UTA), not in analysis. */}
      <dl className="grid min-w-0 flex-1 grid-cols-2 content-center gap-x-4 gap-y-1 border-border/60 text-[11px] sm:grid-cols-3 sm:border-l sm:pl-5 md:grid-cols-5">
        <Field label="Open"      value={fmtNumber(quote?.open)}        loading={loading} />
        <Field label="Prev"      value={fmtNumber(quote?.prev_close)}  loading={loading} />
        <Field label="High"      value={fmtNumber(quote?.high)}        loading={loading} />
        <Field label="Low"       value={fmtNumber(quote?.low)}         loading={loading} />
        <Field label="Volume"    value={fmtInt(quote?.volume)}         loading={loading} />
        <Field label="Mkt Cap"   value={fmtMoneyShort(quote?.market_cap)} loading={loading} />
        <Field label="52W High"  value={fmtNumber(quote?.year_high)}   loading={loading} />
        <Field label="52W Low"   value={fmtNumber(quote?.year_low)}    loading={loading} />
        <Field label="MA50"      value={fmtNumber(quote?.ma50)}        loading={loading} />
        <Field label="MA200"     value={fmtNumber(quote?.ma200)}       loading={loading} />
      </dl>

      {error && <div className="w-full text-[11px] text-destructive">{error}</div>}
    </section>
  )
}

function Field({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col justify-center py-0.5">
      <dt className="text-[11px] font-medium leading-4 text-muted-foreground/70">{label}</dt>
      <dd className="mt-px truncate font-mono leading-[16px] tabular-nums text-foreground">
        {loading ? <Skeleton className="h-3 w-12 rounded mt-0.5" /> : value}
      </dd>
    </div>
  )
}
