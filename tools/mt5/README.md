# MT5 Broker History Tools

Most tools in this directory collect and validate broker-native data without submitting orders. The separately installed Plan 3 demo-canary EA described below is the only exception: after explicit local operator enablement, it may submit protected Gold orders on the exact allowlisted demo accounts. It has no live-account mode, EURUSD execution path, or remote order command.

## Broker mappings

| Broker terminal | Gold research/live | Gold demo | EUR/USD | Export `InpBrokerId` |
| --- | --- | --- | --- | --- |
| HFM MT5 | `XAUUSDb` | `XAUUSD` | research/live `EURUSDb`; demo `EURUSD` | `hfmarkets` |
| IC Markets MT5 | `XAUUSD` | `XAUUSD` | `EURUSD` | `icmarkets` |

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

The bridge remains read-only. Plan 3 adds a separate broker-local demo-canary EA; the bridge itself never gains order authority.

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

## Demo risk shell, no order submission

`JmbGoldmineDemoRiskShell.mq5` is an EA that reads the latest JMB shadow decision and writes gate status to:

```text
OpenAliceMt5RiskShellV1/<broker>/<symbol>/gate_status.csv
```

This shell does not submit, modify, or close orders. It validates demo account mode, chart symbol, decision freshness, shadow mode, lot size, stop loss, spread, kill switch, and existing manual or foreign exposure before reporting `shadow_ready`.

Recommended first run:

- Keep `InpKillSwitch=true`.
- Attach to HFM demo `XAUUSD` and `EURUSD`.
- Attach to IC Markets demo `XAUUSD` and `EURUSD`.
- Use `InpBrokerId=hfmarkets` or `icmarkets`.
- Use the exact chart symbol in `InpSymbol`.

Keep this EA available as the rollback and diagnostic shell for the Plan 3 ceremony below.

## Plan 3 broker-local Gold demo canary

The [approved Plan 3 design](../../docs/superpowers/specs/2026-07-13-jmb-goldmine-demo-canary-execution-design.md) governs this separately installed EA. UTA remains mandatory for app-, API-, UI-, workspace-, or AI-managed broker orders. `JmbGoldmineDemoCanary` is a narrower broker-local exception governed by the PRD's R6: it reads local artifacts, exposes no remote order command, and independently enforces its demo-account and Gold-only bindings inside MT5.

Codex does not launch MetaEditor, compile MQL, attach an EA, enable Algo Trading, change terminal inputs, or submit a broker request. Every MetaEditor and terminal action below is an operator-only human gate. Keep terminal Algo Trading disabled throughout Stage 0.

### Install and compile manually

Perform these steps separately in the HFM demo terminal and the IC Markets demo terminal. Use each terminal's **File -> Open Data Folder** so files are copied into the correct installation.

