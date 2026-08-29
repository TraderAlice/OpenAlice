export * from "./types.js";
export * from "./oos.js";
export * from "./walk-forward.js";
export * from "./monte-carlo.js";
export * from "./sensitivity.js";
export * from "./data-snooping.js";

import { evaluateOutOfSample, type EvaluateOutOfSampleOptions } from "./oos.js";
import { evaluateWalkForward, type EvaluateWalkForwardOptions } from "./walk-forward.js";
import { runMonteCarloSimulation, type MonteCarloSimulationOptions } from "./monte-carlo.js";
import { evaluateParameterSensitivity, type EvaluateSensitivityOptions } from "./sensitivity.js";
import { evaluateDataSnooping, type EvaluateDataSnoopingOptions } from "./data-snooping.js";
import type { ResearchIntegrityReport } from "./types.js";

export interface GenerateIntegrityReportOptions {
  experimentId?: string;
  strategyId?: string;
  oosOptions?: EvaluateOutOfSampleOptions;
  walkForwardOptions?: EvaluateWalkForwardOptions;
  monteCarloOptions?: MonteCarloSimulationOptions;
  sensitivityOptions?: EvaluateSensitivityOptions;
  dataSnoopingOptions?: EvaluateDataSnoopingOptions;
}

export function generateResearchIntegrityReport(options: GenerateIntegrityReportOptions): ResearchIntegrityReport {
  const evaluatedAt = new Date().toISOString();
  const summaryFindings: string[] = [];

  const outOfSample = options.oosOptions ? evaluateOutOfSample(options.oosOptions) : undefined;
  if (outOfSample) {
    summaryFindings.push(
      `OOS Sharpe degradation: ${outOfSample.sharpeDegradationPct}% (IS: ${outOfSample.isSharpe.toFixed(2)} -> OOS: ${outOfSample.oosSharpe.toFixed(2)}). Deflated Sharpe Ratio: ${(outOfSample.deflatedSharpeRatio.dsr * 100).toFixed(1)}%.`
    );
  }

  const walkForward = options.walkForwardOptions ? evaluateWalkForward(options.walkForwardOptions) : undefined;
  if (walkForward) {
    summaryFindings.push(
      `Walk-Forward Efficiency (WFE): ${walkForward.walkForwardEfficiency}% across ${walkForward.windowCount} windows (${(walkForward.positiveOosWindowRatio * 100).toFixed(1)}% positive OOS).`
    );
  }

  const monteCarlo = options.monteCarloOptions ? runMonteCarloSimulation(options.monteCarloOptions) : undefined;
  if (monteCarlo) {
    summaryFindings.push(
      `Monte Carlo (${monteCarlo.iterations} paths): Ruin probability ${(monteCarlo.ruinProbability * 100).toFixed(1)}%, Median Drawdown ${(monteCarlo.maxDrawdownDistribution.p50 * 100).toFixed(1)}%, 95th percentile Drawdown ${(monteCarlo.maxDrawdownDistribution.p95 * 100).toFixed(1)}%.`
    );
  }

  const sensitivity = options.sensitivityOptions ? evaluateParameterSensitivity(options.sensitivityOptions) : undefined;
  if (sensitivity) {
    const unstable = Object.entries(sensitivity.parameterFragility).filter(([_, v]) => v.isUnstable).map(([k]) => k);
    if (unstable.length > 0) {
      summaryFindings.push(`Parameter sensitivity flagged unstable parameters: [${unstable.join(", ")}].`);
    } else {
      summaryFindings.push(`Parameter sensitivity confirms smooth gradient across all tested parameters.`);
    }
  }

  const dataSnooping = options.dataSnoopingOptions ? evaluateDataSnooping(options.dataSnoopingOptions) : undefined;
  if (dataSnooping) {
    summaryFindings.push(
      `Data snooping correction (${dataSnooping.totalHistoricalTrials} trials): Holm-adjusted p-value = ${dataSnooping.holmAdjustedPValue} (significant: ${dataSnooping.isSignificantAfterCorrection}). Haircut Sharpe: ${dataSnooping.haircutSharpeRatio.toFixed(2)}.`
    );
  }

  return {
    experimentId: options.experimentId,
    strategyId: options.strategyId,
    evaluatedAt,
    outOfSample,
    walkForward,
    monteCarlo,
    sensitivity,
    dataSnooping,
    summaryFindings,
    methodologyNotice:
      "All metrics adhere strictly to an evidence-first framework. Raw empirical distributions, confidence intervals, sample sizes, and academic citations are presented without arbitrary composite scoring."
  };
}
