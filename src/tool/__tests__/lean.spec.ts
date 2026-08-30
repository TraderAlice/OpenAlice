import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createLeanTools } from "../lean.js";
import { LeanService, DEFAULT_LEAN_CONFIG } from "../../domain/lean/service.js";
import { AlgorithmManager } from "../../domain/lean/algorithms.js";
import { ExperimentStore } from "../../domain/lean/experiments.js";
import { TradeJournalStore } from "../../domain/lean/journal.js";
import type { BacktestRequest, BacktestResult, LeanStatistics } from "../../domain/lean/types.js";

const TEST_DIR = join(process.cwd(), "tmp_test_tool_lean");

function mockStats(sharpe = 1.5, profit = 5000): LeanStatistics {
  return {
    totalTrades: 30,
    winningTrades: 18,
    losingTrades: 12,
    winRate: 0.6,
    lossRate: 0.4,
    averageWin: 150,
    averageLoss: 100,
    profitLossRatio: 1.5,
    compoundingAnnualReturn: 0.15,
    drawdown: 0.06,
    netProfit: profit,
    sharpeRatio: sharpe,
    sortinoRatio: sharpe * 1.3,
    probabilisticSharpeRatio: 0.92,
    expectancy: 0.5,
    totalFees: 30,
    alpha: 0.03,
    beta: 0.1,
    annualStandardDeviation: 0.1,
    annualVariance: 0.01,
    informationRatio: 1.1,
    trackingError: 0.04,
    raw: {}
  };
}

