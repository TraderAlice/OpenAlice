import type { ResearchIntegrityReport } from '../../api/lean'
import {
  ShieldAlert,
  ShieldCheck,
  Binary,
  Layers,
  Repeat,
  AlertOctagon,
  BookOpen,
  Info,
  Sliders,
  TrendingDown
} from 'lucide-react'

interface ResearchIntegrityCardsProps {
  report?: ResearchIntegrityReport
}

export function ResearchIntegrityCards({ report }: ResearchIntegrityCardsProps) {
  if (!report) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        No research integrity report loaded
      </div>
    )
  }

  const { outOfSample, walkForward, monteCarlo, sensitivity, dataSnooping } = report

  return (
    <div className="flex flex-col gap-6">
      {/* Evidence-First Methodology Notice */}
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs text-emerald-600 dark:text-emerald-400 flex items-start gap-3">
        <ShieldCheck size={18} className="shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Evidence-First Integrity Guarantee:</span>{' '}
          {report.methodologyNotice}
        </div>
      </div>

      {/* Summary Findings */}
      {report.summaryFindings && report.summaryFindings.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Core Empirical Findings
          </h3>
          <ul className="space-y-2 text-xs">
            {report.summaryFindings.map((finding, idx) => (
              <li key={idx} className="flex items-start gap-2 text-foreground">
                <span className="text-primary font-bold">•</span>
                <span>{finding}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 2-Column Grid for Specific Integrity Checks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* 1. Out-of-Sample (OOS) Validation */}
        {outOfSample && (
          <div className="rounded-lg border border-border bg-card p-5 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-primary/10 text-primary">
                    <Layers size={15} />
                  </div>
                  <h4 className="text-sm font-bold text-foreground">Out-of-Sample (OOS) Split</h4>
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded font-mono font-semibold ${
                    outOfSample.sharpeDegradationPct < 25
                      ? 'bg-success/15 text-success'
                      : outOfSample.sharpeDegradationPct < 50
                      ? 'bg-warning/15 text-warning'
                      : 'bg-destructive/15 text-destructive'
                  }`}
                >
                  {outOfSample.sharpeDegradationPct.toFixed(1)}% Degradation
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4 text-xs font-mono">
                <div className="p-2.5 rounded bg-secondary/50">
                  <div className="text-[11px] text-muted-foreground font-sans">In-Sample (IS)</div>
                  <div className="text-base font-bold text-foreground mt-0.5">
                    SR {outOfSample.isSharpe.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Profit: ${(outOfSample.isNetProfit || 0).toLocaleString()}
                  </div>
                </div>

                <div className="p-2.5 rounded bg-secondary/50">
                  <div className="text-[11px] text-muted-foreground font-sans">Out-of-Sample (OOS)</div>
                  <div className="text-base font-bold text-foreground mt-0.5">
                    SR {outOfSample.oosSharpe.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Profit: ${(outOfSample.oosNetProfit || 0).toLocaleString()}
                  </div>
                </div>
              </div>

              {outOfSample.deflatedSharpeRatio && (
                <div className="mt-3 p-2.5 rounded bg-secondary/30 text-xs">
                  <div className="flex justify-between font-mono">
                    <span className="text-muted-foreground">Deflated Sharpe Ratio (DSR):</span>
                    <span className="font-bold text-foreground">
                      {(outOfSample.deflatedSharpeRatio.dsr * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Accounts for skewness ({outOfSample.deflatedSharpeRatio.skewness}), kurtosis (
                    {outOfSample.deflatedSharpeRatio.kurtosis}), and trials (
                    {outOfSample.deflatedSharpeRatio.trialsTested}).
                  </div>
                </div>
              )}

              <p className="mt-3 text-xs text-muted-foreground">{outOfSample.interpretation}</p>
            </div>

            {outOfSample.academicReferences && (
              <div className="text-[10px] text-muted-foreground/70 border-t border-border/40 pt-2">
                Ref: {outOfSample.academicReferences[0]}
              </div>
            )}
          </div>
        )}

        {/* 2. Walk-Forward Analysis */}
        {walkForward && (
          <div className="rounded-lg border border-border bg-card p-5 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-emerald-500/10 text-emerald-500">
                    <Repeat size={15} />
                  </div>
                  <h4 className="text-sm font-bold text-foreground">Walk-Forward Efficiency</h4>
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded font-mono font-semibold ${
                    walkForward.walkForwardEfficiency >= 50
                      ? 'bg-success/15 text-success'
                      : 'bg-warning/15 text-warning'
                  }`}
                >
                  WFE {walkForward.walkForwardEfficiency.toFixed(1)}%
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-4 text-xs font-mono text-center">
                <div className="p-2 rounded bg-secondary/50">
                  <div className="text-[10px] text-muted-foreground font-sans">Windows</div>
                  <div className="text-sm font-bold text-foreground">{walkForward.windowCount}</div>
                </div>
                <div className="p-2 rounded bg-secondary/50">
                  <div className="text-[10px] text-muted-foreground font-sans">Positive OOS</div>
                  <div className="text-sm font-bold text-foreground">
                    {(walkForward.positiveOosWindowRatio * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="p-2 rounded bg-secondary/50">
                  <div className="text-[10px] text-muted-foreground font-sans">Max OOS DD</div>
                  <div className="text-sm font-bold text-destructive">
                    {(walkForward.maxOosDrawdown * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">{walkForward.interpretation}</p>
            </div>

            {walkForward.academicReferences && (
              <div className="text-[10px] text-muted-foreground/70 border-t border-border/40 pt-2">
                Ref: {walkForward.academicReferences[0]}
              </div>
            )}
          </div>
        )}

        {/* 3. Monte Carlo Simulation */}
        {monteCarlo && (
          <div className="rounded-lg border border-border bg-card p-5 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-purple-500/10 text-purple-500">
                    <Binary size={15} />
                  </div>
                  <h4 className="text-sm font-bold text-foreground">
                    Monte Carlo ({monteCarlo.iterations} Paths)
                  </h4>
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded font-mono font-semibold ${
                    monteCarlo.ruinProbability === 0
                      ? 'bg-success/15 text-success'
                      : monteCarlo.ruinProbability < 0.05
                      ? 'bg-warning/15 text-warning'
                      : 'bg-destructive/15 text-destructive'
                  }`}
                >
                  Ruin Prob: {(monteCarlo.ruinProbability * 100).toFixed(1)}%
                </span>
              </div>

              <div className="mt-4 space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center p-2 rounded bg-secondary/40">
                  <span className="text-muted-foreground font-sans">Max Drawdown Percentiles:</span>
                  <span className="font-semibold text-foreground">
                    p50: {(monteCarlo.maxDrawdownDistribution.p50 * 100).toFixed(1)}% | p95:{' '}
                    <span className="text-destructive">
                      {(monteCarlo.maxDrawdownDistribution.p95 * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>

                <div className="flex justify-between items-center p-2 rounded bg-secondary/40">
                  <span className="text-muted-foreground font-sans">Final Return Percentiles:</span>
                  <span className="font-semibold text-foreground">
                    p50: {(monteCarlo.finalReturnDistribution.p50 * 100).toFixed(1)}% | p05:{' '}
                    {(monteCarlo.finalReturnDistribution.p05 * 100).toFixed(1)}%
                  </span>
                </div>

                <div className="flex justify-between items-center p-2 rounded bg-secondary/40">
                  <span className="text-muted-foreground font-sans">Longest Losing Streak:</span>
                  <span className="font-semibold text-foreground">
                    Median: {monteCarlo.longestLosingStreakDistribution.median} trades (95th: {monteCarlo.longestLosingStreakDistribution.p95})
                  </span>
                </div>
              </div>
            </div>

            {monteCarlo.academicReferences && (
              <div className="text-[10px] text-muted-foreground/70 border-t border-border/40 pt-2">
                Ref: {monteCarlo.academicReferences[0]}
              </div>
            )}
          </div>
        )}

        {/* 4. Data Snooping & Multiple Testing */}
        {dataSnooping && (
          <div className="rounded-lg border border-border bg-card p-5 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-amber-500/10 text-amber-500">
                    <AlertOctagon size={15} />
                  </div>
                  <h4 className="text-sm font-bold text-foreground">Data Snooping Penalty</h4>
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded font-mono font-semibold ${
                    dataSnooping.isSignificantAfterCorrection
                      ? 'bg-success/15 text-success'
                      : 'bg-destructive/15 text-destructive'
                  }`}
                >
                  {dataSnooping.isSignificantAfterCorrection ? 'Significant' : 'Spurious Risk'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4 text-xs font-mono">
                <div className="p-2.5 rounded bg-secondary/50">
                  <div className="text-[10px] text-muted-foreground font-sans">Historical Trials</div>
                  <div className="text-base font-bold text-foreground">{dataSnooping.totalHistoricalTrials}</div>
                  <div className="text-[10px] text-muted-foreground">
                    Exp. False: {dataSnooping.expectedFalseDiscoveries}
                  </div>
                </div>

                <div className="p-2.5 rounded bg-secondary/50">
                  <div className="text-[10px] text-muted-foreground font-sans">Haircut Sharpe</div>
                  <div className="text-base font-bold text-foreground">
                    SR {dataSnooping.haircutSharpeRatio.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    p_adj: {dataSnooping.holmAdjustedPValue}
                  </div>
                </div>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">{dataSnooping.interpretation}</p>
            </div>

            {dataSnooping.academicReferences && (
              <div className="text-[10px] text-muted-foreground/70 border-t border-border/40 pt-2">
                Ref: {dataSnooping.academicReferences[0]}
              </div>
            )}
          </div>
        )}

        {/* 5. Parameter Sensitivity */}
        {sensitivity && (
          <div className="col-span-1 md:col-span-2 rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded bg-blue-500/10 text-blue-500">
                <Sliders size={15} />
              </div>
              <h4 className="text-sm font-bold text-foreground">Parameter Fragility & Elasticity</h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {Object.entries(sensitivity.parameterFragility).map(([paramName, frag]) => (
                <div
                  key={paramName}
                  className={`p-3 rounded-lg border text-xs font-mono ${
                    frag.isUnstable
                      ? 'border-destructive/40 bg-destructive/5'
                      : 'border-border/60 bg-secondary/30'
                  }`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold font-sans text-foreground">{paramName}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        frag.isUnstable ? 'bg-destructive/20 text-destructive' : 'bg-success/20 text-success'
                      }`}
                    >
                      {frag.isUnstable ? 'Unstable Cliff' : 'Robust'}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    Max Drop: <span className="text-foreground font-bold">{frag.maxSharpeDropPct}%</span>
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    Elasticity: <span className="text-foreground">{frag.averageElasticity}</span>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">{sensitivity.interpretation}</p>
          </div>
        )}
      </div>
    </div>
  )
}
