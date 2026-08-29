import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { LeanService, DEFAULT_LEAN_CONFIG } from "../service.js";

describe("LeanService", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "lean-svc-test-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns null on LeanService.create() when enabled: false and not forced", async () => {
    const configDir = join(tempRoot, "data/config");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "lean.json"), JSON.stringify({ enabled: false }), "utf8");

    const svc = await LeanService.create({ projectRoot: tempRoot });
    expect(svc).toBeNull();
  });

  it("creates service when enabled in lean.json config file", async () => {
    const configDir = join(tempRoot, "data/config");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "lean.json"), JSON.stringify({ enabled: true }), "utf8");

    const svc = await LeanService.create({ projectRoot: tempRoot });
    expect(svc).not.toBeNull();
    expect(svc?.enabled).toBe(true);
  });

  it("initializes directories and auxiliary DBs when forced", async () => {
    const svc = await LeanService.create({
      projectRoot: tempRoot,
      force: true
    });
    expect(svc).not.toBeNull();
    expect(existsSync(join(tempRoot, "data/lean/data/market-hours/market-hours-database.json"))).toBe(true);
    expect(existsSync(join(tempRoot, "data/lean/data/symbol-properties/symbol-properties-database.csv"))).toBe(true);
    expect(existsSync(join(tempRoot, "data/lean/runs"))).toBe(true);
    expect(existsSync(join(tempRoot, "data/lean/algorithms"))).toBe(true);
    expect(existsSync(join(tempRoot, "data/lean/experiments"))).toBe(true);
    expect(existsSync(join(tempRoot, "data/lean/journal"))).toBe(true);

    expect(svc?.dataPath).toBe(join(tempRoot, "data/lean/data"));
    expect(svc?.runsPath).toBe(join(tempRoot, "data/lean/runs"));
    expect(svc?.algorithmsPath).toBe(join(tempRoot, "data/lean/algorithms"));
  });

  it("ingests forex quotes using service.ingestForexQuotes", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    const quotes = [
      {
        timestamp: "2024-01-02T00:00:00.000Z",
        bidOpen: 1.08500, bidHigh: 1.08520, bidLow: 1.08495, bidClose: 1.08510,
        askOpen: 1.08515, askHigh: 1.08535, askLow: 1.08510, askClose: 1.08525
      }
    ];

    const res = await svc.ingestForexQuotes("EURUSD", quotes, "oanda", "minute");
    expect(res.daysProcessed).toBe(1);
    expect(res.filesWritten).toHaveLength(1);
    expect(existsSync(res.filesWritten[0])).toBe(true);
  });

  it("checks Docker availability", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    const result = await svc.checkDocker();
    expect(typeof result.available).toBe("boolean");
  });

  it("executes backtest, writes config.json, and parses summary", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    // Mock executeSubprocess
    vi.spyOn(svc as any, "executeSubprocess").mockImplementation(async (...args: any[]) => {
      // Locate results directory mount from args
      const argv = args[1] as string[];
      const resultsDir = argv[argv.indexOf("-v") + 7].split(":")[0];
      const sampleResult = {
        Statistics: {
          "Total Trades": "5",
          "Sharpe Ratio": "1.8",
          "Drawdown": "2.5%",
          "Net Profit": "$1,200.00"
        },
        RuntimeStatistics: {
          "Equity": "$101,200.00"
        }
      };
      await writeFile(join(resultsDir, "results.json"), JSON.stringify(sampleResult), "utf8");
      return { exitCode: 0, stdout: "LEAN Backtesting Complete", stderr: "", timedOut: false };
    });

    const res = await svc.runBacktest({
      strategyName: "MockStrategy",
      symbol: "EURUSD",
      startDate: "2024-01-01",
      endDate: "2024-01-05",
      pythonCode: "class MockStrategy(QCAlgorithm):\n    pass\n"
    });

    expect(res.status).toBe("completed");
    expect(res.statistics?.totalTrades).toBe(5);
    expect(res.statistics?.sharpeRatio).toBe(1.8);
    expect(res.statistics?.netProfit).toBe(1200);

    // Verify backtest can be retrieved
    const fetched = await svc.getBacktest(res.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(res.id);

    const list = await svc.listBacktests();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(res.id);
    expect(list[0].netProfit).toBe(1200);
  });

  it("loads existing algorithm file when strategyId is specified", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    await writeFile(
      join(svc.algorithmsPath, "stored_strategy.py"),
      "# Stored strategy python code\n",
      "utf8"
    );

    vi.spyOn(svc as any, "executeSubprocess").mockImplementation(async (...args: any[]) => {
      const argv = args[1] as string[];
      const resultsDir = argv[argv.indexOf("-v") + 7].split(":")[0];
      await writeFile(join(resultsDir, "results.json"), JSON.stringify({ Statistics: { "Total Trades": "0" } }), "utf8");
      return { exitCode: 0, stdout: "Success", stderr: "", timedOut: false };
    });

    const res = await svc.runBacktest({
      strategyId: "stored_strategy",
      strategyName: "StoredStrategy",
      symbol: "EURUSD",
      startDate: "2024-01-01",
      endDate: "2024-01-05"
    });

    expect(res.status).toBe("completed");
    const algoContent = await readFile(join(res.runDir!, "main.py"), "utf8");
    expect(algoContent).toContain("Stored strategy python code");
  });

  it("handles backtest non-zero exit code failure", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    vi.spyOn(svc as any, "executeSubprocess").mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "SyntaxError in strategy.py",
      timedOut: false
    });

    const res = await svc.runBacktest({
      strategyName: "FailingStrategy",
      symbol: "EURUSD",
      startDate: "2024-01-01",
      endDate: "2024-01-05"
    });

    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/exited with code 1/);
  });

  it("handles backtest execution timeout", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    vi.spyOn(svc as any, "executeSubprocess").mockResolvedValue({
      exitCode: -1,
      stdout: "",
      stderr: "Process terminated",
      timedOut: true
    });

    const res = await svc.runBacktest({
      strategyName: "TimeoutStrategy",
      symbol: "EURUSD",
      startDate: "2024-01-01",
      endDate: "2024-01-05",
      timeoutSeconds: 10
    });

    expect(res.status).toBe("timeout");
    expect(res.error).toMatch(/timed out after 10s/);
  });

  it("handles empty or missing backtests in listBacktests and getBacktest", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    const fetched = await svc.getBacktest("non_existent_id");
    expect(fetched).toBeNull();

    const list = await svc.listBacktests();
    expect(list).toEqual([]);
  });
});
