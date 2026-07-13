# MT5 Data And Training Protocol

> Product scope, priorities, and acceptance criteria are defined in the [JMB Goldmine PRD](PRD.md). This document is the operational protocol for the MT5 research track and must stay consistent with that PRD.

## Purpose

This protocol defines the evidence required for research and for the separately approved Plan 3 broker-local Gold demo canary. It is deliberately narrower than an autonomous live-trading system: the goal is repeatable evidence and execution-plumbing validation, not a claim of profitability or live eligibility.

## Instruments And Broker Mapping

| Canonical instrument | HFM research/live | HFM demo | IC Markets MT5 |
| --- | --- | --- | --- |
| Gold / USD | `XAUUSDb` | `XAUUSD` | `XAUUSD` |
| Euro / USD | `EURUSDb` | `EURUSD` | `EURUSD` |

Every export, backtest, bridge heartbeat, and order must retain both the canonical instrument and the exact broker symbol. The current HFM demo symbols (`XAUUSD`, `EURUSD`) are distinct from the HFM research/live export symbols (`XAUUSDb`, `EURUSDb`); the bridge must label those differences and a future EA must separately validate fills and costs on the demo contracts. Never use one broker's prices to model another broker's fills without labelling the result as a cross-broker experiment.

## Data Standard

1. Use the connected MT5 broker terminal as the primary source.
2. Export ten years of M1 OHLC, tick volume, real volume, and spread points.
3. Capture contract metadata: digits, point, contract size, volume limits, stop distance, and trading mode.
4. Validate coverage, duplicates, out-of-order rows, and large gaps.
5. Keep public or third-party data only as a labelled supplementary research source.

The exporter requests one month at a time to avoid the terminal's chart-bar cap. Its M1 request is therefore small enough for a normal terminal configuration; do not use a single ten-year `CopyRates` request, because it can be silently truncated.

Raw tick history is optional and must be requested in bounded windows. Ten years of ticks can consume tens or hundreds of gigabytes, may not be available from the broker, and is unnecessary for an initial bar-based strategy.

### Observed HFM Export (2026-06-23)

The HFM monthly export contained 3,877,671 parseable rows with no duplicate or malformed timestamps. The broker supplied a mixture of true M1 history and older daily-resolution fallback bars. The latter must not be used as M1 training data.

| Symbol | Eligible M1 range | Excluded historical range |
| --- | --- | --- |
| `EURUSDb` | June 2020 (partial) through June 2026 | June 2016 through May 2020 daily-resolution fallback |
| `XAUUSDb` | September 2021 (partial) through June 2026 | June 2016 through August 2021 daily-resolution fallback |

Current HFM contract metadata captured with the export: `XAUUSDb` has a `0.01` minimum volume and contract size `100`; `EURUSDb` has a `0.01` minimum volume and contract size `100000`. A future EA must re-read these values from the terminal at startup rather than trusting this snapshot.

## Training And Backtest Discipline

"Self-training" means model selection under controlled historical tests. It does not mean changing a live strategy because of its most recent winning or losing trades.

1. Define a small, understandable baseline strategy and its risk model before optimisation.
2. Split time in order: training, validation, and a final untouched out-of-sample test. Do not shuffle time series.
3. Use walk-forward windows. Parameters may be selected on past data, then frozen for the following unseen period.
4. Include broker spread, commission, swap, minimum lot, stop distance, slippage assumptions, and trading-hour restrictions.
5. Compare performance across both brokers when possible. A model that survives only one data feed is not robust enough.
6. Reject strategies that depend on a tiny number of trades, have unstable parameters, fail after realistic costs, or only work in one market regime.
7. Keep a signed experiment record: data source, dates, strategy version, parameters, costs, result, and decision.

### Rolling Walk-Forward Study

The local `walk_forward_daily_trend.py` study uses a rolling 60-month training window and sequential six-month unseen windows by default. In each window it selects from the fixed broad lookbacks on training data only, freezes that choice, and records the resulting out-of-sample performance separately. Its 10-basis-point cost is a placeholder, not a broker-specific cost model. The report is evidence for review only and cannot promote a strategy to a demo EA on its own.

### Fixed-Matrix Experiment Ledger

`run_daily_trend_experiments.py` appends repeated research runs to `~/.openalice/data/research/daily-trend-experiment-ledger.json`. It compares a declared matrix of lookback sets and fixed cost assumptions, then logs every out-of-sample result for the Research Desk visual ledger. It is intentionally not a genetic optimiser and must not keep mining historical data until a desired win rate appears.

