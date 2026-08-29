import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createLeanTools } from "../../../tool/lean.js";
import { LeanService, DEFAULT_LEAN_CONFIG } from "../service.js";
import { AlgorithmManager, parseStrategyParameters, extractStrategyMetadata } from "../algorithms.js";
import { ExperimentStore, generateParameterGrid } from "../experiments.js";
import { TradeJournalStore } from "../journal.js";
import { listTemplates, getTemplate } from "../templates/index.js";
import type { BacktestRequest, BacktestResult, LeanStatistics } from "../types.js";

const TEST_DIR = join(process.cwd(), "tmp_test_m3_m5_adversarial");

function mockStats(overrides: Partial<LeanStatistics> = {}): LeanStatistics {
  return {
    totalTrades: 40,
    winningTrades: 24,
    losingTrades: 16,
    winRate: 0.6,
    lossRate: 0.4,
    averageWin: 120,
    averageLoss: 80,
    profitLossRatio: 1.5,
    compoundingAnnualReturn: 0.18,
    drawdown: 0.07,
    netProfit: 6400,
    sharpeRatio: 1.75,
    sortinoRatio: 2.2,
    probabilisticSharpeRatio: 0.94,
    expectancy: 0.5,
    totalFees: 40,
    alpha: 0.04,
    beta: 0.08,
    annualStandardDeviation: 0.11,
    annualVariance: 0.0121,
    informationRatio: 1.15,
    trackingError: 0.045,
    raw: {},
    ...overrides
  };
}

