# SPECIFICATION REPORT: QuantConnect LEAN Docker & Forex Engine

**Author**: Spec Miner 3 (Archetype: Specification Miner)  
**Date**: 2026-08-29  
**Target Milestones**: Milestone 1 (Isolated Architecture & Foundation) & Milestone 2 (Forex Data Ingestion & Pipeline)  
**Status**: COMPLETE

---

## 1. Observation

### 1.1 Documents & Authoritative Sources Inspected
1. **Original User Request**: `/home/monarch/projects/OpenAlice/.agents/ORIGINAL_REQUEST.md`
   - §R2: "LEAN Engine execution must run as an isolated containerized service via Docker (`quantconnect/lean:latest`) or standalone process."
   - §R2: "The integration layer (`src/domain/lean/`) must manage configuration generation (`config.json`), historical data directory bindings, and algorithm lifecycle via subprocess orchestration."
   - §R3: "Use Python for initial LEAN algorithms via the LEAN Python bridge... Ingest appropriate sample/free historical Forex data (starting with `EURUSD`) formatted into LEAN's expected data layout (`data/lean/data/forex/...`)."
2. **Integration Plan**: `/home/monarch/.gemini/antigravity-cli/brain/764e56cc-655f-45aa-b41e-e25d14ac480e/lean-integration-plan.md`
   - Lines 101–126: Forex Data Format `{DataFolder}/forex/{market}/minute/{ticker}/{YYYYMMDD}_quote.zip` and Docker execution command.
   - Lines 367–377: `data/config/lean.json` structure with `enabled: false` default.
3. **QuantConnect LEAN Engine Source & Documentation**:
   - `QuantConnect.Lean.Engine.DataFeeds.FileSystemDataFeed`
   - `QuantConnect.Lean.Engine.Results.BacktestingResultHandler`
   - `QuantConnect.Lean.Engine.TransactionHandlers.BacktestingTransactionHandler`
   - `QuantConnect.Lean.Engine.RealTime.BacktestingRealTimeHandler`
   - `QuantConnect.Lean.Engine.HistoricalData.SubscriptionDataReaderHistoryProvider`
   - `QuantConnect.Data.Auxiliary.LocalDiskMapFileProvider`
   - `QuantConnect.Data.Auxiliary.LocalDiskFactorFileProvider`
   - `QuantConnect.Lean.Engine.DataFeeds.DefaultDataProvider`
   - `QuantConnect.Lean.Engine.Alphas.DefaultAlphaHandler`

---

