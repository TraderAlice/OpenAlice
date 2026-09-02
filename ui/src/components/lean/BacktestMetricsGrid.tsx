import type { LeanStatistics } from '../../api/lean'
import {
  TrendingUp,
  Percent,
  Activity,
  Award,
  AlertTriangle,
  Scale,
  Zap,
  DollarSign
} from 'lucide-react'

interface BacktestMetricsGridProps {
  statistics?: LeanStatistics
  initialCash?: number
}

export function BacktestMetricsGrid({ statistics, initialCash = 100000 }: BacktestMetricsGridProps) {
  if (!statistics) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No performance statistics available
      </div>
    )
  }

  const cards = [
    {
      label: 'Sharpe Ratio',
      value: statistics.sharpeRatio.toFixed(2),
      subtext: `Sortino: ${statistics.sortinoRatio.toFixed(2)}`,
      icon: Award,
      tone: statistics.sharpeRatio >= 1.5 ? 'success' : statistics.sharpeRatio > 0 ? 'primary' : 'destructive'
    },
    {
      label: 'CAGR (Annual Return)',
      value: `${(statistics.compoundingAnnualReturn * 100).toFixed(2)}%`,
      subtext: `Net Profit: $${statistics.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      icon: TrendingUp,
      tone: statistics.compoundingAnnualReturn >= 0 ? 'success' : 'destructive'
    },
    {
      label: 'Max Drawdown',
      value: `${(statistics.drawdown * 100).toFixed(2)}%`,
      subtext: `Std Dev: ${(statistics.annualStandardDeviation * 100).toFixed(1)}%`,
      icon: AlertTriangle,
      tone: statistics.drawdown <= 0.1 ? 'success' : statistics.drawdown <= 0.2 ? 'warning' : 'destructive'
    },
    {
      label: 'Win Rate',
      value: `${(statistics.winRate * 100).toFixed(1)}%`,
      subtext: `${statistics.winningTrades}W / ${statistics.losingTrades}L (${statistics.totalTrades} Total)`,
      icon: Percent,
      tone: statistics.winRate >= 0.5 ? 'success' : 'warning'
    },
    {
      label: 'Profit/Loss Ratio',
      value: statistics.profitLossRatio.toFixed(2),
      subtext: `Avg Win: $${statistics.averageWin.toFixed(0)} | Avg Loss: $${statistics.averageLoss.toFixed(0)}`,
      icon: Scale,
      tone: statistics.profitLossRatio >= 1.5 ? 'success' : 'primary'
    },
    {
      label: 'Probabilistic Sharpe (PSR)',
      value: `${(statistics.probabilisticSharpeRatio * 100).toFixed(1)}%`,
      subtext: `Expectancy: $${statistics.expectancy.toFixed(1)}`,
      icon: Zap,
      tone: statistics.probabilisticSharpeRatio >= 0.95 ? 'success' : 'primary'
    },
    {
      label: 'Risk / Market Sensitivity',
      value: `Beta: ${statistics.beta.toFixed(2)}`,
      subtext: `Alpha: ${(statistics.alpha * 100).toFixed(1)}%`,
      icon: Activity,
      tone: 'primary'
    },
    {
      label: 'Execution Costs',
      value: `$${statistics.totalFees.toFixed(2)}`,
      subtext: `Total Commissions & Swap Fees`,
      icon: DollarSign,
      tone: 'muted'
    }
  ]

  const toneClass = (tone: string) => {
    switch (tone) {
      case 'success':
        return 'text-success bg-success/10 border-success/20'
      case 'warning':
        return 'text-warning bg-warning/10 border-warning/20'
      case 'destructive':
        return 'text-destructive bg-destructive/10 border-destructive/20'
      case 'muted':
        return 'text-muted-foreground bg-muted/30 border-border/40'
      default:
        return 'text-primary bg-primary/10 border-primary/20'
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c, i) => {
        const Icon = c.icon
        return (
          <div
            key={i}
            className="flex flex-col justify-between rounded-lg border border-border bg-card p-4 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground tracking-wide">
                {c.label}
              </span>
              <div className={`p-1.5 rounded-md border ${toneClass(c.tone)}`}>
                <Icon size={14} />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-xl font-bold font-mono tracking-tight text-foreground">
                {c.value}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate font-mono">
                {c.subtext}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
