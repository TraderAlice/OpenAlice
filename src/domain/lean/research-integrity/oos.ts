import type { LeanStatistics } from "../types.js";
import type { OutOfSampleReport } from "./types.js";

/**
 * Standard Normal Cumulative Distribution Function Phi(z).
 */
export function normalCdf(z: number): number {
  if (isNaN(z)) return 0.5;
  if (z < -8) return 0.0;
  if (z > 8) return 1.0;

  // Rational approximation for error function (Abramowitz & Stegun 7.1.26)
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Inverse Standard Normal CDF (Probit function) Phi^-1(p).
 * Acklam's rational approximation.
 */
export function normalInverseCdf(p: number): number {
  if (p <= 0.0) return -8.0;
  if (p >= 1.0) return 8.0;

  const a1 = -3.969683028665376e1;
  const a2 = 2.209460984245205e2;
  const a3 = -2.759285104469687e2;
  const a4 = 1.383577518672690e2;
  const a5 = -3.066479806614716e1;
  const a6 = 2.506628277459239e0;

  const b1 = -5.447609879822406e1;
  const b2 = 1.615858368580409e2;
  const b3 = -1.556989798598866e2;
  const b4 = 6.680131188771972e1;
  const b5 = -1.328068155288572e1;

  const c1 = -7.784894002430293e-3;
  const c2 = -3.223964580411365e-1;
  const c3 = -2.400758277161838e0;
  const c4 = -2.549732539343734e0;
  const c5 = 4.374664141464968e0;
  const c6 = 2.938163982698783e0;

  const d1 = 7.784695709041462e-3;
  const d2 = 3.224671290700398e-1;
  const d3 = 2.445134137142996e0;
  const d4 = 3.754408661907416e0;

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
      (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
    ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
}

/**
 * Calculates sample moments (mean, variance, skewness, kurtosis) from a series of returns.
 */
export function calculateMoments(returns: number[]): {
  mean: number;
  variance: number;
  stdDev: number;
  skewness: number;
  kurtosis: number;
} {
  const n = returns.length;
  if (n < 3) {
    return { mean: 0, variance: 0, stdDev: 0, skewness: 0, kurtosis: 3 };
  }

  const mean = returns.reduce((sum, r) => sum + r, 0) / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;

  for (const r of returns) {
    const diff = r - mean;
    const diff2 = diff * diff;
    m2 += diff2;
    m3 += diff2 * diff;
    m4 += diff2 * diff2;
  }

  const variance = m2 / (n - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    return { mean, variance: 0, stdDev: 0, skewness: 0, kurtosis: 3 };
  }

  // Unbiased / sample skewness and kurtosis
  const skewness = (n * m3) / ((n - 1) * (n - 2) * Math.pow(stdDev, 3));
  const kurtosis = (n * (n + 1) * m4) / ((n - 1) * (n - 2) * (n - 3) * Math.pow(stdDev, 4)) -
    (3 * Math.pow(n - 1, 2)) / ((n - 2) * (n - 3)) + 3;

  return { mean, variance, stdDev, skewness, kurtosis: Math.max(1, kurtosis) };
}

/**
 * Calculates Deflated Sharpe Ratio (DSR) according to Bailey & López de Prado (2014).
 * Adjusts Sharpe ratio for non-normality (skewness, kurtosis), sample length T,
 * and number of multiple trials tested N.
 */
export function calculateDeflatedSharpeRatio(options: {
  sharpeRatio: number;
  sampleLengthT: number;
  skewness?: number;
  kurtosis?: number;
  trialsTested?: number;
  varianceOfTrials?: number;
}): {
  dsr: number;
  expectedMaxSharpeNull: number;
  estimatedSharpe: number;
  sampleLengthT: number;
  skewness: number;
  kurtosis: number;
  trialsTested: number;
} {
  const {
    sharpeRatio,
    sampleLengthT,
    skewness = 0.0,
    kurtosis = 3.0,
    trialsTested = 1,
    varianceOfTrials = 1.0
  } = options;

  const N = Math.max(1, trialsTested);
  const T = Math.max(2, sampleLengthT);
  const gamma = 0.57721566490153286; // Euler-Mascheroni constant

  let expectedMaxSharpeNull = 0.0;
  if (N > 1) {
    // Bailey & López de Prado (2014) equation 8
    const term1 = (1 - gamma) * normalInverseCdf(1 - 1 / N);
    const term2 = gamma * normalInverseCdf(1 - 1 / (N * Math.E));
    expectedMaxSharpeNull = Math.sqrt(varianceOfTrials) * (term1 + term2);
  }

  // Standard error denominator accounting for non-normality (Mertens 2002 / Lo 2002)
  // Var(SR) = (1 - gamma3 * SR + (gamma4 - 1)/4 * SR^2) / (T - 1)
  const varNumerator = 1 - skewness * sharpeRatio + ((kurtosis - 1) / 4) * Math.pow(sharpeRatio, 2);
  const stdError = Math.sqrt(Math.max(0.0001, varNumerator) / (T - 1));

  const zScore = (sharpeRatio - expectedMaxSharpeNull) / stdError;
  const dsr = normalCdf(zScore);

  return {
    dsr: Number(dsr.toFixed(4)),
    expectedMaxSharpeNull: Number(expectedMaxSharpeNull.toFixed(4)),
    estimatedSharpe: Number(sharpeRatio.toFixed(4)),
    sampleLengthT: T,
    skewness: Number(skewness.toFixed(4)),
    kurtosis: Number(kurtosis.toFixed(4)),
    trialsTested: N
  };
}

export interface EvaluateOutOfSampleOptions {
  isStats: LeanStatistics;
  oosStats: LeanStatistics;
  isPeriod: { start: string; end: string };
  oosPeriod: { start: string; end: string };
  parameterCount?: number;
  independentDataPoints?: number;
  returns?: number[];
  trialsTested?: number;
}

export function evaluateOutOfSample(options: EvaluateOutOfSampleOptions): OutOfSampleReport {
  const {
    isStats,
    oosStats,
    isPeriod,
    oosPeriod,
    parameterCount = 4,
    independentDataPoints = 1000,
    returns = [],
    trialsTested = 1
  } = options;

  const isSharpe = isStats.sharpeRatio ?? 0;
  const oosSharpe = oosStats.sharpeRatio ?? 0;
  const sharpeDegradationPct = isSharpe !== 0
    ? Number((((isSharpe - oosSharpe) / Math.abs(isSharpe)) * 100).toFixed(2))
    : 0;

  const isNetProfit = isStats.netProfit ?? 0;
  const oosNetProfit = oosStats.netProfit ?? 0;
  const netProfitDegradationPct = isNetProfit !== 0
    ? Number((((isNetProfit - oosNetProfit) / Math.abs(isNetProfit)) * 100).toFixed(2))
    : 0;

  const isWinRate = isStats.winRate ?? 0;
  const oosWinRate = oosStats.winRate ?? 0;
  const isMaxDrawdown = isStats.drawdown ?? 0;
  const oosMaxDrawdown = oosStats.drawdown ?? 0;

  const parameterToDataRatio = independentDataPoints > 0
    ? Number((parameterCount / independentDataPoints).toFixed(6))
    : 0;

  const moments = returns.length > 3
    ? calculateMoments(returns)
    : { skewness: 0, kurtosis: 3 };

  const sampleT = oosStats.totalTrades > 0 ? oosStats.totalTrades : independentDataPoints;
  const deflatedSharpe = calculateDeflatedSharpeRatio({
    sharpeRatio: oosSharpe,
    sampleLengthT: sampleT,
    skewness: moments.skewness,
    kurtosis: moments.kurtosis,
    trialsTested
  });

  // Evidence-based interpretation
  let interpretation = `In-Sample Sharpe (${isSharpe.toFixed(2)}) degraded by ${sharpeDegradationPct}% to Out-of-Sample Sharpe (${oosSharpe.toFixed(2)}). `;
  if (sharpeDegradationPct > 50) {
    interpretation += `High Sharpe degradation (>50%) indicates significant in-sample curve fitting and overfitting to training noise. `;
  } else if (sharpeDegradationPct > 20) {
    interpretation += `Moderate Sharpe degradation (20-50%) indicates typical market regime variation and mild parameter sensitivity. `;
  } else {
    interpretation += `Low Sharpe degradation (<20%) demonstrates strong generalizability to unseen out-of-sample data. `;
  }

  if (deflatedSharpe.dsr < 0.5) {
    interpretation += `Deflated Sharpe Ratio (DSR = ${(deflatedSharpe.dsr * 100).toFixed(1)}%) is low, meaning after accounting for non-normality and selection bias across ${trialsTested} trials, performance is consistent with the null hypothesis of luck.`;
  } else if (deflatedSharpe.dsr >= 0.95) {
    interpretation += `Deflated Sharpe Ratio (DSR = ${(deflatedSharpe.dsr * 100).toFixed(1)}%) exceeds the 95% statistical significance threshold, indicating genuine quantitative edge.`;
  }

  return {
    isPeriod,
    oosPeriod,
    isSharpe,
    oosSharpe,
    sharpeDegradationPct,
    isNetProfit,
    oosNetProfit,
    netProfitDegradationPct,
    isWinRate,
    oosWinRate,
    isMaxDrawdown,
    oosMaxDrawdown,
    parameterCount,
    independentDataPoints,
    parameterToDataRatio,
    deflatedSharpeRatio: deflatedSharpe,
    interpretation,
    academicReferences: [
      "Bailey, D. H., & López de Prado, M. (2014). The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting, and Non-Normality. The Journal of Portfolio Management, 40(5), 94-107.",
      "Lo, A. W. (2002). The Statistics of Sharpe Ratios. Financial Analysts Journal, 58(4), 36-52."
    ]
  };
}
