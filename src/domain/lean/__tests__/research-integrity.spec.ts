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
import type { LeanStatistics } from "../types.js";

function mockLeanStats(overrides: Partial<LeanStatistics> = {}): LeanStatistics {
  return {
    totalTrades: 50,
    winningTrades: 30,
    losingTrades: 20,
    winRate: 0.60,
    lossRate: 0.40,
    averageWin: 150,
    averageLoss: 100,
    profitLossRatio: 1.5,
    compoundingAnnualReturn: 0.15,
    drawdown: 0.08,
    netProfit: 2500,
    sharpeRatio: 1.8,
    sortinoRatio: 2.1,
    probabilisticSharpeRatio: 0.95,
    expectancy: 0.5,
    totalFees: 50,
    alpha: 0.05,
    beta: 0.1,
    annualStandardDeviation: 0.12,
    annualVariance: 0.0144,
    informationRatio: 1.2,
    trackingError: 0.05,
    raw: {},
    ...overrides
  };
}

describe("Research Integrity Engine (Evidence-First)", () => {
  describe("Statistical Primitives", () => {
    it("computes standard normal CDF correctly at key quantiles", () => {
      expect(normalCdf(0)).toBeCloseTo(0.5, 4);
      expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
      expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
      expect(normalCdf(2.576)).toBeCloseTo(0.995, 3);
    });

    it("computes inverse normal CDF (probit) accurately", () => {
      expect(normalInverseCdf(0.5)).toBeCloseTo(0.0, 4);
      expect(normalInverseCdf(0.975)).toBeCloseTo(1.96, 2);
      expect(normalInverseCdf(0.025)).toBeCloseTo(-1.96, 2);
    });

    it("calculates empirical return moments (mean, skewness, kurtosis)", () => {
      const symmetricReturns = [-0.02, -0.01, 0, 0.01, 0.02];
      const symMoments = calculateMoments(symmetricReturns);
      expect(symMoments.mean).toBeCloseTo(0, 4);
      expect(symMoments.skewness).toBeCloseTo(0, 1);

      // Positively skewed series
      const rightSkewed = [-0.01, -0.01, -0.01, 0.05, 0.10];
      const rightMoments = calculateMoments(rightSkewed);
      expect(rightMoments.skewness).toBeGreaterThan(0);
    });
  });

  describe("Out-of-Sample (OOS) & Deflated Sharpe Ratio (DSR)", () => {
    it("calculates Deflated Sharpe Ratio with selection bias and non-normality", () => {
      // 1 trial: DSR equals standard Probabilistic Sharpe Ratio
      const singleTrial = calculateDeflatedSharpeRatio({
        sharpeRatio: 1.5,
        sampleLengthT: 250,
        trialsTested: 1
      });
      expect(singleTrial.expectedMaxSharpeNull).toBe(0);
      expect(singleTrial.dsr).toBeGreaterThan(0.90);

      // 100 trials: expected max Sharpe under null increases, DSR deflates
      const multiTrial = calculateDeflatedSharpeRatio({
        sharpeRatio: 1.5,
        sampleLengthT: 250,
        trialsTested: 100,
        varianceOfTrials: 0.5
      });
      expect(multiTrial.expectedMaxSharpeNull).toBeGreaterThan(0.5);
      expect(multiTrial.dsr).toBeLessThan(singleTrial.dsr);
    });

    it("evaluates in-sample vs out-of-sample degradation", () => {
      const isStats = mockLeanStats({ sharpeRatio: 2.0, netProfit: 10000, drawdown: 0.05 });
      const oosStats = mockLeanStats({ sharpeRatio: 1.2, netProfit: 4000, drawdown: 0.09 });

      const report = evaluateOutOfSample({
        isStats,
        oosStats,
        isPeriod: { start: "2020-01-01", end: "2022-12-31" },
        oosPeriod: { start: "2023-01-01", end: "2024-12-31" },
        parameterCount: 5,
        independentDataPoints: 1250,
        trialsTested: 10
      });

      expect(report.isSharpe).toBe(2.0);
      expect(report.oosSharpe).toBe(1.2);
      expect(report.sharpeDegradationPct).toBe(40.0);
      expect(report.parameterToDataRatio).toBe(5 / 1250);
      expect(report.interpretation).toContain("Moderate Sharpe degradation");
      expect(report.academicReferences.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Walk-Forward Analysis (WFA)", () => {
    it("generates rolling and anchored window splits", () => {
      const splitsRolling = generateWalkForwardSplits({
        startDate: "2020-01-01",
        endDate: "2024-12-31",
        numWindows: 4,
        mode: "rolling"
      });
      expect(splitsRolling.length).toBe(4);
      expect(splitsRolling[0].windowIndex).toBe(1);
      expect(new Date(splitsRolling[0].isPeriod.start).getTime()).toBeLessThan(
        new Date(splitsRolling[0].oosPeriod.start).getTime()
      );

      const splitsAnchored = generateWalkForwardSplits({
        startDate: "2020-01-01",
        endDate: "2024-12-31",
        numWindows: 3,
        mode: "anchored"
      });
      expect(splitsAnchored.length).toBe(3);
      expect(splitsAnchored[0].isPeriod.start).toBe(splitsAnchored[1].isPeriod.start);
    });

    it("evaluates Walk-Forward Efficiency (WFE) across multiple windows", () => {
      const windows = [
        {
          windowIndex: 1,
          isPeriod: { start: "2020-01-01", end: "2020-12-31" },
          oosPeriod: { start: "2021-01-01", end: "2021-06-30" },
          isReturn: 0.20,
          oosReturn: 0.14,
          isSharpe: 1.8,
          oosSharpe: 1.4,
          isMaxDrawdown: 0.05,
          oosMaxDrawdown: 0.06
        },
        {
          windowIndex: 2,
          isPeriod: { start: "2020-07-01", end: "2021-06-30" },
          oosPeriod: { start: "2021-07-01", end: "2021-12-31" },
          isReturn: 0.18,
          oosReturn: 0.11,
          isSharpe: 1.6,
          oosSharpe: 1.2,
          isMaxDrawdown: 0.06,
          oosMaxDrawdown: 0.07
        }
      ];

      const report = evaluateWalkForward({ windows, mode: "rolling" });
      expect(report.aggregateIsReturn).toBeCloseTo(0.38, 2);
      expect(report.aggregateOosReturn).toBeCloseTo(0.25, 2);
      expect(report.walkForwardEfficiency).toBeCloseTo(65.79, 1);
      expect(report.positiveOosWindowRatio).toBe(1.0);
      expect(report.maxOosDrawdown).toBe(0.07);
    });
  });

  describe("Monte Carlo Simulation", () => {
    it("runs bootstrap trade return resampling and computes distributions", () => {
      const trades = [0.02, -0.01, 0.03, -0.015, 0.025, -0.008, 0.04, -0.02, 0.01, -0.005];
      const mc = runMonteCarloSimulation({
        tradeReturns: trades,
        iterations: 500,
        initialEquity: 100000,
        ruinThresholdPct: 0.25,
        randomSeed: 42
      });

      expect(mc.iterations).toBe(500);
      expect(mc.tradeCount).toBe(10);
      expect(mc.ruinProbability).toBeLessThan(0.05); // Strategy is profitable
      expect(mc.maxDrawdownDistribution.p50).toBeGreaterThanOrEqual(0);
      expect(mc.finalReturnDistribution.p50).toBeGreaterThan(0);
      expect(mc.longestLosingStreakDistribution.median).toBeGreaterThanOrEqual(1);
      expect(mc.confidenceIntervals.finalReturn95[0]).toBeLessThan(mc.confidenceIntervals.finalReturn95[1]);
      expect(mc.methodologyAssumptions.length).toBeGreaterThan(0);
    });

    it("handles empty trade list safely", () => {
      const mc = runMonteCarloSimulation({ tradeReturns: [] });
      expect(mc.iterations).toBe(0);
      expect(mc.ruinProbability).toBe(0);
    });
  });

  describe("Parameter Sensitivity", () => {
    it("computes elasticity and detects fragile parameter peaks", () => {
      const baseParams = { fast_period: 12, slow_period: 26 };
      const perturbations = [
        { parameterName: "fast_period", perturbedValue: 13.2, resultingSharpe: 1.6, resultingNetProfit: 9000, resultingMaxDrawdown: 0.06 },
        { parameterName: "fast_period", perturbedValue: 10.8, resultingSharpe: 1.5, resultingNetProfit: 8500, resultingMaxDrawdown: 0.07 },
        { parameterName: "slow_period", perturbedValue: 28.6, resultingSharpe: 0.2, resultingNetProfit: 1000, resultingMaxDrawdown: 0.25 }, // Sudden collapse!
        { parameterName: "slow_period", perturbedValue: 23.4, resultingSharpe: 1.6, resultingNetProfit: 9100, resultingMaxDrawdown: 0.05 }
      ];

      const report = evaluateParameterSensitivity({
        baseParameters: baseParams,
        baseSharpe: 1.8,
        baseNetProfit: 10000,
        baseMaxDrawdown: 0.05,
        perturbations
      });

      expect(report.parameterFragility["slow_period"].isUnstable).toBe(true);
      expect(report.parameterFragility["fast_period"].isUnstable).toBe(false);
      expect(report.interpretation).toContain("Unstable parameters identified");
    });
  });

  describe("Data Snooping & Multiple Testing Corrections", () => {
    it("applies Holm-Bonferroni correction to multiple strategy p-values", () => {
      const rawP = [0.01, 0.04, 0.03, 0.10];
      const adjusted = holmBonferroniAdjust(rawP);
      expect(adjusted[0]).toBeCloseTo(0.04, 2); // 0.01 * 4
      expect(adjusted[2]).toBeCloseTo(0.09, 2); // 0.03 * 3
    });

    it("evaluates data snooping penalty and haircut Sharpe for N trials", () => {
      const single = evaluateDataSnooping({
        totalHistoricalTrials: 1,
        sharpeRatio: 2.2,
        sampleLengthT: 252 * 2 // 2 years
      });
      expect(single.haircutSharpeRatio).toBe(2.2);
      expect(single.isSignificantAfterCorrection).toBe(true);

      const heavySnooping = evaluateDataSnooping({
        totalHistoricalTrials: 50,
        sharpeRatio: 0.8,
        sampleLengthT: 252 * 2
      });
      expect(heavySnooping.expectedFalseDiscoveries).toBe(2.5);
      expect(heavySnooping.haircutSharpeRatio).toBeLessThan(0.8);
      expect(heavySnooping.bonferroniAdjustedPValue).toBeGreaterThan(heavySnooping.rawPValue);
    });
  });

  describe("Unified Research Integrity Report", () => {
    it("combines all research integrity modules into evidence-rich report", () => {
      const isStats = mockLeanStats({ sharpeRatio: 1.8 });
      const oosStats = mockLeanStats({ sharpeRatio: 1.4 });

      const report = generateResearchIntegrityReport({
        experimentId: "exp-123",
        strategyId: "strat-abc",
        oosOptions: {
          isStats,
          oosStats,
          isPeriod: { start: "2020-01-01", end: "2022-12-31" },
          oosPeriod: { start: "2023-01-01", end: "2024-12-31" },
          trialsTested: 5
        },
        dataSnoopingOptions: {
          totalHistoricalTrials: 5,
          sharpeRatio: 1.4
        }
      });

      expect(report.experimentId).toBe("exp-123");
      expect(report.outOfSample).toBeDefined();
      expect(report.dataSnooping).toBeDefined();
      expect(report.summaryFindings.length).toBe(2);
      expect(report.methodologyNotice).toContain("evidence-first");
    });
  });
});
