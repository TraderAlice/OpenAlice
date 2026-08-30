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

  it("checks native LEAN CLI availability", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    const result = await svc.checkLeanCli();
    expect(typeof result.available).toBe("boolean");
  });

  it("executes backtest via the native LEAN CLI, writes summary, and parses results", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    vi.spyOn(svc as any, "resolveExecutor").mockResolvedValue("lean-cli");
    vi.spyOn(svc as any, "executeSubprocess").mockImplementation(async (...args: any[]) => {
      const argv = args[1] as string[];
      expect(argv[0]).toBe("backtest");
      expect(argv[1]).toBe(".");
      const opts = args[3] as { cwd?: string; env?: Record<string, string> };
      expect(opts.cwd).toContain("project");
      expect(opts.env?.TMPDIR).toContain("data/lean/tmp");
      const resultsDir = argv[argv.indexOf("--output") + 1];
      const sampleResult = {
        statistics: {
          "Total Trades": "5",
          "Sharpe Ratio": "1.8",
          "Drawdown": "2.5%",
          "Net Profit": "$1,200.00"
        },
        runtimeStatistics: {
          "Equity": "$101,200.00"
        },
        totalPerformance: {
          tradeStatistics: { totalNumberOfTrades: 5, totalProfitLoss: "1200" }
        },
        orders: {},
        charts: {}
      };
      await writeFile(join(resultsDir, "202401.json"), JSON.stringify(sampleResult), "utf8");
      return { exitCode: 0, stdout: "LEAN Backtesting Complete", stderr: "", timedOut: false };
    });

    const res = await svc.runBacktest({
      strategyName: "Mock Strategy",
      symbol: "EURUSD",
      startDate: "2024-01-01",
      endDate: "2024-01-05",
      pythonCode: "class MockStrategy(QCAlgorithm):\n    pass\n"
    });

    expect(res.status).toBe("completed");
    expect(res.statistics?.totalTrades).toBe(5);
    expect(res.statistics?.sharpeRatio).toBe(1.8);
    expect(res.statistics?.netProfit).toBe(1200);

    const leanJsonPath = join(res.runDir!, "project", "lean.json");
    expect(existsSync(leanJsonPath)).toBe(true);
    const leanConfig = JSON.parse(await readFile(leanJsonPath, "utf8"));
    expect(leanConfig["organization-id"]).toBe("a1ce0000000000000000000000000001");
    expect(leanConfig["algorithm-type-name"]).toBe("main");
    expect(leanConfig["data-folder"]).toBe(join(tempRoot, "data/lean/data"));

    // Verify backtest can be retrieved
    const fetched = await svc.getBacktest(res.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(res.id);

    const list = await svc.listBacktests();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(res.id);
    expect(list[0].netProfit).toBe(1200);
  });

  it("falls back to the internal Docker runner when the LEAN CLI is absent", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    vi.spyOn(svc as any, "resolveExecutor").mockResolvedValue("docker");

    let dockerInvoked = false;
    vi.spyOn(svc as any, "executeSubprocess").mockImplementation(async (...args: any[]) => {
      const cmd = args[0] as string;
      expect(cmd).toBe("docker");
      const argv = args[1] as string[];
      const resultsDir = argv[argv.indexOf("-v") + 7].split(":")[0];
      dockerInvoked = true;
      await writeFile(join(resultsDir, "results.json"), JSON.stringify({ Statistics: { "Total Trades": "3" } }), "utf8");
      return { exitCode: 0, stdout: "Docker run complete", stderr: "", timedOut: false };
    });

    const res = await svc.runBacktest({
      strategyName: "DockerFallback",
      symbol: "EURUSD",
      startDate: "2024-01-01",
      endDate: "2024-01-05"
    });

    expect(dockerInvoked).toBe(true);
    expect(res.status).toBe("completed");
    expect(res.statistics?.totalTrades).toBe(3);
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

    vi.spyOn(svc as any, "resolveExecutor").mockResolvedValue("lean-cli");
    vi.spyOn(svc as any, "executeSubprocess").mockImplementation(async (...args: any[]) => {
      const argv = args[1] as string[];
      const resultsDir = argv[argv.indexOf("--output") + 1];
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
    const projectAlgo = await readFile(join(res.runDir!, "project", "main.py"), "utf8");
    expect(projectAlgo).toContain("Stored strategy python code");
  });

  it("handles backtest non-zero exit code failure", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    vi.spyOn(svc as any, "resolveExecutor").mockResolvedValue("lean-cli");
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

  it("treats a non-zero exit with real results as completed with a data-quality note", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    vi.spyOn(svc as any, "resolveExecutor").mockResolvedValue("lean-cli");
    vi.spyOn(svc as any, "executeSubprocess").mockImplementation(async (...args: any[]) => {
      const argv = args[1] as string[];
      const resultsDir = argv[argv.indexOf("--output") + 1];
      const fullResult = {
        statistics: {},
        runtimeStatistics: { Equity: "$108,000.00" },
        totalPerformance: {
          tradeStatistics: { totalNumberOfTrades: 4, winRate: "0.75", totalProfitLoss: "8000" }
        },
        orders: {},
        charts: {}
      };
      const summaryResult = {
        statistics: { "Total Trades": "4", "Net Profit": "$8,000.00" }
      };
      await writeFile(join(resultsDir, "12345.json"), JSON.stringify(fullResult), "utf8");
      await writeFile(join(resultsDir, "12345-summary.json"), JSON.stringify(summaryResult), "utf8");
      return { exitCode: 1, stdout: "", stderr: "", timedOut: false };
    });

    const res = await svc.runBacktest({
      strategyName: "WarningStrategy",
      symbol: "EURUSD",
      startDate: "2024-01-01",
      endDate: "2024-01-05"
    });

    expect(res.status).toBe("completed");
    expect(res.error).toMatch(/completed with exit code 1/);
    expect(res.statistics?.totalTrades).toBe(4);
    expect(res.statistics?.netProfit).toBe(8000);
    expect(res.statistics?.winRate).toBeCloseTo(0.75);
    expect(res.runtimeStatistics?.equity).toBe(108000);
  });

  it("handles backtest execution timeout and sweeps engine containers", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    let sweepFired = false;
    vi.spyOn(svc as any, "resolveExecutor").mockResolvedValue("lean-cli");
    vi.spyOn(svc as any, "executeSubprocess").mockImplementation(async (...args: any[]) => {
      const opts = args[3] as { onTimeout?: () => void };
      opts.onTimeout?.();
      sweepFired = true;
      return { exitCode: -1, stdout: "", stderr: "Process terminated", timedOut: true };
    });

    const res = await svc.runBacktest({
      strategyName: "TimeoutStrategy",
      symbol: "EURUSD",
      startDate: "2024-01-01",
      endDate: "2024-01-05",
      timeoutSeconds: 10
    });

    expect(sweepFired).toBe(true);
    expect(res.status).toBe("timeout");
    expect(res.error).toMatch(/timed out after 10s/);
  });

  it("sweeps only engine containers created inside the run window", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    const removed: string[] = [];
    let inspectCalls = 0;
    vi.spyOn(svc as any, "executeSubprocess").mockImplementation(async (...args: any[]) => {
      const argv = args[1] as string[];
      if (argv[0] === "ps") {
        return { exitCode: 0, stdout: "abc123\ndef456\n", stderr: "", timedOut: false };
      }
      if (argv[0] === "inspect") {
        inspectCalls++;
        const id = argv[argv.length - 1];
        return {
          exitCode: 0,
          stdout: id === "abc123" ? "2025-01-01T00:00:00Z" : new Date().toISOString(),
          stderr: "",
          timedOut: false
        };
      }
      if (argv[0] === "rm") {
        removed.push(argv[argv.length - 1]);
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      }
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    });

    await (svc as any).sweepEngineContainers("quantconnect/lean:latest", Date.now() - 5000);
    expect(inspectCalls).toBe(2);
    expect(removed).toEqual(["def456"]);
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
