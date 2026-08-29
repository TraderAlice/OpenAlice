import { describe, it, expect } from "vitest";
import { generateLeanConfig, serializeLeanConfig } from "../config-gen.js";

describe("generateLeanConfig", () => {
  it("generates default backtesting config for Python algorithm", () => {
    const cfg = generateLeanConfig({
      algorithmLocation: "/Lean/Algorithm.Python/strategy.py",
      algorithmTypeName: "ForexMomentum",
      dataFolder: "/Lean/Data",
      resultsDestinationFolder: "/Results"
    }) as any;

    expect(cfg.environment).toBe("backtesting");
    expect(cfg["algorithm-language"]).toBe("Python");
    expect(cfg["algorithm-location"]).toBe("/Lean/Algorithm.Python/strategy.py");
    expect(cfg["algorithm-type-name"]).toBe("ForexMomentum");
    expect(cfg["data-folder"]).toBe("/Lean/Data");
    expect(cfg["results-destination-folder"]).toBe("/Results");

    expect(cfg.environments.backtesting["setup-handler"]).toBe("QuantConnect.Lean.Engine.Setup.ConsoleSetupHandler");
    expect(cfg.environments.backtesting["result-handler"]).toBe("QuantConnect.Lean.Engine.Results.BacktestingResultHandler");
    expect(cfg.environments.backtesting["data-feed-handler"]).toBe("QuantConnect.Lean.Engine.DataFeeds.FileSystemDataFeed");
    expect(cfg.environments.backtesting["real-time-handler"]).toBe("QuantConnect.Lean.Engine.RealTime.BacktestingRealTimeHandler");
    expect(cfg.environments.backtesting["transaction-handler"]).toBe("QuantConnect.Lean.Engine.TransactionHandlers.BacktestingTransactionHandler");
  });

  it("handles default fallback values when options are empty", () => {
    const cfg = generateLeanConfig() as any;

    expect(cfg.environment).toBe("backtesting");
    expect(cfg["algorithm-language"]).toBe("Python");
    expect(cfg["algorithm-location"]).toBe("/Lean/Algorithm.Python/main.py");
    expect(cfg["algorithm-type-name"]).toBe("ForexStrategy");
    expect(cfg["data-folder"]).toBe("/Lean/Data");
    expect(cfg["results-destination-folder"]).toBe("/Results");
    expect(cfg.parameters).toEqual({});
  });

  it("injects custom algorithm parameters", () => {
    const cfg = generateLeanConfig({
      parameters: { fastPeriod: 10, slowPeriod: 30, leverage: 50 }
    }) as any;

    expect(cfg.parameters).toEqual({ fastPeriod: 10, slowPeriod: 30, leverage: 50 });
  });

  it("supports custom environment name and liveMode", () => {
    const cfg = generateLeanConfig({
      environment: "live-paper",
      liveMode: true
    }) as any;

    expect(cfg.environment).toBe("live-paper");
    expect(cfg.environments["live-paper"]["live-mode"]).toBe(true);
  });

  it("serializes valid JSON string", () => {
    const str = serializeLeanConfig({ algorithmTypeName: "TestStrategy" });
    expect(typeof str).toBe("string");
    const parsed = JSON.parse(str);
    expect(parsed["algorithm-type-name"]).toBe("TestStrategy");
  });
});
