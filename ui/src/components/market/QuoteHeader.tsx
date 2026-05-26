import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { marketApi, type EquityQuote } from '../../api/market'
import { fmtNumber, fmtMoneyShort, fmtPercent, fmtInt } from './format'

interface Props {
  symbol: string
}

export function QuoteHeader({ symbol }: Props) {
  const { t } = useTranslation()
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

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2 px-4 py-3 border border-border rounded bg-bg-secondary/30">
      <div className="flex flex-col min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[20px] font-semibold text-text tracking-tight">{symbol}</span>
          {name && <span className="text-[13px] text-text-muted truncate">{name}</span>}
          {exchange && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted font-medium">
              {exchange}
            </span>
          )}
          {provider && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted font-medium">
              {provider}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-3 mt-1">
          <span className="text-[22px] font-mono font-semibold text-text">
            {fmtNumber(lastPrice)}
          </span>
          {change != null && changePct != null && (
            <span className={`text-[13px] font-medium ${up ? 'text-green' : 'text-red'}`}>
              {up ? '+' : ''}{fmtNumber(change)} ({up ? '+' : ''}{fmtPercent(changePct)})
            </span>
          )}
        </div>
      </div>

      {/* Bid / ask intentionally omitted — they're real-time L1 quote data
          that belongs at the execution layer (UTA), not in analysis. */}
      <dl className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-4 gap-y-1 text-[11px]">
        <Field label={t('market.open', 'Open')}      value={fmtNumber(quote?.open)} />
        <Field label={t('market.prevClose', 'Prev')}      value={fmtNumber(quote?.prev_close)} />
        <Field label={t('market.high', 'High')}      value={fmtNumber(quote?.high)} />
        <Field label={t('market.low', 'Low')}       value={fmtNumber(quote?.low)} />
        <Field label={t('market.volume', 'Volume')}    value={fmtInt(quote?.volume)} />
        <Field label={t('market.mktCap', 'Mkt Cap')}   value={fmtMoneyShort(quote?.market_cap)} />
        <Field label={t('market.yearHigh', '52W High')}  value={fmtNumber(quote?.year_high)} />
        <Field label={t('market.yearLow', '52W Low')}   value={fmtNumber(quote?.year_low)} />
        <Field label={t('market.ma50')}      value={fmtNumber(quote?.ma50)} />
        <Field label={t('market.ma200')}     value={fmtNumber(quote?.ma200)} />
      </dl>

      {error && <div className="w-full text-[11px] text-red">{error}</div>}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col min-w-0">
      <dt className="text-text-muted/60 uppercase tracking-wide">{label}</dt>
      <dd className="font-mono text-text truncate">{value}</dd>
    </div>
  )
}
