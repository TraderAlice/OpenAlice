import { useEffect, useState } from 'react'
import {
  ShieldCheck,
  ArrowLeft,
  RefreshCw,
  GitFork,
  Layers,
  FileSpreadsheet,
  BookOpen,
  Filter,
  Plus,
  Scale
} from 'lucide-react'
import {
  leanApi,
  type Experiment,
  type ResearchIntegrityReport,
  type ExperimentComparison
} from '../api/lean'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'
import { PageSidebarLayout } from '../components/PageSidebarLayout'
import { QuantLabSidebar } from '../components/lean/QuantLabSidebar'
import { ResearchIntegrityCards } from '../components/lean/ResearchIntegrityCards'

interface ResearchIntegrityPageProps {
  spec: Extract<ViewSpec, { kind: 'quant-lab-integrity' }>
}

export function ResearchIntegrityPage({ spec }: ResearchIntegrityPageProps) {
  const { openOrFocus } = useWorkspace()
  const initialExpId = spec.params.experimentId

  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [selectedExpId, setSelectedExpId] = useState<string>(initialExpId)
  const [report, setReport] = useState<ResearchIntegrityReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [comparing, setComparing] = useState(false)
  const [compareTargetId, setCompareTargetId] = useState<string>('')
  const [comparison, setComparison] = useState<ExperimentComparison | null>(null)

  const loadData = async () => {
    try {
      setLoading(true)
      const res = await leanApi.listExperiments()
      if (res?.experiments) {
        setExperiments(res.experiments)
        const targetId =
          selectedExpId === 'latest' && res.experiments.length > 0
            ? res.experiments[0].id
            : selectedExpId

        if (targetId && targetId !== 'latest') {
          setSelectedExpId(targetId)
          const repRes = await leanApi.getIntegrityReport(targetId).catch(() => null)
          if (repRes?.report) {
            setReport(repRes.report)
          }
        }
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [initialExpId])

  const handleSelectExperiment = async (id: string) => {
    setSelectedExpId(id)
    try {
      setLoading(true)
      const res = await leanApi.getIntegrityReport(id)
      if (res?.report) {
        setReport(res.report)
      } else {
        setReport(null)
      }
    } catch {
      setReport(null)
    } finally {
      setLoading(false)
    }
  }

  const handleCompare = async () => {
    if (!selectedExpId || !compareTargetId) return
    try {
      const res = await leanApi.compareExperiments(selectedExpId, compareTargetId)
      if (res?.comparison) {
        setComparison(res.comparison)
      }
    } catch (err: any) {
      alert(`Comparison failed: ${err.message}`)
    }
  }

  const selectedExp = experiments.find((e) => e.id === selectedExpId)

  return (
    <PageSidebarLayout
      storageKey="quant-lab-sidebar"
      title="Quant Lab"
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
                <ShieldCheck className="text-emerald-500 h-6 w-6" />
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Research Integrity & Bias Audit
                </h1>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Evidence-first audit: Out-of-sample degradation, Deflated Sharpe, Monte Carlo distributions, and Data Snooping corrections.
              </p>
            </div>
          </div>

          {/* Experiment Switcher */}
          <div className="flex items-center gap-3">
            <select
              value={selectedExpId}
              onChange={(e) => handleSelectExperiment(e.target.value)}
              className="rounded-md border border-input bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {experiments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.strategyId} ({e.id.slice(0, 10)})
                </option>
              ))}
            </select>

            <button
              onClick={() => setComparing(!comparing)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-secondary text-xs font-semibold text-foreground hover:bg-secondary/80 transition-colors"
            >
              <Scale size={14} />
              Compare Experiments
            </button>
          </div>
        </div>

        {/* Experiment Context Bar */}
        {selectedExp && (
          <div className="rounded-lg border border-border bg-card p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold text-foreground">
                Hypothesis: {selectedExp.hypothesis}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                <span>Strategy: {selectedExp.strategyId}</span>
                <span>•</span>
                <span>
                  IS: {selectedExp.inSamplePeriod.start} to {selectedExp.inSamplePeriod.end}
                </span>
                {selectedExp.outOfSamplePeriod && (
                  <>
                    <span>•</span>
                    <span>
                      OOS: {selectedExp.outOfSamplePeriod.start} to {selectedExp.outOfSamplePeriod.end}
                    </span>
                  </>
                )}
                <span>•</span>
                <span>{selectedExp.backtestIds.length} Linked Backtests</span>
              </div>
            </div>
          </div>
        )}

        {/* Comparison Drawer / Panel */}
        {comparing && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-foreground">A/B Experiment Parameter & Performance Diff</h3>
              <div className="flex items-center gap-2">
                <select
                  value={compareTargetId}
                  onChange={(e) => setCompareTargetId(e.target.value)}
                  className="rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground"
                >
                  <option value="">Select target experiment to compare...</option>
                  {experiments
                    .filter((e) => e.id !== selectedExpId)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.strategyId} ({e.id})
                      </option>
                    ))}
                </select>
                <button
                  onClick={handleCompare}
                  disabled={!compareTargetId}
                  className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
                >
                  Diff
                </button>
              </div>
            </div>

            {comparison && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div className="p-3 rounded bg-background border border-border">
                  <div className="font-bold text-foreground mb-2 font-sans">Parameter Diffs</div>
                  {Object.keys(comparison.parameterDiffs).length === 0 ? (
                    <div className="text-muted-foreground italic">No parameter differences</div>
                  ) : (
                    Object.entries(comparison.parameterDiffs).map(([param, diff]) => (
                      <div key={param} className="flex justify-between py-1 border-b border-border/40">
                        <span className="text-muted-foreground">{param}:</span>
                        <span>
                          <span className="text-destructive">{String(diff.a)}</span> →{' '}
                          <span className="text-success">{String(diff.b)}</span>
                        </span>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-3 rounded bg-background border border-border">
                  <div className="font-bold text-foreground mb-2 font-sans">Performance Diffs (B - A)</div>
                  <div className="space-y-1">
                    <div className="flex justify-between py-1 border-b border-border/40">
                      <span className="text-muted-foreground">In-Sample Sharpe Diff:</span>
                      <span
                        className={
                          (comparison.metricDiffs.isSharpeDiff || 0) >= 0 ? 'text-success font-bold' : 'text-destructive font-bold'
                        }
                      >
                        {comparison.metricDiffs.isSharpeDiff != null
                          ? `${comparison.metricDiffs.isSharpeDiff > 0 ? '+' : ''}${comparison.metricDiffs.isSharpeDiff}`
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/40">
                      <span className="text-muted-foreground">Out-of-Sample Sharpe Diff:</span>
                      <span
                        className={
                          (comparison.metricDiffs.oosSharpeDiff || 0) >= 0 ? 'text-success font-bold' : 'text-destructive font-bold'
                        }
                      >
                        {comparison.metricDiffs.oosSharpeDiff != null
                          ? `${comparison.metricDiffs.oosSharpeDiff > 0 ? '+' : ''}${comparison.metricDiffs.oosSharpeDiff}`
                          : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Evidence Dashboard */}
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <RefreshCw className="animate-spin mr-2 inline" size={16} />
            Computing statistical evidence...
          </div>
        ) : (
          <ResearchIntegrityCards report={report || undefined} />
        )}
      </div>
    </PageSidebarLayout>
  )
}
