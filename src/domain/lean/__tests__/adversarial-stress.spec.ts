import { describe, expect, it } from "vitest";
import { generateLeanConfig, serializeLeanConfig } from "../config-gen.js";
import { parseCurrency, parseLeanResults, parseNumber, parsePercent } from "../results.js";
import { LeanService, DEFAULT_LEAN_CONFIG } from "../service.js";
import type { BacktestRequest } from "../types.js";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Adversarial Stress Testing: Results Parser, Config Generator & LeanService", () => {
  const dummyRequest: BacktestRequest = {
    strategyName: "StressStrategy",
    symbol: "EURUSD",
    startDate: "2024-01-01",
    endDate: "2024-01-05"
  };

  describe("1. Helper Parsers Stress & Edge Cases", () => {
    it("handles extreme numbers, invalid types, percentages, and NaN in parsePercent", () => {
      expect(parsePercent(0)).toBe(0);
      expect(parsePercent(1)).toBe(1);
      expect(parsePercent(0.42)).toBe(0.42);
      expect(parsePercent(-0.15)).toBe(-0.15);
      expect(parsePercent(50)).toBe(0.5);
      expect(parsePercent(-25)).toBe(-0.25);
      expect(parsePercent("15.5%")).toBeCloseTo(0.155);
      expect(parsePercent("-42.8%")).toBeCloseTo(-0.428);
      expect(parsePercent("0%")).toBe(0);
      expect(parsePercent("")).toBe(0);
      expect(parsePercent("invalid-string")).toBe(0);
      expect(parsePercent(null)).toBe(0);
      expect(parsePercent(undefined)).toBe(0);
      expect(parsePercent({})).toBe(0);
      expect(parsePercent([])).toBe(0);
      expect(parsePercent(true)).toBe(0);
      expect(parsePercent(false)).toBe(0);
      expect(parsePercent(Infinity)).toBe(Infinity);
      expect(parsePercent(-Infinity)).toBe(-Infinity);
      expect(Number.isNaN(parsePercent(NaN))).toBe(true);
    });

    it("handles extreme values, currency symbols, whitespace, and negative formats in parseCurrency", () => {
      expect(parseCurrency(100)).toBe(100);
      expect(parseCurrency(-500.25)).toBe(-500.25);
      expect(parseCurrency("$1,234,567.89")).toBe(1234567.89);
      expect(parseCurrency("-$987,654.32")).toBe(-987654.32);
      expect(parseCurrency(" $ 50.00 ")).toBe(50);
      expect(parseCurrency("")).toBe(0);
      expect(parseCurrency("N/A")).toBe(0);
      expect(parseCurrency(null)).toBe(0);
      expect(parseCurrency(undefined)).toBe(0);
      expect(parseCurrency({})).toBe(0);
      expect(parseCurrency([])).toBe(0);
      expect(parseCurrency(true)).toBe(0);
      expect(parseCurrency(1e12)).toBe(1000000000000);
      expect(parseCurrency(-1e12)).toBe(-1000000000000);
    });

    it("handles custom fallbacks, commas, and scientific notation in parseNumber", () => {
      expect(parseNumber(42)).toBe(42);
      expect(parseNumber("1,000,000")).toBe(1000000);
      expect(parseNumber("-1,234.56")).toBe(-1234.56);
      expect(parseNumber("1.25e-4")).toBe(0.000125);
      expect(parseNumber("invalid", -999)).toBe(-999);
      expect(parseNumber(null, 10)).toBe(10);
      expect(parseNumber(undefined, 20)).toBe(20);
      expect(parseNumber({}, 30)).toBe(30);
      expect(parseNumber([], 40)).toBe(40);
    });
  });

  describe("2. parseLeanResults Stress & Malformed Payload Handling", () => {
    it("handles completely invalid JSON strings without crashing", () => {
      const result = parseLeanResults("{corrupted: json [unclosed", "bt_corrupted", dummyRequest);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("Failed to parse LEAN results JSON");
      expect(result.orders).toEqual([]);
      expect(result.closedTrades).toEqual([]);
      expect(result.charts).toEqual({});
    });

    it("handles null, boolean, number, and empty string primitives safely", () => {
      const resNull = parseLeanResults(null as any, "bt_null", dummyRequest);
      expect(resNull.status).toBe("failed");

      const resNum = parseLeanResults(12345 as any, "bt_num", dummyRequest);
      expect(resNum.status).toBe("failed");

      const resEmpty = parseLeanResults("", "bt_empty", dummyRequest);
      expect(resEmpty.status).toBe("failed");
    });

    it("handles empty object payload with all defaults", () => {
      const result = parseLeanResults({}, "bt_empty_obj", dummyRequest);
      expect(result.id).toBe("bt_empty_obj");
      expect(result.status).toBe("completed");
      expect(result.statistics?.totalTrades).toBe(0);
      expect(result.statistics?.netProfit).toBe(0);
      expect(result.statistics?.sharpeRatio).toBe(0);
      expect(result.runtimeStatistics?.equity).toBe(0);
      expect(result.orders).toEqual([]);
      expect(result.closedTrades).toEqual([]);
      expect(result.charts).toEqual({});
    });

    it("handles missing sub-properties, null sub-properties, and non-object fields gracefully", () => {
      const malformedPayload = {
        Statistics: null,
        RuntimeStatistics: "not an object",
        TotalPerformance: {
          TradeStatistics: null,
          PortfolioStatistics: undefined,
          ClosedTrades: "not an array"
        },
        Charts: "not an object",
        Orders: null
      };

      const result = parseLeanResults(malformedPayload as any, "bt_malformed", dummyRequest);
      expect(result.status).toBe("completed");
      expect(result.statistics?.totalTrades).toBe(0);
      expect(result.statistics?.netProfit).toBe(0);
      expect(result.orders).toEqual([]);
      expect(result.closedTrades).toEqual([]);
      expect(result.charts).toEqual({});
    });

    it("handles massive order lists (50,000 orders) efficiently without memory exhaustion", () => {
      const orderCount = 50000;
      const massiveOrders: any[] = [];
      for (let i = 0; i < orderCount; i++) {
        massiveOrders.push({
          Id: i + 1,
          Symbol: { Value: "EURUSD" },
          Price: 1.085 + (i % 100) * 0.0001,
          Quantity: 10000,
          Direction: i % 2 === 0 ? 0 : 1,
          Type: 0,
          Status: 3,
          Time: "2024-01-02T10:00:00Z",
          Value: 10850,
          OrderFee: { Value: { Amount: 2.0, Currency: "USD" } }
        });
      }

      const t0 = performance.now();
      const result = parseLeanResults({ Orders: massiveOrders }, "bt_massive_orders", dummyRequest);
      const elapsed = performance.now() - t0;

      expect(result.orders.length).toBe(orderCount);
      expect(result.orders[0].id).toBe(1);
      expect(result.orders[0].direction).toBe("Buy");
      expect(result.orders[0].fee).toBe(2.0);
      expect(result.orders[1].direction).toBe("Sell");
      expect(elapsed).toBeLessThan(1000); // 50k orders in under 1 second
    });

    it("handles order dictionary format with null entries, string symbols, and numeric codes", () => {
      const orderDict = {
        "1": {
          Id: 101,
          Symbol: "EURUSD",
          Price: 1.09,
          Quantity: 5000,
          Direction: "Buy",
          Type: "Market",
          Status: "Filled",
          Time: "2024-01-02T10:00:00Z",
          Tag: "entry signal"
        },
        "2": null, // Corrupted / null item
        "3": {
          Id: 102,
          Symbol: null,
          Price: 0,
          Quantity: 0,
          Direction: 99, // Unknown direction code
          Type: 99, // Unknown type code
          Status: 5, // Canceled
          CreatedTime: "2024-01-02T10:05:00Z"
        }
      };

      const result = parseLeanResults({ Orders: orderDict }, "bt_dict_orders", dummyRequest);
      expect(result.orders.length).toBe(2);
      expect(result.orders[0].id).toBe(101);
      expect(result.orders[0].symbol).toBe("EURUSD");
      expect(result.orders[0].tag).toBe("entry signal");
      expect(result.orders[1].id).toBe(102);
      expect(result.orders[1].symbol).toBe("");
      expect(result.orders[1].status).toBe("Canceled");
    });

    it("handles charts with missing values, sparse series, or nested objects", () => {
      const chartPayload = {
        Charts: {
          "Strategy Equity": {
            Series: {
              Equity: {
                Name: "Equity",
                Unit: "$",
                Values: [
                  { x: 1704153600, y: 100000 },
                  { Time: 1704153660, Value: 100050 }
                ]
              },
              EmptySeries: {
                Values: null
              }
            }
          },
          Benchmark: {
            Series: null
          }
        }
      };

      const result = parseLeanResults(chartPayload, "bt_charts", dummyRequest);
      expect(result.charts["Strategy Equity - Equity"]).toBeDefined();
      expect(result.charts["Strategy Equity - Equity"].values).toHaveLength(2);
      expect(result.charts["Strategy Equity - Equity"].values[0]).toEqual({ x: 1704153600, y: 100000 });
      expect(result.charts["Strategy Equity - Equity"].values[1]).toEqual({ x: 1704153660, y: 100050 });
      expect(result.charts["Strategy Equity - EmptySeries"].values).toEqual([]);
    });

    it("handles Chart series where series value is null or ClosedTrades has null elements", () => {
      // Test Charts with a null series item
      const nullSeriesPayload = {
        Charts: {
          "Performance": {
            Series: {
              "Valid": { Name: "Valid", Unit: "%", Values: [{ x: 1, y: 2 }] }
            }
          }
        }
      };
      const res1 = parseLeanResults(nullSeriesPayload, "bt_null_series", dummyRequest);
      expect(res1.charts["Performance - Valid"]).toBeDefined();
    });

    it("handles ClosedTrades with complete statistics and metrics", () => {
      const closedTradesPayload = {
        TotalPerformance: {
          TradeStatistics: {
            TotalNumberOfTrades: 2,
            NumberOfWinningTrades: 1,
            NumberOfLosingTrades: 1,
            WinRate: 0.5,
            TotalProfitLoss: 150.25
          },
          PortfolioStatistics: {
            SharpeRatio: 1.85,
            Drawdown: 0.045
          },
          ClosedTrades: [
            {
              Symbol: { Value: "EURUSD" },
              EntryTime: "2024-01-02T10:00:00Z",
              EntryPrice: 1.085,
              ExitTime: "2024-01-02T10:30:00Z",
              ExitPrice: 1.087,
              Quantity: 100000,
              ProfitLoss: 200,
              TotalFees: 4,
              MAE: -20,
              MFE: 250,
              Duration: "00:30:00"
            },
            {
              Symbol: "GBPUSD",
              EntryTime: "2024-01-02T11:00:00Z",
              EntryPrice: 1.275,
              ExitTime: "2024-01-02T11:45:00Z",
              ExitPrice: 1.2745,
              Quantity: 100000,
              ProfitLoss: -49.75,
              TotalFees: 4,
              MAE: -60,
              MFE: 10,
              Duration: "00:45:00"
            }
          ]
        }
      };

      const result = parseLeanResults(closedTradesPayload, "bt_trades", dummyRequest);
      expect(result.statistics?.totalTrades).toBe(2);
      expect(result.statistics?.winningTrades).toBe(1);
      expect(result.statistics?.losingTrades).toBe(1);
      expect(result.statistics?.winRate).toBe(0.5);
      expect(result.statistics?.sharpeRatio).toBe(1.85);
      expect(result.statistics?.drawdown).toBe(0.045);
      expect(result.closedTrades).toHaveLength(2);
      expect(result.closedTrades[0].symbol).toBe("EURUSD");
      expect(result.closedTrades[0].profitLoss).toBe(200);
      expect(result.closedTrades[1].symbol).toBe("GBPUSD");
      expect(result.closedTrades[1].profitLoss).toBe(-49.75);
    });
  });

  describe("3. generateLeanConfig Stress & Parameter Serialization", () => {
    it("generates default configuration without parameters", () => {
      const config = generateLeanConfig();
      expect(config["algorithm-language"]).toBe("Python");
      expect(config.environment).toBe("backtesting");
      expect(config["data-folder"]).toBe("/Lean/Data");
      expect(config["results-destination-folder"]).toBe("/Results");
      expect(config.parameters).toEqual({});
    });

    it("correctly embeds custom parameters and overrides", () => {
      const config = generateLeanConfig({
        algorithmLocation: "/custom/path/main.py",
        algorithmTypeName: "AdvancedMacdForex",
        dataFolder: "/custom/data",
        resultsDestinationFolder: "/custom/results",
        environment: "live",
        liveMode: true,
        parameters: {
          fastPeriod: 12,
          slowPeriod: 26,
          signalPeriod: 9,
          enableStopLoss: true,
          symbolName: "EURUSD"
        }
      });

      expect(config["algorithm-location"]).toBe("/custom/path/main.py");
      expect(config["algorithm-type-name"]).toBe("AdvancedMacdForex");
      expect(config["data-folder"]).toBe("/custom/data");
      expect(config["results-destination-folder"]).toBe("/custom/results");
      expect(config.environment).toBe("live");
      expect((config.environments as any)["live"]["live-mode"]).toBe(true);
      expect(config.parameters).toEqual({
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        enableStopLoss: true,
        symbolName: "EURUSD"
      });
    });

    it("serializes to valid formatted JSON string matching LEAN requirements", () => {
      const serialized = serializeLeanConfig({
        algorithmTypeName: "TestStrategy",
        parameters: { param1: "val1" }
      });

      expect(typeof serialized).toBe("string");
      const parsed = JSON.parse(serialized);
      expect(parsed["algorithm-type-name"]).toBe("TestStrategy");
      expect(parsed.parameters.param1).toBe("val1");
      expect(parsed.environments.backtesting["setup-handler"]).toBe(
        "QuantConnect.Lean.Engine.Setup.ConsoleSetupHandler"
      );
    });
  });

  describe("4. LeanService Real Subprocess Execution & Error Handling", () => {
    it("handles fast successful subprocess execution via executeSubprocess", async () => {
      const service = new LeanService(DEFAULT_LEAN_CONFIG, "/tmp");
      const result = await (service as any).executeSubprocess(
        "node",
        ["-e", "console.log('Subprocess STDOUT test'); console.error('Subprocess STDERR test'); process.exit(0);"],
        5000,
        {}
      );

      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.stdout).toContain("Subprocess STDOUT test");
      expect(result.stderr).toContain("Subprocess STDERR test");
    });

    it("handles subprocess failure with non-zero exit code and stderr", async () => {
      const service = new LeanService(DEFAULT_LEAN_CONFIG, "/tmp");
      const result = await (service as any).executeSubprocess(
        "node",
        ["-e", "console.error('Fatal Python Runtime Exception'); process.exit(137);"],
        5000,
        {}
      );

      expect(result.exitCode).toBe(137);
      expect(result.timedOut).toBe(false);
      expect(result.stderr).toContain("Fatal Python Runtime Exception");
    });

    it("handles subprocess timeout and forces termination within deadline", async () => {
      const service = new LeanService(DEFAULT_LEAN_CONFIG, "/tmp");
      const t0 = performance.now();
      const result = await (service as any).executeSubprocess(
        "node",
        ["-e", "setInterval(() => {}, 1000);"],
        150, // 150ms timeout
        {}
      );
      const elapsed = performance.now() - t0;

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(-1);
      expect(elapsed).toBeGreaterThanOrEqual(140);
      expect(elapsed).toBeLessThan(1500); // Should terminate promptly
    });

    it("handles non-existent binary spawn error gracefully without unhandled rejection", async () => {
      const service = new LeanService(DEFAULT_LEAN_CONFIG, "/tmp");
      const result = await (service as any).executeSubprocess(
        "__non_existent_lean_binary_12345__",
        ["arg1"],
        1000,
        {}
      );

      expect(result.exitCode).toBe(-1);
      expect(result.timedOut).toBe(false);
      expect(result.stderr).toMatch(/ENOENT/i);
    });

    it("runs full runBacktest with end-to-end timeout workflow", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "lean-challenger-test-"));
      try {
        const service = (await LeanService.create({
          projectRoot: tempDir,
          force: true,
          config: {
            dockerImage: "node", // Use node as mock runner
            defaultTimeoutSeconds: 0.1
          }
        }))!;

        // Override executeSubprocess to simulate hanging Docker container
        const originalExec = (service as any).executeSubprocess.bind(service);
        (service as any).executeSubprocess = (cmd: string, args: string[], timeoutMs: number, opts: any) => {
          return originalExec(
            "node",
            ["-e", "setInterval(() => {}, 1000);"],
            100, // 100ms
            opts
          );
        };

        const res = await service.runBacktest({
          strategyName: "HangingStrategy",
          symbol: "EURUSD",
          startDate: "2024-01-01",
          endDate: "2024-01-02",
          timeoutSeconds: 0.1
        });

        expect(res.status).toBe("timeout");
        expect(res.error).toContain("timed out after 0.1s");
        expect(res.exitCode).toBe(-1);

        // Verify summary.json was persisted
        const saved = await service.getBacktest(res.id);
        expect(saved).not.toBeNull();
        expect(saved?.status).toBe("timeout");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("runs full runBacktest with end-to-end non-zero exit code workflow", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "lean-challenger-test-"));
      try {
        const service = (await LeanService.create({
          projectRoot: tempDir,
          force: true
        }))!;

        const originalExec = (service as any).executeSubprocess.bind(service);
        (service as any).executeSubprocess = (cmd: string, args: string[], timeoutMs: number, opts: any) => {
          return originalExec(
            "node",
            ["-e", "console.error('LEAN Engine initialization failed: Memory limit exceeded'); process.exit(1);"],
            5000,
            opts
          );
        };

        const res = await service.runBacktest({
          strategyName: "FailingStrategy",
          symbol: "EURUSD",
          startDate: "2024-01-01",
          endDate: "2024-01-02"
        });

        expect(res.status).toBe("failed");
        expect(res.exitCode).toBe(1);
        expect(res.error).toContain("LEAN engine exited with code 1");
        expect(res.logs).toContain("Memory limit exceeded");

        const saved = await service.getBacktest(res.id);
        expect(saved).not.toBeNull();
        expect(saved?.status).toBe("failed");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
