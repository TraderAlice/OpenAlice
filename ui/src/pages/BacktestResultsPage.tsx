import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Code2,
  DollarSign,
  FileText,
  History,
  Play,
  RefreshCw,
  ShieldCheck,
  Terminal,
  XCircle
} from 'lucide-react'
import { leanApi, type BacktestResult } from '../api/lean'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'
import { PageSidebarLayout } from '../components/PageSidebarLayout'
import { QuantLabSidebar } from '../components/lean/QuantLabSidebar'
import { LeanEquityCurve } from '../components/lean/LeanEquityCurve'
import { BacktestMetricsGrid } from '../components/lean/BacktestMetricsGrid'
import { TradeLogTable } from '../components/lean/TradeLogTable'

interface BacktestResultsPageProps {
  spec: Extract<ViewSpec, { kind: 'quant-lab-results' }>
}

export function BacktestResultsPage({ spec }: BacktestResultsPageProps) {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const backtestId = spec.params.id

  const [result, setResult] = useState<BacktestResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [showLogs, setShowLogs] = useState(false)
  const [evaluating, setEvaluating] = useState(false)

  const loadBacktest = async () => {
    try {
      setLoading(true)
      const res = await leanApi.getBacktest(backtestId)
      if (res?.backtest) {
        setResult(res.backtest)
      }
    } catch (err: any) {
      alert(`Failed to load backtest results: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBacktest()
  }, [backtestId])

  const handleLaunchIntegrityCheck = async () => {
    if (!result) return
    try {
      setEvaluating(true)
      // Create or link an experiment for this backtest
      const exp = await leanApi.createExperiment({
        strategyId: result.request.strategyId || result.request.strategyName,
        hypothesis: `Research integrity evaluation for ${result.request.strategyName} (${result.request.symbol})`,
        parameters: result.request.parameters || {},
        inSamplePeriod: {
          start: result.request.startDate,
          end: result.request.endDate
        },
        instruments: [result.request.symbol]
      })

      if (exp?.experiment?.id) {
        openOrFocus({
          kind: 'quant-lab-integrity',
          params: { experimentId: exp.experiment.id }
        })
      }
    } catch (err: any) {
      alert(`Failed to initialize research integrity analysis: ${err.message}`)
    } finally {
      setEvaluating(false)
    }
  }

  if (loading) {
    return (
      <PageSidebarLayout
        storageKey="quant-lab-sidebar"
        title="LEAN GUI"
        defaultWidth={260}
        sidebar={<QuantLabSidebar />}
      >
        <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
          <RefreshCw className="animate-spin mr-2" size={16} />
          Loading LEAN simulation teardown...
        </div>
      </PageSidebarLayout>
    )
  }

  if (!result) {
    return (
      <PageSidebarLayout
        storageKey="quant-lab-sidebar"
        title="LEAN GUI"
        defaultWidth={260}
        sidebar={<QuantLabSidebar />}
      >
        <div className="p-8 text-center text-sm text-muted-foreground">
          Backtest result '{backtestId}' not found.
        </div>
      </PageSidebarLayout>
    )
  }

  const { request, statistics, charts, orders, closedTrades, status, durationMs, error, logs } = result
  const equitySeries = charts?.StrategyEquity || charts?.Equity
  const benchmarkSeries = charts?.Benchmark

  return (
    <PageSidebarLayout
      storageKey="quant-lab-sidebar"
      title="LEAN GUI"
      defaultWidth={260}
      sidebar={<QuantLabSidebar />}
    >
      <div className="flex h-full flex-col overflow-y-auto bg-background p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => openOrFocus({ kind: 'quant-lab', params: {} })}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {request.strategyName} Teardown
                </h1>
                <span
                  className={`px-2.5 py-0.5 rounded text-xs font-semibold uppercase ${
                    status === 'completed'
                      ? 'bg-success/15 text-success'
                      : status === 'failed'
                      ? 'bg-destructive/15 text-destructive'
                      : 'bg-warning/15 text-warning'
                  }`}
                >
                  {status}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                <span className="font-mono">{result.id}</span>
                <span>•</span>
                <span className="font-semibold text-foreground">{request.symbol}</span>
                <span>•</span>
                <span>
                  {request.startDate} to {request.endDate}
                </span>
                <span>•</span>
                <span>{((durationMs || 0) / 1000).toFixed(1)}s runtime</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {request.strategyId && (
              <button
                onClick={() =>
                  openOrFocus({
                    kind: 'quant-lab-strategy',
                    params: { id: request.strategyId! }
                  })
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-secondary text-xs font-semibold text-foreground hover:bg-secondary/80 transition-colors"
              >
                <Code2 size={14} />
                Edit Algorithm
              </button>
            )}
            <button
              onClick={handleLaunchIntegrityCheck}
              disabled={evaluating}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-success text-success-foreground text-xs font-semibold shadow hover:bg-success/85 transition-colors"
            >
              <ShieldCheck size={14} className={evaluating ? 'animate-spin' : ''} />
              {evaluating ? 'Analyzing...' : 'Research Integrity Teardown'}
            </button>
          </div>
        </div>

        {/* Error Banner if Failed */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive flex items-start gap-2">
            <XCircle size={16} className="shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Simulation Failure:</span> {error}
            </div>
          </div>
        )}

        {/* Core Performance Grid */}
        <BacktestMetricsGrid statistics={statistics} initialCash={request.initialCash} />

        {/* Interactive Equity Curve & Drawdown Chart */}
        <LeanEquityCurve
          equitySeries={equitySeries}
          benchmarkSeries={benchmarkSeries}
          initialCash={request.initialCash}
        />

        {/* Trade Logs & Orders Table */}
        <TradeLogTable closedTrades={closedTrades} orders={orders} />

        {/* Collapsible Container Logs */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div
            onClick={() => setShowLogs(!showLogs)}
            className="flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">
                LEAN Docker Container Execution Output
              </span>
            </div>
            <span className="text-xs text-primary font-semibold hover:underline">
              {showLogs ? 'Hide Logs ▲' : 'Show Logs ▼'}
            </span>
          </div>

          {showLogs && (
            <pre className="mt-3 p-3 rounded bg-secondary/50 font-mono text-[11px] text-muted-foreground max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {logs || 'No stdout/stderr captured.'}
            </pre>
          )}
        </div>
      </div>
    </PageSidebarLayout>
  )
}
