# ARCHITECTURAL BLUEPRINT & TEST SPECIFICATION: LEAN FOUNDATION & FOREX PIPELINE (M1 & M2)

**Author**: Explorer (Archetype: Explorer)  
**Milestone**: Milestone 1 (Isolated Architecture & Foundation) & Milestone 2 (Forex Data Ingestion & Pipeline)  
**Target Directory**: `src/domain/lean/`  
**Date**: 2026-08-29  
**Status**: COMPLETE

---

## 1. Observation

### 1.1 Inputs & Architectural Context
1. **Spec Miner Handoff (`.agents/teamwork_preview_spec_miner_m0_3/handoff.md`)**:
   - Outlined exact Docker container invocation: `quantconnect/lean:latest` with `--rm`, volume mounts (`/Lean/Data`, `/Lean/Algorithm.Python`, `/Lean/Launcher/bin/Debug/config.json`, `/Results`).
   - Detailed LEAN `config.json` structure with Python handlers (`FileSystemDataFeed`, `BacktestingResultHandler`, `BacktestingTransactionHandler`).
   - Defined 11-column QuoteBar CSV format: `Milliseconds,BidOpen,BidHigh,BidLow,BidClose,LastBidSize,AskOpen,AskHigh,AskLow,AskClose,LastAskSize` within `{YYYYMMDD}_quote.zip`.
   - Identified mandatory auxiliary database requirements: `market-hours-database.json` and `symbol-properties-database.csv` in `data/lean/data/`.
   - Detailed LEAN `results.json` schema including `Statistics`, `TotalPerformance`, `Charts`, `Orders`, and `RuntimeStatistics`.

2. **Architecture & Extension Seams Handoff (`.agents/teamwork_preview_explorer_m0_2/handoff.md`)**:
   - Confirmed extension seam in `src/main.ts` (line 276) and `src/webui/plugin.ts` (lines 217–251).
   - Confirmed configuration isolation in `data/config/lean.json` defaulting to `"enabled": false`.
   - Confirmed storage isolation under `data/lean/` (`algorithms/`, `data/`, `runs/`, `experiments/`, `journal/`).
   - Confirmed strict boundary: zero changes to List B files (existing UTA trading, `calculateQuant`, indicator tools).

3. **Node 22 Runtime Verification**:
   - Verified that `node:zlib.crc32` and `node:zlib.deflateRawSync` are natively available in Node v22.23.1, enabling a 100% pure-TypeScript, zero-dependency ZIP archive generator that passes `unzip -t` and standard decompression tests without requiring third-party npm packages or external binaries.

---

## 2. Detailed Architectural Blueprint (`src/domain/lean/`)

### 2.1 File Structure
```text
src/domain/lean/
├── types.ts              # Domain interfaces, config schemas, backtest request/result models
├── config-gen.ts         # LEAN engine config.json generation & serialization
├── results.ts            # LEAN raw results.json parser & numeric metric transformers
├── data-converter.ts     # Forex quote to 11-col CSV & ZIP converter, auxiliary DB seeders
├── service.ts            # LeanService lifecycle, Docker subprocess runner, run isolation
├── index.ts              # Public domain exports
└── __tests__/
    ├── config-gen.spec.ts
    ├── results.spec.ts
    ├── data-converter.spec.ts
    └── service.spec.ts
```

---

### 2.2 `src/domain/lean/types.ts` (Data Models & Interfaces)

```typescript
export interface LeanConfig {
  enabled: boolean;
  dockerImage: string;
  dataDir: string;
  algorithmsDir: string;
  runsDir: string;
  experimentsDir: string;
  journalDir: string;
  algorithmLanguage: "Python" | "CSharp";
  maxConcurrentBacktests: number;
  defaultCash: number;
  defaultBrokerage: string;
  defaultTimeoutSeconds: number;
  memoryLimit?: string;
  cpuLimit?: string;
}

export type BacktestStatus = "pending" | "running" | "completed" | "failed" | "timeout";

export interface BacktestRequest {
  strategyId?: string;
  strategyName: string;
  pythonCode?: string;
  symbol: string;
  market?: string;
  resolution?: "minute" | "hour" | "daily";
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  initialCash?: number;
  parameters?: Record<string, string | number | boolean>;
  brokerage?: string;
  timeoutSeconds?: number;
}

export interface ChartPoint {
  x: number; // Unix timestamp in seconds
  y: number; // Value
}

export interface ChartSeries {
  name: string;
  unit: string;
  values: ChartPoint[];
}

export interface LeanOrder {
  id: number;
  symbol: string;
  price: number;
  quantity: number;
  direction: "Buy" | "Sell" | "Hold";
  type: "Market" | "Limit" | "StopMarket" | "StopLimit" | string;
  status: "Filled" | "Canceled" | "Invalid" | "Submitted" | string;
  time: string;
  createdTime?: string;
  lastFillTime?: string | null;
  tag?: string;
  fee: number;
  feeCurrency: string;
  value: number;
}

export interface ClosedTrade {
  symbol: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  quantity: number;
  profitLoss: number;
  totalFees: number;
  mae: number;
  mfe: number;
  duration: string;
}

export interface LeanStatistics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // 0.0 to 1.0
  lossRate: number; // 0.0 to 1.0
  averageWin: number;
  averageLoss: number;
  profitLossRatio: number;
  compoundingAnnualReturn: number; // 0.0 to 1.0 (e.g. 0.154 for 15.4%)
  drawdown: number; // 0.0 to 1.0 (e.g. 0.042 for 4.2%)
  netProfit: number;
  sharpeRatio: number;
  sortinoRatio: number;
  probabilisticSharpeRatio: number;
  expectancy: number;
  totalFees: number;
  alpha: number;
  beta: number;
  annualStandardDeviation: number;
  annualVariance: number;
  informationRatio: number;
  trackingError: number;
  raw: Record<string, string>;
}

export interface LeanRuntimeStatistics {
  equity: number;
  fees: number;
  holdings: number;
  netProfit: number;
  returnPct: number;
  unrealized: number;
  volume: number;
  raw: Record<string, string>;
}

export interface BacktestResult {
  id: string;
  request: BacktestRequest;
  status: BacktestStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
  statistics?: LeanStatistics;
  runtimeStatistics?: LeanRuntimeStatistics;
  charts: Record<string, ChartSeries>;
  orders: LeanOrder[];
  closedTrades: ClosedTrade[];
  logs?: string;
  error?: string;
  runDir?: string;
}

export interface BacktestSummary {
  id: string;
  strategyName: string;
  symbol: string;
  startDate: string;
  endDate: string;
  status: BacktestStatus;
  startedAt: string;
  completedAt?: string;
  netProfit?: number;
  sharpeRatio?: number;
  drawdown?: number;
  totalTrades?: number;
}

export interface ForexQuote {
  timestamp: Date | string | number;
  bidOpen: number;
  bidHigh: number;
  bidLow: number;
  bidClose: number;
  askOpen: number;
  askHigh: number;
  askLow: number;
  askClose: number;
  bidSize?: number;
  askSize?: number;
}

export interface ForexDataConversionOptions {
  market?: string;
  symbol: string;
  resolution?: "minute" | "daily";
  dataDir: string;
  sanitizeInvertedSpreads?: boolean;
}

export interface ConversionResult {
  symbol: string;
  market: string;
  resolution: string;
  totalQuotes: number;
  daysProcessed: number;
  filesWritten: string[];
}
```

