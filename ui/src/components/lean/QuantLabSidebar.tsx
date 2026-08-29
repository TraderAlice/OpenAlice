import { useEffect, useState } from 'react'
import {
  Beaker,
  BookOpen,
  Code2,
  Cpu,
  FileCheck,
  History,
  Layers,
  LineChart,
  Plus,
  RefreshCw,
  ShieldCheck,
  Zap
} from 'lucide-react'
import { leanApi, type LeanStatus, type StrategyMetadata, type BacktestSummary } from '../../api/lean'
import { useWorkspace } from '../../tabs/store'
import { getFocusedTab, type ViewSpec } from '../../tabs/types'
import { SidebarRow } from '../SidebarRow'
import { SidebarSectionHeader } from '../SidebarSectionHeader'

interface QuantLabSidebarProps {
  onNavigate?: () => void
}

export function QuantLabSidebar({ onNavigate }: QuantLabSidebarProps) {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const focusedTab = useWorkspace((s) => getFocusedTab(s))
  const [status, setStatus] = useState<LeanStatus | null>(null)
  const [strategies, setStrategies] = useState<StrategyMetadata[]>([])
  const [backtests, setBacktests] = useState<BacktestSummary[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      setLoading(true)
      const [sRes, stratRes, btRes] = await Promise.all([
        leanApi.getStatus().catch(() => null),
        leanApi.listStrategies().catch(() => ({ strategies: [] })),
        leanApi.listBacktests().catch(() => ({ backtests: [] }))
      ])
      if (sRes) setStatus(sRes)
      if (stratRes?.strategies) setStrategies(stratRes.strategies)
      if (btRes?.backtests) setBacktests(btRes.backtests.slice(0, 5))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const navTo = (spec: ViewSpec) => {
    openOrFocus(spec)
    onNavigate?.()
  }

  const isMainActive = focusedTab?.spec.kind === 'quant-lab'
  const isJournalActive = focusedTab?.spec.kind === 'quant-lab-journal'
  const activeStrategyId = focusedTab?.spec.kind === 'quant-lab-strategy' ? focusedTab.spec.params.id : null
  const activeBacktestId = focusedTab?.spec.kind === 'quant-lab-results' ? focusedTab.spec.params.id : null
  const isIntegrityActive = focusedTab?.spec.kind === 'quant-lab-integrity'

  return (
    <div className="flex h-full flex-col select-none overflow-y-auto p-2 gap-4">
      {/* Header / Engine Status */}
      <div className="flex flex-col gap-1 px-2 py-1.5 rounded-md bg-secondary/40 border border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Beaker size={14} className="text-primary animate-pulse" />
            <span className="text-xs font-semibold tracking-wide">LEAN Engine</span>
          </div>
          <button
            onClick={refresh}
            title="Refresh status"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                status?.dockerAvailable ? 'bg-success' : 'bg-destructive'
              }`}
            />
            {status?.dockerAvailable ? 'Docker Ready' : 'Docker Offline'}
          </span>
          <span className="text-border">|</span>
          <span>{status?.enabled ? 'Active' : 'Disabled'}</span>
        </div>
      </div>

      {/* Main Navigation */}
      <div className="flex flex-col gap-0.5">
        <SidebarSectionHeader title="Quant Research" />
        <SidebarRow
          label="Strategies & Hub"
          icon={<Layers size={13} className="text-primary" />}
          active={isMainActive}
          onClick={() => navTo({ kind: 'quant-lab', params: {} })}
          trail={
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
              {strategies.length}
            </span>
          }
        />
        <SidebarRow
          label="Research Integrity"
          icon={<ShieldCheck size={13} className="text-emerald-500" />}
          active={isIntegrityActive}
          onClick={() =>
            navTo({
              kind: 'quant-lab-integrity',
              params: { experimentId: 'latest' }
            })
          }
          trail={
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-medium">
              Evidence
            </span>
          }
        />
        <SidebarRow
          label="Discretionary Journal"
          icon={<BookOpen size={13} className="text-amber-500" />}
          active={isJournalActive}
          onClick={() => navTo({ kind: 'quant-lab-journal', params: {} })}
          trail={
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-mono">
              {status?.journalCount ?? 0}
            </span>
          }
        />
      </div>

      {/* Strategies List */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Algorithms
          </span>
          <button
            onClick={() => navTo({ kind: 'quant-lab', params: {} })}
            title="Create new strategy"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus size={13} />
          </button>
        </div>
        {strategies.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground/80 italic">
            No strategies created yet
          </div>
        ) : (
          strategies.map((strat) => (
            <SidebarRow
              key={strat.id}
              label={strat.name}
              icon={<Code2 size={13} className="text-muted-foreground/70" />}
              active={activeStrategyId === strat.id}
              onClick={() =>
                navTo({
                  kind: 'quant-lab-strategy',
                  params: { id: strat.id }
                })
              }
              trail={
                strat.templateId ? (
                  <span className="text-[10px] text-muted-foreground/60">
                    {strat.templateId}
                  </span>
                ) : undefined
              }
            />
          ))
        )}
      </div>

      {/* Recent Backtests */}
      <div className="flex flex-col gap-0.5">
        <SidebarSectionHeader title="Recent Runs" />
        {backtests.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground/80 italic">
            No backtest runs found
          </div>
        ) : (
          backtests.map((bt) => (
            <SidebarRow
              key={bt.id}
              label={
                <div className="flex flex-col">
                  <span className="text-xs truncate">{bt.strategyName}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {bt.symbol} · {bt.startDate.slice(2)} to {bt.endDate.slice(2)}
                  </span>
                </div>
              }
              icon={<History size={13} className="text-muted-foreground/70" />}
              active={activeBacktestId === bt.id}
              onClick={() =>
                navTo({
                  kind: 'quant-lab-results',
                  params: { id: bt.id }
                })
              }
              trail={
                bt.sharpeRatio != null ? (
                  <span
                    className={`text-[10px] font-mono font-medium ${
                      bt.sharpeRatio >= 1.5
                        ? 'text-success'
                        : bt.sharpeRatio > 0
                        ? 'text-primary'
                        : 'text-destructive'
                    }`}
                  >
                    SR {bt.sharpeRatio.toFixed(1)}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    {bt.status}
                  </span>
                )
              }
            />
          ))
        )}
      </div>
    </div>
  )
}
