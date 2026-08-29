import { useEffect, useState } from 'react'
import {
  Beaker,
  Plus,
  Play,
  Layers,
  Code2,
  History,
  ShieldCheck,
  BookOpen,
  ArrowRight,
  TrendingUp,
  Sparkles,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle
} from 'lucide-react'
import {
  leanApi,
  type LeanStatus,
  type StrategyMetadata,
  type StrategyTemplate,
  type BacktestSummary,
  type Experiment
} from '../api/lean'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'
import { PageHeader } from '../components/PageHeader'
import { PageSidebarLayout } from '../components/PageSidebarLayout'
import { QuantLabSidebar } from '../components/lean/QuantLabSidebar'

interface QuantLabPageProps {
  spec?: Extract<ViewSpec, { kind: 'quant-lab' }>
}

export function QuantLabPage({ spec }: QuantLabPageProps) {
  const { openOrFocus } = useWorkspace()
  const [status, setStatus] = useState<LeanStatus | null>(null)
  const [templates, setTemplates] = useState<StrategyTemplate[]>([])
  const [strategies, setStrategies] = useState<StrategyMetadata[]>([])
  const [backtests, setBacktests] = useState<BacktestSummary[]>([])
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newStrategyName, setNewStrategyName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string>('ema-cross')

  const loadData = async () => {
    try {
      setLoading(true)
      const [sRes, tRes, stRes, btRes, expRes] = await Promise.all([
        leanApi.getStatus().catch(() => null),
        leanApi.listTemplates().catch(() => ({ templates: [] })),
        leanApi.listStrategies().catch(() => ({ strategies: [] })),
        leanApi.listBacktests().catch(() => ({ backtests: [] })),
        leanApi.listExperiments().catch(() => ({ experiments: [] }))
      ])

      if (sRes) setStatus(sRes)
      if (tRes?.templates) setTemplates(tRes.templates)
      if (stRes?.strategies) setStrategies(stRes.strategies)
      if (btRes?.backtests) setBacktests(btRes.backtests)
      if (expRes?.experiments) setExperiments(expRes.experiments)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCreateFromTemplate = async (templateId: string, name?: string) => {
    try {
      const template = templates.find((t) => t.id === templateId)
      const stratName = name || `${template?.name || 'New'} Strategy`
      const res = await leanApi.createStrategy({
        name: stratName,
        templateId
      })
      if (res?.strategy?.id) {
        openOrFocus({
          kind: 'quant-lab-strategy',
          params: { id: res.strategy.id }
        })
      }
    } catch (err: any) {
      alert(`Failed to create strategy: ${err.message}`)
    }
  }

  // Show disabled state when lean.enabled: false (plan: gated until lean.enabled: true)
  if (!loading && status !== null && !status.enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background p-8 text-center">
        <Beaker className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">Quant Lab is not enabled</h2>
        <p className="text-sm text-muted-foreground max-w-sm mb-4">
          To activate Quant Lab, set <code className="font-mono bg-secondary px-1 rounded">enabled: true</code> in{' '}
          <code className="font-mono bg-secondary px-1 rounded">data/config/lean.json</code>.
          All existing OpenAlice features remain fully operational while Quant Lab is disabled.
        </p>
      </div>
    )
  }

  return (
    <PageSidebarLayout
      storageKey="quant-lab-sidebar"
      title="Quant Lab"
      defaultWidth={260}
      sidebar={<QuantLabSidebar />}
    >
      <div className="flex h-full flex-col overflow-y-auto bg-background p-6 space-y-6">
        {/* Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <Beaker className="text-primary h-6 w-6" />
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Quant Lab Research Center
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Event-driven Forex quantitative research, realistic bid/ask backtesting, and evidence-first statistical validation.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-secondary/50 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold shadow hover:bg-primary/90 transition-colors"
            >
              <Plus size={14} />
              New Algorithm
            </button>
          </div>
        </div>

        {/* Engine Banner & Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border bg-card p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>LEAN Engine</span>
              <span className={`w-2 h-2 rounded-full ${status?.dockerAvailable ? 'bg-success' : 'bg-destructive'}`} />
            </div>
            <div className="mt-2 text-lg font-bold text-foreground">
              {status?.dockerAvailable ? 'Docker Engine Ready' : 'Docker Offline'}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {status?.dockerVersion || 'Docker runtime not detected'}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Active Strategies</span>
              <Code2 size={14} className="text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-foreground">
              {strategies.length}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {templates.length} built-in QCAlgorithm templates
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Backtest Runs</span>
              <History size={14} className="text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-foreground">
              {backtests.length}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Across OANDA Forex QuoteBars
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Experiments & Integrity</span>
              <ShieldCheck size={14} className="text-purple-500" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-foreground">
              {experiments.length}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Evidence-first validation active
            </div>
          </div>
        </div>

        {/* Create Strategy Modal/Bar */}
        {creating && (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-semibold text-foreground">Strategy Name</label>
              <input
                type="text"
                placeholder="e.g. EURUSD London Breakout Strategy"
                value={newStrategyName}
                onChange={(e) => setNewStrategyName(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="w-56">
              <label className="text-xs font-semibold text-foreground">Base Template</label>
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                className="w-full mt-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 mt-5">
              <button
                onClick={() => {
                  handleCreateFromTemplate(selectedTemplate, newStrategyName)
                  setCreating(false)
                }}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
              >
                Create Strategy
              </button>
              <button
                onClick={() => setCreating(false)}
                className="px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* QCAlgorithm Strategy Templates Gallery */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">Built-in Forex Algorithm Templates</h2>
              <p className="text-xs text-muted-foreground">
                Battle-tested Python QuantConnect strategies with spread modeling, margin leverage, and 24/5 sessions.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="flex flex-col justify-between rounded-lg border border-border bg-card p-5 hover:border-primary/50 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-primary/10 text-primary">
                      {tpl.category}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {tpl.parameterDefs.length} Parameters
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-foreground mt-2">{tpl.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{tpl.description}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between">
                  <button
                    onClick={() => handleCreateFromTemplate(tpl.id)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <span>Instantiate Algorithm</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Existing Strategies List */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-foreground">Your Strategy Portfolio</h2>
          </div>

          {strategies.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              No custom strategies created yet. Instantiate a template above to begin.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {strategies.map((strat) => (
                <div
                  key={strat.id}
                  onClick={() =>
                    openOrFocus({
                      kind: 'quant-lab-strategy',
                      params: { id: strat.id }
                    })
                  }
                  className="rounded-lg border border-border bg-card p-5 cursor-pointer hover:border-primary/60 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-foreground">{strat.name}</h3>
                      {strat.templateId && (
                        <span className="text-[10px] font-mono text-muted-foreground px-2 py-0.5 rounded bg-secondary">
                          {strat.templateId}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {strat.description || 'Custom QuantConnect algorithmic strategy.'}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Updated {new Date(strat.updatedAt).toLocaleDateString()}</span>
                    <span className="font-semibold text-primary flex items-center gap-1">
                      Edit & Backtest <ArrowRight size={12} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Backtest Results */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-foreground">Recent Backtest Runs</h2>
          </div>

          {backtests.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              No backtests have been executed yet. Run a strategy to see detailed performance teardowns.
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <table className="w-full text-left text-xs border-collapse font-mono">
                <thead>
                  <tr className="border-b border-border/80 bg-secondary/30 text-[11px] font-sans text-muted-foreground uppercase">
                    <th className="py-2.5 px-4">Run ID / Strategy</th>
                    <th className="py-2.5 px-4">Symbol</th>
                    <th className="py-2.5 px-4">Period</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Net Profit</th>
                    <th className="py-2.5 px-4">Sharpe</th>
                    <th className="py-2.5 px-4">Drawdown</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {backtests.map((bt) => {
                    const isWin = (bt.netProfit || 0) >= 0
                    return (
                      <tr
                        key={bt.id}
                        onClick={() =>
                          openOrFocus({
                            kind: 'quant-lab-results',
                            params: { id: bt.id }
                          })
                        }
                        className="hover:bg-secondary/40 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4">
                          <div className="font-bold text-foreground font-sans">{bt.strategyName}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{bt.id}</div>
                        </td>
                        <td className="py-3 px-4 font-bold text-foreground">{bt.symbol}</td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {bt.startDate} to {bt.endDate}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              bt.status === 'completed'
                                ? 'bg-success/15 text-success'
                                : bt.status === 'failed'
                                ? 'bg-destructive/15 text-destructive'
                                : 'bg-warning/15 text-warning'
                            }`}
                          >
                            {bt.status}
                          </span>
                        </td>
                        <td className={`py-3 px-4 font-bold ${isWin ? 'text-success' : 'text-destructive'}`}>
                          {bt.netProfit != null ? `$${bt.netProfit.toLocaleString()}` : '-'}
                        </td>
                        <td className="py-3 px-4 font-bold text-foreground">
                          {bt.sharpeRatio != null ? bt.sharpeRatio.toFixed(2) : '-'}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {bt.drawdown != null ? `${(bt.drawdown * 100).toFixed(1)}%` : '-'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-primary font-semibold hover:underline">View Teardown →</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageSidebarLayout>
  )
}