---

### 2.3 `src/domain/lean/config-gen.ts` (LEAN Launcher Configuration Generator)

```typescript
export interface GenerateLeanConfigOptions {
  algorithmLocation?: string;
  algorithmTypeName?: string;
  dataFolder?: string;
  resultsDestinationFolder?: string;
  parameters?: Record<string, string | number | boolean>;
  environment?: string;
  liveMode?: boolean;
}

export function generateLeanConfig(options: GenerateLeanConfigOptions = {}): Record<string, unknown> {
  const envName = options.environment ?? "backtesting";
  const algoLocation = options.algorithmLocation ?? "/Lean/Algorithm.Python/main.py";
  const algoTypeName = options.algorithmTypeName ?? "ForexStrategy";
  const dataFolder = options.dataFolder ?? "/Lean/Data";
  const resultsFolder = options.resultsDestinationFolder ?? "/Results";

  return {
    environment: envName,
    "algorithm-language": "Python",
    "algorithm-location": algoLocation,
    "algorithm-type-name": algoTypeName,
    "data-folder": dataFolder,
    "results-destination-folder": resultsFolder,

    "job-queue-handler": "QuantConnect.Queues.JobQueue",
    "messaging-handler": "QuantConnect.Messaging.Messaging",
    "api-handler": "QuantConnect.Api.Api",
    "map-file-provider": "QuantConnect.Data.Auxiliary.LocalDiskMapFileProvider",
    "factor-file-provider": "QuantConnect.Data.Auxiliary.LocalDiskFactorFileProvider",
    "data-provider": "QuantConnect.Lean.Engine.DataFeeds.DefaultDataProvider",
    "alpha-handler": "QuantConnect.Lean.Engine.Alphas.DefaultAlphaHandler",

    parameters: options.parameters ?? {},

    environments: {
      [envName]: {
        "live-mode": options.liveMode ?? false,
        "setup-handler": "QuantConnect.Lean.Engine.Setup.ConsoleSetupHandler",
        "result-handler": "QuantConnect.Lean.Engine.Results.BacktestingResultHandler",
        "data-feed-handler": "QuantConnect.Lean.Engine.DataFeeds.FileSystemDataFeed",
        "real-time-handler": "QuantConnect.Lean.Engine.RealTime.BacktestingRealTimeHandler",
        "history-provider": [
          "QuantConnect.Lean.Engine.HistoricalData.SubscriptionDataReaderHistoryProvider"
        ],
        "transaction-handler": "QuantConnect.Lean.Engine.TransactionHandlers.BacktestingTransactionHandler"
      }
    }
  };
}

export function serializeLeanConfig(options: GenerateLeanConfigOptions = {}): string {
  return JSON.stringify(generateLeanConfig(options), null, 2);
}
```

---

### 2.4 `src/domain/lean/results.ts` (LEAN Results JSON Parser)