HFM Gold must use the validated eligible M1 range beginning in 2021; if a 2019 start is requested, the system must reject or shorten the HFM study rather than blend in fallback-resolution history. IC Markets Gold can be evaluated from 2019 when its own exported files and validation support that range.

The Steward's learning loop is journal-based: read past experiment runs, daily reviews, bridge status, and future demo logs; record lessons, suspected failure causes, protected-risk events, and the next bounded hypothesis. It may improve review discipline and test design, but it may not silently change live or paper risk rules.

### Initial Trend-Following Baseline

The first baseline is daily time-series momentum, evaluated across broad 60, 120, 180, and 252 trading-day lookbacks. It selects one lookback using data through 2023 and evaluates that frozen choice on 2024 onward. This is a research hypothesis, not a live signal or a claim of suitability.

The choice is informed by Moskowitz, Ooi, and Pedersen's study of time-series momentum across liquid currency and commodity futures, which found persistence over one- to twelve-month horizons in its historical sample. That evidence is not a guarantee for HFM's retail `EURUSDb` or `XAUUSDb`, so the broker-specific holdout test remains the relevant gate. [Paper](https://pages.stern.nyu.edu/~lpederse/papers/TimeSeriesMomentum.pdf)

### Initial Baseline Result (2026-06-23)

Using a conservative illustrative 10-basis-point one-way cost and a 2018–2023 selection window, the daily trend baseline selected a 120-day lookback for `EURUSDb` and a 60-day lookback for `XAUUSDb`. The EUR/USD choice lost 11.3% in the untouched 2024–2026 holdout, so it is rejected. The gold choice gained 68.4% in that holdout but had a 21.5% maximum drawdown. It is historical research only; the rolling study, broker-specific cost and financing model, and a demo forward test remain mandatory before any EA may use it.

### Observed Rolling Walk-Forward Result (2026-06-23)

The initial rolling study used a five-year training window, then selected a lookback and tested it on the following six months. It produced seven sequential unseen test windows through 2026-06-23. These figures retain the illustrative 10-basis-point one-way cost and therefore are not broker-cost-adjusted or a promotion decision.

| Broker / symbol | Aggregate unseen return | Sharpe | Maximum drawdown | Research status |
| --- | ---: | ---: | ---: | --- |
| HFM `EURUSDb` | -18.05% | -0.75 | -23.14% | Rejected |
| HFM `XAUUSDb` | 81.41% | 0.98 | -29.25% | Early candidate; cost model required |
| IC Markets `EURUSD` | -16.94% | -0.70 | -22.29% | Rejected |
| IC Markets `XAUUSD` | 79.60% | 0.97 | -30.23% | Early candidate; cost model required |

The two EUR/USD studies are not eligible for an EA under this protocol. The two Gold/USD studies remain historical research candidates only: their drawdowns are material, and commission, spread, swap, slippage, and a meaningful paper forward test remain mandatory.

## Research Dashboard

The local OpenAlice **Research** page (`/research`) is a read-only evidence ledger. It combines MT5 export presence, backtest artifacts, validation stages, the latest completed daily trend observation, and OpenAlice's recent-news archive. It never receives broker credentials, cannot submit orders, and uses an evidence grade instead of an invented probability of profit. The installed Windows app reads persistent reports from `~/.openalice/data/research/`, so they are not lost when the application is upgraded.

The dashboard's “latest trend” is derived from the last completed daily bar in the local backtest artifact. It is not a live quote or a trading instruction. IC Markets remains in a waiting state until its own `XAUUSD` and `EURUSD` history is exported and tested.

## Approved Plan 3 Demo Canary Boundary

The [approved Plan 3 design](superpowers/specs/2026-07-13-jmb-goldmine-demo-canary-execution-design.md) permits one narrow exception to the normal UTA execution path. The Research Desk and MT5 bridge remain read-only. A separately installed broker-local EA may submit protected `XAUUSD` orders only on the exact HFM and IC Markets demo accounts after local operator enablement. It exposes no app, API, Research, workspace, Codex, or AI order command. App/API/AI-managed orders remain subject to UTA guards and user approval.

Plan 3 is HFM-first and IC-second. EURUSD remains shadow-only. The EA has no live-mode input or live-account bypass, and no Plan 3 evidence can promote a live account. Its safe defaults are `status_only`, `InpDemoExecutionEnabled=false`, and `InpKillSwitch=true`.

## Required EA Risk Gates

The Plan 3 EA must enforce these locally in MT5, independent of an AI service:

- Only the configured broker symbols may be traded.
- Maximum risk per trade, maximum open risk, maximum daily loss, and maximum consecutive losses.
- Maximum spread and slippage thresholds.
- One-position-per-symbol rule until the strategy is proven.
- News/session blackout windows where relevant.
- A persistent kill switch that blocks new entries and can close positions only on explicit configuration.
- Unique EA magic numbers per broker and account.
- Status-only demo mode as the default; non-demo accounts and live execution are ineligible with no enabling setting.

## Latency Boundary

The MT5 EA owns tick processing, sizing, and order submission. OpenAlice or an AI agent may generate research and review reports, but must not sit in the tick-by-tick order path. This keeps the execution path local and deterministic; it does not guarantee a particular broker or network latency.

## Stage 0 Readiness And Promotion Gates

The exact copy layout, MetaEditor steps, inputs, Common Files paths, rollback, pause, and emergency checks are in the [MT5 operator guide](../tools/mt5/README.md#plan-3-broker-local-gold-demo-canary). Codex does not launch MetaEditor, run the MQL harness, attach an EA, enable Algo Trading, or submit a broker request.

### Stage 0: status-only dry run

1. The human operator recompiles the completed-D1 read-only bridge, policy script, `JmbGoldmineDemoCanary`, and no-order harness in both broker terminals. Every compile must report `0 errors, 0 warnings`, and the harness must end with `JMB_CANARY_HARNESS PASS` and zero failures.
2. The operator writes a `status_only`, candidate-unapproved policy on each exact demo `XAUUSD` chart, enters the exact expected demo account login locally, and attaches HFM and IC with `InpDemoExecutionEnabled=false` and `InpKillSwitch=true`. Algo Trading remains disabled.
3. The bridge stays on a duplicate Gold chart. Both `OpenAliceMt5ExecutionV1/<broker>/XAUUSD/latest_status.csv` files must advance for at least two ten-second cycles; both bridge heartbeats must also remain current. The operator confirms zero new orders and zero new positions in both terminals.
4. Both `completed_d1.csv` files must contain a `bar_as_of` later than the stale `2026-06-23` artifact. File modification time alone is not evidence.
5. Every new canary gate is compared with the existing `JmbGoldmineDemoRiskShell` output. A mismatch, missing artifact, wrong identity, or uncertain broker state leaves both brokers execution-disabled and triggers rollback to the status-only shell.

This two-terminal observation is a pending human gate, not an automated test result.

### HFM canary

After Stage 0 evidence is reviewed, the operator builds an HFM-only `canary_ready` cost model, writes an operator-approved `hfm_canary` policy, reconfirms the local HFM login/server/symbol/magic binding, and deliberately enables HFM demo execution and turns off its kill switch. IC Markets remains `status_only`.

Promotion evidence requires one HFM decision with a durable pre-request event, broker result, broker-confirmed protective stop, append-only lifecycle evidence, and successful restart reconciliation. Any unprotected fill, unknown or partial result, reconciliation mismatch, non-demo identity, missing cost evidence, or duplicate uncertainty returns HFM to `status_only`. No automatic resend is allowed.

### IC Markets canary

Only after the HFM evidence is accepted may the operator build an IC-only `canary_ready` cost model, write an `ic_canary` policy, and locally enable the IC Markets demo EA. The same evidence chain is required, including IC-specific spread, deviation, volume, server, costs, identifiers, protective stop, and restart behavior. HFM must remain protected and reconciled or be paused.

Only after both named ceremonies pass may the operator write `both_demo` policies. Each broker remains independently bound and paused. EURUSD remains shadow-only, and live execution remains absent.

### Pause, rollback, and recovery evidence

- Pause with the local kill switch on, execution disabled, and a new `status_only` policy. The kill switch blocks new entries but does not close a correctly protected position.
- Roll back by capturing execution and broker evidence, detaching the canary from the Gold status chart, and reattaching `JmbGoldmineDemoRiskShell` with its kill switch on. Leave the read-only bridge attached to its duplicate chart and preserve all event, processed-observation, and reconciliation files.
- Treat an unknown broker result as reconciliation-required, never as a rejection or permission to resend. Verify orders, deals, positions, and stops in MT5 before trusting local status.
- If protection is absent, the EA may attempt its narrowly defined emergency close of the EA-owned position and must persist a protection-error pause. The operator verifies the broker is protected or flat and leaves the broker at `status_only`; a persistent latch is never deleted merely to resume.
- A paused or restarted EA returns with execution disabled and kill switch on for at least two stable status cycles before any human review of re-enablement.
