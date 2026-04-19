import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'
import type { CandlestickData, HistogramData, LineData, Time } from 'lightweight-charts'

export interface KlineDataPoint {
  /** Date string: YYYY-MM-DD or YYYYMMDD */
  d: string
  o: number
  h: number
  l: number
  c: number
  v?: number
}

interface KlineChartProps {
  symbol?: string
  name?: string
  data: KlineDataPoint[]
}

function parseTime(d: string): Time {
  // ISO datetime (intraday): "2026-04-08T09:00:00.000+08:00" → Unix timestamp (seconds)
  // lightweight-charts displays in UTC, so we shift by local timezone offset to show correct local time
  if (d.includes('T')) {
    const date = new Date(d)
    const utcSeconds = Math.floor(date.getTime() / 1000)
    const offsetSeconds = -date.getTimezoneOffset() * 60  // positive for UTC+8
    return (utcSeconds + offsetSeconds) as unknown as Time
  }
  // YYYYMMDD → YYYY-MM-DD
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` as unknown as Time
  // Already YYYY-MM-DD
  return d as unknown as Time
}

export function KlineChart({ symbol, name, data }: KlineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || data.length === 0) return

    const isIntraday = data[0].d.includes('T')

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 360,
      layout: {
        background: { color: 'transparent' },
        textColor: '#8b949e',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(139,148,158,0.08)' },
        horzLines: { color: 'rgba(139,148,158,0.08)' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: 'rgba(139,148,158,0.2)' },
      localization: { locale: 'zh-TW' },
      timeScale: {
        borderColor: 'rgba(139,148,158,0.2)',
        timeVisible: isIntraday,
        secondsVisible: false,
        shiftVisibleRangeOnNewBar: true,
      },
    })

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })

    const candleData: CandlestickData[] = data.map((p) => ({
      time: parseTime(p.d),
      open: p.o,
      high: p.h,
      low: p.l,
      close: p.c,
    }))
    candleSeries.setData(candleData)

    // Moving averages
    const MA_CONFIG = [
      { period: 5, color: '#f6c244', label: 'MA5' },
      { period: 20, color: '#2196f3', label: 'MA20' },
      { period: 60, color: '#ab47bc', label: 'MA60' },
    ]

    for (const ma of MA_CONFIG) {
      if (data.length < ma.period) continue
      const maData: LineData[] = []
      for (let i = ma.period - 1; i < data.length; i++) {
        let sum = 0
        for (let j = i - ma.period + 1; j <= i; j++) sum += data[j].c
        maData.push({ time: parseTime(data[i].d), value: sum / ma.period })
      }
      const maSeries = chart.addSeries(LineSeries, {
        color: ma.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      maSeries.setData(maData)
    }

    // Volume histogram
    const hasVolume = data.some((p) => p.v != null && p.v > 0)
    if (hasVolume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      })
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      })

      const volumeData: HistogramData[] = data.map((p) => ({
        time: parseTime(p.d),
        value: p.v ?? 0,
        color: p.c >= p.o ? 'rgba(38,166,154,0.3)' : 'rgba(239,83,80,0.3)',
      }))
      volumeSeries.setData(volumeData)
    }

    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [data])

  const title = [name, symbol ? `(${symbol})` : ''].filter(Boolean).join(' ')

  return (
    <div className="mt-3 rounded-lg overflow-hidden border border-border/30">
      {title && (
        <div className="px-3 py-1.5 text-[12px] text-text-muted border-b border-border/20">
          {title} K-Line
        </div>
      )}
      <div ref={containerRef} />
    </div>
  )
}
