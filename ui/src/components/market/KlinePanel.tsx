import { useMarketBars } from '../../hooks/useMarketBars'
import { Button } from '../ui/button'
import { MARKET_INTERVALS, MARKET_REFERENCE_COUNT, type MarketInterval } from '@traderalice/connector-protocol'
import { BarFreshness } from './BarFreshness'
import { WatchlistButton } from './WatchlistButton'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { SegmentedControl } from '../SegmentedControl'

export type KlineInterval = MarketInterval
export type KlineTimeframe = '1D' | '5D' | '1M' | '3M' | '1Y' | '5Y' | 'All'

const INTERVALS = MARKET_INTERVALS
const TIMEFRAMES: KlineTimeframe[] = ['1D', '5D', '1M', '3M', '1Y', '5Y', 'All']
const DEFAULT_INTERVAL: KlineInterval = '1d'
const DEFAULT_RANGE: KlineTimeframe = '1Y'

function parseInterval(s: string | null): KlineInterval {
  return (INTERVALS as readonly string[]).includes(s ?? '') ? (s as KlineInterval) : DEFAULT_INTERVAL
}

function parseTimeframe(s: string | null): KlineTimeframe {
  return (TIMEFRAMES as string[]).includes(s ?? '') ? (s as KlineTimeframe) : DEFAULT_RANGE
}

const INTRADAY: ReadonlySet<KlineInterval> = new Set(['1m', '5m', '15m', '30m', '1h', '4h'])

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
  // Calendar dates and timezone-bearing intraday instants are both valid.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z`
    : s.includes(' ') ? s.replace(' ', 'T') + 'Z' : s
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
  displayTitle?: string
  embeddedInterval?: MarketInterval
  onEmbeddedIntervalChange?: (interval: MarketInterval) => void
  /** Read-only mirror of the displayed series for sibling analysis panels.
   *  This avoids a second bar request on bespoke detail pages. */
  onSnapshot?: (snapshot: KlineSnapshot) => void
}