describe("LEAN AI Tool Registry", () => {
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

  describe("leanStatus", () => {
    it("reports LEAN GUI readiness, native CLI status, and managed paths", async () => {
      vi.spyOn(leanService, "checkDocker").mockResolvedValueOnce({ available: true, version: "Docker 29.7.2" });
      vi.spyOn(leanService, "checkLeanCli").mockResolvedValueOnce({ available: true, version: "lean 1.0.229" });

      const res: any = await tools.leanStatus.execute!({} as any, {} as any);

      expect(res.success).toBe(true);
      expect(res.enabled).toBe(true);
      expect(res.docker.version).toBe("Docker 29.7.2");
      expect(res.leanCli.version).toBe("lean 1.0.229");
      expect(res.paths.algorithms).toContain("algorithms");
    });
  });

  describe("leanCreateStrategy", () => {
    it("creates a strategy from template via AI tool", async () => {
      const res: any = await tools.leanCreateStrategy.execute!(
        {
          name: "EURUSD EMA Cross",
          templateId: "ema-cross",
          parameters: { fast_period: 10, slow_period: 25 }
        } as any,
        {} as any
      );

      expect(res.success).toBe(true);
      expect(res.action).toBe("created");
      expect(res.strategy.name).toBe("EURUSD EMA Cross");
      expect(res.strategy.parameters.fast_period).toBe(10);
    });

    it("updates an existing strategy if ID is already present", async () => {
      await algoManager.createStrategy({
        id: "strat-test-1",
        name: "Old Name",
        templateId: "ema-cross"
      });

      const res: any = await tools.leanCreateStrategy.execute!(
        {
          id: "strat-test-1",
          name: "New Name",
          parameters: { fast_period: 15 }
        } as any,
        {} as any
      );

      expect(res.success).toBe(true);
      expect(res.action).toBe("updated");
      expect(res.strategy.name).toBe("New Name");
      expect(res.strategy.parameters.fast_period).toBe(15);
    });
  });

  describe("leanRunBacktest & leanGetResults", () => {
    it("runs backtest using LeanService and links to experiment", async () => {
      const exp = await expStore.create({
        strategyId: "strat-1",
        hypothesis: "Testing backtest run",
        parameters: { fast: 12 },
        inSamplePeriod: { start: "2020-01-01", end: "2023-12-31" }
      });

      const mockBacktestResult: BacktestResult = {
        id: "bt_mock_123",
        request: {
          strategyName: "TestStrat",
          symbol: "EURUSD",
          startDate: "2020-01-01",
          endDate: "2023-12-31"
        },
        status: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:01:00Z",
        durationMs: 60000,
        statistics: mockStats(1.8, 6000),
        charts: {},
        orders: [],
        closedTrades: [
          {
            symbol: "EURUSD",
            entryTime: "2020-01-02T10:00:00Z",
            entryPrice: 1.10,
            exitTime: "2020-01-02T14:00:00Z",
            exitPrice: 1.105,
            quantity: 10000,
            profitLoss: 500,
            totalFees: 5,
            mae: 0.001,
            mfe: 0.006,
            duration: "4h"
          }
        ]
      };

      vi.spyOn(leanService, "runBacktest").mockResolvedValueOnce(mockBacktestResult);
      vi.spyOn(leanService, "getBacktest").mockResolvedValueOnce(mockBacktestResult);

      const runRes: any = await tools.leanRunBacktest.execute!(
        {
          strategyName: "TestStrat",
          symbol: "EURUSD",
          startDate: "2020-01-01",
          endDate: "2023-12-31",
          experimentId: exp.id
        } as any,
        {} as any
      );

      expect(runRes.success).toBe(true);
      expect(runRes.backtestId).toBe("bt_mock_123");
      expect(runRes.statistics.sharpeRatio).toBe(1.8);

      const updatedExp = await expStore.get(exp.id);
      expect(updatedExp?.backtestIds).toContain("bt_mock_123");

      const getRes: any = await tools.leanGetResults.execute!(
        {
          backtestId: "bt_mock_123",
          includeClosedTrades: true
        } as any,
        {} as any
      );

      expect(getRes.success).toBe(true);
      expect(getRes.id).toBe("bt_mock_123");
      expect(getRes.closedTrades.length).toBe(1);
    });
  });

  describe("leanOptimize", () => {
    it("runs parameter grid optimization sweep and identifies best parameters", async () => {
      let callCount = 0;
      vi.spyOn(leanService, "runBacktest").mockImplementation(async (req: BacktestRequest) => {
        callCount++;
        const fast = Number(req.parameters?.fast || 10);
        return {
          id: `bt_opt_${callCount}`,
          request: req,
          status: "completed",
          startedAt: "2026-01-01T00:00:00Z",
          statistics: mockStats(fast * 0.1, fast * 500),
          charts: {},
          orders: [],
          closedTrades: []
        };
      });

      const res: any = await tools.leanOptimize.execute!(
        {
          strategyId: "strat-opt",
          symbol: "EURUSD",
          startDate: "2020-01-01",
          endDate: "2022-12-31",
          parameterRanges: {
            fast: { min: 10, max: 20, step: 5 } // 10, 15, 20 (3 combinations)
          }
        } as any,
        {} as any
      );

      expect(res.success).toBe(true);
      expect(res.totalCombinations).toBe(3);
      expect(res.topConfiguration.parameters.fast).toBe(20);
      expect(res.topConfiguration.sharpeRatio).toBeCloseTo(2.0, 1);
    });
  });

  describe("leanResearchIntegrity", () => {
    it("runs statistical integrity evaluation on backtests and experiment", async () => {
      const mockResultIS: BacktestResult = {
        id: "bt_is",
        request: { strategyId: "strat-1", strategyName: "Strat", symbol: "EURUSD", startDate: "2020-01-01", endDate: "2022-12-31" },
        status: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        statistics: mockStats(2.0, 8000),
        charts: {},
        orders: [],
        closedTrades: [
          { symbol: "EURUSD", entryTime: "2020-01-02", entryPrice: 1.1, exitTime: "2020-01-02", exitPrice: 1.11, quantity: 1, profitLoss: 500, totalFees: 0, mae: 0, mfe: 0, duration: "1h" },
          { symbol: "EURUSD", entryTime: "2020-01-03", entryPrice: 1.1, exitTime: "2020-01-03", exitPrice: 1.09, quantity: 1, profitLoss: -200, totalFees: 0, mae: 0, mfe: 0, duration: "1h" }
        ]
      };

      const mockResultOOS: BacktestResult = {
        id: "bt_oos",
        request: { strategyId: "strat-1", strategyName: "Strat", symbol: "EURUSD", startDate: "2023-01-01", endDate: "2024-12-31" },
        status: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        statistics: mockStats(1.4, 4000),
        charts: {},
        orders: [],
        closedTrades: [
          { symbol: "EURUSD", entryTime: "2023-01-02", entryPrice: 1.1, exitTime: "2023-01-02", exitPrice: 1.11, quantity: 1, profitLoss: 300, totalFees: 0, mae: 0, mfe: 0, duration: "1h" }
        ]
      };

      vi.spyOn(leanService, "getBacktest").mockImplementation(async (id: string) => {
        if (id === "bt_is") return mockResultIS;
        if (id === "bt_oos") return mockResultOOS;
        return null;
      });

      const exp = await expStore.create({
        strategyId: "strat-1",
        hypothesis: "Integrity check test",
        parameters: { fast: 12 },
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" }
      });

      const res: any = await tools.leanResearchIntegrity.execute!(
        {
          experimentId: exp.id,
          isBacktestId: "bt_is",
          oosBacktestId: "bt_oos",
          monteCarloIterations: 100,
          totalHistoricalTrials: 10
        } as any,
        {} as any
      );

      expect(res.success).toBe(true);
      expect(res.report.outOfSample.sharpeDegradationPct).toBe(30.0);
      expect(res.report.dataSnooping.totalHistoricalTrials).toBe(10);
      expect(res.report.methodologyNotice).toContain("evidence-first");

      const savedExp = await expStore.get(exp.id);
      expect(savedExp?.researchIntegrity).toBeDefined();
    });
  });

  describe("leanListExperiments", () => {
    it("lists experiments with filtering", async () => {
      await expStore.create({
        strategyId: "strat-x",
        hypothesis: "Test X",
        parameters: {},
        inSamplePeriod: { start: "2020-01-01", end: "2022-12-31" },
        tags: ["tag1"]
      });

      const res: any = await tools.leanListExperiments.execute!(
        {
          strategyId: "strat-x"
        } as any,
        {} as any
      );

      expect(res.success).toBe(true);
      expect(res.count).toBe(1);
      expect(res.experiments[0].strategyId).toBe("strat-x");
    });
  });

  describe("leanJournalEntry & leanFormalizeIdea", () => {
    it("creates, reads, and formalizes journal trade entry", async () => {
      const createRes: any = await tools.leanJournalEntry.execute!(
        {
          action: "create",
          title: "EURUSD Asian Breakout Entry",
          symbol: "EURUSD",
          direction: "long",
          entryTime: "2024-03-01T08:00:00Z",
          entryPrice: 1.0850,
          profitLoss: 350,
          hypothesis: "London open breakout of Asian highs",
          marketContext: { session: "London" }
        } as any,
        {} as any
      );

      expect(createRes.success).toBe(true);
      const journalId = createRes.entry.id;

      const formalizeRes: any = await tools.leanFormalizeIdea.execute!(
        {
          journalId
        } as any,
        {} as any
      );

      expect(formalizeRes.success).toBe(true);
      expect(formalizeRes.proposal.suggestedTemplateId).toBe("london-breakout");
      expect(formalizeRes.proposal.strategyName).toContain("London Breakout");
    });
  });
});