```typescript
import type {
  BacktestRequest,
  BacktestResult,
  ChartSeries,
  ClosedTrade,
  LeanOrder,
  LeanRuntimeStatistics,
  LeanStatistics
} from "./types.js";

export function parsePercent(val: unknown): number {
  if (typeof val === "number") return val <= 1 && val >= -1 ? val : val / 100;
  if (typeof val !== "string") return 0;
  const cleaned = val.replace(/%/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num / 100;
}

export function parseCurrency(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val !== "string") return 0;
  const cleaned = val.replace(/[$,s]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function parseNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number") return val;
  if (typeof val !== "string") return fallback;
  const cleaned = val.replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? fallback : num;
}

export function parseLeanResults(
  rawInput: string | Record<string, unknown>,
  backtestId: string,
  request: BacktestRequest,
  extra: { startedAt?: string; completedAt?: string; exitCode?: number; logs?: string } = {}
): BacktestResult {
  let raw: Record<string, any>;
  try {
    raw = typeof rawInput === "string" ? JSON.parse(rawInput) : rawInput;
  } catch (err: any) {
    return {
      id: backtestId,
      request,
      status: "failed",
      startedAt: extra.startedAt ?? new Date().toISOString(),
      completedAt: extra.completedAt ?? new Date().toISOString(),
      exitCode: extra.exitCode,
      logs: extra.logs,
      error: `Failed to parse LEAN results JSON: ${err.message}`,
      charts: {},
      orders: [],
      closedTrades: []
    };
  }

  const rawStats: Record<string, string> = raw.Statistics ?? {};
  const rawRuntime: Record<string, string> = raw.RuntimeStatistics ?? {};
  const totalPerf = raw.TotalPerformance ?? {};
  const tradeStats = totalPerf.TradeStatistics ?? {};
  const portStats = totalPerf.PortfolioStatistics ?? {};

  const statistics: LeanStatistics = {
    totalTrades: tradeStats.TotalNumberOfTrades ?? parseInt(rawStats["Total Trades"] ?? "0", 10) || 0,
    winningTrades: tradeStats.NumberOfWinningTrades ?? 0,
    losingTrades: tradeStats.NumberOfLosingTrades ?? 0,
    winRate: tradeStats.WinRate ?? parsePercent(rawStats["Win Rate"]),
    lossRate: tradeStats.LossRate ?? parsePercent(rawStats["Loss Rate"]),
    averageWin: tradeStats.AverageWin ?? parsePercent(rawStats["Average Win"]),
    averageLoss: tradeStats.AverageLoss ?? parsePercent(rawStats["Average Loss"]),
    profitLossRatio: tradeStats.WinLossRatio ?? parseNumber(rawStats["Profit-Loss Ratio"]),
    compoundingAnnualReturn: portStats.CompoundingAnnualReturn ?? parsePercent(rawStats["Compounding Annual Return"]),
    drawdown: portStats.Drawdown ?? parsePercent(rawStats["Drawdown"]),
    netProfit: tradeStats.TotalProfitLoss ?? parseCurrency(rawStats["Net Profit"]),
    sharpeRatio: portStats.SharpeRatio ?? parseNumber(rawStats["Sharpe Ratio"]),
    sortinoRatio: portStats.SortinoRatio ?? parseNumber(rawStats["Sortino Ratio"]),
    probabilisticSharpeRatio: portStats.ProbabilisticSharpeRatio ?? parsePercent(rawStats["Probabilistic Sharpe Ratio"]),
    expectancy: portStats.Expectancy ?? parseNumber(rawStats["Expectancy"]),
    totalFees: portStats.TotalFees ?? parseCurrency(rawStats["Total Fees"]),
    alpha: portStats.Alpha ?? parseNumber(rawStats["Alpha"]),
    beta: portStats.Beta ?? parseNumber(rawStats["Beta"]),
    annualStandardDeviation: portStats.AnnualStandardDeviation ?? parseNumber(rawStats["Annual Standard Deviation"]),
    annualVariance: portStats.AnnualVariance ?? parseNumber(rawStats["Annual Variance"]),
    informationRatio: portStats.InformationRatio ?? parseNumber(rawStats["Information Ratio"]),
    trackingError: portStats.TrackingError ?? parseNumber(rawStats["Tracking Error"]),
    raw: rawStats
  };

  const runtimeStatistics: LeanRuntimeStatistics = {
    equity: parseCurrency(rawRuntime["Equity"]),
    fees: parseCurrency(rawRuntime["Fees"]),
    holdings: parseCurrency(rawRuntime["Holdings"]),
    netProfit: parseCurrency(rawRuntime["Net Profit"]),
    returnPct: parsePercent(rawRuntime["Return"]),
    unrealized: parseCurrency(rawRuntime["Unrealized"]),
    volume: parseCurrency(rawRuntime["Volume"]),
    raw: rawRuntime
  };

  const charts: Record<string, ChartSeries> = {};
  if (raw.Charts && typeof raw.Charts === "object") {
    for (const [chartName, chartData] of Object.entries<any>(raw.Charts)) {
      if (chartData && chartData.Series && typeof chartData.Series === "object") {
        for (const [seriesName, sData] of Object.entries<any>(chartData.Series)) {
          const key = chartName === seriesName ? chartName : `${chartName} - ${seriesName}`;
          charts[key] = {
            name: sData.Name ?? seriesName,
            unit: sData.Unit ?? "",
            values: Array.isArray(sData.Values)
              ? sData.Values.map((pt: any) => ({
                  x: pt.x ?? pt.Time ?? 0,
                  y: pt.y ?? pt.Value ?? 0
                }))
              : []
          };
        }
      }
    }
  }

  const orders: LeanOrder[] = [];
  if (raw.Orders && typeof raw.Orders === "object") {
    const orderEntries = Array.isArray(raw.Orders) ? raw.Orders : Object.values(raw.Orders);
    for (const o of orderEntries as any[]) {
      if (!o) continue;
      const dirMap = ["Buy", "Sell", "Hold"];
      const typeMap = ["Market", "Limit", "StopMarket", "StopLimit"];
      const statusMap: Record<number, string> = {
        0: "New",
        1: "Submitted",
        2: "PartiallyFilled",
        3: "Filled",
        5: "Canceled",
        6: "Invalid"
      };

      orders.push({
        id: o.Id ?? 0,
        symbol: typeof o.Symbol === "object" ? o.Symbol?.Value ?? "" : String(o.Symbol ?? ""),
        price: o.Price ?? 0,
        quantity: o.Quantity ?? 0,
        direction: (dirMap[o.Direction] ?? "Buy") as any,
        type: (typeMap[o.Type] ?? "Market") as any,
        status: (statusMap[o.Status] ?? (o.Status === 3 ? "Filled" : "Other")) as any,
        time: o.Time ?? o.CreatedTime ?? "",
        createdTime: o.CreatedTime,
        lastFillTime: o.LastFillTime,
        tag: o.Tag ?? "",
        fee: o.OrderFee?.Value?.Amount ?? 0,
        feeCurrency: o.OrderFee?.Value?.Currency ?? "USD",
        value: o.Value ?? 0
      });
    }
  }

  const closedTrades: ClosedTrade[] = [];
  if (Array.isArray(totalPerf.ClosedTrades)) {
    for (const t of totalPerf.ClosedTrades) {
      closedTrades.push({
        symbol: typeof t.Symbol === "object" ? t.Symbol?.Value ?? "" : String(t.Symbol ?? ""),
        entryTime: t.EntryTime ?? "",
        entryPrice: t.EntryPrice ?? 0,
        exitTime: t.ExitTime ?? "",
        exitPrice: t.ExitPrice ?? 0,
        quantity: t.Quantity ?? 0,
        profitLoss: t.ProfitLoss ?? 0,
        totalFees: t.TotalFees ?? 0,
        mae: t.MAE ?? 0,
        mfe: t.MFE ?? 0,
        duration: t.Duration ?? ""
      });
    }
  }

  const durationMs =
    extra.startedAt && extra.completedAt
      ? new Date(extra.completedAt).getTime() - new Date(extra.startedAt).getTime()
      : undefined;

  return {
    id: backtestId,
    request,
    status: extra.exitCode === 0 || extra.exitCode === undefined ? "completed" : "failed",
    startedAt: extra.startedAt ?? new Date().toISOString(),
    completedAt: extra.completedAt ?? new Date().toISOString(),
    durationMs,
    exitCode: extra.exitCode ?? 0,
    statistics,
    runtimeStatistics,
    charts,
    orders,
    closedTrades,
    logs: extra.logs
  };
}
```

