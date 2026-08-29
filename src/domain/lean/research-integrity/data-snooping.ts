import { normalCdf } from "./oos.js";
import type { DataSnoopingReport } from "./types.js";

export interface EvaluateDataSnoopingOptions {
  totalHistoricalTrials: number; // N trials tested
  sharpeRatio: number; // Candidate annualized Sharpe ratio
  sampleLengthT?: number; // Number of periods (e.g. 252 daily bars, or years = sampleLengthT / 252)
  nominalAlpha?: number; // default 0.05
  candidatePValues?: number[]; // optional array of p-values if all trials are provided
}

/**
 * Calculates two-tailed p-value from t-statistic using normal approximation.
 */
export function pValueFromTStat(t: number): number {
  const absT = Math.abs(t);
  const pOneTailed = 1 - normalCdf(absT);
  return Math.min(1.0, Math.max(0.0, 2 * pOneTailed));
}

/**
 * Applies Holm-Bonferroni step-down correction to a list of p-values.
 */
export function holmBonferroniAdjust(pValues: number[]): number[] {
  const n = pValues.length;
  if (n <= 1) return pValues.slice();

  // Pair each p-value with original index
  const indexed = pValues.map((p, idx) => ({ p, idx }));
  indexed.sort((a, b) => a.p - b.p);

  const adjusted: { pAdj: number; idx: number }[] = [];
  let runningMax = 0;

  for (let k = 0; k < n; k++) {
    const rawP = indexed[k].p;
    const factor = n - k;
    const stepAdj = Math.min(1.0, rawP * factor);
    runningMax = Math.max(runningMax, stepAdj);
    adjusted.push({ pAdj: runningMax, idx: indexed[k].idx });
  }

  // Restore original ordering
  adjusted.sort((a, b) => a.idx - b.idx);
  return adjusted.map((a) => Number(a.pAdj.toFixed(6)));
}

export function evaluateDataSnooping(options: EvaluateDataSnoopingOptions): DataSnoopingReport {
  const {
    totalHistoricalTrials,
    sharpeRatio,
    sampleLengthT = 252,
    nominalAlpha = 0.05,
    candidatePValues
  } = options;

  const N = Math.max(1, totalHistoricalTrials);
  const T = Math.max(2, sampleLengthT);
  const years = T / 252;

  // t-statistic for annualized Sharpe ratio: t = SR * sqrt(years)
  const tStatistic = Number((sharpeRatio * Math.sqrt(years)).toFixed(4));
  const rawPValue = Number(pValueFromTStat(tStatistic).toFixed(6));

  const bonferroniAlpha = Number((nominalAlpha / N).toFixed(6));
  const bonferroniAdjustedPValue = Number(Math.min(1.0, rawPValue * N).toFixed(6));

  let holmAdjustedPValue = bonferroniAdjustedPValue;
  if (candidatePValues && candidatePValues.length > 0) {
    const adjustedList = holmBonferroniAdjust(candidatePValues);
    const targetIdx = candidatePValues.indexOf(rawPValue);
    if (targetIdx >= 0) {
      holmAdjustedPValue = adjustedList[targetIdx];
    } else {
      holmAdjustedPValue = adjustedList[0];
    }
  }

  const expectedFalseDiscoveries = Number((N * nominalAlpha).toFixed(2));

  // Haircut Sharpe ratio per Harvey & Liu (2014) / Harvey, Liu, Zhu (2016)
  // Penalizes estimated Sharpe based on log(N) multiple testing trials
  let haircutSharpeRatio = sharpeRatio;
  if (N > 1 && sharpeRatio > 0) {
    const penalty = Math.sqrt(2 * Math.log(N) / years);
    haircutSharpeRatio = Math.max(0, Number((sharpeRatio - penalty).toFixed(4)));
  }

  const isSignificantAfterCorrection = holmAdjustedPValue < nominalAlpha;

  let interpretation = `Data snooping analysis across ${N} total experiment backtests on this dataset. `;
  if (N === 1) {
    interpretation += `Single backtest trial recorded; no family-wise error rate multiple testing penalty applied.`;
  } else {
    interpretation += `With ${N} historical trials, the probability of false discoveries increases (expected false discoveries under null = ${expectedFalseDiscoveries}). `;
    if (isSignificantAfterCorrection) {
      interpretation += `After Holm-Bonferroni correction (p_adj = ${holmAdjustedPValue}), statistical significance holds at alpha=${nominalAlpha}. The haircut Sharpe is ${haircutSharpeRatio.toFixed(2)}.`;
    } else {
      interpretation += `WARNING: After Holm-Bonferroni correction (p_adj = ${holmAdjustedPValue}), the strategy FAILS to maintain statistical significance at alpha=${nominalAlpha} (raw p = ${rawPValue} -> adjusted p = ${holmAdjustedPValue}). Performance may be a spurious artifact of repeated testing.`;
    }
  }

  return {
    totalHistoricalTrials: N,
    nominalAlpha,
    bonferroniAlpha,
    rawPValue,
    bonferroniAdjustedPValue,
    holmAdjustedPValue,
    expectedFalseDiscoveries,
    tStatistic,
    haircutSharpeRatio,
    isSignificantAfterCorrection,
    interpretation,
    academicReferences: [
      "Harvey, C. R., Liu, Y., & Zhu, H. (2016). ... and the Cross-Section of Expected Returns. The Review of Financial Studies, 29(1), 5-68.",
      "Holm, S. (1979). A Simple Sequentially Rejective Multiple Test Procedure. Scandinavian Journal of Statistics, 6(2), 65-70.",
      "Harvey, C. R., & Liu, Y. (2014). Evaluating Trading Strategies. The Journal of Portfolio Management, 40(5), 108-118."
    ]
  };
}
