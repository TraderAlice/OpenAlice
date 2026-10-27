import { useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { X } from 'lucide-react'
import type { AssetClass } from '../../api/market'
import { useMarketBars } from '../../hooks/useMarketBars'
import { cn } from '../../lib/utils'
import { MeasuredChartFrame } from '../MeasuredChartFrame'
import { fmtNumber, fmtPercent } from '../market/format'
import { Button } from '../ui/button'
import { NewsSectorHeatmap } from './NewsSectorHeatmap'

type Asset = { assetClass: AssetClass; symbol: string; name: string }
const assetKey = (asset: Pick<Asset, 'assetClass' | 'symbol'>) => `${asset.assetClass}:${asset.symbol}`

export function NewsMarketContext({ watchlist, title, showMarkets = false }: {
  watchlist: Array<Pick<Asset, 'assetClass' | 'symbol'>>; title?: string; showMarkets?: boolean
}) {
  const { t } = useTranslation()
  const [group, setGroup] = useState<'overview' | 'forex' | 'commodities' | 'crypto' | 'sectors'>('overview')
  const groups: Record<string, Asset[]> = {
    forex: [
      { assetClass: 'currency', symbol: 'EURUSD', name: 'EUR/USD' },
      { assetClass: 'currency', symbol: 'USDJPY', name: 'USD/JPY' },
      { assetClass: 'currency', symbol: 'GBPUSD', name: 'GBP/USD' },
      { assetClass: 'currency', symbol: 'USDCNY', name: 'USD/CNY' },
    ],
    commodities: [
      { assetClass: 'commodity', symbol: 'gold', name: t('news.market.commodityGold') },
      { assetClass: 'commodity', symbol: 'crude_oil', name: t('news.market.oil') },
      { assetClass: 'commodity', symbol: 'silver', name: t('news.market.silver') },
      { assetClass: 'commodity', symbol: 'copper', name: t('news.market.copper') },
    ],
    crypto: [
      { assetClass: 'crypto', symbol: 'BTCUSD', name: 'BTC/USD' },
      { assetClass: 'crypto', symbol: 'ETHUSD', name: 'ETH/USD' },
      { assetClass: 'crypto', symbol: 'SOLUSD', name: 'SOL/USD' },
    ],
  }
  const overview: Asset[] = watchlist.length ? watchlist.slice(0, 4).map(asset => ({ ...asset, name: asset.symbol })) : [
    { assetClass: 'equity', symbol: '^GSPC', name: t('news.market.sp500') },
    { assetClass: 'equity', symbol: '000001.SS', name: t('news.market.shanghai') },
    { assetClass: 'commodity', symbol: 'GC=F', name: t('news.market.gold') },
    { assetClass: 'crypto', symbol: 'BTC-USD', name: 'BTC/USD' },
  ]
  const assets = group === 'overview' ? overview : groups[group] ?? []
  const [selected, setSelected] = useState<Asset | null>(null)
  const origin = useRef<HTMLButtonElement | null>(null)
  const chartId = useId()
  const asset = group === 'sectors' ? selected : assets.find(item => selected && assetKey(item) === assetKey(selected))
  const select = (item: Asset, button: HTMLButtonElement) => {
    origin.current = button
    setSelected(current => current && assetKey(current) === assetKey(item) ? null : item)
  }
  const close = () => { setSelected(null); origin.current?.focus() }
  return <section aria-label={title ?? t('news.market.context')} className="shrink-0 border-b border-border">
    <div className="flex items-center justify-between gap-2 px-4 pt-2 text-[11px] text-muted-foreground">
      <span>{title ?? t('news.market.context')}</span><span>{t(group === 'sectors' ? 'news.market.etfPerformance' : 'news.market.daily')}</span>
    </div>
    {showMarkets && <div role="group" aria-label={t('news.market.groups')} className="flex flex-wrap gap-0.5 px-4 pt-1">
      {(['overview', 'forex', 'commodities', 'crypto', 'sectors'] as const).map(value => <Button key={value} size="xs" variant={group === value ? 'secondary' : 'ghost'} aria-pressed={group === value}
        onClick={() => { setSelected(null); setGroup(value) }}>{t(`news.market.${value === 'overview' && watchlist.length ? 'watchlist' : value}`)}</Button>)}
    </div>}
    {group === 'sectors' ? <NewsSectorHeatmap selected={selected?.symbol} chartId={chartId}
      onSelect={(symbol, name, button) => select({ assetClass: 'equity', symbol, name }, button)} />
      : <div className="flex overflow-x-auto px-2 pb-1">
        {assets.map(item => <MarketTicker key={assetKey(item)} asset={item} expanded={!!selected && assetKey(item) === assetKey(selected)} chartId={chartId}
          onSelect={button => select(item, button)} />)}
      </div>}
    {asset && <MarketChart key={assetKey(asset)} id={chartId} asset={asset} onClose={close} />}
  </section>
}

function MarketTicker({ asset, expanded, chartId, onSelect }: {
  asset: Asset; expanded: boolean; chartId: string; onSelect: (button: HTMLButtonElement) => void
}) {
  const { t } = useTranslation()
  const { bars, meta, loading, error, retry } = useMarketBars({ symbol: asset.symbol, assetClass: asset.assetClass, interval: '1d', count: 2 })
  const latest = bars?.at(-1)
  const previous = bars?.at(-2)
  const digits = asset.assetClass === 'currency' ? 4 : 2
  const change = latest && previous && Number.isFinite(latest.close) && Number.isFinite(previous.close) && previous.close !== 0
    ? (latest.close - previous.close) / Math.abs(previous.close) : null
  return <div className="relative min-w-44 flex-1">
    <button type="button" aria-label={t('news.market.viewChart', { name: asset.name })} aria-expanded={expanded} aria-controls={expanded ? chartId : undefined}
      onClick={event => onSelect(event.currentTarget)} className={cn('w-full rounded-md px-2 py-2 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring', expanded && 'bg-muted')}>
      <span className="block text-xs font-medium">{asset.name}</span>
      <span className="mt-1 flex items-baseline gap-2 font-mono text-sm tabular-nums">
        <span>{loading ? '…' : fmtNumber(latest?.close, digits)}</span>
        <span className={cn('text-xs', change !== null && change > 0 ? 'text-success' : change !== null && change < 0 ? 'text-destructive' : 'text-muted-foreground')}>
          {change !== null && change > 0 ? '+' : ''}{fmtPercent(change)}
        </span>
      </span>
      <span className="mt-1 block text-[10px] text-muted-foreground">{loading ? t('common.loading') : error ? t('news.market.unavailable') : `${latest?.date ?? '—'} · ${meta?.provider ?? '—'}`}</span>
    </button>
    {error && <Button size="xs" variant="ghost" className="ml-2" aria-label={t('news.market.retryData', { name: asset.name })} onClick={retry}>{t('common.retry')}</Button>}
  </div>
}

function MarketChart({ id, asset, onClose }: { id: string; asset: Asset; onClose: () => void }) {
  const { t } = useTranslation()
  const [days, setDays] = useState(90)
  const start = useMemo(() => { const date = new Date(); date.setDate(date.getDate() - days); return date.toISOString().slice(0, 10) }, [days])
  const { bars, meta, loading, error, retry } = useMarketBars({ symbol: asset.symbol, assetClass: asset.assetClass, interval: '1d', start })
  const data = bars?.map(bar => ({ date: bar.date, close: Number.isFinite(bar.close) ? bar.close : null }))
  const latest = bars?.at(-1)
  const available = data?.some(bar => bar.close !== null)
  const digits = asset.assetClass === 'currency' ? 4 : 2
  return <section id={id} aria-label={t('news.market.chart')} className="border-t border-border px-4 py-3">
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
      <h3 className="text-xs font-medium">{asset.name}</h3>
      <div className="flex gap-0.5" role="group" aria-label={t('news.market.range')}>
        {([['1M', 30], ['3M', 90], ['1Y', 365]] as const).map(([label, value]) => <Button key={label} size="xs" variant={days === value ? 'secondary' : 'ghost'} aria-pressed={days === value} onClick={() => setDays(value)}>{label}</Button>)}
      </div>
      <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label={t('news.market.closeChart')} onClick={onClose}><X className="size-3.5" aria-hidden /></Button>
    </div>
    {loading ? <p role="status" className="py-8 text-xs text-muted-foreground">{t('common.loading')}</p>
      : error || !available ? <div className="py-4 text-xs text-muted-foreground"><p role="status">{t('news.market.unavailable')}</p><Button size="xs" variant="outline" className="mt-2" onClick={retry}>{t('common.retry')}</Button></div>
      : <>
        <p className="mb-2 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground"><span className="font-mono text-sm tabular-nums text-foreground">{fmtNumber(latest?.close, digits)}</span><span>{latest?.date} · {meta?.provider ?? '—'}</span></p>
        <MeasuredChartFrame className="h-40">
          {({ width, height }) => <LineChart accessibilityLayer width={width} height={height} data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" tickFormatter={value => String(value).slice(5, 10)} minTickGap={40} tick={{ fontSize: 10, fill: 'var(--chart-axis)' }} stroke="var(--chart-axis)" />
            <YAxis domain={['auto', 'auto']} tickFormatter={value => fmtNumber(value, asset.assetClass === 'currency' ? digits : 0)} width={64} tick={{ fontSize: 10, fill: 'var(--chart-axis)' }} stroke="var(--chart-axis)" />
            <Tooltip isAnimationActive={false} formatter={value => [fmtNumber(Number(value), digits), asset.name]} labelFormatter={value => String(value)} />
            <Line type="linear" dataKey="close" stroke="var(--chart-1)" strokeWidth={1.5} dot={{ r: 1.5 }} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>}
        </MeasuredChartFrame>
      </>}
  </section>
}
