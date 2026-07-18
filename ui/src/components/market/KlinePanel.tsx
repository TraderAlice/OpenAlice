import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type CandlestickData,
  type HistogramData,
} from 'lightweight-charts'
import { barsApi, type AssetClass, type HistoricalBar, type BarSourceCandidate, type BarMeta } from '../../api/market'
import { Skeleton } from '../StateViews'
import { useThemeStore } from '../../theme/store'
import { useEffectiveTheme } from '../../theme/useEffectiveTheme'

type Interval = '1m' | '5m' | '1h' | '1d'
type Timeframe = '1D' | '5D' | '1M' | '3M' | '1Y' | '5Y' | 'All'

const INTERVALS: Interval[] = ['1m', '5m', '1h', '1d']
const TIMEFRAMES: Timeframe[] = ['1D', '5D', '1M', '3M', '1Y', '5Y', 'All']
const DEFAULT_INTERVAL: Interval = '1d'
const DEFAULT_RANGE: Timeframe = '1Y'

function parseInterval(s: string | null): Interval {
  return (INTERVALS as string[]).includes(s ?? '') ? (s as Interval) : DEFAULT_INTERVAL
}

function parseTimeframe(s: string | null): Timeframe {
  return (TIMEFRAMES as string[]).includes(s ?? '') ? (s as Timeframe) : DEFAULT_RANGE
}

const INTRADAY: ReadonlySet<Interval> = new Set(['1m', '5m', '1h'])

function daysForTimeframe(tf: Timeframe): number | null {
  switch (tf) {
    case '1D': return 1
    case '5D': return 5
    case '1M': return 30
    case '3M': return 90
    case '1Y': return 365
    case '5Y': return 365 * 5
    case 'All': return null
  }
}

function startDateFromToday(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function toUTCTimestamp(s: string): UTCTimestamp {
  // Daily bars use `YYYY-MM-DD`; intraday uses `YYYY-MM-DD HH:MM:SS`.
  const iso = s.includes(' ') ? s.replace(' ', 'T') + 'Z' : `${s}T00:00:00Z`
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp
}

interface Props {
  selection: { symbol: string; assetClass: AssetClass } | null
}

interface ChartPolicyColors {
  axisText: string
  axisBorder: string
  crosshair: string
  grid: string
  selection: string
  up: string
  down: string
  volumeUp: string
  volumeDown: string
}

function cssPolicyColors(): ChartPolicyColors {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => style.getPropertyValue(name).trim()
  return {
    axisText: read('--oa-chart-axis-text'),
    axisBorder: read('--oa-chart-axis-border'),
    crosshair: read('--oa-chart-crosshair'),
    grid: read('--oa-chart-grid'),
    selection: read('--oa-chart-selection'),
    up: read('--oa-market-up'),
    down: read('--oa-market-down'),
    volumeUp: read('--oa-market-volume-up'),
    volumeDown: read('--oa-market-volume-down'),
  }
}

function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (match === null) return color
  return `rgba(${Number.parseInt(match[1]!, 16)}, ${Number.parseInt(match[2]!, 16)}, ${Number.parseInt(match[3]!, 16)}, ${alpha})`
}

