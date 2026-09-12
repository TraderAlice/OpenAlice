import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Download, RefreshCw, Settings2 } from 'lucide-react'
import { api } from '../api'
import type {
  MonitorAlert,
  MonitorAsset,
  MonitorEvaluation,
  MonitorSettings,
  MonitorSnapshot,
} from '../api/market-monitor'
import type { HistoricalBar } from '../api/market'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/ui/button'
import { EmptyState, Skeleton } from '../components/StateViews'
import { cn } from '../lib/utils'

const ASSETS: MonitorAsset[] = ['BTC', 'TSLA']
const DEFAULT_SETTINGS: MonitorSettings = {
  enabledAssets: ASSETS,
  intervalMinutes: 15,
  notifications: false,
  alertConfidence: 68,
  abnormalVolumeRatio: 1.8,
  abnormalMovePercent: 1.5,
}

type Timeframe = '1D' | '1H'

function formatNumber(value: unknown, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value)
    : '—'
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? '—' : `${value > 0 ? '+' : ''}${formatNumber(value)}%`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function usePersistedAsset(): [MonitorAsset, (asset: MonitorAsset) => void] {
  const [asset, setAssetState] = useState<MonitorAsset>(() => window.localStorage.getItem('market-monitor.asset') === 'TSLA' ? 'TSLA' : 'BTC')
  const setAsset = (next: MonitorAsset) => {
    window.localStorage.setItem('market-monitor.asset', next)
    setAssetState(next)
  }
  return [asset, setAsset]
}

