# MT5 Broker History Tools

These tools collect and validate broker-native M1 data for research and paper-trading development. They do not submit orders and do not read account credentials.

## Broker mappings

| Broker terminal | Gold research/live | Gold demo | EUR/USD | Export `InpBrokerId` |
| --- | --- | --- | --- | --- |
| HFM MT5 | `XAUUSDb` | `XAUUSD` | research/live `EURUSDb`; demo `EURUSD` | `hfmarkets` |
| IC Markets MT5 | `XAUUSD` | `EURUSD` | `icmarkets` |

## Export

1. Open the MT5 terminal connected to the intended broker.
2. The exporter requests data one month at a time, so its M1 request stays below the terminal chart-bar cap. A normal `100,000`-bar limit is sufficient; no terminal restart is required solely for this exporter.
3. Copy `ExportBrokerM1History.mq5` into that terminal's `MQL5\\Scripts` directory and compile it in MetaEditor.
4. Run it from **Navigator -> Scripts** with the broker-specific settings below.

HFM:

```text
InpBrokerId: hfmarkets
InpSymbols: XAUUSDb,EURUSDb
InpStart: 2016.06.22 00:00
InpOverwrite: false
```

IC Markets:

```text
InpBrokerId: icmarkets
InpSymbols: XAUUSD,EURUSD
InpStart: 2016.06.22 00:00
InpOverwrite: false
```

The script requests M1 history from the connected MT5 broker in monthly chunks and writes one CSV per month under the shared MT5 directory:

```text
%APPDATA%\\MetaQuotes\\Terminal\\Common\\Files\\OpenAliceMt5HistoryV2\\<broker>\\<symbol>\\
```

Each symbol also gets a `contract.csv` file containing the broker's current contract and volume rules, plus a `manifest.csv` containing export coverage. `InpOverwrite=false` is intentional: it skips completed monthly files rather than duplicating them. Set it to `true` only when deliberately refreshing a period.

## Validate

After exporting, run:

```powershell
python tools/mt5/validate_history.py "$env:APPDATA\\MetaQuotes\\Terminal\\Common\\Files\\OpenAliceMt5HistoryV2" --output .codex-run/mt5-history-report.json
```

The report is streamed, so it works with large data sets. A multi-minute gap is a review signal, not automatically bad: forex weekends, broker maintenance, and market holidays are expected. It must be classified before any strategy is trusted.

## Scope boundary

Ten years of M1 bars are the first research layer. Do not silently substitute generic public data for broker-native testing. Tick history is much larger and may not be retained by a broker for the entire period; collect it only for specific strategy windows after an M1 strategy survives walk-forward testing.

## Research Baseline

`backtest_daily_trend.py` is a research-only daily time-series-momentum baseline. It aggregates the broker export into daily bars, evaluates a small set of broad lookbacks on a training period, then reports the chosen lookback on an untouched holdout period. It does not connect to MT5 or generate an order.

```powershell
python tools/mt5/backtest_daily_trend.py "$env:APPDATA\MetaQuotes\Terminal\Common\Files\OpenAliceMt5HistoryV2" --symbol EURUSDb --output .codex-run/eurusd-trend-baseline.json
python tools/mt5/backtest_daily_trend.py "$env:APPDATA\MetaQuotes\Terminal\Common\Files\OpenAliceMt5HistoryV2" --symbol XAUUSDb --output .codex-run/xauusd-trend-baseline.json
```

For the installed Windows app, write the reports to its persistent local data
folder so they survive application upgrades:

```powershell
$research = Join-Path $env:USERPROFILE '.openalice\data\research'
New-Item -ItemType Directory -Force $research | Out-Null
python tools/mt5/backtest_daily_trend.py "$env:APPDATA\MetaQuotes\Terminal\Common\Files\OpenAliceMt5HistoryV2" --broker icmarkets --symbol EURUSD --output "$research\icmarkets-eurusd-trend-baseline.json"
python tools/mt5/backtest_daily_trend.py "$env:APPDATA\MetaQuotes\Terminal\Common\Files\OpenAliceMt5HistoryV2" --broker icmarkets --symbol XAUUSD --output "$research\icmarkets-xauusd-trend-baseline.json"
```

The default cost assumption is deliberately conservative and not a substitute for HFM's actual commissions, financing, and spread history. A passing result is research input only, never permission to enable an EA.

## Walk-Forward Evaluation

The baseline is one historical split. Before a study can be considered for a demo EA, run a rolling walk-forward study: each window selects its lookback from the preceding 60 months, freezes that choice, and evaluates the next unseen six months. The default 10 bps cost is only a placeholder and must be replaced by broker-specific costs before promotion.