export function KlinePanel({ selection }: Props) {
  const effectiveTheme = useEffectiveTheme()
  const marketColors = useThemeStore((state) => state.appearance?.marketColors)
  const marketDirection = useThemeStore((state) => state.appearance?.marketDirection)
  const activeFamilyId = useThemeStore((state) => state.appearance?.activeFamilyId)
  const themeFamilies = useThemeStore((state) => state.families)
  const [searchParams, setSearchParams] = useSearchParams()
  const interval = parseInterval(searchParams.get('interval'))
  const tf = parseTimeframe(searchParams.get('range'))
  // The provider picked at search time (a barId), if any — opens the chart on it.
  const sourceParam = searchParams.get('source')

  // Local setter named `selectInterval` rather than `setInterval` so it
  // doesn't shadow the global timer function we use for polling below.
  const selectInterval = (iv: Interval) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (iv === DEFAULT_INTERVAL) next.delete('interval')
      else next.set('interval', iv)
      return next
    }, { replace: true })
  }
  const setTf = (t: Timeframe) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (t === DEFAULT_RANGE) next.delete('range')
      else next.set('range', t)
      return next
    }, { replace: true })
  }

  const [bars, setBars] = useState<HistoricalBar[] | null>(null)
  const [meta, setMeta] = useState<BarMeta | null>(null)
  const [candidates, setCandidates] = useState<BarSourceCandidate[]>([])
  // null = vendor default for this symbol; a barId = an explicitly-picked source.
  // Seed from the URL so the very first fetch is the right source (no vendor flicker).
  const [selectedBarId, setSelectedBarId] = useState<string | null>(sourceParam)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  // Build chart once.
  useEffect(() => {
    if (!containerRef.current) return
    const colors = cssPolicyColors()
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: colors.axisText,
        panes: { separatorColor: colors.axisBorder, separatorHoverColor: colors.selection },
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair: { vertLine: { color: colors.crosshair }, horzLine: { color: colors.crosshair } },
      rightPriceScale: { borderColor: colors.axisBorder },
      timeScale: { borderColor: colors.axisBorder, timeVisible: false, secondsVisible: false },
      autoSize: true,
    })

    const candle = chart.addSeries(CandlestickSeries, {
      // Hollow rising candles remain distinguishable without color alone.
      upColor: 'transparent',
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
    })

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    }, 1)
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } })

    chartRef.current = chart
    candleRef.current = candle
    volumeRef.current = volume

    return () => {
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
    }
  }, [])

  // Re-project the existing chart when appearance policy changes. The chart
  // and its data source remain mounted; only visual options and volume colors
  // are updated.
  useEffect(() => {
    const chart = chartRef.current
    const candle = candleRef.current
    const volume = volumeRef.current
    if (chart === null || candle === null || volume === null) return
    const colors = cssPolicyColors()
    chart.applyOptions({
      layout: {
        background: { color: 'transparent' },
        textColor: colors.axisText,
        panes: { separatorColor: colors.axisBorder, separatorHoverColor: colors.selection },
      },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      crosshair: { vertLine: { color: colors.crosshair }, horzLine: { color: colors.crosshair } },
      rightPriceScale: { borderColor: colors.axisBorder },
      timeScale: { borderColor: colors.axisBorder },
    })
    candle.applyOptions({
      upColor: 'transparent',
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
    })
    if (bars !== null) {
      volume.setData(bars.map((bar) => ({
        time: toUTCTimestamp(bar.date),
        value: bar.volume ?? 0,
        color: withAlpha(bar.close >= bar.open ? colors.volumeUp : colors.volumeDown, 0.33),
      })))
    }
  }, [activeFamilyId, effectiveTheme, marketColors, marketDirection, themeFamilies, bars])

  // Toggle time-axis detail when interval flips between intraday and daily.
  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({ timeVisible: INTRADAY.has(interval) })
  }, [interval])

  // Discover the available bar sources for this symbol (populates the picker).
  // Seed the picked source from the URL (?source=barId, set at search time);
  // otherwise null → vendor default.
  useEffect(() => {
    setSelectedBarId(sourceParam)
    setCandidates([])
    if (!selection || selection.assetClass === 'commodity') return
    let cancelled = false
    barsApi.searchSources(selection.symbol, 12)
      .then((r) => { if (!cancelled) setCandidates(r.candidates) })
      .catch(() => { if (!cancelled) setCandidates([]) })
    return () => { cancelled = true }
  }, [selection, sourceParam])

  // Fetch bars: an explicitly-picked source (barId) or the vendor default
  // (symbol+assetClass). Re-polls so a long-open tab doesn't show stale bars.
  useEffect(() => {
    if (!selection) { setBars(null); setMeta(null); setError(null); return }
    if (selection.assetClass === 'commodity') {
      setBars(null)
      setMeta(null)
      setError('Commodity K-line support is coming in the next step.')
      return
    }
    let cancelled = false
    const run = (isInitial: boolean) => {
      if (isInitial) setLoading(true)
      setError(null)
      const days = daysForTimeframe(tf)
      const params: Parameters<typeof barsApi.bars>[0] = { interval }
      if (selectedBarId) params.barId = selectedBarId
      else { params.symbol = selection.symbol; params.assetClass = selection.assetClass }
      if (days != null) params.start = startDateFromToday(days)

      barsApi.bars(params)
        .then((res) => {
          if (cancelled) return
          if (res.error || !res.results) {
            setError(res.error ?? 'No data returned.'); setBars(null); setMeta(null)
          } else if (res.results.length === 0) {
            setError('No bars in this range.'); setBars([]); setMeta(res.meta)
          } else {
            setBars(res.results); setMeta(res.meta)
          }
        })
        .catch((e) => {
          if (cancelled) return
          setError(e instanceof Error ? e.message : String(e)); setBars(null); setMeta(null)
        })
        .finally(() => { if (!cancelled && isInitial) setLoading(false) })
    }
    run(true)
    // 60s for intraday intervals (1m/5m/1h) because each tick is a fresh bar;
    // 5min for daily because a refresh within a single day is cosmetic.
    const pollMs = INTRADAY.has(interval) ? 60_000 : 300_000
    const timer = setInterval(() => run(false), pollMs)
    return () => { cancelled = true; clearInterval(timer) }
  }, [selection, selectedBarId, interval, tf])

  // Push bars into chart and fit.
  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !chartRef.current) return
    if (!bars || bars.length === 0) {
      candleRef.current.setData([])
      volumeRef.current.setData([])
      return
    }

    const candleData: CandlestickData[] = bars.map((b) => ({
      time: toUTCTimestamp(b.date),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }))
    const colors = cssPolicyColors()
    const volumeData: HistogramData[] = bars.map((b) => ({
      time: toUTCTimestamp(b.date),
      value: b.volume ?? 0,
      color: withAlpha(
        b.close >= b.open ? colors.volumeUp : colors.volumeDown,
        0.33,
      ),
    }))

    candleRef.current.setData(candleData)
    volumeRef.current.setData(volumeData)
    chartRef.current.timeScale().fitContent()
  }, [bars])

  const title = useMemo(() => {
    if (!selection) return 'Select a symbol'
    return `${selection.symbol} · ${selection.assetClass}`
  }, [selection])

  // Source options for the picker — always include the currently-shown provider
  // (even if it wasn't in the search results), so the dropdown reflects reality.
  const sourceOptions = useMemo<BarSourceCandidate[]>(() => {
    const opts = [...candidates]
    if (meta?.barId && !opts.some((c) => c.barId === meta.barId)) {
      opts.unshift({ barId: meta.barId, source: meta.source, sourceId: meta.sourceId, symbol: meta.symbol, assetClass: 'unknown', label: meta.sourceId, barCapability: meta.barCapability })
    }
    return opts
  }, [candidates, meta])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between py-2 px-1 gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-medium text-text truncate">{title}</span>
          {meta && (
            <span
              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted font-medium"
              title={`Provider: ${meta.barId}${meta.barCapability ? ` (${meta.barCapability})` : ''}`}
            >
              {meta.sourceId}{meta.barCapability ? ` · ${meta.barCapability}` : ''}
            </span>
          )}
          {bars && bars.length > 0 && (
            <span className="text-[11px] text-text-muted/60 truncate">
              {bars.length} bars · {bars[0].date} → {bars[bars.length - 1].date}
            </span>
          )}
        </div>
        <div className="flex items-center gap-5 flex-wrap">
          {sourceOptions.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-text-muted/70">Source</span>
              <select
                value={selectedBarId ?? meta?.barId ?? ''}
                onChange={(e) => setSelectedBarId(e.target.value || null)}
                className="bg-bg-tertiary border border-border rounded px-2 py-1 text-[12px] text-text cursor-pointer max-w-[240px]"
                title="Which provider's K-line to show — sources are never merged; you pick"
              >
                {sourceOptions.map((c) => (
                  <option key={c.barId} value={c.barId}>
                    {c.sourceId} · {c.symbol}{c.barCapability ? ` (${c.barCapability})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-text-muted/70">Interval</span>
            <div className="flex border border-border rounded overflow-hidden" title="Candle width (how much time each bar covers)">
              {INTERVALS.map((iv, i) => (
                <button
                  key={iv}
                  onClick={() => selectInterval(iv)}
                  className={`px-2 py-1 text-[12px] transition-colors cursor-pointer ${
                    i > 0 ? 'border-l border-border' : ''
                  } ${interval === iv ? 'bg-bg-tertiary text-text' : 'text-text-muted hover:text-text'}`}
                >
                  {iv}
                </button>
              ))}
            </div>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-text-muted/70">Range</span>
            <div className="flex border border-border rounded overflow-hidden" title="How far back to load history">
              {TIMEFRAMES.map((t, i) => (
                <button
                  key={t}
                  onClick={() => setTf(t)}
                  className={`px-2 py-1 text-[12px] transition-colors cursor-pointer ${
                    i > 0 ? 'border-l border-border' : ''
                  } ${tf === t ? 'bg-bg-tertiary text-text' : 'text-text-muted hover:text-text'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </label>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 border border-border rounded bg-bg-secondary/30">
        <div ref={containerRef} className="absolute inset-0" />
        {!selection && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-text-muted">
            Pick an asset to see the K-line.
          </div>
        )}
        {selection && loading && !bars && (
          <div className="absolute inset-0 p-2" aria-hidden="true">
            <Skeleton className="w-full h-full rounded" />
          </div>
        )}
        {selection && loading && (
          <div className="absolute top-2 right-2 text-[11px] text-text-muted">Loading…</div>
        )}
        {selection && error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-text-muted px-8 text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