## 2. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Docker Execution | Docker CLI Runner | Invokes `quantconnect/lean:latest` via containerized subprocess with isolated volume mounts. | `-v <dataDir>:/Lean/Data:ro`, `-v <algoDir>:/Lean/Algorithm.Python:ro`, `-v <configFile>:/Lean/Launcher/bin/Debug/config.json:ro`, `-v <resultsDir>:/Results:rw`, `--rm` | Exit code 0, `<resultsDir>/<algorithm-id>.json` or `results.json` generated | Non-zero exit code, stderr error logs, timeout kill | LEAN Docker Specification & Plan §2 |
| 2 | Configuration | LEAN `config.json` Generator | Emits runtime config specifying Python algorithm class, data folder paths, results directory, and backtesting handlers. | Algorithm name/path, data dir, results dir, environment parameters | Structured `config.json` with `environment: "backtesting"`, `algorithm-language: "Python"`, handlers | Invalid JSON causes engine crash on boot; missing keys fall back to defaults or throw | LEAN Launcher Configuration & Plan §10 |
| 3 | Data Pipeline | Forex QuoteBar Data Ingestor (Minute) | Formats minute Forex bid/ask quote data into LEAN directory tree and ZIP/CSV structure. | Timestamps (ms since midnight), Bid OHLC, Ask OHLC, Sizes | `{DataFolder}/forex/{market}/minute/{ticker}/{YYYYMMDD}_quote.zip` containing `{YYYYMMDD}_quote.csv` | Missing date files cause engine to skip bars without crashing | LEAN Data Specification & Plan §9 |
| 4 | Data Pipeline | Forex QuoteBar Data Ingestor (Daily) | Formats daily Forex bid/ask quote data into single ticker ZIP/CSV. | Date `YYYYMMDD 00:00`, Bid OHLC, Ask OHLC | `{DataFolder}/forex/{market}/daily/{ticker}.zip` containing `{ticker}.csv` | Corrupt CSV throws parse exception during backtest init | LEAN Data Specification |
| 5 | Data Auxiliary | Market Hours & Symbol Properties | Metadata specifying exchange trading sessions (24/5 FX) and symbol lot sizes/spread rules. | Market name, SecurityType, exchange schedule | `market-hours/market-hours-database.json`, `symbol-properties/symbol-properties-database.csv` | Engine aborts immediately if `market-hours-database.json` is missing from `/Lean/Data` | LEAN Core Source Analysis |
| 6 | Results Parsing | Performance Statistics Parser | Extracts key performance metrics (Sharpe, Sortino, Drawdown, CAGR, Win Rate, Expectancy) from result JSON. | LEAN raw JSON (`Statistics` string map) | Typed `LeanStatistics` object with numeric parsed values | Missing keys defaulted to 0 or null; malformed numbers handled safely | LEAN BacktestingResultHandler |
| 7 | Results Parsing | Chart Data Series Parser | Extracts time-series curves for Strategy Equity, Benchmark, and Drawdown. | LEAN raw JSON (`Charts` map of series `Values`) | Typed `ChartSeries` arrays with `{ timestamp: number, value: number }` | Empty values array if no trades or single-day backtest | LEAN BacktestingResultHandler |
| 8 | Results Parsing | Order & Execution History Parser | Parses order lifecycle, fill prices, quantities, timestamps, direction, and fees. | LEAN raw JSON (`Orders` map / list) | Typed `LeanOrder[]` array | Invalid orders captured with status `Invalid` and reason tag | LEAN TransactionHandler |
| 9 | Results Parsing | Runtime Statistics Parser | Parses live progress and summary statistics (Equity, Fees, Holdings, Unrealized, Volume). | LEAN raw JSON (`RuntimeStatistics` map) | Typed `LeanRuntimeStatistics` object | Default empty map if backtest aborted prematurely | LEAN BacktestingResultHandler |
| 10 | Strategy Bridge | Forex Python QCAlgorithm Bridge | Python base strategy template inheriting from `QCAlgorithm` with Forex brokerage model, leverage, and spread settings. | Python strategy script, symbol, dates, initial cash | Executed backtest generating trades and portfolio updates | Python syntax/runtime error reported in container logs & result JSON | LEAN PythonNet Bridge & Plan §9 |

---

## 3. Detailed Technical Specifications

### 3.1 Docker CLI Command Execution Specification

```bash
docker run --rm \
  --name "lean-backtest-<uuid>" \
  --user "$(id -u):$(id -g)" \
  --memory="4g" \
  --cpus="2.0" \
  -v "<host_base>/data/lean/data:/Lean/Data:ro" \
  -v "<host_base>/data/lean/algorithms:/Lean/Algorithm.Python:ro" \
  -v "<host_base>/data/lean/runs/<run_id>/config.json:/Lean/Launcher/bin/Debug/config.json:ro" \
  -v "<host_base>/data/lean/runs/<run_id>/results:/Results:rw" \
  quantconnect/lean:latest \
  --data-folder /Lean/Data \
  --results-destination-folder /Results \
  --config /Lean/Launcher/bin/Debug/config.json
```

#### Volume Mount Details:
1. **`/Lean/Data`** (Read-Only): Host path `<project_root>/data/lean/data`. Must contain:
   - `forex/<market>/<resolution>/<ticker>/...`
   - `market-hours/market-hours-database.json` (Required by LEAN on startup)
   - `symbol-properties/symbol-properties-database.csv` (Required for contract specifications)
2. **`/Lean/Algorithm.Python`** (Read-Only): Host path containing `<strategy_name>.py`.
3. **`/Lean/Launcher/bin/Debug/config.json`** (Read-Only): Generated run-specific configuration file.
4. **`/Results`** (Read-Write): Isolated run results folder `<project_root>/data/lean/runs/<run_id>/results/`.

---

### 3.2 LEAN `config.json` Specification for Python Forex Backtesting