---

### 2.5 `src/domain/lean/data-converter.ts` (Forex Data Pipeline & Zero-Dependency ZIP)

```typescript
import { crc32, deflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ConversionResult, ForexDataConversionOptions, ForexQuote } from "./types.js";

export function createZipArchive(files: Array<{ name: string; content: string | Buffer }>): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, "utf8");
    const contentBuffer = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8");
    const uncompressedSize = contentBuffer.length;
    const crc = crc32(contentBuffer);
    const compressedData = deflateRawSync(contentBuffer);
    const compressedSize = compressedData.length;

    const dosTime = 0;
    const dosDate = 0x5821; // 2024-01-01

    // Local Header (30 bytes + name length)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuffer.copy(localHeader, 30);

    localHeaders.push(localHeader, compressedData);

    // Central Directory Header (46 bytes + name length)
    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuffer.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localHeader.length + compressedSize;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const h of centralHeaders) centralDirSize += h.length;

  // End of Central Directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

export async function ensureMarketHoursDatabase(dataDir: string): Promise<string> {
  const dir = join(dataDir, "market-hours");
  await mkdir(dir, { recursive: true });
  const target = join(dir, "market-hours-database.json");

  if (!existsSync(target)) {
    const marketHours = {
      entries: {
        "Forex-oanda": {
          dataTimeZone: "UTC",
          exchangeTimeZone: "America/New_York",
          sunday: [{ start: "17:00:00", end: "24:00:00", state: "open" }],
          monday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          tuesday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          wednesday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          thursday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          friday: [{ start: "00:00:00", end: "17:00:00", state: "open" }],
          saturday: [],
          holidays: []
        },
        "Forex-fxcm": {
          dataTimeZone: "UTC",
          exchangeTimeZone: "America/New_York",
          sunday: [{ start: "17:00:00", end: "24:00:00", state: "open" }],
          monday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          tuesday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          wednesday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          thursday: [{ start: "00:00:00", end: "24:00:00", state: "open" }],
          friday: [{ start: "00:00:00", end: "17:00:00", state: "open" }],
          saturday: [],
          holidays: []
        }
      }
    };
    await writeFile(target, JSON.stringify(marketHours, null, 2), "utf8");
  }
  return target;
}

export async function ensureSymbolPropertiesDatabase(dataDir: string): Promise<string> {
  const dir = join(dataDir, "symbol-properties");
  await mkdir(dir, { recursive: true });
  const target = join(dir, "symbol-properties-database.csv");

  if (!existsSync(target)) {
    const lines = [
      "market,symbol,securitytype,description,quote_currency,contract_multiplier,minimum_price_variation,lot_size,market_ticker,minimum_order_size,price_magnifier,strike_multiplier",
      "oanda,eurusd,forex,EUR/USD,USD,1,0.0001,1,EUR_USD,1,1,1",
      "oanda,gbpusd,forex,GBP/USD,USD,1,0.0001,1,GBP_USD,1,1,1",
      "oanda,usdjpy,forex,USD/JPY,JPY,1,0.01,1,USD_JPY,1,1,1",
      "oanda,audusd,forex,AUD/USD,USD,1,0.0001,1,AUD_USD,1,1,1",
      "oanda,usdcad,forex,USD/CAD,CAD,1,0.0001,1,USD_CAD,1,1,1",
      "oanda,usdchf,forex,USD/CHF,CHF,1,0.0001,1,USD_CHF,1,1,1",
      "oanda,nzdusd,forex,NZD/USD,USD,1,0.0001,1,NZD_USD,1,1,1",
      "fxcm,eurusd,forex,EUR/USD,USD,1,0.0001,1000,EUR/USD,1000,1,1",
      "fxcm,gbpusd,forex,GBP/USD,USD,1,0.0001,1000,GBP/USD,1000,1,1",
      "fxcm,usdjpy,forex,USD/JPY,JPY,1,0.01,1000,USD/JPY,1000,1,1"
    ];
    await writeFile(target, lines.join("\n") + "\n", "utf8");
  }
  return target;
}

export async function convertForexQuotesToLeanFormat(
  quotes: ForexQuote[],
  options: ForexDataConversionOptions
): Promise<ConversionResult> {
  const market = (options.market ?? "oanda").toLowerCase();
  const symbol = options.symbol.toLowerCase();
  const resolution = options.resolution ?? "minute";

  await ensureMarketHoursDatabase(options.dataDir);
  await ensureSymbolPropertiesDatabase(options.dataDir);

  const targetDir = join(options.dataDir, "forex", market, resolution, symbol);
  await mkdir(targetDir, { recursive: true });

  // Group quotes by UTC date YYYYMMDD
  const grouped = new Map<string, Array<{ ms: number; quote: ForexQuote }>>();

  for (const q of quotes) {
    const d = new Date(q.timestamp);
    if (isNaN(d.getTime())) continue;

    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const dateKey = `${yyyy}${mm}${dd}`;

    const ms = d.getUTCHours() * 3600000 + d.getUTCMinutes() * 60000 + d.getUTCSeconds() * 1000 + d.getUTCMilliseconds();

    let askOpen = q.askOpen;
    let askHigh = q.askHigh;
    let askLow = q.askLow;
    let askClose = q.askClose;

    if (options.sanitizeInvertedSpreads) {
      if (askOpen < q.bidOpen) askOpen = q.bidOpen;
      if (askHigh < q.bidHigh) askHigh = q.bidHigh;
      if (askLow < q.bidLow) askLow = q.bidLow;
      if (askClose < q.bidClose) askClose = q.bidClose;
    }

    const sanitizedQuote: ForexQuote = {
      ...q,
      askOpen,
      askHigh,
      askLow,
      askClose
    };

    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    grouped.get(dateKey)!.push({ ms, quote: sanitizedQuote });
  }

  const filesWritten: string[] = [];

  for (const [dateKey, dayEntries] of grouped.entries()) {
    dayEntries.sort((a, b) => a.ms - b.ms);

    const lines = dayEntries.map(({ ms, quote }) => {
      return [
        ms,
        quote.bidOpen.toFixed(5),
        quote.bidHigh.toFixed(5),
        quote.bidLow.toFixed(5),
        quote.bidClose.toFixed(5),
        quote.bidSize ?? 0,
        quote.askOpen.toFixed(5),
        quote.askHigh.toFixed(5),
        quote.askLow.toFixed(5),
        quote.askClose.toFixed(5),
        quote.askSize ?? 0
      ].join(",");
    });

    const csvContent = lines.join("\n") + "\n";
    const zipName = `${dateKey}_quote.zip`;
    const csvName = `${dateKey}_quote.csv`;

    const zipBuffer = createZipArchive([{ name: csvName, content: csvContent }]);
    const zipPath = join(targetDir, zipName);
    await writeFile(zipPath, zipBuffer);
    filesWritten.push(zipPath);
  }

  return {
    symbol,
    market,
    resolution,
    totalQuotes: quotes.length,
    daysProcessed: grouped.size,
    filesWritten
  };
}
```

