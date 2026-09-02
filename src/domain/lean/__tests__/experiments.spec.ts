import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { ExperimentStore, generateParameterGrid } from "../experiments.js";
import type { LeanStatistics } from "../types.js";

const TEST_DIR = join(process.cwd(), "tmp_test_experiments");

function mockStats(sharpe: number, profit: number, dd: number): LeanStatistics {
  return {
    totalTrades: 20,
    winningTrades: 12,
    losingTrades: 8,
    winRate: 0.6,
    lossRate: 0.4,
    averageWin: 100,
    averageLoss: 80,
    profitLossRatio: 1.25,
    compoundingAnnualReturn: 0.12,
    drawdown: dd,
    netProfit: profit,
    sharpeRatio: sharpe,
    sortinoRatio: sharpe * 1.2,
    probabilisticSharpeRatio: 0.9,
    expectancy: 0.4,
    totalFees: 20,
    alpha: 0.02,
    beta: 0.1,
    annualStandardDeviation: 0.1,
    annualVariance: 0.01,
    informationRatio: 1.0,
    trackingError: 0.04,
    raw: {}
  };
}

describe("LEAN Experiment History & Lineage", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("Parameter Grid Generation", () => {
    it("generates full Cartesian product grid for optimization sweeps", () => {
      const ranges = {
        fast: { min: 10, max: 20, step: 5 }, // 10, 15, 20 (3 values)
        slow: { min: 50, max: 70, step: 10 } // 50, 60, 70 (3 values)
      };
      const grid = generateParameterGrid(ranges);
      expect(grid.length).toBe(9);
      expect(grid[0]).toEqual({ fast: 10, slow: 50 });
      expect(grid[8]).toEqual({ fast: 20, slow: 70 });
    });

    it("handles single-value and empty parameter ranges", () => {
      expect(generateParameterGrid({})).toEqual([{}]);
      const single = generateParameterGrid({ paramA: { min: 5, max: 5, step: 1 } });
      expect(single).toEqual([{ paramA: 5 }]);
    });
  });

  describe("Experiment CRUD & Memory", () => {
    it("creates, persists, and retrieves an experiment", async () => {
      const store = new ExperimentStore(TEST_DIR);
      const exp = await store.create({
        strategyId: "ema-cross-v1",
        hypothesis: "Testing EURUSD EMA cross with 12/26 periods on 1m bars",
        parameters: { fast_period: 12, slow_period: 26 },
        inSamplePeriod: { start: "2020-01-01", end: "2023-12-31" },
        outOfSamplePeriod: { start: "2024-01-01", end: "2024-12-31" },
        tags: ["eurusd", "trend", "ema"]
      });

      expect(exp.id).toBeDefined();
      expect(exp.strategyId).toBe("ema-cross-v1");
      expect(exp.parameters.fast_period).toBe(12);

      const fetched = await store.get(exp.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.hypothesis).toContain("Testing EURUSD EMA cross");
      expect(fetched?.tags).toContain("eurusd");
    });

    it("filters experiments by strategyId and tags", async () => {
      const store = new ExperimentStore(TEST_DIR);
      await store.create({
        id: "exp-1",
        strategyId: "strat-a",
        hypothesis: "Hypothesis A",
        parameters: { p: 1 },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" },
        tags: ["alpha"]
      });

      await store.create({
        id: "exp-2",
        strategyId: "strat-b",
        hypothesis: "Hypothesis B",
        parameters: { p: 2 },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" },
        tags: ["beta"]
      });

      const listA = await store.list({ strategyId: "strat-a" });
      expect(listA.length).toBe(1);
      expect(listA[0].id).toBe("exp-1");

      const listTag = await store.list({ tag: "beta" });
      expect(listTag.length).toBe(1);
      expect(listTag[0].id).toBe("exp-2");
    });

    it("tracks lineage across parent and child experiments", async () => {
      const store = new ExperimentStore(TEST_DIR);
      const parent = await store.create({
        id: "exp-root",
        strategyId: "strat-a",
        hypothesis: "Initial baseline",
        parameters: { fast: 12 },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" }
      });

      const child = await store.create({
        id: "exp-child-1",
        strategyId: "strat-a",
        parentExperimentId: "exp-root",
        hypothesis: "Refining fast period to 9",
        parameters: { fast: 9 },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" }
      });

      const updatedParent = await store.get("exp-root");
      expect(updatedParent?.childExperimentIds).toContain("exp-child-1");

      const tree = await store.getLineageTree("exp-root");
      expect(tree).not.toBeNull();
      expect(tree?.experiment.id).toBe("exp-root");
      expect(tree?.children.length).toBe(1);
      expect(tree?.children[0].experiment.id).toBe("exp-child-1");
    });

    it("compares two experiments and outputs parameter and metric diffs", async () => {
      const store = new ExperimentStore(TEST_DIR);
      const exp1 = await store.create({
        id: "exp-comp-1",
        strategyId: "strat-a",
        hypothesis: "Baseline",
        parameters: { fast: 12, slow: 26 },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" }
      });
      await store.setResults("exp-comp-1", {
        inSample: mockStats(1.5, 5000, 0.08)
      });

      const exp2 = await store.create({
        id: "exp-comp-2",
        strategyId: "strat-a",
        hypothesis: "Tuned",
        parameters: { fast: 9, slow: 26 },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" }
      });
      await store.setResults("exp-comp-2", {
        inSample: mockStats(1.9, 7500, 0.06)
      });

      const comparison = await store.compareExperiments("exp-comp-1", "exp-comp-2");
      expect(comparison.parameterDiffs.fast).toEqual({ a: 12, b: 9 });
      expect(comparison.parameterDiffs.slow).toBeUndefined(); // slow is identical
      expect(comparison.metricDiffs.isSharpeDiff).toBeCloseTo(0.4, 2);
      expect(comparison.metricDiffs.isNetProfitDiff).toBe(2500);
      expect(comparison.metricDiffs.isDrawdownDiff).toBeCloseTo(-0.02, 2);
    });
  });
});
