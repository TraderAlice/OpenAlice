import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface TradeJournalEntry {
  id: string;
  title: string;
  symbol: string;
  direction: "long" | "short";
  entryTime: string;
  exitTime?: string;
  entryPrice: number;
  exitPrice?: number;
  profitLoss?: number;
  hypothesis: string;
  marketContext?: {
    session?: "Asian" | "London" | "NewYork" | "Overlap" | string;
    trend?: "uptrend" | "downtrend" | "range" | string;
    newsEvents?: string[];
    notes?: string;
  };
  review?: {
    whatWorked?: string;
    whatFailed?: string;
    emotionalState?: string;
    lessonsLearned?: string;
  };
  formalizationStatus: "draft" | "formalized" | "backtested";
  formalizedStrategyId?: string;
  formalizedExperimentId?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateJournalEntryOptions {
  id?: string;
  title: string;
  symbol: string;
  direction: "long" | "short";
  entryTime: string;
  exitTime?: string;
  entryPrice: number;
  exitPrice?: number;
  profitLoss?: number;
  hypothesis: string;
  marketContext?: TradeJournalEntry["marketContext"];
  review?: TradeJournalEntry["review"];
  tags?: string[];
}

export interface JournalFilter {
  symbol?: string;
  direction?: "long" | "short";
  formalizationStatus?: "draft" | "formalized" | "backtested";
  tag?: string;
  limit?: number;
}

export interface FormalizedStrategyProposal {
  entry: TradeJournalEntry;
  suggestedTemplateId: "ema-cross" | "london-breakout" | "rsi-mean-reversion";
  strategyName: string;
  formalizedHypothesis: string;
  suggestedParameters: Record<string, string | number | boolean>;
  suggestedRanges: Record<string, { min: number; max: number; step: number }>;
}

export class TradeJournalStore {
  private readonly journalDir: string;

  constructor(journalDir: string) {
    this.journalDir = resolve(journalDir);
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.journalDir, { recursive: true });
  }

  private getFilePath(id: string): string {
    return join(this.journalDir, `${id}.json`);
  }

  async create(options: CreateJournalEntryOptions): Promise<TradeJournalEntry> {
    await this.ensureDir();

    const timestamp = Date.now();
    const shortId = Math.random().toString(36).substring(2, 8);
    const id = options.id || `jnl_${timestamp}_${shortId}`;
    const now = new Date().toISOString();

    const entry: TradeJournalEntry = {
      id,
      title: options.title,
      symbol: options.symbol.toUpperCase(),
      direction: options.direction,
      entryTime: options.entryTime,
      exitTime: options.exitTime,
      entryPrice: options.entryPrice,
      exitPrice: options.exitPrice,
      profitLoss: options.profitLoss,
      hypothesis: options.hypothesis,
      marketContext: options.marketContext,
      review: options.review,
      formalizationStatus: "draft",
      tags: options.tags ?? [],
      createdAt: now,
      updatedAt: now
    };

    const filePath = this.getFilePath(id);
    await writeFile(filePath, JSON.stringify(entry, null, 2), "utf8");
    return entry;
  }

  async get(id: string): Promise<TradeJournalEntry | null> {
    await this.ensureDir();
    const filePath = this.getFilePath(id);
    if (!existsSync(filePath)) return null;

    try {
      const data = await readFile(filePath, "utf8");
      return JSON.parse(data) as TradeJournalEntry;
    } catch {
      return null;
    }
  }

  async list(filter?: JournalFilter): Promise<TradeJournalEntry[]> {
    await this.ensureDir();
    const files = await readdir(this.journalDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    const list: TradeJournalEntry[] = [];
    for (const f of jsonFiles) {
      const id = f.replace(/\.json$/, "");
      const entry = await this.get(id);
      if (!entry) continue;

      if (filter?.symbol && entry.symbol !== filter.symbol.toUpperCase()) continue;
      if (filter?.direction && entry.direction !== filter.direction) continue;
      if (filter?.formalizationStatus && entry.formalizationStatus !== filter.formalizationStatus) continue;
      if (filter?.tag && !entry.tags.includes(filter.tag)) continue;

      list.push(entry);
    }

    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (filter?.limit && filter.limit > 0) {
      return list.slice(0, filter.limit);
    }
    return list;
  }

  async update(id: string, updates: Partial<TradeJournalEntry>): Promise<TradeJournalEntry> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Journal entry '${id}' not found`);
    }

    const updated: TradeJournalEntry = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    };

    const filePath = this.getFilePath(id);
    await writeFile(filePath, JSON.stringify(updated, null, 2), "utf8");
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureDir();
    const filePath = this.getFilePath(id);
    if (!existsSync(filePath)) return false;

    await unlink(filePath);
    return true;
  }

  /**
   * Formalizes a discretionary journal idea into an algorithmic strategy proposal.
   */
  async formalizeIdea(id: string): Promise<FormalizedStrategyProposal> {
    const entry = await this.get(id);
    if (!entry) {
      throw new Error(`Journal entry '${id}' not found`);
    }

    const hypothesisLower = (entry.hypothesis + " " + (entry.marketContext?.session || "")).toLowerCase();

    let templateId: "ema-cross" | "london-breakout" | "rsi-mean-reversion" = "ema-cross";
    let strategyName = `Formalized ${entry.symbol} Trend Strategy`;
    let suggestedParams: Record<string, string | number | boolean> = {
      symbol: entry.symbol,
      fast_period: 12,
      slow_period: 26,
      risk_fraction: 0.05
    };
    let suggestedRanges: Record<string, { min: number; max: number; step: number }> = {
      fast_period: { min: 8, max: 20, step: 2 },
      slow_period: { min: 20, max: 50, step: 5 }
    };

    if (hypothesisLower.includes("london") || hypothesisLower.includes("breakout") || hypothesisLower.includes("asian")) {
      templateId = "london-breakout";
      strategyName = `Formalized ${entry.symbol} London Breakout`;
      suggestedParams = {
        symbol: entry.symbol,
        asian_start_hour: 0,
        asian_end_hour: 7,
        breakout_end_hour: 12,
        buffer_pips: 5.0,
        rr_ratio: 1.5,
        risk_fraction: 0.05
      };
      suggestedRanges = {
        buffer_pips: { min: 2.0, max: 10.0, step: 1.0 },
        rr_ratio: { min: 1.0, max: 3.0, step: 0.5 }
      };
    } else if (hypothesisLower.includes("rsi") || hypothesisLower.includes("mean reversion") || hypothesisLower.includes("oversold") || hypothesisLower.includes("bollinger")) {
      templateId = "rsi-mean-reversion";
      strategyName = `Formalized ${entry.symbol} RSI Mean Reversion`;
      suggestedParams = {
        symbol: entry.symbol,
        rsi_period: 14,
        rsi_oversold: 30,
        rsi_overbought: 70,
        bb_period: 20,
        bb_std: 2.0,
        risk_fraction: 0.05
      };
      suggestedRanges = {
        rsi_period: { min: 10, max: 20, step: 2 },
        rsi_oversold: { min: 20, max: 35, step: 5 },
        bb_period: { min: 15, max: 30, step: 5 }
      };
    }

    const formalizedHypothesis = `Systematic formulation of journal entry '${entry.title}': ${entry.hypothesis}. Formalized to algorithmic rule set based on ${templateId} template.`;

    const updated = await this.update(id, {
      formalizationStatus: "formalized"
    });

    return {
      entry: updated,
      suggestedTemplateId: templateId,
      strategyName,
      formalizedHypothesis,
      suggestedParameters: suggestedParams,
      suggestedRanges: suggestedRanges
    };
  }
}