1. Re-copy `OpenAliceMt5ReadOnlyBridge.mq5` to `MQL5\Experts\OpenAliceMt5ReadOnlyBridge.mq5`. This version exports the latest 300 completed D1 bars and bounded spread samples in addition to its read-only heartbeat; recompile it even if an older bridge is already attached.
2. Copy `ConfigureJmbGoldmineDemoPolicy.mq5` to `MQL5\Scripts\ConfigureJmbGoldmineDemoPolicy.mq5`.
3. Copy the complete repository folder `JmbGoldmineDemoCanary\` to `MQL5\Experts\JmbGoldmineDemoCanary\`. Preserve `JmbGoldmineDemoCanary.mq5` and every sibling `.mqh` file in that layout.
4. Copy `tests\JmbGoldmineDemoCanaryHarness.mq5` to `MQL5\Experts\tests\JmbGoldmineDemoCanaryHarness.mq5`, preserving its relative path to `..\JmbGoldmineDemoCanary\`.
5. In MetaEditor opened from that terminal, compile the bridge, policy script, canary EA, and harness. Accept only `0 errors, 0 warnings` for every file.
6. With Algo Trading still disabled, attach the harness to an unused demo chart. Its Experts log must end with `JMB_CANARY_HARNESS PASS`, every case must print `PASS`, and the failure count must be zero. Remove the harness after the run. The harness includes no trade gateway.

Compilation and harness results are pending until a human records them for both terminals. A source-code build or TypeScript test cannot substitute for this gate.

### Shared Common Files layout

OpenAlice and the terminals exchange local artifacts only through MetaTrader Common Files under `%APPDATA%\MetaQuotes\Terminal\Common\Files`. The operator should expect these broker-specific artifacts:

```text
OpenAliceMt5BridgeV1\<broker>\XAUUSD\status.csv
OpenAliceMt5BridgeV1\<broker>\XAUUSD\completed_d1.csv
OpenAliceMt5BridgeV1\<broker>\XAUUSD\spread_samples_YYYYMMDD.csv
OpenAliceMt5DemoPolicyV1\<broker>\XAUUSD\policy.csv
OpenAliceMt5CostModelV1\<broker>\XAUUSD\cost_model.csv
OpenAliceMt5ExecutionDecisionV1\<broker>\XAUUSD\latest_decision.csv
OpenAliceMt5ExecutionDecisionV1\<broker>\XAUUSD\decisions.jsonl
OpenAliceMt5ExecutionV1\<broker>\XAUUSD\latest_status.csv
OpenAliceMt5ExecutionV1\<broker>\XAUUSD\events.jsonl
OpenAliceMt5ExecutionV1\<broker>\XAUUSD\processed_observations.csv
OpenAliceMt5ExecutionV1\<broker>\XAUUSD\reconciliation_latch.csv
```

The bridge owns its first three read-only files, the operator-only script owns `policy.csv`, OpenAlice's deterministic decision cycle owns the cost-model and decision files, and the EA owns the execution files. Do not hand-edit, truncate, copy between brokers, or delete the append-only event, decision, processed-observation, or reconciliation files during rollback or recovery. The local expected account login is an EA input only and must never be put in a policy, status file, screenshot, commit, or Research API response.

### Stage 0: status-only dry run

Stage 0 is a two-terminal human ceremony. It does not authorize any order.

1. In each demo terminal, keep two `XAUUSD` charts: the recompiled read-only bridge stays on its existing duplicate Gold chart; the status/execution chart is reserved for the risk shell or canary. Do not attach the canary to EURUSD.
2. Reattach the bridge with `InpBrokerId=hfmarkets`, `InpSymbol=XAUUSD` in HFM and `InpBrokerId=icmarkets`, `InpSymbol=XAUUSD` in IC Markets. Confirm `status.csv`, `completed_d1.csv`, and the current monthly spread-sample file update.
3. Save the stable `JmbGoldmineDemoRiskShell` gate result for comparison. Remove that shell from the Gold status chart, then attach `JmbGoldmineDemoCanary` to the same chart with the exact status-only inputs below.
4. Run `ConfigureJmbGoldmineDemoPolicy` on each terminal's `XAUUSD` chart with `InpRolloutStage=status_only` and `InpCandidateApproved=false`. Use a unique immutable version such as `hfm-status-only-v1` or `ic-status-only-v1`. HFM may use the script's `0.75` spread and `0.50` deviation defaults. IC Markets must set both to `0.30`; the HFM defaults are deliberately refused on IC. Keep the remaining limits at or below 72 hours, `10.00` risk, `40.00` daily loss, 4 losses, and `0.01` lot.
5. Leave terminal Algo Trading disabled. Confirm the EA's `latest_status.csv` advances for at least two ten-second timer cycles on both terminals. Also observe at least two 30-second bridge cycles so its heartbeat and completed-D1 export remain current.
6. Compare every reported canary gate with the saved risk-shell result. Confirm the MT5 **Trade** and **History** tabs show zero new canary orders and zero new positions across the observation window. `execution_enabled` must be `0`, `kill_switch` must be `1`, and the rollout stage must be `status_only`.
7. Inspect the newest row in each `completed_d1.csv`. Its `bar_as_of` must be later than the stale `2026-06-23` artifact. A merely recent file modification time is insufficient. If either broker lacks fresh completed-D1 evidence, both canary promotions remain blocked.
8. Record terminal/server, compile and harness results, before/after order and position counts, two-cycle timestamps, risk-shell comparison, and completed-D1 `bar_as_of` values without recording account logins.

Use these exact EA inputs; replace `<local demo login>` only in the terminal input dialog:

| Input | HFM | IC Markets |
| --- | --- | --- |
| `InpBrokerId` | `hfmarkets` | `icmarkets` |
| `InpExpectedServer` | `HFMarketsGlobal-Demo4` | `ICMarketsSC-Demo` |
| `InpExpectedAccountLogin` | `<local HFM demo login>` | `<local IC demo login>` |
| `InpSymbol` | `XAUUSD` | `XAUUSD` |
| `InpMagicNumber` | `880101` | `880201` |
| `InpDemoExecutionEnabled` | `false` | `false` |
| `InpKillSwitch` | `true` | `true` |

Any non-demo account, login/server mismatch, missing cost or policy evidence, stale decision or completed observation, foreign Gold exposure, reconciliation error, or unwritable log remains blocked. Do not weaken an input to make Stage 0 appear ready.

### HFM canary

This is the Stage 1 ceremony and remains pending until the human Stage 0 evidence above is reviewed.

1. Leave IC Markets at `status_only`, `InpDemoExecutionEnabled=false`, and `InpKillSwitch=true`.
2. Build and review an HFM `canary_ready` broker-cost model from fresh HFM bridge spread evidence. Confirm HFM has a fresh completed-D1 observation and an eligible `daily-trend-v1` Gold decision.
3. On the HFM demo `XAUUSD` chart only, run the operator policy script with a new policy version, `InpRolloutStage=hfm_canary`, `InpCandidateApproved=true`, and limits no looser than HFM's immutable ceilings.
4. Reconfirm the locally entered HFM demo login, server, symbol, and magic. Only the operator then sets `InpDemoExecutionEnabled=true`, sets `InpKillSwitch=false`, and enables terminal Algo Trading for the HFM canary.
5. Observe one eligible decision from its durable `order_requesting` event through broker result, accepted volume/price, broker-confirmed stop protection, append-only evidence, and restart reconciliation. The broker's Trade/History tabs are authoritative.
6. An unprotected fill, unknown result, partial result, reconciliation mismatch, non-demo identity, missing cost evidence, or duplicate/uncertain observation immediately returns HFM to `status_only` using the pause procedure below. Do not resend an unknown request.

HFM evidence must be reviewed and accepted before any IC execution setting changes.

### IC Markets canary

This is the Stage 2 ceremony and remains pending until the HFM canary has broker-confirmed stop protection, durable request/result evidence, and successful restart reconciliation.

1. Keep the HFM position, if any, protected and reconciled; otherwise pause HFM before proceeding.
2. Build and review an IC `canary_ready` cost model from IC-only evidence. Never reuse the HFM model.
3. On the IC Markets demo `XAUUSD` chart only, run the operator policy script with a new policy version, `InpRolloutStage=ic_canary`, `InpCandidateApproved=true`, `InpMaxSpread<=0.30`, `InpMaxDeviation<=0.30`, and the remaining immutable ceilings unchanged or tighter.
4. Reconfirm the locally entered IC demo login, `ICMarketsSC-Demo`, `XAUUSD`, and magic `880201`. Only the operator then sets `InpDemoExecutionEnabled=true`, sets `InpKillSwitch=false`, and enables Algo Trading for the IC Markets canary.
5. Repeat the HFM evidence chain and specifically verify IC spread, deviation, volume, server, cost, order/deal/position identifiers, broker-side stop, and restart behavior.

Only after both ceremonies pass may the operator write `both_demo` policies. Each broker keeps independent gates, magic numbers, loss days, pauses, and evidence. EURUSD remains shadow-only and live execution remains absent at every stage.

### Kill switch, pause, rollback, and recovery

To pause a broker, set `InpKillSwitch=true` first, set `InpDemoExecutionEnabled=false`, write a new `status_only` policy with the operator script, and disable terminal Algo Trading if no other approved EA needs it. Confirm two `latest_status.csv` cycles with execution disabled. The kill switch blocks new entries; it does not close a correctly protected existing position.

To roll back, keep the broker paused, capture `latest_status.csv`, `events.jsonl`, `processed_observations.csv`, `reconciliation_latch.csv`, and the broker Trade/History state, then detach `JmbGoldmineDemoCanary` from the Gold status chart and reattach `JmbGoldmineDemoRiskShell` with its kill switch on. Leave the read-only bridge on its duplicate Gold chart. The rollback shell submits no orders. Do not delete canary evidence or treat rollback as clearance of an unresolved broker result.

For an unknown result, restart, or reconciliation failure, keep execution disabled and use the broker terminal to correlate symbol, magic, decision comment, order, deal, position, and stop with the durable event record. The EA never blindly resends. Restart the canary only with execution disabled and the kill switch on, then require two stable status cycles before review.

If a fill lacks broker-confirmed stop protection, the EA's sole emergency path attempts to close only that EA-owned unprotected position and persists a protection-error pause. The operator must immediately verify the actual position and stop in the broker terminal, correlate the close result with `events.jsonl` and `reconciliation_latch.csv`, and leave the broker at `status_only`. A local `filled_protected` label is not evidence unless the broker confirms both exposure and stop. Never clear or delete the persistent latch merely to resume; promotion requires an explicit human incident review and approved recovery decision.

There is no live-mode input, live-account bypass, EURUSD demo allowlist, AI risk override, or remote close/order command. App/API/AI-managed orders continue to require UTA approval and guards.
