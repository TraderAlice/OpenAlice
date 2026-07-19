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
import { readSemanticColor } from '../../theme/semanticColors'
import { useEffectivePalette, useEffectiveTheme } from '../../theme/useEffectiveTheme'
import { Skeleton } from '../StateViews'

export type KlineInterval = '1m' | '5m' | '1h' | '1d'
export type KlineTimeframe = '1D' | '5D' | '1M' | '3M' | '1Y' | '5Y' | 'All'

const INTERVALS: KlineInterval[] = ['1m', '5m', '1h', '1d']
const TIMEFRAMES: KlineTimeframe[] = ['1D', '5D', '1M', '3M', '1Y', '5Y', 'All']
const DEFAULT_INTERVAL: KlineInterval = '1d'
const DEFAULT_RANGE: KlineTimeframe = '1Y'

function parseInterval(s: string | null): KlineInterval {
  return (INTERVALS as string[]).includes(s ?? '') ? (s as KlineInterval) : DEFAULT_INTERVAL
}

function parseTimeframe(s: string | null): KlineTimeframe {
  return (TIMEFRAMES as string[]).includes(s ?? '') ? (s as KlineTimeframe) : DEFAULT_RANGE
}

const INTRADAY: ReadonlySet<KlineInterval> = new Set(['1m', '5m', '1h'])

