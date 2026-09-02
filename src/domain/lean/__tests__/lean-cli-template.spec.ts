import { describe, it, expect } from "vitest";
import { writeLeanCliConfig, LEAN_CLI_DEFAULT_ORG_ID } from "../lean-cli-template.js";

describe("writeLeanCliConfig", () => {
  it("builds a CLI-compatible lean.json with runtime values injected", () => {
    const config = writeLeanCliConfig({
      algorithmFileName: "eurusd_london_breakout.py",
      dataFolder: "/home/test/data/lean/data",
      startDate: "2024-01-02",
      endDate: "2024-01-05",
      cashAmount: "50000",
      parameters: { fast: 12, slow: 26 }
    });

    expect(config["organization-id"]).toBe(LEAN_CLI_DEFAULT_ORG_ID);
    expect(config["data-folder"]).toBe("/home/test/data/lean/data");
    expect(config["algorithm-type-name"]).toBe("eurusd_london_breakout");
    expect(config["start-date"]).toBe("2024-01-02");
    expect(config["end-date"]).toBe("2024-01-05");
    expect(config["cash-amount"]).toBe("50000");
    expect(config.parameters).toEqual({ fast: 12, slow: 26 });

    const backtesting = (config.environments as any).backtesting;
    expect(backtesting).toBeDefined();
    expect(backtesting["result-handler"]).toBe("QuantConnect.Lean.Engine.Results.BacktestingResultHandler");
  });

  it("defaults parameters to an empty object and keeps the canonical launcher keys", () => {
    const config = writeLeanCliConfig({
      algorithmFileName: "main.py",
      dataFolder: "/tmp/data"
    });

    expect(config.parameters).toEqual({});
    expect(config["log-handler"]).toBe("QuantConnect.Logging.CompositeLogHandler");
    expect(typeof config["map-file-provider"]).toBe("string");
    expect(config["algorithm-language"]).toBeUndefined();
  });
});