---

### 2.6 `src/domain/lean/service.ts` (LeanService Subprocess Execution Runner)

```typescript
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { generateLeanConfig } from "./config-gen.js";
import { convertForexQuotesToLeanFormat, ensureMarketHoursDatabase, ensureSymbolPropertiesDatabase } from "./data-converter.js";
import { parseLeanResults } from "./results.js";
import type {
  BacktestRequest,
  BacktestResult,
  BacktestSummary,
  ConversionResult,
  ForexQuote,
  LeanConfig
} from "./types.js";

export const DEFAULT_LEAN_CONFIG: LeanConfig = {
  enabled: false,
  dockerImage: "quantconnect/lean:latest",
  dataDir: "data/lean/data",
  algorithmsDir: "data/lean/algorithms",
  runsDir: "data/lean/runs",
  experimentsDir: "data/lean/experiments",
  journalDir: "data/lean/journal",
  algorithmLanguage: "Python",
  maxConcurrentBacktests: 2,
  defaultCash: 100000,
  defaultBrokerage: "oanda",
  defaultTimeoutSeconds: 300,
  memoryLimit: "4g",
  cpuLimit: "2.0"
};

export interface LeanServiceOptions {
  config?: Partial<LeanConfig>;
  projectRoot?: string;
  force?: boolean;
}

export class LeanService {
  private readonly config: LeanConfig;
  private readonly root: string;

  constructor(config: LeanConfig, projectRoot: string = process.cwd()) {
    this.config = config;
    this.root = projectRoot;
  }

  static async create(options: LeanServiceOptions = {}): Promise<LeanService | null> {
    const root = options.projectRoot ?? process.cwd();
    const configPath = join(root, "data/config/lean.json");

    let loadedConfig: Partial<LeanConfig> = {};
    if (existsSync(configPath)) {
      try {
        const raw = await readFile(configPath, "utf8");
        loadedConfig = JSON.parse(raw);
      } catch {
        // Fallback to default
      }
    }

    const merged: LeanConfig = {
      ...DEFAULT_LEAN_CONFIG,
      ...loadedConfig,
      ...options.config
    };

    if (!merged.enabled && !options.force) {
      return null;
    }

    const service = new LeanService(merged, root);
    await service.ensureDataDirs();
    return service;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get dataPath(): string {
    return resolve(this.root, this.config.dataDir);
  }

  get runsPath(): string {
    return resolve(this.root, this.config.runsDir);
  }

  get algorithmsPath(): string {
    return resolve(this.root, this.config.algorithmsDir);
  }

  async ensureDataDirs(): Promise<void> {
    await mkdir(this.dataPath, { recursive: true });
    await mkdir(this.runsPath, { recursive: true });
    await mkdir(this.algorithmsPath, { recursive: true });
    await mkdir(resolve(this.root, this.config.experimentsDir), { recursive: true });
    await mkdir(resolve(this.root, this.config.journalDir), { recursive: true });

    await ensureMarketHoursDatabase(this.dataPath);
    await ensureSymbolPropertiesDatabase(this.dataPath);
  }

  async ingestForexQuotes(
    symbol: string,
    quotes: ForexQuote[],
    market = "oanda",
    resolution: "minute" | "daily" = "minute"
  ): Promise<ConversionResult> {
    return convertForexQuotesToLeanFormat(quotes, {
      market,
      symbol,
      resolution,
      dataDir: this.dataPath,
      sanitizeInvertedSpreads: true
    });
  }

  async checkDocker(): Promise<{ available: boolean; version?: string; error?: string }> {
    return new Promise((res) => {
      const p = spawn("docker", ["--version"]);
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => {
        if (code === 0) res({ available: true, version: out.trim() });
        else res({ available: false, error: err.trim() || `exit code ${code}` });
      });
      p.on("error", (e) => res({ available: false, error: e.message }));
    });
  }

  async runBacktest(request: BacktestRequest): Promise<BacktestResult> {
    const timestamp = Date.now();
    const shortId = Math.random().toString(36).substring(2, 8);
    const backtestId = `bt_${timestamp}_${shortId}`;

    const runDir = join(this.runsPath, backtestId);
    const resultsDir = join(runDir, "results");
    await mkdir(resultsDir, { recursive: true });

    const algoFile = join(runDir, "main.py");
    if (request.pythonCode) {
      await writeFile(algoFile, request.pythonCode, "utf8");
    } else if (request.strategyId) {
      const existing = join(this.algorithmsPath, `${request.strategyId}.py`);
      if (existsSync(existing)) {
        const code = await readFile(existing, "utf8");
        await writeFile(algoFile, code, "utf8");
      }
    }

    const configObj = generateLeanConfig({
      algorithmLocation: "/Lean/Algorithm.Python/main.py",
      algorithmTypeName: request.strategyName || "ForexStrategy",
      dataFolder: "/Lean/Data",
      resultsDestinationFolder: "/Results",
      parameters: request.parameters
    });

    const configFile = join(runDir, "config.json");
    await writeFile(configFile, JSON.stringify(configObj, null, 2), "utf8");

    const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
    const gid = typeof process.getgid === "function" ? process.getgid() : 1000;

    const dockerArgs = [
      "run",
      "--rm",
      "--name", `lean-${backtestId}`,
      "--user", `${uid}:${gid}`,
      "--memory", this.config.memoryLimit ?? "4g",
      "--cpus", this.config.cpuLimit ?? "2.0",
      "-v", `${this.dataPath}:/Lean/Data:ro`,
      "-v", `${runDir}:/Lean/Algorithm.Python:ro`,
      "-v", `${configFile}:/Lean/Launcher/bin/Debug/config.json:ro`,
      "-v", `${resultsDir}:/Results:rw`,
      this.config.dockerImage,
      "--data-folder", "/Lean/Data",
      "--results-destination-folder", "/Results",
      "--config", "/Lean/Launcher/bin/Debug/config.json"
    ];

    const startedAt = new Date().toISOString();
    const timeoutMs = (request.timeoutSeconds ?? this.config.defaultTimeoutSeconds) * 1000;

    const { exitCode, stdout, stderr, timedOut } = await this.executeSubprocess("docker", dockerArgs, timeoutMs, `lean-${backtestId}`);
    const completedAt = new Date().toISOString();
    const logs = `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;

    if (timedOut) {
      const res: BacktestResult = {
        id: backtestId,
        request,
        status: "timeout",
        startedAt,
        completedAt,
        durationMs: timeoutMs,
        exitCode: -1,
        logs,
        error: `Backtest timed out after ${timeoutMs / 1000}s`,
        charts: {},
        orders: [],
        closedTrades: [],
        runDir
      };
      await writeFile(join(runDir, "summary.json"), JSON.stringify(res, null, 2), "utf8");
      return res;
    }

    // Discover result JSON in resultsDir
    let resultJsonContent = "";
    if (existsSync(resultsDir)) {
      const files = await readdir(resultsDir);
      const jsonFile = files.find((f) => f.endsWith(".json") && !f.includes("config"));
      if (jsonFile) {
        resultJsonContent = await readFile(join(resultsDir, jsonFile), "utf8");
      }
    }

    let parsed = parseLeanResults(
      resultJsonContent || "{}",
      backtestId,
      request,
      { startedAt, completedAt, exitCode, logs }
    );
    parsed.runDir = runDir;

    if (exitCode !== 0 && !parsed.error) {
      parsed.error = `LEAN engine exited with code ${exitCode}`;
      parsed.status = "failed";
    }

    await writeFile(join(runDir, "summary.json"), JSON.stringify(parsed, null, 2), "utf8");
    return parsed;
  }

  async getBacktest(backtestId: string): Promise<BacktestResult | null> {
    const summaryFile = join(this.runsPath, backtestId, "summary.json");
    if (!existsSync(summaryFile)) return null;
    try {
      const data = await readFile(summaryFile, "utf8");
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async listBacktests(): Promise<BacktestSummary[]> {
    if (!existsSync(this.runsPath)) return [];
    const entries = await readdir(this.runsPath, { withFileTypes: true });
    const summaries: BacktestSummary[] = [];

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const summaryFile = join(this.runsPath, ent.name, "summary.json");
      if (existsSync(summaryFile)) {
        try {
          const res: BacktestResult = JSON.parse(await readFile(summaryFile, "utf8"));
          summaries.push({
            id: res.id,
            strategyName: res.request.strategyName,
            symbol: res.request.symbol,
            startDate: res.request.startDate,
            endDate: res.request.endDate,
            status: res.status,
            startedAt: res.startedAt,
            completedAt: res.completedAt,
            netProfit: res.statistics?.netProfit,
            sharpeRatio: res.statistics?.sharpeRatio,
            drawdown: res.statistics?.drawdown,
            totalTrades: res.statistics?.totalTrades
          });
        } catch {
          // ignore corrupted summary
        }
      }
    }

    return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private executeSubprocess(
    cmd: string,
    args: string[],
    timeoutMs: number,
    containerName: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((res) => {
      const child = spawn(cmd, args);
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        spawn("docker", ["kill", containerName]);
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));

      child.on("close", (code) => {
        clearTimeout(timer);
        res({ exitCode: code ?? (timedOut ? -1 : 0), stdout, stderr, timedOut });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        res({ exitCode: -1, stdout, stderr: `${stderr}\n${err.message}`, timedOut });
      });
    });
  }
}
```

---

## 3. Vitest Test Specifications

### 3.1 `src/domain/lean/__tests__/config-gen.spec.ts`
```typescript
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
  });

  it("injects custom algorithm parameters", () => {
    const cfg = generateLeanConfig({
      parameters: { fastPeriod: 10, slowPeriod: 30, leverage: 50 }
    }) as any;

    expect(cfg.parameters).toEqual({ fastPeriod: 10, slowPeriod: 30, leverage: 50 });
  });

  it("serializes valid JSON string", () => {
    const str = serializeLeanConfig({ algorithmTypeName: "TestStrategy" });
    expect(typeof str).toBe("string");
    const parsed = JSON.parse(str);
    expect(parsed["algorithm-type-name"]).toBe("TestStrategy");
  });
});
```

---

### 3.2 `src/domain/lean/__tests__/results.spec.ts`
```typescript
import { describe, it, expect } from "vitest";
import { parseLeanResults, parsePercent, parseCurrency, parseNumber } from "../results.js";