describe("Empirical Challenger Suite: Milestones 3, 4, 5 Adversarial Stress", () => {
  let leanService: LeanService;
  let algoManager: AlgorithmManager;
  let expStore: ExperimentStore;
  let jnlStore: TradeJournalStore;
  let tools: ReturnType<typeof createLeanTools>;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const algosDir = join(TEST_DIR, "algorithms");
    const expsDir = join(TEST_DIR, "experiments");
    const jnlsDir = join(TEST_DIR, "journal");
    const runsDir = join(TEST_DIR, "runs");
    const dataDir = join(TEST_DIR, "data");

    await mkdir(algosDir, { recursive: true });
    await mkdir(expsDir, { recursive: true });
    await mkdir(jnlsDir, { recursive: true });
    await mkdir(runsDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });

    leanService = new LeanService(
      {
        ...DEFAULT_LEAN_CONFIG,
        enabled: true,
        algorithmsDir: algosDir,
        experimentsDir: expsDir,
        journalDir: jnlsDir,
        runsDir: runsDir,
        dataDir: dataDir
      },
      TEST_DIR
    );

    algoManager = new AlgorithmManager(algosDir);
    expStore = new ExperimentStore(expsDir);
    jnlStore = new TradeJournalStore(jnlsDir);

    tools = createLeanTools({
      leanService,
      algorithmManager: algoManager,
      experimentStore: expStore,
      journalStore: jnlStore
    });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("1. AI Tools Parameter Validation & Execution Error Resilience", () => {
    it("leanCreateStrategy: rejects invalid creation without code or templateId", async () => {
      const res: any = await tools.leanCreateStrategy.execute!(
        {
          name: "Invalid Empty Strategy"
        } as any,
        {} as any
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/code or valid templateId must be provided/i);
    });

    it("leanCreateStrategy: successfully creates custom Python code strategy", async () => {
      const customCode = `
from AlgorithmImports import *
class CustomTestAlgo(QCAlgorithm):
    """
    Custom Test Algorithm docstring.
    Parameters:
    - lookback: Period lookback (default: 20, range: [10, 50])
    """
    def Initialize(self):
        self.period = int(self.GetParameter("lookback", 20))
`;
      const res: any = await tools.leanCreateStrategy.execute!(
        {
          id: "custom-algo-1",
          name: "Custom Test Algo",
          code: customCode
        } as any,
        {} as any
      );

      expect(res.success).toBe(true);
      expect(res.action).toBe("created");
      expect(res.strategy.id).toBe("custom-algo-1");
      expect(res.strategy.parameters.lookback).toBe(20);
      expect(res.strategy.parameterDefs[0].min).toBe(10);
      expect(res.strategy.parameterDefs[0].max).toBe(50);
    });

    it("leanRunBacktest: handles LeanService execution failure gracefully without unhandled rejection", async () => {
      vi.spyOn(leanService, "runBacktest").mockRejectedValueOnce(
        new Error("Docker daemon connection timed out on socket /var/run/docker.sock")
      );

      const res: any = await tools.leanRunBacktest.execute!(
        {
          strategyName: "FailingBacktest",
          symbol: "EURUSD",
          startDate: "2024-01-01",
          endDate: "2024-01-05"
        } as any,
        {} as any
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("Docker daemon connection timed out");
    });

    it("leanGetResults: returns descriptive error for non-existent backtest ID", async () => {
      const res: any = await tools.leanGetResults.execute!(
        {
          backtestId: "non_existent_bt_id_999"
        } as any,
        {} as any
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("Backtest 'non_existent_bt_id_999' not found");
    });

    it("leanGetResults: handles includeOrders, includeClosedTrades, and includeCharts flags properly", async () => {
      const mockResult: BacktestResult = {
        id: "bt_flags_test",
        request: { strategyName: "FlagStrat", symbol: "EURUSD", startDate: "2024-01-01", endDate: "2024-01-05" },
        status: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        statistics: mockStats(),
        charts: { "Equity": { name: "Equity", unit: "$", values: [{ x: 1, y: 100 }] } },
        orders: [{ id: 1, symbol: "EURUSD", type: "Market", direction: "Buy", quantity: 1000, price: 1.08, status: "Filled", time: "2024-01-02", fee: 1, feeCurrency: "USD", value: 1080 }],
        closedTrades: [{ symbol: "EURUSD", entryTime: "2024-01-02", entryPrice: 1.08, exitTime: "2024-01-02", exitPrice: 1.085, quantity: 1000, profitLoss: 50, totalFees: 2, mae: 0, mfe: 0, duration: "1h" }]
      };

      vi.spyOn(leanService, "getBacktest").mockResolvedValue(mockResult);

      const res1: any = await tools.leanGetResults.execute!(
        {
          backtestId: "bt_flags_test",
          includeOrders: true,
          includeClosedTrades: true,
          includeCharts: true
        } as any,
        {} as any
      );

      expect(res1.success).toBe(true);
      expect(res1.orders).toHaveLength(1);
      expect(res1.closedTrades).toHaveLength(1);
      expect(res1.charts).toBeDefined();

      const res2: any = await tools.leanGetResults.execute!(
        {
          backtestId: "bt_flags_test",
          includeOrders: false,
          includeClosedTrades: false,
          includeCharts: false
        } as any,
        {} as any
      );

      expect(res2.success).toBe(true);
      expect(res2.orders).toBeUndefined();
      expect(res2.closedTrades).toBeUndefined();
      expect(res2.charts).toBeUndefined();
    });

    it("leanOptimize: guards against unbounded combinatorial explosion (> 50 combinations)", async () => {
      const res: any = await tools.leanOptimize.execute!(
        {
          strategyId: "strat-large-grid",
          symbol: "EURUSD",
          startDate: "2024-01-01",
          endDate: "2024-01-05",
          parameterRanges: {
            p1: { min: 1, max: 10, step: 1 }, // 10
            p2: { min: 1, max: 10, step: 1 }  // 10 -> Total 100 combinations
          }
        } as any,
        {} as any
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("Parameter grid has 100 combinations; maximum allowed is 50");
    });

    it("leanResearchIntegrity: handles missing backtest or experiment gracefully", async () => {
      const res: any = await tools.leanResearchIntegrity.execute!(
        {
          monteCarloIterations: 50,
          totalHistoricalTrials: 5
        } as any,
        {} as any
      );

      expect(res.success).toBe(true);
      expect(res.report.dataSnooping.totalHistoricalTrials).toBe(5);
      expect(res.report.methodologyNotice).toContain("evidence-first");
    });

    it("leanJournalEntry: enforces required validation fields for creation", async () => {
      const res: any = await tools.leanJournalEntry.execute!(
        {
          action: "create",
          title: "Incomplete Entry"
          // Missing symbol, direction, entryTime, entryPrice, hypothesis
        } as any,
        {} as any
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("Missing required fields for journal creation");
    });

    it("leanJournalEntry: handles get, update, delete on non-existent entry safely", async () => {
      const getRes: any = await tools.leanJournalEntry.execute!(
        { action: "get", id: "missing-jnl-99" } as any,
        {} as any
      );
      expect(getRes.success).toBe(false);
      expect(getRes.entry).toBeNull();

      const delRes: any = await tools.leanJournalEntry.execute!(
        { action: "delete", id: "missing-jnl-99" } as any,
        {} as any
      );
      expect(delRes.success).toBe(false);

      const updRes: any = await tools.leanJournalEntry.execute!(
        { action: "update", id: "missing-jnl-99", title: "New" } as any,
        {} as any
      );
      expect(updRes.success).toBe(false);
      expect(updRes.error).toContain("not found");
    });

    it("leanFormalizeIdea: rejects non-existent journal entry with descriptive error", async () => {
      const res: any = await tools.leanFormalizeIdea.execute!(
        { journalId: "non_existent_journal_entry" } as any,
        {} as any
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain("Journal entry 'non_existent_journal_entry' not found");
    });
  });

  describe("2. Parameter Grid Sweeps & Edge Cases", () => {
    it("handles float step values with precise decimal rounding", () => {
      const ranges = {
        multiplier: { min: 1.0, max: 2.0, step: 0.25 } // 1.0, 1.25, 1.5, 1.75, 2.0
      };
      const grid = generateParameterGrid(ranges);
      expect(grid.length).toBe(5);
      expect(grid.map((g) => g.multiplier)).toEqual([1.0, 1.25, 1.5, 1.75, 2.0]);
    });

    it("handles negative ranges and single bounds safely without infinite loop", () => {
      const ranges = {
        negativeParam: { min: -10, max: -4, step: 2 },
        zeroStepParam: { min: 5, max: 10, step: 0 },
        invertedParam: { min: 20, max: 10, step: 2 }
      };
      const grid = generateParameterGrid(ranges);
      // negativeParam: -10, -8, -6, -4 (4)
      // zeroStepParam: 5 (1)
      // invertedParam: 20 (1)
      expect(grid.length).toBe(4);
      expect(grid[0].negativeParam).toBe(-10);
      expect(grid[0].zeroStepParam).toBe(5);
      expect(grid[0].invertedParam).toBe(20);
    });

    it("handles 3-dimensional Cartesian products properly", () => {
      const ranges = {
        fast: { min: 10, max: 12, step: 1 }, // 10, 11, 12 (3)
        slow: { min: 20, max: 22, step: 1 }, // 20, 21, 22 (3)
        risk: { min: 0.02, max: 0.04, step: 0.01 } // 0.02, 0.03, 0.04 (3)
      };
      const grid = generateParameterGrid(ranges);
      expect(grid.length).toBe(27);
    });
  });

  describe("3. Experiment Store Lineage & Comparison Robustness", () => {
    it("builds multi-level deep lineage tree (4 levels deep)", async () => {
      const root = await expStore.create({
        id: "exp_root",
        strategyId: "strat_tree",
        hypothesis: "Root hypothesis",
        parameters: { v: 1 },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" }
      });

      const l1 = await expStore.create({
        id: "exp_l1",
        strategyId: "strat_tree",
        parentExperimentId: "exp_root",
        hypothesis: "L1 hypothesis",
        parameters: { v: 2 },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" }
      });

      const l2 = await expStore.create({
        id: "exp_l2",
        strategyId: "strat_tree",
        parentExperimentId: "exp_l1",
        hypothesis: "L2 hypothesis",
        parameters: { v: 3 },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" }
      });

      const l3 = await expStore.create({
        id: "exp_l3",
        strategyId: "strat_tree",
        parentExperimentId: "exp_l2",
        hypothesis: "L3 hypothesis",
        parameters: { v: 4 },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" }
      });

      const tree = await expStore.getLineageTree("exp_root");
      expect(tree).not.toBeNull();
      expect(tree?.experiment.id).toBe("exp_root");
      expect(tree?.children[0].experiment.id).toBe("exp_l1");
      expect(tree?.children[0].children[0].experiment.id).toBe("exp_l2");
      expect(tree?.children[0].children[0].children[0].experiment.id).toBe("exp_l3");
    });

    it("returns null when building lineage tree for non-existent root", async () => {
      const tree = await expStore.getLineageTree("non_existent_exp_root");
      expect(tree).toBeNull();
    });

    it("compares experiments with mismatched parameters and partial results safely", async () => {
      const expA = await expStore.create({
        id: "comp_a",
        strategyId: "strat_comp",
        hypothesis: "Hyp A",
        parameters: { p1: 10, p2: "alpha", onlyInA: true },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" }
      });
      await expStore.setResults("comp_a", {
        inSample: mockStats({ sharpeRatio: 1.5, netProfit: 5000, drawdown: 0.08 }),
        outOfSample: mockStats({ sharpeRatio: 1.0, netProfit: 2000, drawdown: 0.12 })
      });

      const expB = await expStore.create({
        id: "comp_b",
        strategyId: "strat_comp",
        hypothesis: "Hyp B",
        parameters: { p1: 20, p2: "alpha", onlyInB: 99 },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" }
      });
      await expStore.setResults("comp_b", {
        inSample: mockStats({ sharpeRatio: 2.1, netProfit: 9500, drawdown: 0.05 }),
        outOfSample: mockStats({ sharpeRatio: 1.6, netProfit: 4500, drawdown: 0.08 })
      });

      const comp = await expStore.compareExperiments("comp_a", "comp_b");
      expect(comp.parameterDiffs.p1).toEqual({ a: 10, b: 20 });
      expect(comp.parameterDiffs.p2).toBeUndefined(); // Identical
      expect(comp.parameterDiffs.onlyInA).toEqual({ a: true, b: undefined });
      expect(comp.parameterDiffs.onlyInB).toEqual({ a: undefined, b: 99 });

      expect(comp.metricDiffs.isSharpeDiff).toBeCloseTo(0.6, 2);
      expect(comp.metricDiffs.isNetProfitDiff).toBe(4500);
      expect(comp.metricDiffs.isDrawdownDiff).toBeCloseTo(-0.03, 2);

      expect(comp.metricDiffs.oosSharpeDiff).toBeCloseTo(0.6, 2);
      expect(comp.metricDiffs.oosNetProfitDiff).toBe(2500);
      expect(comp.metricDiffs.oosDrawdownDiff).toBeCloseTo(-0.04, 2);
    });

    it("handles corrupted JSON files in experiments directory during list()", async () => {
      await expStore.create({
        id: "valid_exp_1",
        strategyId: "strat_valid",
        hypothesis: "Valid exp",
        parameters: {},
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" }
      });

      // Write corrupted JSON file
      const corruptedPath = join(TEST_DIR, "experiments", "corrupted_exp.json");
      await writeFile(corruptedPath, "{ invalid json corrupt content... ", "utf8");

      const list = await expStore.list();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe("valid_exp_1");
    });
  });

  describe("4. Trade Journal Idea Formalization Heuristics", () => {
    it("formalizes London Breakout when hypothesis references 'asian' and 'breakout'", async () => {
      const entry = await jnlStore.create({
        title: "Asian High Breakout",
        symbol: "EURUSD",
        direction: "long",
        entryTime: "2024-03-01T08:00:00Z",
        entryPrice: 1.0850,
        hypothesis: "Took breakout long as London broke Asian high",
        marketContext: { session: "London" }
      });

      const proposal = await jnlStore.formalizeIdea(entry.id);
      expect(proposal.suggestedTemplateId).toBe("london-breakout");
      expect(proposal.suggestedParameters.asian_end_hour).toBe(7);
      expect(proposal.suggestedRanges.buffer_pips).toBeDefined();
    });

    it("formalizes RSI Mean Reversion when hypothesis mentions 'bollinger' or 'oversold'", async () => {
      const entry = await jnlStore.create({
        title: "Bollinger Band Rebound",
        symbol: "EURUSD",
        direction: "long",
        entryTime: "2024-03-02T14:00:00Z",
        entryPrice: 1.0820,
        hypothesis: "Price pierced outer Bollinger bands on 5m chart, extreme oversold condition",
        marketContext: { session: "NewYork" }
      });

      const proposal = await jnlStore.formalizeIdea(entry.id);
      expect(proposal.suggestedTemplateId).toBe("rsi-mean-reversion");
      expect(proposal.suggestedParameters.bb_period).toBe(20);
      expect(proposal.suggestedRanges.rsi_oversold).toBeDefined();
    });

    it("defaults to EMA Trend Crossover for general trend hypotheses", async () => {
      const entry = await jnlStore.create({
        title: "Moving Average Trend Following",
        symbol: "GBPUSD",
        direction: "long",
        entryTime: "2024-03-03T10:00:00Z",
        entryPrice: 1.2800,
        hypothesis: "Following 4H macro uptrend momentum with dynamic trailing stop"
      });

      const proposal = await jnlStore.formalizeIdea(entry.id);
      expect(proposal.suggestedTemplateId).toBe("ema-cross");
      expect(proposal.suggestedParameters.fast_period).toBe(12);
      expect(proposal.suggestedParameters.slow_period).toBe(26);
    });

    it("handles corrupted JSON in journal directory gracefully during list()", async () => {
      await jnlStore.create({
        id: "valid_jnl_1",
        title: "Valid Trade",
        symbol: "EURUSD",
        direction: "long",
        entryTime: "2024-01-01T00:00:00Z",
        entryPrice: 1.08,
        hypothesis: "Valid trade"
      });

      const corruptedPath = join(TEST_DIR, "journal", "corrupted_jnl.json");
      await writeFile(corruptedPath, "{ corrupted json file ...", "utf8");

      const list = await jnlStore.list();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe("valid_jnl_1");
    });
  });

  describe("5. Python Parameter Parser & Template Validation", () => {
    it("parses diverse GetParameter types including booleans, strings, ints, and floats", () => {
      const code = `
class AdvancedForex(QCAlgorithm):
    """
    Advanced Forex Strategy with multi-type parameters.
    Parameters:
    - lookback: Lookback bars (default: 14, range: [5, 50])
    - threshold: Volatility threshold (default: 0.0025, range: [0.001, 0.01])
    - invert_signals: Signal inversion (default: False)
    - pair_name: Currency pair (default: "EURUSD")
    """
    def Initialize(self):
        self.lookback = int(self.GetParameter("lookback", 14))
        self.threshold = float(self.GetParameter("threshold", 0.0025))
        self.invert = self.GetParameter("invert_signals", False)
        self.pair = self.GetParameter("pair_name", "EURUSD")
`;
      const { parameters, parameterDefs } = parseStrategyParameters(code);
      expect(parameters.lookback).toBe(14);
      expect(parameters.threshold).toBe(0.0025);
      expect(parameters.invert_signals).toBe(false);
      expect(parameters.pair_name).toBe("EURUSD");

      const lookbackDef = parameterDefs.find((p) => p.name === "lookback");
      expect(lookbackDef?.min).toBe(5);
      expect(lookbackDef?.max).toBe(50);
    });

    it("extracts class name and description docstring cleanly", () => {
      const code = `
class MySpecialAlgo(QCAlgorithm):
    """
    Line 1 description of strategy.
    Line 2 details and rules.
    Parameters:
    - p1: Param 1
    """
    def Initialize(self):
        pass
`;
      const meta = extractStrategyMetadata(code);
      expect(meta.className).toBe("MySpecialAlgo");
      expect(meta.description).toContain("Line 1 description of strategy.");
      expect(meta.description).toContain("Line 2 details and rules.");
      expect(meta.description).not.toContain("Parameters:");
    });

    it("verifies all built-in templates load with non-empty code, parameters, and valid syntax", async () => {
      const templates = await listTemplates();
      expect(templates.length).toBe(3);

      for (const t of templates) {
        expect(t.code.length).toBeGreaterThan(100);
        expect(t.code).toContain("QCAlgorithm");
        expect(t.code).toContain("AddForex");
        expect(t.code).toContain("BrokerageName.Oanda");
        expect(Object.keys(t.defaultParameters).length).toBeGreaterThan(0);
        expect(t.parameterDefs.length).toBeGreaterThan(0);
      }
    });
  });
});