function daysForTimeframe(tf: KlineTimeframe): number | null {
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

export interface KlineSnapshot {
  bars: HistoricalBar[] | null
  meta: BarMeta | null
  loading: boolean
  error: string | null
  interval: KlineInterval
  timeframe: KlineTimeframe
}

interface Props {
  selection: { symbol: string; assetClass: AssetClass } | null
  /** Explicit provider identity from the focused market tab. This cannot rely
   * only on React Router state: tab switches project their URL with
   * history.replaceState, which intentionally does not notify the router. */
  source?: string
  /** Read-only mirror of the displayed series for sibling analysis panels.
   *  This avoids a second bar request on bespoke detail pages. */
  onSnapshot?: (snapshot: KlineSnapshot) => void
}

export function KlinePanel({ selection, source, onSnapshot }: Props) {
  const effectiveTheme = useEffectiveTheme()
  const effectivePalette = useEffectivePalette()
  const [searchParams, setSearchParams] = useSearchParams()
  const interval = parseInterval(searchParams.get('interval'))
  const tf = parseTimeframe(searchParams.get('range'))
  // The provider picked at search time (a barId), if any — opens the chart on
  // it. Unlike interval/range, source comes from the focused tab spec. Router
  // search state can be stale after history.replaceState-based tab switches.
  const requestedBarId = source ?? null
  const selectionSymbol = selection?.symbol ?? null
  const selectionAssetClass = selection?.assetClass ?? null

  // Local setter named `selectInterval` rather than `setInterval` so it
  // doesn't shadow the global timer function we use for polling below.
  const selectInterval = (iv: KlineInterval) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (iv === DEFAULT_INTERVAL) next.delete('interval')
      else next.set('interval', iv)
      return next
    }, { replace: true })
  }
  const setTf = (t: KlineTimeframe) => {
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
  // Seed from the focused tab so the first fetch is right (no vendor flicker).
  const [selectedBarId, setSelectedBarId] = useState<string | null>(requestedBarId)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onSnapshot?.({ bars, meta, loading, error, interval, timeframe: tf })
  }, [bars, meta, loading, error, interval, tf, onSnapshot])

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  // A focused market tab can change identity without remounting this panel.
  // Never let the previous pair's last close leak into sibling analytics while
  // the new source is loading.
  useEffect(() => {
    setBars(null)
    setMeta(null)
    setError(null)
  }, [selectionSymbol, selectionAssetClass, requestedBarId])

  // Canvas renderers cannot resolve CSS variables themselves. Rebuild on a
  // concrete theme change and read the same semantic card used by DOM/SVG UI.
  useEffect(() => {
    if (!containerRef.current) return
    const colors = readKlineChartColors()
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: colors.text,
        panes: { separatorColor: colors.grid, separatorHoverColor: colors.primaryMuted },
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      rightPriceScale: { borderColor: colors.grid },
      timeScale: { borderColor: colors.grid, timeVisible: false, secondsVisible: false },
      autoSize: true,
    })

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: colors.positive,
      downColor: colors.negative,
      borderUpColor: colors.positive,
      borderDownColor: colors.negative,
      wickUpColor: colors.positive,
      wickDownColor: colors.negative,
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
  }, [effectiveTheme, effectivePalette])

  // Toggle time-axis detail when interval flips between intraday and daily.
  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({ timeVisible: INTRADAY.has(interval) })
  }, [interval, effectiveTheme, effectivePalette])

  // Discover the available bar sources for this symbol (populates the picker).
  // Seed the picked source from the focused tab; otherwise null → vendor default.
  useEffect(() => {
    setSelectedBarId(requestedBarId)
    setCandidates([])
    if (!selectionSymbol || !selectionAssetClass) return
    let cancelled = false
    barsApi.searchSources(selectionSymbol, 12)
      .then((r) => {
        if (cancelled) return
        const selectedSymbol = selectionSymbol.trim().toLowerCase()
        // Federated search is intentionally fuzzy across asset classes. The
        // chart picker is not: it may switch providers for the current asset,
        // but must never offer similarly named instruments (e.g. GOLD stock
        // and gold-miner equities on the commodity/gold chart).
        setCandidates(r.candidates.filter((candidate) =>
          candidate.symbol.trim().toLowerCase() === selectedSymbol &&
          (candidate.assetClass === selectionAssetClass || candidate.assetClass === 'unknown'),
        ))
      })
      .catch(() => { if (!cancelled) setCandidates([]) })
    return () => { cancelled = true }
  }, [selectionSymbol, selectionAssetClass, requestedBarId])

  // Fetch bars: an explicitly-picked source (barId) or the vendor default
  // (symbol+assetClass). Re-polls so a long-open tab doesn't show stale bars.
  useEffect(() => {
    if (!selectionSymbol || !selectionAssetClass) { setBars(null); setMeta(null); setError(null); return }
    let cancelled = false
    const run = (isInitial: boolean) => {
      if (isInitial) setLoading(true)
      setError(null)
      const days = daysForTimeframe(tf)
      const params: Parameters<typeof barsApi.bars>[0] = { interval }
      // Vendor barIds share the same `{source}|{nativeSymbol}` shape as UTA
      // aliceIds, so the server needs the selected asset class to distinguish
      // which vendor client owns the native symbol. UTA sources safely ignore
      // this extra routing hint.
      if (selectedBarId) {
        params.barId = selectedBarId
        params.assetClass = selectionAssetClass
      }
      else { params.symbol = selectionSymbol; params.assetClass = selectionAssetClass }
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
  }, [selectionSymbol, selectionAssetClass, selectedBarId, interval, tf])

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
    const colors = readKlineChartColors()
    const volumeData: HistogramData[] = bars.map((b) => ({
      time: toUTCTimestamp(b.date),
      value: b.volume ?? 0,
      color: b.close >= b.open ? colors.positiveMuted : colors.negativeMuted,
    }))

    candleRef.current.setData(candleData)
    volumeRef.current.setData(volumeData)
    chartRef.current.timeScale().fitContent()
  }, [bars, effectiveTheme, effectivePalette])

  const title = useMemo(() => {
    if (!selectionSymbol || !selectionAssetClass) return 'Select a symbol'
    return `${selectionSymbol} · ${selectionAssetClass}`
  }, [selectionSymbol, selectionAssetClass])

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
          <span className="text-[13px] font-medium text-foreground truncate">{title}</span>
          {meta && (
            <span
              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium"
              title={`Provider: ${meta.barId}${meta.barCapability ? ` (${meta.barCapability})` : ''}`}
            >
              {meta.sourceId}{meta.barCapability ? ` · ${meta.barCapability}` : ''}
            </span>
          )}
          {bars && bars.length > 0 && (
            <span className="text-[11px] text-muted-foreground/60 truncate">
              {bars.length} bars · {bars[0].date} → {bars[bars.length - 1].date}
            </span>
          )}
        </div>
        <div className="flex items-center gap-5 flex-wrap">
          {sourceOptions.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Source</span>
              <select
                value={selectedBarId ?? meta?.barId ?? ''}
                onChange={(e) => setSelectedBarId(e.target.value || null)}
                className="bg-muted border border-border rounded px-2 py-1 text-[12px] text-foreground cursor-pointer max-w-[240px]"
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
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Interval</span>
            <div className="flex border border-border rounded overflow-hidden" title="Candle width (how much time each bar covers)">
              {INTERVALS.map((iv, i) => (
                <button
                  key={iv}
                  onClick={() => selectInterval(iv)}
                  className={`px-2 py-1 text-[12px] transition-colors cursor-pointer ${
                    i > 0 ? 'border-l border-border' : ''
                  } ${interval === iv ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {iv}
                </button>
              ))}
            </div>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground/70">Range</span>
            <div className="flex border border-border rounded overflow-hidden" title="How far back to load history">
              {TIMEFRAMES.map((t, i) => (
                <button
                  key={t}
                  onClick={() => setTf(t)}
                  className={`px-2 py-1 text-[12px] transition-colors cursor-pointer ${
                    i > 0 ? 'border-l border-border' : ''
                  } ${tf === t ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </label>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 border border-border rounded bg-secondary/30">
        <div ref={containerRef} className="absolute inset-0" />
        {!selection && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-muted-foreground">
            Pick an asset to see the K-line.
          </div>
        )}
        {selection && loading && !bars && (
          <div className="absolute inset-0 p-2" aria-hidden="true">
            <Skeleton className="w-full h-full rounded" />
          </div>
        )}
        {selection && loading && (
          <div className="absolute top-2 right-2 text-[11px] text-muted-foreground">Loading…</div>
        )}
        {selection && error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-muted-foreground px-8 text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

function readKlineChartColors() {
  return {
    text: readSemanticColor('chart-axis'),
    grid: readSemanticColor('chart-grid'),
    primaryMuted: readSemanticColor('primary-muted'),
    positive: readSemanticColor('chart-positive'),
    negative: readSemanticColor('chart-negative'),
    positiveMuted: readSemanticColor('chart-positive-muted'),
    negativeMuted: readSemanticColor('chart-negative-muted'),
  }
}