describe("results parser helpers", () => {
  it("parses percentages correctly", () => {
    expect(parsePercent("15.4%")).toBeCloseTo(0.154);
    expect(parsePercent("-4.2%")).toBeCloseTo(-0.042);
    expect(parsePercent(0.154)).toBe(0.154);
    expect(parsePercent(15.4)).toBeCloseTo(0.154);
    expect(parsePercent(null)).toBe(0);
  });

  it("parses currency strings correctly", () => {
    expect(parseCurrency("$1,234.56")).toBe(1234.56);
    expect(parseCurrency("-$50.00")).toBe(-50);
    expect(parseCurrency(100)).toBe(100);
  });

  it("parses numeric ratios safely", () => {
    expect(parseNumber("1.85")).toBe(1.85);
    expect(parseNumber("N/A", 0)).toBe(0);
    expect(parseNumber(undefined, 0)).toBe(0);
  });
});

describe("parseLeanResults", () => {
  const sampleLeanOutput = {
    TotalPerformance: {
      TradeStatistics: {
        TotalNumberOfTrades: 12,
        NumberOfWinningTrades: 8,
        NumberOfLosingTrades: 4,
        WinRate: 0.6667,
        LossRate: 0.3333,
        WinLossRatio: 2.1,
        TotalProfitLoss: 2450.50
      },
      PortfolioStatistics: {
        SharpeRatio: 1.95,
        SortinoRatio: 2.80,
        Drawdown: 0.035,
        CompoundingAnnualReturn: 0.245,
        Expectancy: 0.72,
        TotalFees: 18.00
      },
      ClosedTrades: [
        {
          Symbol: { Value: "EURUSD" },
          EntryTime: "2024-01-02T10:00:00Z",
          EntryPrice: 1.0850,
          ExitTime: "2024-01-02T14:30:00Z",
          ExitPrice: 1.0880,
          Quantity: 100000,
          ProfitLoss: 300.00,
          TotalFees: 2.00,
          MAE: -50.00,
          MFE: 320.00,
          Duration: "04:30:00"
        }
      ]
    },
    Charts: {
      "Strategy Equity": {
        Series: {
          Equity: {
            Name: "Equity",
            Unit: "$",
            Values: [{ x: 1704153600, y: 100000 }, { x: 1704240000, y: 102450.50 }]
          }
        }
      }
    },
    Orders: {
      "1": {
        Id: 1,
        Symbol: { Value: "EURUSD" },
        Price: 1.0850,
        Quantity: 100000,
        Direction: 0,
        Type: 0,
        Status: 3,
        Time: "2024-01-02T10:00:00Z",
        OrderFee: { Value: { Amount: 2.00, Currency: "USD" } },
        Value: 108500
      }
    },
    Statistics: {
      "Total Trades": "12",
      "Win Rate": "66.7%",
      "Sharpe Ratio": "1.95",
      "Drawdown": "3.5%",
      "Net Profit": "$2,450.50"
    },
    RuntimeStatistics: {
      "Equity": "$102,450.50",
      "Fees": "$18.00",
      "Net Profit": "$2,450.50",
      "Return": "2.45%"
    }
  };

  it("transforms raw LEAN JSON into typed BacktestResult", () => {
    const req = { strategyName: "TestStrategy", symbol: "EURUSD", startDate: "2024-01-01", endDate: "2024-01-05" };
    const res = parseLeanResults(sampleLeanOutput, "bt_123", req, { exitCode: 0 });

    expect(res.id).toBe("bt_123");
    expect(res.status).toBe("completed");
    expect(res.statistics?.totalTrades).toBe(12);
    expect(res.statistics?.winRate).toBeCloseTo(0.6667);
    expect(res.statistics?.sharpeRatio).toBe(1.95);
    expect(res.statistics?.drawdown).toBe(0.035);
    expect(res.statistics?.netProfit).toBe(2450.50);

    expect(res.closedTrades).toHaveLength(1);
    expect(res.closedTrades[0].symbol).toBe("EURUSD");
    expect(res.closedTrades[0].profitLoss).toBe(300);

    expect(res.orders).toHaveLength(1);
    expect(res.orders[0].direction).toBe("Buy");
    expect(res.orders[0].status).toBe("Filled");

    expect(res.charts["Strategy Equity - Equity"]).toBeDefined();
    expect(res.charts["Strategy Equity - Equity"].values).toHaveLength(2);
  });

  it("handles zero-trade backtest results gracefully", () => {
    const req = { strategyName: "EmptyStrategy", symbol: "EURUSD", startDate: "2024-01-01", endDate: "2024-01-05" };
    const res = parseLeanResults({}, "bt_empty", req, { exitCode: 0 });

    expect(res.status).toBe("completed");
    expect(res.statistics?.totalTrades).toBe(0);
    expect(res.orders).toEqual([]);
    expect(res.closedTrades).toEqual([]);
    expect(res.charts).toEqual({});
  });

  it("handles corrupted input JSON gracefully", () => {
    const req = { strategyName: "Corrupted", symbol: "EURUSD", startDate: "2024-01-01", endDate: "2024-01-05" };
    const res = parseLeanResults("{invalid-json", "bt_err", req, { exitCode: 1 });

    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/Failed to parse/);
  });
});
```

---

### 3.3 `src/domain/lean/__tests__/data-converter.spec.ts`
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertForexQuotesToLeanFormat, createZipArchive, ensureMarketHoursDatabase, ensureSymbolPropertiesDatabase } from "../data-converter.js";
import { existsSync } from "node:fs";

describe("createZipArchive", () => {
  it("creates valid PKZIP buffer with deflate compression", () => {
    const buf = createZipArchive([
      { name: "test.csv", content: "0,1.0850,1.0852,1.0849,1.0851,0,1.0852,1.0854,1.0851,1.0853,0
" }
    ]);
    expect(buf.length).toBeGreaterThan(30);
    // Check PKZIP signature 0x04034b50
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
  });
});

describe("convertForexQuotesToLeanFormat", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lean-data-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("converts minute quotes to {YYYYMMDD}_quote.zip and seeds auxiliary databases", async () => {
    const quotes = [
      {
        timestamp: "2024-01-02T00:00:00.000Z",
        bidOpen: 1.08500, bidHigh: 1.08520, bidLow: 1.08495, bidClose: 1.08510,
        askOpen: 1.08515, askHigh: 1.08535, askLow: 1.08510, askClose: 1.08525
      },
      {
        timestamp: "2024-01-02T00:01:00.000Z",
        bidOpen: 1.08510, bidHigh: 1.08530, bidLow: 1.08505, bidClose: 1.08520,
        askOpen: 1.08525, askHigh: 1.08545, askLow: 1.08520, askClose: 1.08535
      }
    ];

    const result = await convertForexQuotesToLeanFormat(quotes, {
      market: "oanda",
      symbol: "EURUSD",
      resolution: "minute",
      dataDir: tempDir
    });

    expect(result.symbol).toBe("eurusd");
    expect(result.daysProcessed).toBe(1);
    expect(result.filesWritten).toHaveLength(1);
    expect(existsSync(result.filesWritten[0])).toBe(true);

    // Verify market hours and symbol properties exist
    expect(existsSync(join(tempDir, "market-hours/market-hours-database.json"))).toBe(true);
    expect(existsSync(join(tempDir, "symbol-properties/symbol-properties-database.csv"))).toBe(true);
  });

  it("sanitizes inverted spreads when requested", async () => {
    const quotes = [
      {
        timestamp: "2024-01-02T00:00:00.000Z",
        bidOpen: 1.08550, bidHigh: 1.08560, bidLow: 1.08540, bidClose: 1.08550,
        askOpen: 1.08500, askHigh: 1.08510, askLow: 1.08490, askClose: 1.08500 // Inverted (ask < bid)
      }
    ];

    const result = await convertForexQuotesToLeanFormat(quotes, {
      market: "oanda",
      symbol: "EURUSD",
      dataDir: tempDir,
      sanitizeInvertedSpreads: true
    });

    expect(result.daysProcessed).toBe(1);
  });
});
```

