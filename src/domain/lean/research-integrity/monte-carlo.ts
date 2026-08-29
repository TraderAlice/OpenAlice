import type { MonteCarloPercentiles, MonteCarloReport } from "./types.js";

export interface MonteCarloSimulationOptions {
  tradeReturns: number[]; // e.g. [0.012, -0.005, 0.024, -0.018] or PnL amounts
  iterations?: number; // default 1000
  initialEquity?: number; // default 100000
  ruinThresholdPct?: number; // default 0.20 (20% max drawdown)
  randomSeed?: number;
}

/**
 * Calculates a specific percentile from a sorted array of numbers.
 */
function getPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Builds percentiles structure from a sorted numeric array.
 */
function extractPercentiles(sorted: number[]): MonteCarloPercentiles {
  return {
    p05: Number(getPercentile(sorted, 5).toFixed(4)),
    p25: Number(getPercentile(sorted, 25).toFixed(4)),
    p50: Number(getPercentile(sorted, 50).toFixed(4)),
    p75: Number(getPercentile(sorted, 75).toFixed(4)),
    p95: Number(getPercentile(sorted, 95).toFixed(4)),
    p99: Number(getPercentile(sorted, 99).toFixed(4))
  };
}

/**
 * Pseudo-random generator with optional seed for reproducible Monte Carlo simulation.
 */
function createPrng(seed?: number) {
  let s = seed ?? Math.floor(Math.random() * 2147483647);
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function runMonteCarloSimulation(options: MonteCarloSimulationOptions): MonteCarloReport {
  const {
    tradeReturns,
    iterations = 1000,
    initialEquity = 100000,
    ruinThresholdPct = 0.20,
    randomSeed
  } = options;

  const n = tradeReturns.length;
  if (n === 0) {
    const emptyPercentiles: MonteCarloPercentiles = { p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, p99: 0 };
    return {
      iterations: 0,
      tradeCount: 0,
      initialEquity,
      ruinThresholdPct,
      ruinProbability: 0,
      maxDrawdownDistribution: emptyPercentiles,
      finalReturnDistribution: emptyPercentiles,
      sharpeRatioDistribution: emptyPercentiles,
      longestLosingStreakDistribution: { median: 0, p95: 0, max: 0 },
      confidenceIntervals: { maxDrawdown95: [0, 0], finalReturn95: [0, 0] },
      methodologyAssumptions: ["Insufficient trades for bootstrap resampling"],
      academicReferences: ["Efron, B., & Tibshirani, R. J. (1993). An Introduction to the Bootstrap. CRC Press."]
    };
  }

  const rng = createPrng(randomSeed);
  const maxDrawdowns: number[] = [];
  const finalReturns: number[] = [];
  const sharpeRatios: number[] = [];
  const maxLosingStreaks: number[] = [];
  let ruinCount = 0;

  for (let iter = 0; iter < iterations; iter++) {
    let currentEquity = initialEquity;
    let peakEquity = initialEquity;
    let maxDd = 0;
    let currentLosingStreak = 0;
    let maxStreakInPath = 0;
    const pathReturns: number[] = [];

    for (let t = 0; t < n; t++) {
      const randIdx = Math.floor(rng() * n);
      const ret = tradeReturns[randIdx];
      pathReturns.push(ret);

      if (ret < 0) {
        currentLosingStreak++;
        if (currentLosingStreak > maxStreakInPath) {
          maxStreakInPath = currentLosingStreak;
        }
      } else {
        currentLosingStreak = 0;
      }

      // Update equity based on percentage return (or fractional PnL)
      if (Math.abs(ret) < 1.0) {
        currentEquity *= (1 + ret);
      } else {
        // Absolute PnL fallback
        currentEquity += ret;
      }

      if (currentEquity > peakEquity) {
        peakEquity = currentEquity;
      }

      const dd = peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0;
      if (dd > maxDd) {
        maxDd = dd;
      }
    }

    const finalRet = (currentEquity - initialEquity) / initialEquity;
    maxDrawdowns.push(maxDd);
    finalReturns.push(finalRet);
    maxLosingStreaks.push(maxStreakInPath);

    if (maxDd >= ruinThresholdPct) {
      ruinCount++;
    }

    // Path annualized Sharpe
    const meanRet = pathReturns.reduce((sum, r) => sum + r, 0) / n;
    const varRet = pathReturns.reduce((sum, r) => sum + Math.pow(r - meanRet, 2), 0) / Math.max(1, n - 1);
    const stdRet = Math.sqrt(varRet);
    const pathSharpe = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252) : 0;
    sharpeRatios.push(pathSharpe);
  }

  maxDrawdowns.sort((a, b) => a - b);
  finalReturns.sort((a, b) => a - b);
  sharpeRatios.sort((a, b) => a - b);
  maxLosingStreaks.sort((a, b) => a - b);

  const ruinProbability = Number((ruinCount / iterations).toFixed(4));
  const maxDrawdownDistribution = extractPercentiles(maxDrawdowns);
  const finalReturnDistribution = extractPercentiles(finalReturns);
  const sharpeRatioDistribution = extractPercentiles(sharpeRatios);

  const longestLosingStreakDistribution = {
    median: Math.round(getPercentile(maxLosingStreaks, 50)),
    p95: Math.round(getPercentile(maxLosingStreaks, 95)),
    max: maxLosingStreaks[maxLosingStreaks.length - 1]
  };

  const confidenceIntervals = {
    maxDrawdown95: [
      Number(getPercentile(maxDrawdowns, 2.5).toFixed(4)),
      Number(getPercentile(maxDrawdowns, 97.5).toFixed(4))
    ] as [number, number],
    finalReturn95: [
      Number(getPercentile(finalReturns, 2.5).toFixed(4)),
      Number(getPercentile(finalReturns, 97.5).toFixed(4))
    ] as [number, number]
  };

  return {
    iterations,
    tradeCount: n,
    initialEquity,
    ruinThresholdPct,
    ruinProbability,
    maxDrawdownDistribution,
    finalReturnDistribution,
    sharpeRatioDistribution,
    longestLosingStreakDistribution,
    confidenceIntervals,
    methodologyAssumptions: [
      "IID Assumption: Trade returns are resampled with replacement assuming independent and identically distributed returns.",
      "Serial Correlation Warning: If the strategy exhibits trade autocorrelation or clustering (e.g. regime dependency), standard bootstrap may underestimate drawdown tails.",
      "Execution Stability: Assumes fill execution, slippage, and spread dynamics remain invariant across synthetic sequence orderings."
    ],
    academicReferences: [
      "Efron, B., & Tibshirani, R. J. (1993). An Introduction to the Bootstrap. Chapman and Hall/CRC.",
      "Vinod, H. D. (2004). Ranking Mutual Funds Using Unconventional Strategies and Bootstrap. Journal of Empirical Finance, 11(2), 243-277."
    ]
  };
}