```powershell
python tools/mt5/walk_forward_daily_trend.py "$env:APPDATA\MetaQuotes\Terminal\Common\Files\OpenAliceMt5HistoryV2" --broker hfmarkets --symbol XAUUSDb --output "$research\xauusd-walk-forward.json"
python tools/mt5/walk_forward_daily_trend.py "$env:APPDATA\MetaQuotes\Terminal\Common\Files\OpenAliceMt5HistoryV2" --broker hfmarkets --symbol EURUSDb --output "$research\eurusd-walk-forward.json"
python tools/mt5/walk_forward_daily_trend.py "$env:APPDATA\MetaQuotes\Terminal\Common\Files\OpenAliceMt5HistoryV2" --broker icmarkets --symbol XAUUSD --output "$research\icmarkets-xauusd-walk-forward.json"
python tools/mt5/walk_forward_daily_trend.py "$env:APPDATA\MetaQuotes\Terminal\Common\Files\OpenAliceMt5HistoryV2" --broker icmarkets --symbol EURUSD --output "$research\icmarkets-eurusd-walk-forward.json"
```

The report shows every selection/test window and an aggregate of sequential unseen-period returns. It is historical evidence, not a forecast or a permission to trade.

## Demo Terminal Readiness Check

`CheckDemoReadiness.mq5` is the first live-terminal check. It is read-only: it refuses a non-demo account, checks the terminal connection and configured symbol, then writes the current demo server, contract, trade-permission, bid/ask, and spread information to a shared CSV. It cannot place, modify, or cancel an order.

1. Copy the script into the relevant MT5 terminal's `MQL5\\Scripts` folder and compile it in MetaEditor.
2. Run it in the HFM demo terminal with `InpBrokerId=hfmarkets`, `InpSymbol=XAUUSD`.
3. Run it in the IC Markets terminal with `InpBrokerId=icmarkets`, `InpSymbol=XAUUSD`.
4. Confirm the terminal log says **"No order was sent"**.

The generated reports appear at:

```text
%APPDATA%\\MetaQuotes\\Terminal\\Common\\Files\\OpenAliceMt5DiagnosticsV1\\<broker>\\<symbol>\\demo-readiness.csv
```

Run this check at normal market conditions, around rollover, and during a major-news window. It captures observed demo spreads for the eventual cost model; it does not claim those conditions will equal live execution.

## Read-Only MT5 Connector (Phase 1)

`OpenAliceMt5ReadOnlyBridge.mq5` is the first connector component. Attach it as an Expert Advisor to the Gold chart in each **demo** terminal; it writes a fresh local heartbeat every 30 seconds. OpenAlice reads that heartbeat to show terminal mode, server, quote/spread, and open position/order counts in the Research Desk.

It has no `CTrade` dependency and no order-placement, amendment, or cancellation function. A heartbeat from a non-demo account is displayed as unsafe and does not advance the connector.

| Terminal | EA inputs |
| --- | --- |
| HFM demo | `InpBrokerId=hfmarkets`, `InpSymbol=XAUUSD` |
| IC Markets demo | `InpBrokerId=icmarkets`, `InpSymbol=XAUUSD` |

The bridge writes to:

```text
%APPDATA%\\MetaQuotes\\Terminal\\Common\\Files\\OpenAliceMt5BridgeV1\\<broker>\\<symbol>\\status.csv
```

After both heartbeats appear as **Demo bridge connected**, the next implementation phase is a paper-only command protocol with a separate human approval gate. It will not be enabled by this phase.

## Read-only trade ledger exporter

`ExportMt5TradeLedger.mq5` exports MT5 deal history for one broker/symbol into MetaTrader Common Files:

`OpenAliceMt5TradeLedgerV1/<broker>/<symbol>/deals.csv`

Use it on demo accounts first:

1. Open MetaEditor from the target MT5 terminal.
2. Copy or open `tools/mt5/ExportMt5TradeLedger.mq5`.
3. Compile it.
4. Run it once per broker/symbol with:
   - HFM demo Gold: `InpBrokerId=hfmarkets`, `InpSymbol=XAUUSD`
   - HFM demo EURUSD: `InpBrokerId=hfmarkets`, `InpSymbol=EURUSD`
   - IC Markets demo Gold: `InpBrokerId=icmarkets`, `InpSymbol=XAUUSD`
   - IC Markets demo EURUSD: `InpBrokerId=icmarkets`, `InpSymbol=EURUSD`

The exporter is read-only. It does not submit, modify, or close orders. If the exported account mode is not `demo`, JMB Goldmine must show the ledger as blocked for demo-autopilot progression.