```json
{
  "environment": "backtesting",
  "algorithm-language": "Python",
  "algorithm-location": "/Lean/Algorithm.Python/main.py",
  "algorithm-type-name": "ForexStrategy",
  "data-folder": "/Lean/Data",
  "results-destination-folder": "/Results",
  
  "job-queue-handler": "QuantConnect.Queues.JobQueue",
  "messaging-handler": "QuantConnect.Messaging.Messaging",
  "api-handler": "QuantConnect.Api.Api",
  "map-file-provider": "QuantConnect.Data.Auxiliary.LocalDiskMapFileProvider",
  "factor-file-provider": "QuantConnect.Data.Auxiliary.LocalDiskFactorFileProvider",
  "data-provider": "QuantConnect.Lean.Engine.DataFeeds.DefaultDataProvider",
  "alpha-handler": "QuantConnect.Lean.Engine.Alphas.DefaultAlphaHandler",
  
  "parameters": {},

  "environments": {
    "backtesting": {
      "live-mode": false,
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
}
```

---

### 3.3 Forex Historical Data Layout Specification

#### Directory Structure:
```text
data/lean/data/
├── market-hours/
│   └── market-hours-database.json
├── symbol-properties/
│   └── symbol-properties-database.csv
└── forex/
    └── oanda/
        ├── minute/
        │   └── eurusd/
        │       ├── 20240102_quote.zip
        │       ├── 20240103_quote.zip
        │       └── ...
        └── daily/
            └── eurusd.zip
```

#### Minute Resolution QuoteBar CSV Format:
- **Zip Archive**: `20240102_quote.zip`
- **Internal File**: `20240102_quote.csv` (No header row)
- **Columns (11 fields)**:
  `Milliseconds,BidOpen,BidHigh,BidLow,BidClose,LastBidSize,AskOpen,AskHigh,AskLow,AskClose,LastAskSize`
- **Field Definitions**:
  1. `Milliseconds`: Time elapsed since 00:00:00.000 UTC of the day (integer: `0` to `86340000` in 60000ms increments)
  2. `BidOpen`: Opening bid price (e.g. `1.08500`)
  3. `BidHigh`: Highest bid price in the minute
  4. `BidLow`: Lowest bid price in the minute
  5. `BidClose`: Closing bid price in the minute
  6. `LastBidSize`: Last bid volume/size (typically `0` for Forex if volume unavailable)
  7. `AskOpen`: Opening ask price (e.g. `1.08515`)
  8. `AskHigh`: Highest ask price in the minute
  9. `AskLow`: Lowest ask price in the minute
  10. `AskClose`: Closing ask price in the minute
  11. `LastAskSize`: Last ask volume/size (typically `0` for Forex)

#### Sample CSV Content:
```csv
0,1.08500,1.08520,1.08495,1.08510,0,1.08515,1.08535,1.08510,1.08525,0
60000,1.08510,1.08530,1.08505,1.08520,0,1.08525,1.08545,1.08520,1.08535,0
120000,1.08520,1.08540,1.08515,1.08525,0,1.08535,1.08555,1.08530,1.08540,0
```

---

### 3.4 LEAN Results JSON Schema Specification

When `BacktestingResultHandler` completes, it outputs a result JSON file containing the following top-level keys:

```typescript
export interface LeanBacktestResultJson {
  RollingWindow?: Record<string, unknown>;
  TotalPerformance?: {
    TradeStatistics?: {
      TotalNumberOfTrades: number;
      NumberOfWinningTrades: number;
      NumberOfLosingTrades: number;
      WinRate: number;
      LossRate: number;
      WinLossRatio: number;
      AverageWin: number;
      AverageLoss: number;
      AverageTrade: number;
      TotalProfitLoss: number;
      ProfitFactor: number;
      MaxConsecutiveWinningTrades: number;
      MaxConsecutiveLosingTrades: number;
      LargestWinningTrade: number;
      LargestLosingTrade: number;
      AverageHoldingTimeWinning: string;
      AverageHoldingTimeLosing: string;
      AverageHoldingTime: string;
    };
    PortfolioStatistics?: {
      MinimumEquity: number;
      MaximumEquity: number;
      CompoundingAnnualReturn: number;
      SharpeRatio: number;
      SortinoRatio: number;
      ProbabilisticSharpeRatio: number;
      Drawdown: number;
      AnnualStandardDeviation: number;
      AnnualVariance: number;
      TrackingError: number;
      InformationRatio: number;
      TotalFees: number;
      Alpha: number;
      Beta: number;
      Expectancy: number;
    };
    ClosedTrades?: Array<{
      Symbol: { Value: string; ID: string };
      EntryTime: string;
      EntryPrice: number;
      ExitTime: string;
      ExitPrice: number;
      Quantity: number;
      ProfitLoss: number;
      TotalFees: number;
      MAE: number;
      MFE: number;
      Duration: string;
    }>;
  };
  Charts: {
    "Strategy Equity": {
      Name: "Strategy Equity";
      ChartType: number;
      Series: {
        Equity: {
          Name: "Equity";
          Unit: "$";
          Index: number;
          SeriesType: number;
          Values: Array<{ x: number; y: number }>; // x is Unix epoch seconds
        };
        DailyPerformance?: {
          Name: "DailyPerformance";
          Unit: "%";
          Index: number;
          SeriesType: number;
          Values: Array<{ x: number; y: number }>;
        };
      };
    };
    Benchmark?: {
      Name: "Benchmark";
      ChartType: number;
      Series: {
        Benchmark: {
          Name: "Benchmark";
          Unit: "$";
          Index: number;
          SeriesType: number;
          Values: Array<{ x: number; y: number }>;
        };
      };
    };
    Drawdown?: {
      Name: "Drawdown";
      ChartType: number;
      Series: {
        "Equity Drawdown": {
          Name: "Equity Drawdown";
          Unit: "%";
          Index: number;
          SeriesType: number;
          Values: Array<{ x: number; y: number }>;
        };
      };
    };
  };
  Orders: Record<string, {
    Id: number;
    ContingentId: number;
    BrokerId: string[];
    Symbol: { Value: string; ID: string; Permtick: string };
    Price: number;
    PriceCurrency: string;
    Time: string; // ISO 8601 UTC
    CreatedTime: string;
    LastFillTime: string | null;
    Quantity: number;
    Type: number; // 0=Market, 1=Limit, 2=StopMarket, 3=StopLimit
    Status: number; // 3=Filled, 5=Canceled, 6=Invalid
    Tag: string;
    SecurityType: number; // 4=Forex
    Direction: number; // 0=Buy, 1=Sell, 2=Hold
    Value: number;
    OrderFee: { Value: { Amount: number; Currency: string } };
  }>;
  ProfitLoss: Record<string, number>;
  Statistics: {
    "Total Trades": string;
    "Average Win": string;
    "Average Loss": string;
    "Compounding Annual Return": string;
    "Drawdown": string;
    "Expectancy": string;
    "Net Profit": string;
    "Sharpe Ratio": string;
    "Sortino Ratio": string;
    "Loss Rate": string;
    "Win Rate": string;
    "Profit-Loss Ratio": string;
    "Alpha": string;
    "Beta": string;
    "Annual Standard Deviation": string;
    "Annual Variance": string;
    "Information Ratio": string;
    "Tracking Error": string;
    "Total Fees": string;
    "Estimated Strategy Capacity"?: string;
    "Lowest Capacity Asset"?: string;
    "Portfolio Turnover"?: string;
    "Probabilistic Sharpe Ratio"?: string;
  };
  RuntimeStatistics: {
    "Equity": string;
    "Fees": string;
    "Holdings": string;
    "Net Profit": string;
    "Probabilistic Sharpe Ratio"?: string;
    "Return": string;
    "Unrealized": string;
    "Volume": string;
  };
  AlgorithmConfiguration?: {
    StartDate: string;
    EndDate: string;
    TradingDaysPerYear: number;
    InitialCapital: number;
  };
}
```

---

## 4. Edge Cases

