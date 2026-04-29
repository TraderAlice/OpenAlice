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
import { marketApi, type AssetClass, type HistoricalBar } from '../../api/market'

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

export function KlinePanel({ selection }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const interval = parseInterval(searchParams.get('interval'))
  const tf = parseTimeframe(searchParams.get('range'))

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
  const [provider, setProvider] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  // Build chart once.
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#c9d1d9',
        panes: { separatorColor: '#30363d', separatorHoverColor: '#58a6ff33' },
      },
      grid: {
        vertLines: { color: '#21262d' },
        horzLines: { color: '#21262d' },
      },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d', timeVisible: false, secondsVisible: false },
      autoSize: true,
    })

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#3fb950',
      downColor: '#f85149',
      borderUpColor: '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
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

  // Toggle time-axis detail when interval flips between intraday and daily.
  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({ timeVisible: INTRADAY.has(interval) })
  }, [interval])

  // Fetch bars on any of: symbol, interval, timeframe. Re-polls periodically
  // so a long-open tab doesn't show yesterday's bars as if they were live.
  useEffect(() => {
    if (!selection) { setBars(null); setProvider(null); setError(null); return }
    if (selection.assetClass === 'commodity') {
      setBars(null)
      setProvider(null)
      setError('Commodity K-line support is coming in the next step.')
      return
    }
    let cancelled = false
    const fetch = (isInitial: boolean) => {
      if (isInitial) setLoading(true)
      setError(null)
      const days = daysForTimeframe(tf)
      const opts: { interval: string; startDate?: string } = { interval }
      if (days != null) opts.startDate = startDateFromToday(days)

      marketApi.historical(selection.assetClass, selection.symbol, opts)
        .then((res) => {
          if (cancelled) return
          if (res.error || !res.results) {
            setError(res.error ?? 'No data returned.')
            setBars(null)
            setProvider(null)
          } else if (res.results.length === 0) {
            setError('No bars in this range.')
            setBars([])
            setProvider(res.provider || null)
          } else {
            setBars(res.results)
            setProvider(res.provider || null)
          }
        })
        .catch((e) => {
          if (cancelled) return
          setError(e instanceof Error ? e.message : String(e)); setBars(null); setProvider(null)
        })
        .finally(() => { if (!cancelled && isInitial) setLoading(false) })
    }
    fetch(true)
    // 60s for intraday intervals (1m/5m/1h) because each tick is a fresh bar;
    // 5min for daily because a refresh within a single day is cosmetic.
    const pollMs = INTRADAY.has(interval) ? 60_000 : 300_000
    const timer = setInterval(() => fetch(false), pollMs)
    return () => { cancelled = true; clearInterval(timer) }
  }, [selection, interval, tf])

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
    const volumeData: HistogramData[] = bars.map((b) => ({
      time: toUTCTimestamp(b.date),
      value: b.volume ?? 0,
      color: b.close >= b.open ? '#3fb95055' : '#f8514955',
    }))

    candleRef.current.setData(candleData)
    volumeRef.current.setData(volumeData)
    chartRef.current.timeScale().fitContent()
  }, [bars])

  const title = useMemo(() => {
    if (!selection) return 'Select a symbol'
    return `${selection.symbol} · ${selection.assetClass}`
  }, [selection])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between py-2 px-1 gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-medium text-text truncate">{title}</span>
          {provider && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted font-medium">
              {provider}
            </span>
          )}
          {bars && bars.length > 0 && (
            <span className="text-[11px] text-text-muted/60 truncate">
              {bars.length} bars · {bars[0].date} → {bars[bars.length - 1].date}
            </span>
          )}
        </div>
        <div className="flex items-center gap-5 flex-wrap">
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