export function KlinePanel({ selection, source, onSnapshot, displayTitle, embeddedInterval, onEmbeddedIntervalChange }: Props) {
  const effectiveTheme = useEffectiveTheme()
  const effectivePalette = useEffectivePalette()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [localInterval, setLocalInterval] = useState(embeddedInterval ?? DEFAULT_INTERVAL)
  const embedded = embeddedInterval !== undefined
  const interval = embedded ? localInterval : parseInterval(searchParams.get('interval'))
  const tf = parseTimeframe(searchParams.get('range'))
  // The provider picked at search time (a barId), if any — opens the chart on
  // it. Unlike interval/range, source comes from the focused tab spec. Router
  // search state can be stale after history.replaceState-based tab switches.
  const requestedBarId = source ?? null
  const selectionSymbol = selection?.symbol ?? null
  const selectionAssetClass = selection?.assetClass ?? null

  // Local setter named `selectInterval` rather than `setInterval` so it
  // doesn't shadow the global timer function we use for polling below.
  const updateChartQuery = (update: (next: URLSearchParams) => void) => {
    if (!selection) return
    const next = new URLSearchParams(searchParams)
    if (selectedBarId) next.set('source', selectedBarId)
    else next.delete('source')
    update(next)
    // Focused market tabs may project their URL without updating Router state.
    // Explicitly address this asset, never the router's previously visited page.
    navigate({ pathname: `/market/${selection.assetClass}/${encodeURIComponent(selection.symbol)}`, search: next.toString() }, { replace: true })
  }
  const selectInterval = (iv: KlineInterval) => {
    if (embedded) { if (onEmbeddedIntervalChange) onEmbeddedIntervalChange(iv); else setLocalInterval(iv); return }
    updateChartQuery((next) => {
      if (iv === DEFAULT_INTERVAL) next.delete('interval')
      else next.set('interval', iv)
      const days = daysForTimeframe(tf)
      if (iv === '1m' && (days == null || days > 5)) next.set('range', '5D')
      if (iv === '5m' && (days == null || days > 30)) next.set('range', '1M')
    })
  }
  const setTf = (t: KlineTimeframe) => {
    updateChartQuery((next) => {
      if (t === DEFAULT_RANGE) next.delete('range')
      else next.set('range', t)
    })
  }

  const [candidates, setCandidates] = useState<BarSourceCandidate[]>([])
  // null = vendor default for this symbol; a barId = an explicitly-picked source.
  // Seed from the focused tab so the first fetch is right (no vendor flicker).
  const [selectedBarId, setSelectedBarId] = useState<string | null>(requestedBarId)
  const query = useMemo(() => {
    if (!selectedBarId && (!selectionSymbol || !selectionAssetClass)) return null
    const params: Parameters<typeof barsApi.bars>[0] = { interval }
    if (selectedBarId) params.barId = selectedBarId
    else params.symbol = selectionSymbol!
    if (selectionAssetClass) params.assetClass = selectionAssetClass
    const days = daysForTimeframe(tf)
    if (embedded) params.count = MARKET_REFERENCE_COUNT
    else if (days != null) params.start = startDateFromToday(days)
    return params
  }, [selectedBarId, selectionSymbol, selectionAssetClass, interval, tf, embedded])
  const { bars, meta, loading, error, retry } = useMarketBars(query)

  useEffect(() => {
    onSnapshot?.({ bars, meta, loading, error, interval, timeframe: tf })
  }, [bars, meta, loading, error, interval, tf, onSnapshot])

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)

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
      crosshair: {
        vertLine: { color: colors.primaryMuted, labelBackgroundColor: colors.labelBackground },
        horzLine: { color: colors.primaryMuted, labelBackgroundColor: colors.labelBackground },
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
    return `${selectionSymbol} ${selectionAssetClass}`
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
      <div className="flex flex-col py-2 px-1 gap-2">
        <div className="flex items-center gap-x-3 gap-y-1 min-w-0 flex-wrap">
          <div className="flex min-w-0 items-center gap-1">
            <span className="text-[13px] font-medium text-foreground truncate">{displayTitle ?? title}</span>
            {selection && <WatchlistButton assetClass={selection.assetClass} symbol={selection.symbol} />}
          </div>
          {meta && (
            <span
              className="inline-flex items-center gap-1.5 text-[11px] leading-[15px] font-medium text-muted-foreground"
              title={`Provider: ${meta.barId}${meta.barCapability ? ` (${meta.barCapability})` : ''}`}
            >
              <span>{meta.sourceId === 'eastmoney' ? '东方财富 · 前复权' : meta.sourceId}</span>{meta.barCapability && <span>{meta.barCapability}</span>}
            </span>
          )}
          {bars && bars.length > 0 && (
            <span className="text-[11px] text-muted-foreground sm:ml-auto"
              title={`${bars[0].date} → ${bars[bars.length - 1].date}`}>
              {bars.length} bars · {bars[0].date.slice(0, 10)} — {bars[bars.length - 1].date.slice(0, 10)}
            </span>
          )}
        </div>
        {meta && <BarFreshness meta={meta} />}
        {meta?.quality && meta.quality.excludedRows > 0 && <p className="text-[11px] leading-5 text-warning" role="status">
          {meta.quality.excludedRows} incomplete {meta.quality.excludedRows === 1 ? 'record' : 'records'} excluded from fetched window.
          {meta.quality.latestExcludedRecordAt && ` Latest: ${meta.quality.latestExcludedRecordAt} (${meta.quality.latestExcludedFields.join(', ')} missing or invalid).`}
        </p>}
        <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
          {!embedded && sourceOptions.length > 1 && (
            <label className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-muted-foreground/70">Source</span>
              <select
                value={selectedBarId ?? meta?.barId ?? ''}
                onChange={(e) => setSelectedBarId(e.target.value || null)}
                className="oa-field-control max-w-[240px] cursor-pointer rounded-md border border-input bg-background px-2 py-1 text-[12px] leading-[18px] text-foreground outline-none transition-[border-color,box-shadow] duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-out)] motion-reduce:transition-none"
                title="Which provider's K-line to show — sources are never merged; you pick"
              >
                {sourceOptions.map((c) => (
                  <option key={c.barId} value={c.barId}>
                    {c.sourceId}, {c.symbol}{c.barCapability ? ` (${c.barCapability})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div
            className="flex items-center gap-2"
            title="Candle width (how much time each bar covers)"
          >
            <span className="text-[11px] font-medium text-muted-foreground/70">Interval</span>
            <SegmentedControl
              value={interval}
              options={INTERVALS.map((value) => ({ value, label: value }))}
              onChange={selectInterval}
              ariaLabel="Interval"
              compact
            />
          </div>
          {!embedded && <div
            className="flex items-center gap-2"
            title="How far back to load history"
          >
            <span className="text-[11px] font-medium text-muted-foreground/70">Range</span>
            <SegmentedControl
              value={tf}
              options={TIMEFRAMES.map((value) => ({ value, label: value }))}
              onChange={setTf}
              ariaLabel="Range"
              compact
            />
          </div>}
          {embedded && <span className="text-xs text-muted-foreground">Latest {MARKET_REFERENCE_COUNT} bars</span>}
        </div>
      </div>

      <div className="oa-data-surface relative min-h-0 flex-1 overflow-hidden rounded-lg border">
        <div ref={containerRef} className="absolute inset-0" />
        {!selection && !requestedBarId && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] leading-5 text-muted-foreground">
            Pick an asset to see the K-line.
          </div>
        )}
        {(selection || requestedBarId) && loading && !bars && (
          <div className="absolute inset-0 p-2" aria-hidden="true">
            <Skeleton className="w-full h-full rounded" />
          </div>
        )}
        {(selection || requestedBarId) && loading && (
          <div className="absolute top-2 right-2 text-[11px] text-muted-foreground">Loading…</div>
        )}
        {(selection || requestedBarId) && error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center flex-col gap-3 text-[13px] leading-5 text-muted-foreground px-8 text-center">
            {error}
            <Button variant="outline" size="sm" onClick={retry}>Retry</Button>
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
    labelBackground: readSemanticColor('popover'),
    positive: readSemanticColor('chart-positive'),
    negative: readSemanticColor('chart-negative'),
    positiveMuted: readSemanticColor('chart-positive-muted'),
    negativeMuted: readSemanticColor('chart-negative-muted'),
  }
}
