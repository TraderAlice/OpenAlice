import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface StrategyTemplateParameter {
  name: string;
  type: "string" | "number" | "boolean";
  defaultValue: string | number | boolean;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  assetClass: "forex" | "equity" | "crypto";
  defaultParameters: Record<string, string | number | boolean>;
  parameterDefs: StrategyTemplateParameter[];
  code: string;
}

export const STRATEGY_TEMPLATES: Record<string, Omit<StrategyTemplate, "code">> = {
  "ema-cross": {
    id: "ema-cross",
    name: "EMA Crossover with ATR Trailing Stop",
    description: "Trend-following strategy that enters on EMA crossovers with ATR-based dynamic risk management.",
    assetClass: "forex",
    defaultParameters: {
      symbol: "EURUSD",
      fast_period: 12,
      slow_period: 26,
      atr_period: 14,
      atr_multiplier: 2.0,
      risk_fraction: 0.05
    },
    parameterDefs: [
      { name: "symbol", type: "string", defaultValue: "EURUSD", description: "Forex pair symbol" },
      { name: "fast_period", type: "number", defaultValue: 12, description: "Fast EMA lookback", min: 5, max: 50, step: 1 },
      { name: "slow_period", type: "number", defaultValue: 26, description: "Slow EMA lookback", min: 20, max: 200, step: 2 },
      { name: "atr_period", type: "number", defaultValue: 14, description: "ATR volatility lookback", min: 7, max: 30, step: 1 },
      { name: "atr_multiplier", type: "number", defaultValue: 2.0, description: "ATR stop multiplier", min: 1.0, max: 5.0, step: 0.5 },
      { name: "risk_fraction", type: "number", defaultValue: 0.05, description: "Portfolio fraction per trade", min: 0.01, max: 0.20, step: 0.01 }
    ]
  },
  "london-breakout": {
    id: "london-breakout",
    name: "London Session Opening Range Breakout",
    description: "Session breakout strategy identifying Asian pre-market consolidation and trading London morning breakouts.",
    assetClass: "forex",
    defaultParameters: {
      symbol: "EURUSD",
      asian_start_hour: 0,
      asian_end_hour: 7,
      breakout_end_hour: 12,
      buffer_pips: 5.0,
      risk_fraction: 0.05,
      rr_ratio: 1.5
    },
    parameterDefs: [
      { name: "symbol", type: "string", defaultValue: "EURUSD", description: "Forex pair symbol" },
      { name: "asian_start_hour", type: "number", defaultValue: 0, description: "Asian session start hour (UTC)", min: 0, max: 4, step: 1 },
      { name: "asian_end_hour", type: "number", defaultValue: 7, description: "Asian session end hour (UTC)", min: 5, max: 9, step: 1 },
      { name: "breakout_end_hour", type: "number", defaultValue: 12, description: "Breakout window end (UTC)", min: 10, max: 16, step: 1 },
      { name: "buffer_pips", type: "number", defaultValue: 5.0, description: "Breakout confirmation buffer in pips", min: 0.0, max: 20.0, step: 1.0 },
      { name: "risk_fraction", type: "number", defaultValue: 0.05, description: "Portfolio fraction per trade", min: 0.01, max: 0.20, step: 0.01 },
      { name: "rr_ratio", type: "number", defaultValue: 1.5, description: "Risk to reward ratio", min: 1.0, max: 4.0, step: 0.5 }
    ]
  },
  "rsi-mean-reversion": {
    id: "rsi-mean-reversion",
    name: "RSI & Bollinger Bands Mean Reversion",
    description: "Counter-trend mean reversion strategy entering at statistical extremes outside Bollinger Bands with RSI confirmation.",
    assetClass: "forex",
    defaultParameters: {
      symbol: "EURUSD",
      rsi_period: 14,
      rsi_oversold: 30,
      rsi_overbought: 70,
      bb_period: 20,
      bb_std: 2.0,
      risk_fraction: 0.05
    },
    parameterDefs: [
      { name: "symbol", type: "string", defaultValue: "EURUSD", description: "Forex pair symbol" },
      { name: "rsi_period", type: "number", defaultValue: 14, description: "RSI lookback period", min: 5, max: 30, step: 1 },
      { name: "rsi_oversold", type: "number", defaultValue: 30, description: "RSI oversold threshold", min: 15, max: 40, step: 5 },
      { name: "rsi_overbought", type: "number", defaultValue: 70, description: "RSI overbought threshold", min: 60, max: 85, step: 5 },
      { name: "bb_period", type: "number", defaultValue: 20, description: "Bollinger Bands period", min: 10, max: 50, step: 2 },
      { name: "bb_std", type: "number", defaultValue: 2.0, description: "Bollinger Bands standard deviations", min: 1.5, max: 3.0, step: 0.25 },
      { name: "risk_fraction", type: "number", defaultValue: 0.05, description: "Portfolio fraction per trade", min: 0.01, max: 0.20, step: 0.01 }
    ]
  }
};

export async function getTemplate(templateId: string, templatesDir?: string): Promise<StrategyTemplate | null> {
  const meta = STRATEGY_TEMPLATES[templateId];
  if (!meta) return null;

  let dir = templatesDir;
  if (!dir) {
    try {
      const { fileURLToPath } = await import("node:url");
      dir = fileURLToPath(new URL(".", import.meta.url));
    } catch {
      dir = join(process.cwd(), "src/domain/lean/templates");
    }
  }

  const filePath = join(dir, `${templateId}.py`);

  let code = "";
  if (existsSync(filePath)) {
    code = await readFile(filePath, "utf8");
  } else {
    const fallbackPath = join(process.cwd(), "src/domain/lean/templates", `${templateId}.py`);
    if (existsSync(fallbackPath)) {
      code = await readFile(fallbackPath, "utf8");
    }
  }

  return {
    ...meta,
    code
  };
}

export async function listTemplates(templatesDir?: string): Promise<StrategyTemplate[]> {
  const templates: StrategyTemplate[] = [];
  for (const id of Object.keys(STRATEGY_TEMPLATES)) {
    const t = await getTemplate(id, templatesDir);
    if (t) templates.push(t);
  }
  return templates;
}
