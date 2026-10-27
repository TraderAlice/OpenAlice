import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { marketApi, type RotationPeriod } from '../../api/market'
import { cn } from '../../lib/utils'
import { fmtPercent } from '../market/format'
import { useReferenceBoard } from '../market/useReferenceBoard'
import { Button } from '../ui/button'

export function NewsSectorHeatmap({ selected, chartId, onSelect }: {
  selected?: string; chartId: string; onSelect: (symbol: string, name: string, button: HTMLButtonElement) => void
}) {
  const { t } = useTranslation()
  const [period, setPeriod] = useState<RotationPeriod>('1D')
  const descriptionId = useId()
  const { data, loading, error, retry } = useReferenceBoard(marketApi.sectorRotation, 300_000)
  const rows = data?.sectors ?? []
  return <div className="space-y-2 px-4 py-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="group" aria-label={t('news.market.performancePeriod')} className="flex gap-0.5">
        {(['1D', '1W', '1M', '3M', '6M'] as const).map(value => <Button key={value} size="xs" variant={period === value ? 'secondary' : 'ghost'} aria-pressed={period === value} onClick={() => setPeriod(value)}>{value}</Button>)}
      </div>
      <span className="text-[10px] text-muted-foreground">{t('news.market.equalTiles')}</span>
    </div>
    {loading && !data ? <p role="status" className="py-4 text-xs text-muted-foreground">{t('common.loading')}</p>
      : <>
        {(error || rows.length === 0) && <div className="flex items-center gap-2 text-xs text-muted-foreground"><p role="status">{t('news.market.unavailable')}</p><Button size="xs" variant="ghost" onClick={retry}>{t('common.retry')}</Button></div>}
        {rows.length > 0 && <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-4">
          {rows.map(row => {
            const value = Number.isFinite(row.returns[period]) ? row.returns[period] : null
            const name = t(`news.market.sectorNames.${row.symbol}`, { defaultValue: row.sector })
            const expanded = selected === row.symbol
            return <button key={row.symbol} type="button" aria-label={t('news.market.viewChart', { name: `${name} (${row.symbol})` })} aria-describedby={`${descriptionId}-${row.symbol}`} aria-expanded={expanded} aria-controls={expanded ? chartId : undefined}
              onClick={event => onSelect(row.symbol, name, event.currentTarget)}
              className={cn('min-w-0 rounded-sm border border-transparent px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring',
                value !== null && value > 0 ? 'bg-success/10 text-success hover:bg-success/20' : value !== null && value < 0 ? 'bg-destructive/10 text-destructive hover:bg-destructive/20' : 'bg-muted text-muted-foreground hover:bg-muted/80',
                expanded && 'border-ring')}>
              <span className="block truncate text-xs font-medium">{name}</span>
              <span className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 font-mono text-xs tabular-nums"><span>{row.symbol}</span><span id={`${descriptionId}-${row.symbol}`}><span className="sr-only">{period} </span>{value !== null && value > 0 ? '+' : ''}{fmtPercent(value)}</span></span>
            </button>
          })}
        </div>}
      </>}
    {data && <p className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground"><span>{data.asOf} · {data.meta?.provider ?? '—'}</span>{data.meta?.stale && <span>{t('news.market.cached')}</span>}</p>}
  </div>
}