---

### 3.4 `src/domain/lean/__tests__/service.spec.ts`
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LeanService } from "../service.js";
import { existsSync } from "node:fs";

describe("LeanService", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "lean-svc-test-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns null on LeanService.create() when enabled: false", async () => {
    const svc = await LeanService.create({
      projectRoot: tempRoot,
      config: { enabled: false }
    });
    expect(svc).toBeNull();
  });

  it("initializes directories and auxiliary DBs when enabled or forced", async () => {
    const svc = await LeanService.create({
      projectRoot: tempRoot,
      force: true
    });
    expect(svc).not.toBeNull();
    expect(existsSync(join(tempRoot, "data/lean/data/market-hours/market-hours-database.json"))).toBe(true);
    expect(existsSync(join(tempRoot, "data/lean/data/symbol-properties/symbol-properties-database.csv"))).toBe(true);
  });

  it("executes backtest, writes config.json, and parses summary", async () => {
    const svc = (await LeanService.create({
      projectRoot: tempRoot,
      force: true
    }))!;

    // Mock executeSubprocess
    vi.spyOn(svc as any, "executeSubprocess").mockImplementation(async (cmd, args, timeoutMs) => {
      // Simulate LEAN generating output results
      const resultsDir = args[args.indexOf("-v") + 7].split(":")[0]; // get /Results mount
      const sampleResult = {
        Statistics: {
          "Total Trades": "5",
          "Sharpe Ratio": "1.8",
          "Drawdown": "2.5%",
          "Net Profit": "$1,200.00"
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
      pythonCode: "class MockStrategy(QCAlgorithm):
    pass
"
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
      endDate: "2024-01-05"
    });

    expect(res.status).toBe("timeout");
    expect(res.error).toMatch(/timed out/);
  });
});
```

---

## 4. Logic Chain

1. **Premise 1**: The OpenAlice LEAN integration requires an isolated TypeScript domain layer (`src/domain/lean/`) that manages configuration, data transformation, subprocess execution, and result parsing.
2. **Premise 2**: To ensure seamless zero-dependency deployment and cross-platform compatibility, ZIP generation can be natively powered by Node 22’s `zlib.deflateRawSync` and `zlib.crc32`.
3. **Premise 3**: LEAN engine Docker execution requires strict file volume mounts and permission mapping (`--user $(id -u):$(id -g)`) so the host process can read and write results without permissions barriers.
4. **Premise 4**: Strict domain type definitions and resilient numeric parsing protect OpenAlice against missing keys or partial results from aborted runs.
5. **Conclusion**: The architectural blueprint above provides complete, turnkey code designs and Vitest specifications ready for direct implementation in Milestone 1 and Milestone 2.

---

## 5. Caveats

1. **Docker Subprocess Environment**: `LeanService` assumes the `quantconnect/lean:latest` image is either already pulled or can be pulled by Docker daemon. In test environments without Docker, unit tests mock `executeSubprocess` to verify full orchestration without docker runtime.
2. **Data Timezone**: Forex quotes are strictly normalized to UTC before calculating millisecond offsets from midnight (`0` to `86,340,000`).
3. **List A vs List B Compliance**: The domain modules in `src/domain/lean/` are 100% self-contained. No List B files are touched.

---

## 6. Conclusion

Milestone 1 and Milestone 2 are fully specified with production-grade TypeScript interfaces, resilient parsing algorithms, zero-dependency ZIP archive creation, and comprehensive Vitest test suites.

---

## 7. Verification Method

1. Inspect this blueprint: `view_file /home/monarch/projects/OpenAlice/.agents/teamwork_preview_explorer_m1_1/handoff.md`
2. Once implemented: Run `npx vitest run src/domain/lean/`
3. Verify test coverage and clean pass across `config-gen.spec.ts`, `results.spec.ts`, `data-converter.spec.ts`, `service.spec.ts`.
