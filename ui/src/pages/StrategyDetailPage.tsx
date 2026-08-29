import { useEffect, useState } from 'react'
import {
  Code2,
  Play,
  Save,
  Trash2,
  ArrowLeft,
  Sliders,
  Settings,
  Clock,
  DollarSign,
  AlertTriangle,
  Check,
  RefreshCw
} from 'lucide-react'
import { leanApi, type LeanStrategy, type BacktestRequest } from '../api/lean'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'
import { PageSidebarLayout } from '../components/PageSidebarLayout'
import { QuantLabSidebar } from '../components/lean/QuantLabSidebar'

interface StrategyDetailPageProps {
  spec: Extract<ViewSpec, { kind: 'quant-lab-strategy' }>
}

export const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF', 'USDCAD', 'NZDUSD'] as const

export function StrategyDetailPage({ spec }: StrategyDetailPageProps) {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const strategyId = spec.params.id

  const [strategy, setStrategy] = useState<LeanStrategy | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [code, setCode] = useState('')
  const [parameters, setParameters] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)

  // Backtest launcher state
  const [symbol, setSymbol] = useState('EURUSD')
  const [startDate, setStartDate] = useState('2024-01-01')
  const [endDate, setEndDate] = useState('2024-06-01')
  const [initialCash, setInitialCash] = useState(100000)
  const [resolution, setResolution] = useState<'minute' | 'hour' | 'daily'>('minute')

  const loadStrategy = async () => {
    try {
      setLoading(true)
      const res = await leanApi.getStrategy(strategyId)
      if (res?.strategy) {
        setStrategy(res.strategy)
        setName(res.strategy.name)
        setDescription(res.strategy.description)
        setCode(res.strategy.code)
        setParameters(res.strategy.parameters || {})
      }
    } catch (err: any) {
      alert(`Failed to load strategy: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStrategy()
  }, [strategyId])

  const handleSave = async () => {
    try {
      setSaving(true)
      const res = await leanApi.updateStrategy(strategyId, {
        name,
        description,
        code,
        parameters
      })
      if (res?.strategy) {
        setStrategy(res.strategy)
        alert('Strategy saved successfully!')
      }
    } catch (err: any) {
      alert(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete strategy '${strategyId}'?`)) return
    try {
      await leanApi.deleteStrategy(strategyId)
      openOrFocus({ kind: 'quant-lab', params: {} })
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`)
    }
  }

  const handleRunBacktest = async () => {
    try {
      setRunning(true)
      // Save changes first if modified
      await leanApi.updateStrategy(strategyId, {
        name,
        description,
        code,
        parameters
      })

      const req: BacktestRequest = {
        strategyId,
        strategyName: name || strategyId,
        symbol,
        startDate,
        endDate,
        initialCash,
        resolution,
        parameters
      }

      const res = await leanApi.runBacktest(req)
      if (res?.backtest?.id) {
        openOrFocus({
          kind: 'quant-lab-results',
          params: { id: res.backtest.id }
        })
      }
    } catch (err: any) {
      alert(`Backtest execution error: ${err.message}`)
    } finally {
      setRunning(false)
    }
  }

  const handleParamChange = (key: string, value: any) => {
    setParameters((prev) => ({
      ...prev,
      [key]: value
    }))
  }

  if (loading) {
    return (
      <PageSidebarLayout
        storageKey="quant-lab-sidebar"
        title="Quant Lab"
        defaultWidth={260}
        sidebar={<QuantLabSidebar />}
      >
        <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
          <RefreshCw className="animate-spin mr-2" size={16} />
          Loading strategy details...
        </div>
      </PageSidebarLayout>
    )
  }

  if (!strategy) {
    return (
      <PageSidebarLayout
        storageKey="quant-lab-sidebar"
        title="Quant Lab"
        defaultWidth={260}
        sidebar={<QuantLabSidebar />}
      >
        <div className="p-8 text-center text-sm text-muted-foreground">
          Strategy not found.
        </div>
      </PageSidebarLayout>
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
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="text-lg font-bold bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none text-foreground"
                />
                {strategy.templateId && (
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary">
                    {strategy.templateId}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                ID: <span className="font-mono">{strategy.id}</span> · Updated{' '}
                {new Date(strategy.updatedAt).toLocaleDateString()}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleDelete}
              className="p-2 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete Strategy"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-secondary text-xs font-semibold text-foreground hover:bg-secondary/80 transition-colors"
            >
              <Save size={14} />
              {saving ? 'Saving...' : 'Save Strategy'}
            </button>
            <button
              onClick={handleRunBacktest}
              disabled={running}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold shadow hover:bg-primary/90 transition-colors"
            >
              <Play size={14} className={running ? 'animate-spin' : ''} />
              {running ? 'Simulating in LEAN...' : 'Run Backtest'}
            </button>
          </div>
        </div>

        {/* 2-Column Grid: Code Editor on Left, Parameters & Backtest Launcher on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Code Editor Panel (2 cols) */}
          <div className="lg:col-span-2 flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 size={15} className="text-primary" />
                <span className="text-xs font-bold text-foreground">Python Algorithm (QCAlgorithm)</span>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">
                {code.split('\n').length} lines · UTF-8
              </span>
            </div>

            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              rows={24}
              className="w-full font-mono text-xs p-4 rounded-md bg-secondary/30 border border-input text-foreground focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed resize-y"
            />
          </div>

          {/* Right Configuration & Backtest Launcher (1 col) */}
          <div className="flex flex-col gap-5">
            {/* Parameters Panel */}
            <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 border-b border-border/50 pb-2">
                <Sliders size={15} className="text-primary" />
                <span className="text-xs font-bold text-foreground">Strategy Parameters</span>
              </div>

              {strategy.parameterDefs.length === 0 && Object.keys(parameters).length === 0 ? (
                <div className="py-4 text-xs text-muted-foreground italic">
                  No adjustable parameters defined. Use `self.GetParameter("name", default)` in Python code.
                </div>
              ) : (
                <div className="space-y-3">
                  {strategy.parameterDefs.map((def) => {
                    const val = parameters[def.name] ?? def.defaultValue
                    return (
                      <div key={def.name} className="flex flex-col gap-1 text-xs">
                        <div className="flex justify-between font-mono">
                          <label className="font-semibold text-foreground">{def.name}</label>
                          <span className="text-muted-foreground">{String(val)}</span>
                        </div>
                        {def.type === 'number' && def.min != null && def.max != null ? (
                          <input
                            type="range"
                            min={def.min}
                            max={def.max}
                            step={def.name.includes('risk') ? 0.01 : 1}
                            value={Number(val)}
                            onChange={(e) => handleParamChange(def.name, parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer"
                          />
                        ) : def.type === 'boolean' ? (
                          <input
                            type="checkbox"
                            checked={Boolean(val)}
                            onChange={(e) => handleParamChange(def.name, e.target.checked)}
                            className="h-4 w-4 rounded border-input text-primary"
                          />
                        ) : (
                          <input
                            type={def.type === 'number' ? 'number' : 'text'}
                            value={val ?? ''}
                            onChange={(e) =>
                              handleParamChange(
                                def.name,
                                def.type === 'number' ? parseFloat(e.target.value) : e.target.value
                              )
                            }
                            className="rounded-md border border-input bg-secondary/50 px-2.5 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        )}
                        {def.description && (
                          <span className="text-[10px] text-muted-foreground">{def.description}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Backtest Launcher Configuration */}
            <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 border-b border-border/50 pb-2">
                <Settings size={15} className="text-primary" />
                <span className="text-xs font-bold text-foreground">LEAN Engine Run Settings</span>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-semibold text-muted-foreground">Forex Symbol</label>
                  <select
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {FOREX_PAIRS.map((p) => (
                      <option key={p} value={p}>
                        {p} (OANDA QuoteBar)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="font-semibold text-muted-foreground">Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-muted-foreground">End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-muted-foreground">Initial Account Cash ($)</label>
                  <input
                    type="number"
                    value={initialCash}
                    onChange={(e) => setInitialCash(parseFloat(e.target.value))}
                    className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="font-semibold text-muted-foreground">Bar Resolution</label>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as any)}
                    className="w-full mt-1 rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="minute">Minute QuoteBars (Realistic)</option>
                    <option value="hour">Hour Resolution</option>
                    <option value="daily">Daily Resolution</option>
                  </select>
                </div>

                <button
                  onClick={handleRunBacktest}
                  disabled={running}
                  className="w-full mt-2 flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-bold shadow hover:bg-primary/90 transition-colors"
                >
                  <Play size={13} className={running ? 'animate-spin' : ''} />
                  {running ? 'Running LEAN Backtest...' : 'Launch Simulation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageSidebarLayout>
  )
}