export function MarketEvidenceMonitorPage({ visible = true }: { visible?: boolean }) {
  const [asset, setAsset] = usePersistedAsset()
  const [timeframe, setTimeframe] = useState<Timeframe>('1D')
  const [settings, setSettings] = useState<MonitorSettings>(DEFAULT_SETTINGS)
  const [history, setHistory] = useState<Record<MonitorAsset, MonitorSnapshot[]>>({ BTC: [], TSLA: [] })
  const [alerts, setAlerts] = useState<MonitorAlert[]>([])
  const [evaluation, setEvaluation] = useState<MonitorEvaluation | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const seenAlerts = useRef<Set<string> | null>(null)
  const lastScheduledAt = useRef(Date.now())
  const snapshots = history[asset]
  const snapshot = snapshots.at(-1) ?? null

  const notifyNewAlerts = useCallback((next: MonitorAlert[], allowNotifications: boolean) => {
    if (!seenAlerts.current) {
      seenAlerts.current = new Set(next.map((item) => item.id))
      return
    }
    const fresh = next.filter((item) => !seenAlerts.current!.has(item.id))
    next.forEach((item) => seenAlerts.current!.add(item.id))
    if (!allowNotifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    fresh.forEach((item) => new Notification(item.title, { body: item.message, tag: item.fingerprint }))
  }, [])

  const loadState = useCallback(async (initial = false) => {
    try {
      const [nextSettings, btc, tsla, nextAlerts] = await Promise.all([
        api.marketMonitor.settings(),
        api.marketMonitor.snapshots('BTC', 120),
        api.marketMonitor.snapshots('TSLA', 120),
        api.marketMonitor.alerts(undefined, 100),
      ])
      setSettings(nextSettings)
      setHistory({ BTC: btc.snapshots, TSLA: tsla.snapshots })
      setAlerts(nextAlerts.alerts)
      notifyNewAlerts(nextAlerts.alerts, nextSettings.notifications)
      setRefreshError(null)
      if (initial) setError(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (initial) setError(message)
      else setRefreshError(message)
    } finally {
      if (initial) setLoading(false)
    }
  }, [notifyNewAlerts])

  const scan = useCallback(async (target: MonitorAsset, trigger: 'manual' | 'scheduled') => {
    setScanning(true)
    try {
      const result = await api.marketMonitor.scan(target, trigger)
      setHistory((current) => {
        const rows = current[target]
        const next = result.stored ? [...rows.filter((row) => row.id !== result.snapshot.id), result.snapshot].slice(-120) : rows.length ? rows : [result.snapshot]
        return { ...current, [target]: next }
      })
      if (result.alert) {
        setAlerts((current) => [...current.filter((item) => item.id !== result.alert!.id), result.alert!].slice(-100))
        notifyNewAlerts([result.alert], settings.notifications)
      }
      setError(null)
      setRefreshError(null)
      return result
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!history[target].length) setError(message)
      else setRefreshError(message)
      return null
    } finally {
      setScanning(false)
    }
  }, [history, notifyNewAlerts, settings.notifications])

  useEffect(() => { void loadState(true) }, [loadState])

  useEffect(() => {
    if (!loading && !snapshot && visible && !error) void scan(asset, 'manual')
  }, [asset, error, loading, scan, snapshot, visible])

  useEffect(() => {
    if (!visible) return
    void api.marketMonitor.evaluation(asset).then(setEvaluation).catch(() => setEvaluation(null))
  }, [asset, snapshots.length, visible])

  useEffect(() => {
    if (!visible) return
    const refresh = window.setInterval(() => { if (document.visibilityState === 'visible') void loadState(false) }, 30_000)
    return () => window.clearInterval(refresh)
  }, [loadState, visible])

  useEffect(() => {
    if (!visible) return
    const cadence = Math.max(1, settings.intervalMinutes) * 60_000
    const scheduled = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      lastScheduledAt.current = Date.now()
      settings.enabledAssets.forEach((target) => { void scan(target, 'scheduled') })
    }, cadence)
    const catchUp = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastScheduledAt.current >= cadence) {
        lastScheduledAt.current = Date.now()
        settings.enabledAssets.forEach((target) => { void scan(target, 'scheduled') })
        void loadState(false)
      }
    }
    document.addEventListener('visibilitychange', catchUp)
    return () => { window.clearInterval(scheduled); document.removeEventListener('visibilitychange', catchUp) }
  }, [loadState, scan, settings.enabledAssets, settings.intervalMinutes, visible])

  const saveSettings = async (next: MonitorSettings) => {
    if (next.notifications && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const permission = await Notification.requestPermission()
      next = { ...next, notifications: permission === 'granted' }
    }
    const saved = await api.marketMonitor.saveSettings(next)
    setSettings(saved)
  }

  const exportData = (format: 'json' | 'csv') => {
    const rows = history[asset]
    const content = format === 'json'
      ? `${JSON.stringify(rows, null, 2)}\n`
      : ['capturedAt,asset,price,bias,confidence,change1dPercent,change5dPercent,volumeRatio20d', ...rows.map((row) => [row.capturedAt, row.asset, row.metrics.lastPrice, row.hypothesis.bias, row.hypothesis.confidence, row.metrics.change1dPercent ?? '', row.metrics.change5dPercent ?? '', row.metrics.volumeRatio20d ?? ''].join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `market-evidence-${asset.toLowerCase()}.${format}`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader
        title="Evidence Monitor"
        description="BTC + TSLA · read-only evidence chain · facts, hypotheses, confirmation and invalidation"
        live={{ lastUpdated: snapshot ? new Date(snapshot.capturedAt) : null, label: snapshot ? `scanned ${formatDate(snapshot.capturedAt)}` : 'waiting for first scan', hideDot: !snapshot }}
        right={<div className="flex items-center gap-1.5">
          {import.meta.env.VITE_DEMO_MODE && <span className="rounded-sm border border-warning/50 bg-warning/10 px-2 py-1 text-[10px] font-semibold tracking-wide text-warning">DEMO DATA · NOT LIVE</span>}
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen((value) => !value)} aria-label="Monitor settings"><Settings2 className="size-4" /></Button>
          <Button size="sm" onClick={() => void scan(asset, 'manual')} disabled={scanning}><RefreshCw className={cn('size-3.5', scanning && 'animate-spin')} />Scan now</Button>
        </div>}
      />

      {refreshError && <div role="status" className="mx-4 mt-2 flex items-center justify-between border-l-2 border-warning bg-warning/5 px-3 py-2 text-xs text-muted-foreground md:mx-6"><span>Refresh failed; the last successful view is retained. {refreshError}</span><Button variant="ghost" size="sm" onClick={() => void loadState(false)}>Retry</Button></div>}

      {settingsOpen && <SettingsPanel settings={settings} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3 md:px-6">
        <div role="tablist" aria-label="Monitored asset" className="inline-flex rounded-md border border-border bg-muted/35 p-0.5">
          {ASSETS.map((item) => <button key={item} role="tab" aria-selected={asset === item} onClick={() => setAsset(item)} className={cn('rounded-[5px] px-4 py-1.5 text-xs font-semibold transition-colors', asset === item ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>{item}<span className="ml-1.5 font-normal text-muted-foreground">{item === 'BTC' ? 'Bitcoin' : 'Tesla'}</span></button>)}
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Chart timeframe" className="inline-flex rounded-md border border-border p-0.5">
            {(['1D', '1H'] as const).map((item) => <button key={item} aria-pressed={timeframe === item} onClick={() => setTimeframe(item)} className={cn('rounded px-2.5 py-1 text-[11px]', timeframe === item ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground')}>{item}</button>)}
          </div>
          <Button variant="ghost" size="sm" onClick={() => exportData('csv')} disabled={!snapshots.length}><Download className="size-3.5" />CSV</Button>
          <Button variant="ghost" size="sm" onClick={() => exportData('json')} disabled={!snapshots.length}>JSON</Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {loading && !snapshot ? <MonitorSkeleton /> : error && !snapshot ? <div><EmptyState title="Evidence monitor unavailable" description={error} /><div className="-mt-9 flex justify-center pb-10"><Button onClick={() => void scan(asset, 'manual')}>Retry scan</Button></div></div> : snapshot ? (
          <div className="mx-auto flex max-w-[1320px] flex-col gap-4 pb-8">
            <Overview snapshot={snapshot} timeframe={timeframe} />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.7fr)]">
              <EvidenceTable snapshot={snapshot} />
              <HypothesisPanel snapshot={snapshot} />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <ContextPanel snapshot={snapshot} />
              <SourcePanel snapshot={snapshot} />
            </div>
            <HistoryPanel snapshots={snapshots} evaluation={evaluation} alerts={alerts.filter((item) => item.asset === asset)} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Panel({ title, trailing, children }: { title: string; trailing?: React.ReactNode; children: React.ReactNode }) {
  return <section className="min-w-0 border-t border-border pt-3"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>{trailing}</div>{children}</section>
}

function Overview({ snapshot, timeframe }: { snapshot: MonitorSnapshot; timeframe: Timeframe }) {
  const bars = timeframe === '1D' ? snapshot.chart.daily : snapshot.chart.intraday
  return <Panel title={`${snapshot.asset} market state`} trailing={<span className="text-[11px] text-muted-foreground">{timeframe === '1D' ? snapshot.chart.dailyMeta.sourceId : snapshot.chart.intradayMeta?.sourceId ?? 'hourly unavailable'} · {formatDate(timeframe === '1D' ? snapshot.metrics.lastBarAt : snapshot.metrics.intraday.latestAt)}</span>}>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
      <div className="min-h-[260px] border-y border-border/60 py-3"><PriceChart bars={bars} unavailable={timeframe === '1H' && !snapshot.metrics.intraday.available} /></div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 content-start">
        <Metric label="Last price" value={snapshot.asset === 'BTC' ? `$${formatNumber(snapshot.metrics.lastPrice, 0)}` : `$${formatNumber(snapshot.metrics.lastPrice)}`} />
        <Metric label="1-day change" value={formatPercent(snapshot.metrics.change1dPercent)} tone={snapshot.metrics.change1dPercent} />
        <Metric label="5-day change" value={formatPercent(snapshot.metrics.change5dPercent)} tone={snapshot.metrics.change5dPercent} />
        <Metric label="Weekly follow-through" value={formatPercent(snapshot.metrics.weeklyChangePercent)} tone={snapshot.metrics.weeklyChangePercent} />
        <Metric label="60-day range" value={snapshot.metrics.rangePosition60d == null ? '—' : `${Math.round(snapshot.metrics.rangePosition60d * 100)}%`} />
        <Metric label="20-day volume" value={snapshot.metrics.volumeRatio20d == null ? '—' : `${formatNumber(snapshot.metrics.volumeRatio20d)}×`} />
        <Metric label="Latest hour" value={formatPercent(snapshot.metrics.intraday.latestChangePercent)} tone={snapshot.metrics.intraday.latestChangePercent} />
        <Metric label="Rolling 4 hours" value={formatPercent(snapshot.metrics.intraday.fourHourChangePercent)} tone={snapshot.metrics.intraday.fourHourChangePercent} />
      </div>
    </div>
  </Panel>
}

function PriceChart({ bars, unavailable }: { bars: HistoricalBar[]; unavailable: boolean }) {
  const points = useMemo(() => {
    const rows = bars.slice(-120)
    if (rows.length < 2) return ''
    const min = Math.min(...rows.map((row) => row.close))
    const max = Math.max(...rows.map((row) => row.close))
    const spread = max - min || 1
    return rows.map((row, index) => `${(index / (rows.length - 1)) * 100},${92 - ((row.close - min) / spread) * 80}`).join(' ')
  }, [bars])
  if (unavailable || !points) return <div className="flex h-[230px] items-center justify-center text-sm text-muted-foreground">No attributed hourly series. Daily bars are not substituted.</div>
  const latest = bars.at(-1)!
  const first = bars[Math.max(0, bars.length - 120)]
  const up = latest.close >= first.close
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-[230px] w-full" role="img" aria-label={`Price path ending ${formatNumber(latest.close)}`}>
    {[20, 40, 60, 80].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} vectorEffect="non-scaling-stroke" className="stroke-border/60" />)}
    <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" strokeWidth="1.75" className={up ? 'stroke-success' : 'stroke-destructive'} />
  </svg>
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  return <div><div className="mb-1 text-[11px] text-muted-foreground">{label}</div><div className={cn('text-lg font-semibold tabular-nums', tone != null && tone > 0 && 'text-success', tone != null && tone < 0 && 'text-destructive')}>{value}</div></div>
}

function EvidenceTable({ snapshot }: { snapshot: MonitorSnapshot }) {
  return <Panel title="Evidence chain"><div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-xs"><thead className="border-b border-border text-[11px] text-muted-foreground"><tr><th className="pb-2 pr-3 font-medium">Signal</th><th className="pb-2 pr-3 font-medium">Frame</th><th className="pb-2 pr-3 font-medium">Observed fact</th><th className="pb-2 font-medium">Interpretation</th></tr></thead><tbody>{snapshot.evidence.map((item) => <tr key={item.id} className="border-b border-border/50 align-top"><td className="py-3 pr-3 font-medium"><span className={cn('mr-2 inline-block size-1.5 rounded-full', item.tone === 'positive' ? 'bg-success' : item.tone === 'negative' ? 'bg-destructive' : 'bg-muted-foreground')} />{item.label}</td><td className="py-3 pr-3 font-mono text-muted-foreground">{item.timeframe}</td><td className="py-3 pr-4 leading-5">{item.observation}</td><td className="py-3 leading-5 text-muted-foreground">{item.interpretation}</td></tr>)}</tbody></table></div></Panel>
}

function HypothesisPanel({ snapshot }: { snapshot: MonitorSnapshot }) {
  const hypothesis = snapshot.hypothesis
  return <Panel title="Current hypothesis" trailing={<span className={cn('text-xs font-semibold tabular-nums', hypothesis.bias === 'bullish' ? 'text-success' : hypothesis.bias === 'bearish' ? 'text-destructive' : 'text-muted-foreground')}>{hypothesis.confidence}%</span>}><h4 className="text-lg font-semibold">{hypothesis.label}</h4><p className="mt-2 text-xs leading-5 text-muted-foreground">{hypothesis.summary}</p><ConditionList title="Confirmation" rows={hypothesis.confirm} tone="positive" /><ConditionList title="Invalidation" rows={hypothesis.invalidate} tone="negative" /><ConditionList title="Competing explanations" rows={hypothesis.alternatives} tone="neutral" /></Panel>
}

function ConditionList({ title, rows, tone }: { title: string; rows: string[]; tone: 'positive' | 'negative' | 'neutral' }) {
  return <div className="mt-4"><div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{title}</div><ul className="space-y-1.5 text-xs leading-5">{rows.map((row) => <li key={row} className="flex gap-2"><span className={cn('mt-2 size-1 shrink-0 rounded-full', tone === 'positive' ? 'bg-success' : tone === 'negative' ? 'bg-destructive' : 'bg-muted-foreground')} /><span>{row}</span></li>)}</ul></div>
}

function ContextPanel({ snapshot }: { snapshot: MonitorSnapshot }) {
  const labels: Record<string, string> = { fundingRate: 'Funding rate', openInterest: 'Perpetual OI', annualizedBasisPercent: 'Annualized basis', optionOpenInterest: 'Options OI', putCallOpenInterestRatio: 'Put/call OI', marketCap: 'Market cap', trailingPe: 'Trailing P/E', forwardPe: 'Forward P/E', analystTargetMean: 'Analyst target', shortPercentFloat: 'Short % float', nextEarningsAt: 'Next earnings' }
  const rows = Object.entries(labels).filter(([key]) => snapshot.context[key] != null)
  return <Panel title={`${snapshot.asset} context`}><dl className="grid grid-cols-2 gap-x-5 gap-y-3">{rows.length ? rows.map(([key, label]) => <div key={key}><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium tabular-nums">{key.toLowerCase().includes('percent') || key === 'annualizedBasisPercent' ? `${formatNumber(snapshot.context[key])}%` : key.endsWith('At') ? formatDate(String(snapshot.context[key])) : formatNumber(snapshot.context[key])}</dd></div>) : <p className="col-span-2 text-xs text-muted-foreground">Context source unavailable. Price/volume evidence remains usable and explicitly attributed.</p>}</dl>{snapshot.context.recentNews?.length ? <div className="mt-4 border-t border-border/60 pt-3"><div className="mb-2 text-[11px] font-semibold text-muted-foreground">Recent matching news</div><ul className="space-y-2">{snapshot.context.recentNews.map((item) => <li key={`${item.time}:${item.title}`} className="text-xs"><span className="text-muted-foreground">{formatDate(item.time)} · {item.source ?? 'unknown'}</span><div className="mt-0.5 line-clamp-2">{item.title}</div></li>)}</ul></div> : null}</Panel>
}

function SourcePanel({ snapshot }: { snapshot: MonitorSnapshot }) {
  return <Panel title="Source health"><div className="space-y-3">{snapshot.sourceHealth.map((source) => <div key={source.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2"><span className={cn('mt-1.5 size-2 rounded-full', source.status === 'ok' ? 'bg-success' : source.status === 'degraded' ? 'bg-warning' : 'bg-destructive')} /><div><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-xs font-medium">{source.label}</span><span className="text-[10px] text-muted-foreground">{source.provider}</span></div><p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{source.detail}</p><div className="mt-0.5 text-[10px] text-muted-foreground/70">As of {formatDate(source.asOf)}</div></div></div>)}</div></Panel>
}

function HistoryPanel({ snapshots, evaluation, alerts }: { snapshots: MonitorSnapshot[]; evaluation: MonitorEvaluation | null; alerts: MonitorAlert[] }) {
  return <Panel title="Observation history" trailing={evaluation ? <span className="text-[11px] text-muted-foreground">{evaluation.resolved} resolved · accuracy {evaluation.directionalAccuracy == null ? '—' : `${formatNumber(evaluation.directionalAccuracy)}%`}</span> : undefined}><div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]"><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-xs"><thead className="border-b border-border text-left text-[11px] text-muted-foreground"><tr><th className="pb-2 font-medium">Captured</th><th className="pb-2 font-medium">Price</th><th className="pb-2 font-medium">Hypothesis</th><th className="pb-2 text-right font-medium">Confidence</th><th className="pb-2 text-right font-medium">Trigger</th></tr></thead><tbody>{snapshots.slice(-12).reverse().map((row) => <tr key={row.id} className="border-b border-border/50"><td className="py-2.5 text-muted-foreground">{formatDate(row.capturedAt)}</td><td className="py-2.5 tabular-nums">{formatNumber(row.metrics.lastPrice)}</td><td className="py-2.5">{row.hypothesis.label}</td><td className="py-2.5 text-right tabular-nums">{row.hypothesis.confidence}%</td><td className="py-2.5 text-right text-muted-foreground">{row.trigger}</td></tr>)}</tbody></table></div><div><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground"><Bell className="size-3.5" />Recent alerts</div>{alerts.length ? <ul className="space-y-2">{alerts.slice(-6).reverse().map((alert) => <li key={alert.id} className="border-l-2 border-warning pl-2 text-xs"><div className="font-medium">{alert.title}</div><div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{alert.message}</div></li>)}</ul> : <p className="text-xs text-muted-foreground">No alert conditions recorded.</p>}</div></div></Panel>
}

function SettingsPanel({ settings, onSave, onClose }: { settings: MonitorSettings; onSave: (settings: MonitorSettings) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const commit = async () => { setSaving(true); try { await onSave(draft); onClose() } finally { setSaving(false) } }
  return <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-3 md:px-6"><div className="mx-auto grid max-w-[980px] gap-3 md:grid-cols-5"><label className="text-[11px] text-muted-foreground">Scan interval (min)<input className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground" type="number" min={1} max={1440} value={draft.intervalMinutes} onChange={(event) => setDraft({ ...draft, intervalMinutes: Number(event.target.value) })} /></label><label className="text-[11px] text-muted-foreground">Alert confidence<input className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground" type="number" min={50} max={95} value={draft.alertConfidence} onChange={(event) => setDraft({ ...draft, alertConfidence: Number(event.target.value) })} /></label><label className="text-[11px] text-muted-foreground">Volume ratio<input className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground" type="number" min={1} max={10} step={0.1} value={draft.abnormalVolumeRatio} onChange={(event) => setDraft({ ...draft, abnormalVolumeRatio: Number(event.target.value) })} /></label><label className="text-[11px] text-muted-foreground">Hourly move %<input className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground" type="number" min={0.1} max={25} step={0.1} value={draft.abnormalMovePercent} onChange={(event) => setDraft({ ...draft, abnormalMovePercent: Number(event.target.value) })} /></label><div className="flex items-end justify-between gap-2"><label className="flex items-center gap-2 pb-1.5 text-xs"><input type="checkbox" checked={draft.notifications} onChange={(event) => setDraft({ ...draft, notifications: event.target.checked })} />Browser alerts</label><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" onClick={() => void commit()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></div></div></div></div>
}

function MonitorSkeleton() {
  return <div className="mx-auto w-full max-w-[1320px] space-y-4"><Skeleton className="h-72 w-full" /><div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div></div>
}
