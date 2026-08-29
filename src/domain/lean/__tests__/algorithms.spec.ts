import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { AlgorithmManager, parseStrategyParameters, extractStrategyMetadata } from "../algorithms.js";
import { listTemplates, getTemplate } from "../templates/index.js";

const TEST_DIR = join(process.cwd(), "tmp_test_algorithms");

describe("LEAN Algorithms & Strategy Management", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("Strategy Templates", () => {
    it("lists all built-in strategy templates", async () => {
      const templates = await listTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(3);
      const ids = templates.map((t) => t.id);
      expect(ids).toContain("ema-cross");
      expect(ids).toContain("london-breakout");
      expect(ids).toContain("rsi-mean-reversion");
    });

    it("loads ema-cross template with valid Python code and parameters", async () => {
      const template = await getTemplate("ema-cross");
      expect(template).not.toBeNull();
      expect(template?.id).toBe("ema-cross");
      expect(template?.assetClass).toBe("forex");
      expect(template?.defaultParameters.symbol).toBe("EURUSD");
      expect(template?.code).toContain("class EmaCrossStrategy(QCAlgorithm):");
      expect(template?.code).toContain("self.AddForex");
      expect(template?.code).toContain("BrokerageName.Oanda");
    });

    it("loads london-breakout template with valid Python code", async () => {
      const template = await getTemplate("london-breakout");
      expect(template).not.toBeNull();
      expect(template?.code).toContain("class LondonBreakoutStrategy(QCAlgorithm):");
      expect(template?.defaultParameters.asian_end_hour).toBe(7);
    });

    it("loads rsi-mean-reversion template with valid Python code", async () => {
      const template = await getTemplate("rsi-mean-reversion");
      expect(template).not.toBeNull();
      expect(template?.code).toContain("class RsiMeanReversionStrategy(QCAlgorithm):");
      expect(template?.defaultParameters.rsi_oversold).toBe(30);
    });

    it("returns null for non-existent template", async () => {
      const template = await getTemplate("non-existent-template-xyz");
      expect(template).toBeNull();
    });
  });

  describe("Parameter & Metadata Parsing", () => {
    it("parses GetParameter calls and docstrings from Python strategy", () => {
      const code = `
class CustomStrategy(QCAlgorithm):
    """
    My custom strategy.
    Parameters:
    - fast_period: Fast period (default: 15, range: [5, 50])
    - stop_loss: Stop loss pips (default: 25.5, range: [10.0, 100.0])
    - use_filter: Trend filter enabled (default: true)
    """
    def Initialize(self):
        self.fast = int(self.GetParameter("fast_period", 15))
        self.stop = float(self.GetParameter("stop_loss", 25.5))
        self.symbol = self.GetParameter("symbol", "GBPUSD")
`;
      const { parameters, parameterDefs } = parseStrategyParameters(code);
      expect(parameters.fast_period).toBe(15);
      expect(parameters.stop_loss).toBe(25.5);
      expect(parameters.symbol).toBe("GBPUSD");

      const fastDef = parameterDefs.find((p) => p.name === "fast_period");
      expect(fastDef?.min).toBe(5);
      expect(fastDef?.max).toBe(50);

      const meta = extractStrategyMetadata(code);
      expect(meta.className).toBe("CustomStrategy");
      expect(meta.description).toContain("My custom strategy.");
    });
  });

  describe("AlgorithmManager CRUD", () => {
    it("creates a strategy from a template and persists it", async () => {
      const manager = new AlgorithmManager(TEST_DIR);
      const created = await manager.createStrategy({
        name: "My EURUSD EMA Strategy",
        templateId: "ema-cross",
        parameters: {
          fast_period: 9,
          slow_period: 21
        }
      });

      expect(created.id).toBe("my-eurusd-ema-strategy");
      expect(created.name).toBe("My EURUSD EMA Strategy");
      expect(created.templateId).toBe("ema-cross");
      expect(created.parameters.fast_period).toBe(9);
      expect(created.parameters.slow_period).toBe(21);
      expect(created.code).toContain("class EmaCrossStrategy(QCAlgorithm):");

      expect(existsSync(join(TEST_DIR, "my-eurusd-ema-strategy.py"))).toBe(true);
      expect(existsSync(join(TEST_DIR, "my-eurusd-ema-strategy.meta.json"))).toBe(true);

      const fetched = await manager.getStrategy("my-eurusd-ema-strategy");
      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe("My EURUSD EMA Strategy");
      expect(fetched?.parameters.fast_period).toBe(9);
    });

    it("creates a custom strategy with direct Python code", async () => {
      const manager = new AlgorithmManager(TEST_DIR);
      const customCode = `
from AlgorithmImports import *

class CustomForex(QCAlgorithm):
    """Simple test strategy"""
    def Initialize(self):
        self.fast = int(self.GetParameter("fast", 10))
`;
      const created = await manager.createStrategy({
        id: "custom-test-1",
        name: "Custom Test 1",
        description: "Test description",
        code: customCode
      });

      expect(created.id).toBe("custom-test-1");
      expect(created.parameters.fast).toBe(10);
    });

    it("lists all created strategies", async () => {
      const manager = new AlgorithmManager(TEST_DIR);
      await manager.createStrategy({ id: "strat-1", name: "Strat 1", templateId: "ema-cross" });
      await manager.createStrategy({ id: "strat-2", name: "Strat 2", templateId: "london-breakout" });

      const list = await manager.listStrategies();
      expect(list.length).toBe(2);
      expect(list.map((s) => s.id)).toContain("strat-1");
      expect(list.map((s) => s.id)).toContain("strat-2");
    });

    it("updates strategy parameters and code", async () => {
      const manager = new AlgorithmManager(TEST_DIR);
      await manager.createStrategy({ id: "strat-to-update", name: "Original Name", templateId: "ema-cross" });

      const updated = await manager.updateStrategy("strat-to-update", {
        name: "Updated Name",
        parameters: { fast_period: 14 }
      });

      expect(updated.name).toBe("Updated Name");
      expect(updated.parameters.fast_period).toBe(14);

      const fetched = await manager.getStrategy("strat-to-update");
      expect(fetched?.name).toBe("Updated Name");
      expect(fetched?.parameters.fast_period).toBe(14);
    });

    it("deletes a strategy and its metadata", async () => {
      const manager = new AlgorithmManager(TEST_DIR);
      await manager.createStrategy({ id: "strat-to-delete", name: "To Delete", templateId: "ema-cross" });

      expect(existsSync(join(TEST_DIR, "strat-to-delete.py"))).toBe(true);

      const deleted = await manager.deleteStrategy("strat-to-delete");
      expect(deleted).toBe(true);
      expect(existsSync(join(TEST_DIR, "strat-to-delete.py"))).toBe(false);
      expect(existsSync(join(TEST_DIR, "strat-to-delete.meta.json"))).toBe(false);

      const fetched = await manager.getStrategy("strat-to-delete");
      expect(fetched).toBeNull();
    });

    it("throws error when creating strategy without code or templateId", async () => {
      const manager = new AlgorithmManager(TEST_DIR);
      await expect(
        manager.createStrategy({ name: "Invalid Strategy" })
      ).rejects.toThrow(/must be provided/);
    });
  });
});
