import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { marketApi, type KeyMetrics, type FinancialRatios } from '../../api/market'
import { Card } from './Card'
import { fmtNumber, fmtPercent, fmtMoneyShort } from './format'

interface Props {
  symbol: string
}

type Loaded = { metrics: KeyMetrics | null; ratios: FinancialRatios | null }

export function KeyMetricsPanel({ symbol }: Props) {
  const { t } = useTranslation()
  const [data, setData] = useState<Loaded | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetch = (isInitial: boolean) => {
      if (isInitial) setLoading(true)
      if (isInitial) setError(null)
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
    const timer = setInterval(() => fetch(false), 300_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [symbol])

  const m = data?.metrics ?? {}
  const r = data?.ratios ?? {}
  const both = { ...r, ...m } as Record<string, unknown>

  const rows: Array<[string, string]> = [
    [t('market.pe'),           fmtNumber(both.price_to_earnings)],
    [t('market.peg'),          fmtNumber(both.priceToEarningsGrowthRatioTTM)],
    [t('market.ps'),           fmtNumber(both.price_to_sales)],
    [t('market.pb'),           fmtNumber(both.price_to_book)],
    [t('market.evEbitda'),     fmtNumber(both.ev_to_ebitda)],
    [t('market.evSales'),      fmtNumber(both.ev_to_sales)],
    [t('market.divYield'),     fmtPercent(both.dividend_yield)],
    [t('market.roe'),          fmtPercent(both.return_on_equity)],
    [t('market.roa'),          fmtPercent(both.return_on_assets)],
    [t('market.grossMargin'),  fmtPercent(both.gross_profit_margin)],
    [t('market.opMargin'),     fmtPercent(both.operating_profit_margin)],
    [t('market.netMargin'),    fmtPercent(both.net_profit_margin)],
    [t('market.debtEquity'),   fmtNumber(both.debt_to_equity)],
    [t('market.currentRatio'), fmtNumber(both.current_ratio)],
    [t('market.marketCap'),    fmtMoneyShort(both.marketCap ?? both.market_cap)],
    [t('market.enterpriseValue'), fmtMoneyShort(both.enterprise_value)],
  ]

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
    <Card title={t('market.keyMetrics')} info={info}>
      {loading && <div className="text-[12px] text-text-muted">{t('common.loading')}</div>}
      {error && !loading && <div className="text-[12px] text-red">{error}</div>}
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