| # | Feature | Input / Condition | Observed / Documented Behavior | Mitigation / Handling |
|---|---------|-------------------|--------------------------------|----------------------|
| 1 | Docker Execution | Missing `market-hours-database.json` in `/Lean/Data` | LEAN aborts immediately with `DirectoryNotFoundException` / `FileNotFoundException` | Seed `data/lean/data/market-hours/` and `symbol-properties/` during OpenAlice LEAN initialization |
| 2 | Docker Execution | Docker root file permissions on `/Results` in Linux | Files created in mounted `/Results` owned by root, making Node.js host unable to delete/modify without root | Use `--user $(id -u):$(id -g)` or `chmod 777` on run results directory before launch |
| 3 | Results Parsing | 0 trades executed in backtest date range | `Statistics["Total Trades"] = "0"`, `Sharpe Ratio = "0"`, `Drawdown = "0%"`, `Orders = {}` | Parser safely parses 0 values without throwing division-by-zero errors |
| 4 | Data Pipeline | Non-continuous Forex timestamps (weekends / holidays) | LEAN skips bars outside market hours per `market-hours-database.json` | Ensure converter generates valid UTC timestamps without weekend synthetic bars |
| 5 | Data Pipeline | Inverted spread (Bid > Ask) in bad source data | LEAN ForexFillModel throws error or produces erratic fills | Data converter sanitizes and validates `Ask >= Bid` before writing CSV/ZIP |
| 6 | Strategy Bridge | XAU/USD (Gold) treated as Forex | LEAN fails to resolve `AddForex("XAUUSD")` properly as it expects `SecurityType.Cfd` and `cfd/oanda/` path | Restrict initial M2 scope to Forex pairs (`EURUSD`, `GBPUSD`, `USDJPY`), CFD handled in subsequent phase |
| 7 | Strategy Bridge | Order sizing smaller than broker lot size | OANDA `lotsize=1` allows unit sizing; FXCM `lotsize=1000` rounds down to 0 | Strategy templates configure `OandaBrokerageModel` with lot size 1 |
| 8 | Multi-Tenancy | Multiple concurrent backtests launched | Containers clashing on port or shared result directory | Generate unique `runId` with isolated `data/lean/runs/<run_id>/` directory per backtest |

---

## 5. Logic Chain

1. **Premise 1**: OpenAlice requires an event-driven quantitative engine for Forex research, isolated via Docker (`ORIGINAL_REQUEST.md` §R2).
2. **Premise 2**: LEAN Engine is driven by `config.json` specifying class handlers for data feed, transactions, and results (`Engine.cs`, `Program.cs`).
3. **Premise 3**: For historical backtesting, `FileSystemDataFeed` requires the standard LEAN data folder layout (`forex/{market}/{resolution}/{ticker}/{date}_quote.zip`).
4. **Premise 4**: LEAN requires `market-hours-database.json` and `symbol-properties-database.csv` in `/Lean/Data` to instantiate instruments and schedule time slices.
5. **Conclusion**: To implement M1 and M2 reliably:
   - The TypeScript domain layer (`src/domain/lean/`) must generate isolated run folders containing `config.json` and algorithms.
   - The data converter must produce clean QuoteBar ZIP/CSVs with 11 standard columns.
   - The auxiliary data files must be pre-populated in `data/lean/data/`.
   - The results parser can deterministically transform `results.json` into typed OpenAlice domain objects.

---

## 6. Caveats

1. **Swap/Financing Fees**: Standard LEAN Forex models do not automatically deduct daily rollover/swap fees unless a custom `ISwapModel` or transaction fee deduction is attached. For initial M2 backtests, P&L is spread- and commission-aware, but overnight financing is excluded.
2. **Gold / Commodities**: XAU/USD is classified by LEAN as a CFD (`SecurityType.Cfd`), which requires `data/cfd/` instead of `data/forex/`. M2 strictly focuses on true Forex pairs (`EURUSD`).
3. **Docker Daemon Dependency**: If Docker daemon is stopped, `LeanService` must detect daemon availability on startup and provide a clear error rather than hanging.

---

## 7. Verification Method

To verify these specifications:
1. **Config Verification**: Verify `config.json` contains valid JSON matching Section 3.2.
2. **Data Format Verification**: Inspect sample ZIP archive:
   ```bash
   unzip -l data/lean/data/forex/oanda/minute/eurusd/20240102_quote.zip
   # Verify exactly 11 columns in extracted CSV without header
   ```
3. **Docker Execution Test**:
   ```bash
   docker run --rm \
     -v "$(pwd)/data/lean/data:/Lean/Data:ro" \
     -v "$(pwd)/data/lean/algorithms:/Lean/Algorithm.Python:ro" \
     -v "$(pwd)/data/lean/runs/test-run/config.json:/Lean/Launcher/bin/Debug/config.json:ro" \
     -v "$(pwd)/data/lean/runs/test-run/results:/Results:rw" \
     quantconnect/lean:latest
   ```
4. **Parser Unit Tests**: Run Vitest tests against fixture JSON files matching Section 3.4 schema.

