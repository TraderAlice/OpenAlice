import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { TradeJournalStore } from "../journal.js";

const TEST_DIR = join(process.cwd(), "tmp_test_journal");

describe("LEAN Manual Trade Journal & AI Idea Formalization", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("Journal Store CRUD", () => {
    it("creates, persists, and retrieves a manual trade entry", async () => {
      const store = new TradeJournalStore(TEST_DIR);
      const entry = await store.create({
        title: "EURUSD London Open Long",
        symbol: "EURUSD",
        direction: "long",
        entryTime: "2024-03-15T08:05:00Z",
        exitTime: "2024-03-15T11:30:00Z",
        entryPrice: 1.0880,
        exitPrice: 1.0925,
        profitLoss: 450,
        hypothesis: "London open breakout above Asian session range (1.0875 high)",
        marketContext: {
          session: "London",
          trend: "uptrend",
          notes: "ECB interest rate decision dovish tone"
        },
        review: {
          whatWorked: "Patience waiting for 5m candle close above Asian high",
          lessonsLearned: "Take partial profits at 1.5R"
        },
        tags: ["london-open", "breakout", "forex"]
      });

      expect(entry.id).toBeDefined();
      expect(entry.formalizationStatus).toBe("draft");
      expect(entry.profitLoss).toBe(450);

      const fetched = await store.get(entry.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.title).toBe("EURUSD London Open Long");
      expect(fetched?.marketContext?.session).toBe("London");
    });

    it("filters journal entries by symbol and formalization status", async () => {
      const store = new TradeJournalStore(TEST_DIR);
      await store.create({
        id: "jnl-1",
        title: "EURUSD Trade",
        symbol: "EURUSD",
        direction: "long",
        entryTime: "2024-01-01T10:00:00Z",
        entryPrice: 1.08,
        hypothesis: "Breakout"
      });

      await store.create({
        id: "jnl-2",
        title: "GBPUSD Trade",
        symbol: "GBPUSD",
        direction: "short",
        entryTime: "2024-01-02T10:00:00Z",
        entryPrice: 1.27,
        hypothesis: "Mean reversion"
      });

      const eurusdList = await store.list({ symbol: "EURUSD" });
      expect(eurusdList.length).toBe(1);
      expect(eurusdList[0].id).toBe("jnl-1");

      const draftList = await store.list({ formalizationStatus: "draft" });
      expect(draftList.length).toBe(2);
    });

    it("updates and deletes journal entries", async () => {
      const store = new TradeJournalStore(TEST_DIR);
      const created = await store.create({
        id: "jnl-del",
        title: "To Delete",
        symbol: "USDJPY",
        direction: "long",
        entryTime: "2024-01-01T00:00:00Z",
        entryPrice: 150.0,
        hypothesis: "Test"
      });

      const updated = await store.update("jnl-del", { title: "Updated Title" });
      expect(updated.title).toBe("Updated Title");

      const deleted = await store.delete("jnl-del");
      expect(deleted).toBe(true);

      const fetched = await store.get("jnl-del");
      expect(fetched).toBeNull();
    });
  });

  describe("Idea Formalization to Algorithmic Strategy", () => {
    it("formalizes London Breakout trade hypothesis to london-breakout template", async () => {
      const store = new TradeJournalStore(TEST_DIR);
      const entry = await store.create({
        id: "jnl-breakout",
        title: "EURUSD Asian Range Breakout",
        symbol: "EURUSD",
        direction: "long",
        entryTime: "2024-02-10T08:00:00Z",
        entryPrice: 1.0850,
        hypothesis: "Price broke 5 pips above Asian high at London session open",
        marketContext: { session: "London" }
      });

      const proposal = await store.formalizeIdea("jnl-breakout");
      expect(proposal.suggestedTemplateId).toBe("london-breakout");
      expect(proposal.strategyName).toContain("London Breakout");
      expect(proposal.suggestedParameters.asian_end_hour).toBe(7);
      expect(proposal.entry.formalizationStatus).toBe("formalized");
    });

    it("formalizes RSI Oversold trade hypothesis to rsi-mean-reversion template", async () => {
      const store = new TradeJournalStore(TEST_DIR);
      const entry = await store.create({
        id: "jnl-rsi",
        title: "EURUSD RSI Dip Buy",
        symbol: "EURUSD",
        direction: "long",
        entryTime: "2024-02-12T14:00:00Z",
        entryPrice: 1.0780,
        hypothesis: "RSI dropped below 25 on 15m chart outside lower Bollinger Band, expecting mean reversion to VWAP",
        marketContext: { session: "NewYork" }
      });

      const proposal = await store.formalizeIdea("jnl-rsi");
      expect(proposal.suggestedTemplateId).toBe("rsi-mean-reversion");
      expect(proposal.suggestedParameters.rsi_period).toBe(14);
      expect(proposal.suggestedParameters.rsi_oversold).toBe(30);
    });
  });
});
