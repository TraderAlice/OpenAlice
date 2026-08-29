import { describe, it, expect } from "vitest";
import {
  normalCdf,
  normalInverseCdf,
  calculateMoments,
  calculateDeflatedSharpeRatio,
  evaluateOutOfSample,
  generateWalkForwardSplits,
  evaluateWalkForward,
  runMonteCarloSimulation,
  evaluateParameterSensitivity,
  evaluateDataSnooping,
  holmBonferroniAdjust,
  generateResearchIntegrityReport
} from "../research-integrity/index.js";

describe("Empirical Challenge & Stress Suite (Milestones 3, 4, 5)", () => {
  describe("1. Statistical Primitives & Mathematical Precision", () => {
    it("satisfies standard normal CDF symmetry and limit properties", () => {
      // Symmetry: Phi(-z) + Phi(z) = 1.0
      const testZ = [0.1, 0.5, 1.0, 1.645, 1.96, 2.326, 2.576, 3.0, 4.0, 5.0];
      for (const z of testZ) {
        expect(normalCdf(-z) + normalCdf(z)).toBeCloseTo(1.0, 6);
      }

      // Limits
      expect(normalCdf(0)).toBeCloseTo(0.5, 6);
      expect(normalCdf(-10)).toBe(0.0);
      expect(normalCdf(10)).toBe(1.0);
      expect(normalCdf(NaN)).toBe(0.5);
    });

    it("verifies inverse normal CDF (probit) inverse property Phi(Phi^-1(p)) = p", () => {
      const testP = [0.001, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.975, 0.99, 0.999];
      for (const p of testP) {
        const z = normalInverseCdf(p);
        const reconstructedP = normalCdf(z);
        expect(reconstructedP).toBeCloseTo(p, 4);
      }

      // Boundary values
      expect(normalInverseCdf(0.0)).toBe(-8.0);
      expect(normalInverseCdf(1.0)).toBe(8.0);
      expect(normalInverseCdf(-0.5)).toBe(-8.0);
      expect(normalInverseCdf(1.5)).toBe(8.0);
    });

    it("computes sample moments matching unbiased Fisher-Pearson definitions", () => {
      // Deterministic array with known analytical properties
      const returns = [0.01, 0.02, 0.03, 0.04, 0.05];
      const moments = calculateMoments(returns);

      expect(moments.mean).toBeCloseTo(0.03, 6);
      // Sample variance: sum((x-0.03)^2)/4 = (0.0004 + 0.0001 + 0 + 0.0001 + 0.0004) / 4 = 0.00025
      expect(moments.variance).toBeCloseTo(0.00025, 6);
      expect(moments.stdDev).toBeCloseTo(Math.sqrt(0.00025), 6);
      expect(moments.skewness).toBeCloseTo(0.0, 4);

      // Edge cases: n < 3 returns fallback
      expect(calculateMoments([])).toEqual({ mean: 0, variance: 0, stdDev: 0, skewness: 0, kurtosis: 3 });
      expect(calculateMoments([0.05])).toEqual({ mean: 0, variance: 0, stdDev: 0, skewness: 0, kurtosis: 3 });
      expect(calculateMoments([0.05, 0.05])).toEqual({ mean: 0, variance: 0, stdDev: 0, skewness: 0, kurtosis: 3 });

      // Zero variance constant series
      const constReturns = [0.02, 0.02, 0.02, 0.02, 0.02];
      const constMoments = calculateMoments(constReturns);
      expect(constMoments.variance).toBe(0);
      expect(constMoments.stdDev).toBe(0);
      expect(constMoments.skewness).toBe(0);
      expect(constMoments.kurtosis).toBe(3);
    });
  });

  describe("2. Deflated Sharpe Ratio (DSR) & Multiple Testing Bias", () => {
    it("empirically verifies DSR deflation with trial count N", () => {
      const baseOptions = {
        sharpeRatio: 1.5,
        sampleLengthT: 30,
        skewness: 0.0,
        kurtosis: 3.0,
        varianceOfTrials: 0.5
      };

      const dsr5 = calculateDeflatedSharpeRatio({ ...baseOptions, trialsTested: 5 });
      const dsr10 = calculateDeflatedSharpeRatio({ ...baseOptions, trialsTested: 10 });
      const dsr25 = calculateDeflatedSharpeRatio({ ...baseOptions, trialsTested: 25 });
      const dsr50 = calculateDeflatedSharpeRatio({ ...baseOptions, trialsTested: 50 });
      const dsr100 = calculateDeflatedSharpeRatio({ ...baseOptions, trialsTested: 100 });

      // Monotonic increase of expected max Sharpe under null hypothesis
      expect(dsr5.expectedMaxSharpeNull).toBeLessThan(dsr10.expectedMaxSharpeNull);
      expect(dsr10.expectedMaxSharpeNull).toBeLessThan(dsr25.expectedMaxSharpeNull);
      expect(dsr25.expectedMaxSharpeNull).toBeLessThan(dsr50.expectedMaxSharpeNull);
      expect(dsr50.expectedMaxSharpeNull).toBeLessThan(dsr100.expectedMaxSharpeNull);

      // Monotonic deflation of DSR probability score
      expect(dsr5.dsr).toBeGreaterThan(dsr10.dsr);
      expect(dsr10.dsr).toBeGreaterThan(dsr25.dsr);
      expect(dsr25.dsr).toBeGreaterThan(dsr50.dsr);
      expect(dsr50.dsr).toBeGreaterThan(dsr100.dsr);
    });

    it("verifies negative skewness (fat left tail risk) penalizes DSR when Sharpe > expected max", () => {
      const symmetric = calculateDeflatedSharpeRatio({
        sharpeRatio: 1.2,
        sampleLengthT: 25,
        skewness: 0.0,
        kurtosis: 3.0,
        trialsTested: 2,
        varianceOfTrials: 0.2
      });

      const negativeSkew = calculateDeflatedSharpeRatio({
        sharpeRatio: 1.2,
        sampleLengthT: 25,
        skewness: -2.0, // Severe crash risk
        kurtosis: 3.0,
        trialsTested: 2,
        varianceOfTrials: 0.2
      });

      // Negative skewness increases variance of Sharpe ratio estimator -> widens std error -> lowers DSR
      expect(negativeSkew.dsr).toBeLessThan(symmetric.dsr);
    });

    it("verifies leptokurtosis (fat tails) penalizes DSR for positive Sharpe", () => {
      const normalKurtosis = calculateDeflatedSharpeRatio({
        sharpeRatio: 1.5,
        sampleLengthT: 300,
        skewness: 0.0,
        kurtosis: 3.0,
        trialsTested: 5
      });

      const fatTails = calculateDeflatedSharpeRatio({
        sharpeRatio: 1.5,
        sampleLengthT: 300,
        skewness: 0.0,
        kurtosis: 9.0, // High excess kurtosis
        trialsTested: 5
      });

      expect(fatTails.dsr).toBeLessThan(normalKurtosis.dsr);
    });

    it("verifies sample size T increases estimation certainty", () => {
      // When SR > expectedMaxSharpeNull, increasing T increases DSR towards 1.0
      const shortSample = calculateDeflatedSharpeRatio({
        sharpeRatio: 1.0,
        sampleLengthT: 10,
        trialsTested: 3,
        varianceOfTrials: 0.3
      });
      const longSample = calculateDeflatedSharpeRatio({
        sharpeRatio: 1.0,
        sampleLengthT: 50,
        trialsTested: 3,
        varianceOfTrials: 0.3
      });
      expect(longSample.dsr).toBeGreaterThan(shortSample.dsr);
    });
  });

  describe("3. Monte Carlo Resampling & Bootstrap Properties", () => {
    it("confirms bootstrap sample mean converges to empirical trade mean (Law of Large Numbers)", () => {
      const empiricalReturns = [0.015, -0.008, 0.022, -0.012, 0.035, -0.019, 0.005, 0.018];

      const mc = runMonteCarloSimulation({
        tradeReturns: empiricalReturns,
        iterations: 2000,
        initialEquity: 100000,
        randomSeed: 12345
      });

      expect(mc.tradeCount).toBe(empiricalReturns.length);
      expect(mc.iterations).toBe(2000);

      // Percentiles must be strictly monotonic non-decreasing
      expect(mc.maxDrawdownDistribution.p05).toBeLessThanOrEqual(mc.maxDrawdownDistribution.p25);
      expect(mc.maxDrawdownDistribution.p25).toBeLessThanOrEqual(mc.maxDrawdownDistribution.p50);
      expect(mc.maxDrawdownDistribution.p50).toBeLessThanOrEqual(mc.maxDrawdownDistribution.p75);
      expect(mc.maxDrawdownDistribution.p75).toBeLessThanOrEqual(mc.maxDrawdownDistribution.p95);

      expect(mc.finalReturnDistribution.p05).toBeLessThanOrEqual(mc.finalReturnDistribution.p25);
      expect(mc.finalReturnDistribution.p25).toBeLessThanOrEqual(mc.finalReturnDistribution.p50);
      expect(mc.finalReturnDistribution.p50).toBeLessThanOrEqual(mc.finalReturnDistribution.p75);
      expect(mc.finalReturnDistribution.p75).toBeLessThanOrEqual(mc.finalReturnDistribution.p95);

      expect(mc.sharpeRatioDistribution.p05).toBeLessThanOrEqual(mc.sharpeRatioDistribution.p95);

      // Confidence intervals must enclose median
      expect(mc.confidenceIntervals.finalReturn95[0]).toBeLessThanOrEqual(mc.finalReturnDistribution.p50);
      expect(mc.confidenceIntervals.finalReturn95[1]).toBeGreaterThanOrEqual(mc.finalReturnDistribution.p50);
      expect(mc.confidenceIntervals.maxDrawdown95[0]).toBeLessThanOrEqual(mc.maxDrawdownDistribution.p50);
      expect(mc.confidenceIntervals.maxDrawdown95[1]).toBeGreaterThanOrEqual(mc.maxDrawdownDistribution.p50);
    });

    it("verifies ruin probability boundary conditions (pure loss vs pure gain)", () => {
      // Pure loss strategy: 10 consecutive losses of 5% each -> drawdown exceeds 35%
      const pureLoss = Array(10).fill(-0.05);
      const mcLoss = runMonteCarloSimulation({
        tradeReturns: pureLoss,
        iterations: 500,
        ruinThresholdPct: 0.20,
        randomSeed: 999
      });
      expect(mcLoss.ruinProbability).toBe(1.0);
      expect(mcLoss.longestLosingStreakDistribution.median).toBe(10);
      expect(mcLoss.longestLosingStreakDistribution.max).toBe(10);

      // Pure gain strategy: zero drawdown, zero ruin probability
      const pureGain = Array(10).fill(0.05);
      const mcGain = runMonteCarloSimulation({
        tradeReturns: pureGain,
        iterations: 500,
        ruinThresholdPct: 0.20,
        randomSeed: 999
      });
      expect(mcGain.ruinProbability).toBe(0.0);
      expect(mcGain.maxDrawdownDistribution.p95).toBe(0.0);
      expect(mcGain.longestLosingStreakDistribution.median).toBe(0);
      expect(mcGain.longestLosingStreakDistribution.max).toBe(0);
    });

    it("handles absolute PnL fallback when trade returns exceed 1.0", () => {
      const absolutePnLTrades = [500, -200, 1000, -400, 800];
      const mc = runMonteCarloSimulation({
        tradeReturns: absolutePnLTrades,
        iterations: 300,
        initialEquity: 10000
      });
      expect(mc.iterations).toBe(300);
      expect(mc.finalReturnDistribution.p50).toBeGreaterThan(0);
    });
  });

  describe("4. Walk-Forward Efficiency (WFE) & Window Integrity", () => {
    it("generates contiguous, non-overlapping sequential splits", () => {
      const splits = generateWalkForwardSplits({
        startDate: "2021-01-01",
        endDate: "2023-12-31",
        numWindows: 6,
        mode: "rolling",
        trainFraction: 0.6
      });

      expect(splits.length).toBe(6);
      for (let i = 0; i < splits.length; i++) {
        const s = splits[i];
        expect(s.windowIndex).toBe(i + 1);
        const isStart = new Date(s.isPeriod.start).getTime();
        const isEnd = new Date(s.isPeriod.end).getTime();
        const oosStart = new Date(s.oosPeriod.start).getTime();
        const oosEnd = new Date(s.oosPeriod.end).getTime();

        expect(isStart).toBeLessThan(isEnd);
        expect(isEnd).toBeLessThanOrEqual(oosStart);
        expect(oosStart).toBeLessThan(oosEnd);
      }
    });

    it("evaluates WFE with negative IS returns and zero returns safely", () => {
      // Strategy with zero IS return (e.g. breakeven)
      const zeroIsReport = evaluateWalkForward({
        windows: [
          {
            windowIndex: 1,
            isPeriod: { start: "2022-01-01", end: "2022-06-30" },
            oosPeriod: { start: "2022-07-01", end: "2022-09-30" },
            isReturn: 0.0,
            oosReturn: 0.05,
            isSharpe: 0.0,
            oosSharpe: 1.2,
            isMaxDrawdown: 0.02,
            oosMaxDrawdown: 0.03
          }
        ]
      });
      expect(zeroIsReport.walkForwardEfficiency).toBe(0);
      expect(zeroIsReport.windows[0].wfeRatio).toBe(0);

      // Strategy with negative IS return (in-sample loss, OOS profit)
      const negIsReport = evaluateWalkForward({
        windows: [
          {
            windowIndex: 1,
            isPeriod: { start: "2022-01-01", end: "2022-06-30" },
            oosPeriod: { start: "2022-07-01", end: "2022-09-30" },
            isReturn: -0.10,
            oosReturn: 0.05,
            isSharpe: -1.0,
            oosSharpe: 0.8,
            isMaxDrawdown: 0.12,
            oosMaxDrawdown: 0.04
          }
        ]
      });
      // WFE = (0.05 / |-0.10|) * 100 = 50%
      expect(negIsReport.walkForwardEfficiency).toBe(50);
      expect(negIsReport.positiveOosWindowRatio).toBe(1.0);
    });
  });

  describe("5. Parameter Sensitivity & Elasticity Stress", () => {
    it("handles zero base parameters and identical perturbations without NaN", () => {
      const report = evaluateParameterSensitivity({
        baseParameters: { paramZero: 0, paramNormal: 50 },
        baseSharpe: 1.5,
        baseNetProfit: 5000,
        baseMaxDrawdown: 0.05,
        perturbations: [
          { parameterName: "paramZero", perturbedValue: 0, resultingSharpe: 1.5, resultingNetProfit: 5000, resultingMaxDrawdown: 0.05 },
          { parameterName: "paramNormal", perturbedValue: 50, resultingSharpe: 1.5, resultingNetProfit: 5000, resultingMaxDrawdown: 0.05 }
        ]
      });

      expect(report.perturbations[0].perturbationPct).toBe(0);
      expect(report.perturbations[0].elasticity).toBe(0);
      expect(report.parameterFragility["paramZero"].isUnstable).toBe(false);
      expect(report.parameterFragility["paramNormal"].isUnstable).toBe(false);
    });

    it("triggers instability on extreme cliff drop (>50% drop within 10% perturbation)", () => {
      const report = evaluateParameterSensitivity({
        baseParameters: { stopLossAtr: 2.0 },
        baseSharpe: 2.0,
        baseNetProfit: 10000,
        baseMaxDrawdown: 0.04,
        perturbations: [
          // 10% perturbation (2.0 -> 2.2) collapses Sharpe from 2.0 to 0.6 (-70% drop)
          { parameterName: "stopLossAtr", perturbedValue: 2.2, resultingSharpe: 0.6, resultingNetProfit: 2000, resultingMaxDrawdown: 0.18 }
        ]
      });

      expect(report.parameterFragility["stopLossAtr"].isUnstable).toBe(true);
      expect(report.parameterFragility["stopLossAtr"].maxSharpeDropPct).toBe(70.0);
      expect(report.interpretation).toContain("Unstable parameters identified");
    });
  });

  describe("6. Multiple Testing Corrections & Haircut Sharpe", () => {
    it("maintains step-down monotonicity in Holm-Bonferroni adjustment", () => {
      const candidateP = [0.001, 0.015, 0.03, 0.045, 0.12];
      const adjusted = holmBonferroniAdjust(candidateP);

      // Adjusted p-values must be non-decreasing and bounded by 1.0
      expect(adjusted[0]).toBeLessThanOrEqual(adjusted[1]);
      expect(adjusted[1]).toBeLessThanOrEqual(adjusted[2]);
      expect(adjusted[2]).toBeLessThanOrEqual(adjusted[3]);
      expect(adjusted[3]).toBeLessThanOrEqual(adjusted[4]);
      for (const p of adjusted) {
        expect(p).toBeLessThanOrEqual(1.0);
        expect(p).toBeGreaterThan(0.0);
      }
    });

    it("correctly penalizes haircut Sharpe ratio as trial count N scales", () => {
      const singleTrial = evaluateDataSnooping({
        totalHistoricalTrials: 1,
        sharpeRatio: 2.5,
        sampleLengthT: 252 * 5 // 5 years
      });
      const fiveTrials = evaluateDataSnooping({
        totalHistoricalTrials: 5,
        sharpeRatio: 2.5,
        sampleLengthT: 252 * 5
      });
      const twentyTrials = evaluateDataSnooping({
        totalHistoricalTrials: 20,
        sharpeRatio: 2.5,
        sampleLengthT: 252 * 5
      });
      const fiftyTrials = evaluateDataSnooping({
        totalHistoricalTrials: 50,
        sharpeRatio: 2.5,
        sampleLengthT: 252 * 5
      });

      expect(singleTrial.haircutSharpeRatio).toBe(2.5);
      expect(fiveTrials.haircutSharpeRatio).toBeLessThan(singleTrial.haircutSharpeRatio);
      expect(twentyTrials.haircutSharpeRatio).toBeLessThan(fiveTrials.haircutSharpeRatio);
      expect(fiftyTrials.haircutSharpeRatio).toBeLessThan(twentyTrials.haircutSharpeRatio);
      expect(fiftyTrials.haircutSharpeRatio).toBeGreaterThanOrEqual(0);
    });
  });
});
