# JMB Goldmine Demo/Paper Autopilot V1 Design

**Date:** 2026-07-13  
**Status:** Written for user review  
**Product:** JMB Goldmine  
**Related docs:** `docs/PRD.md`, `docs/mt5-data-and-training-protocol.md`  
**Approved high-level scope:** Learn from and demo-test Gold/XAUUSD and EURUSD on both HFM demo and IC Markets demo accounts.

## 1. Purpose

JMB Goldmine Demo/Paper Autopilot V1 turns the current research-only MT5 bridge into a controlled demo/paper learning and execution pipeline. It is designed to learn faster from broker-specific data, manual/demo trade history, repeated walk-forward tests, and daily AI review while keeping the live-money boundary locked.

This design does not promise profit, win rate, or live-trading readiness. Its job is to create clean evidence and safe demo execution plumbing so future promotion decisions are based on auditable facts instead of excitement after a few winning trades.

## 2. Safety boundary

V1 is demo/paper only.

- No live account trading.
- No LLM or workspace agent may submit an order, click buy/sell, change live settings, or sit in the tick-by-tick execution path.
- The MT5 EA is the only component allowed to place demo orders, and only when deterministic local gates pass.
- AI agents may research, score, review, journal, recommend, or veto.
- Risk rules are fixed configuration, not self-modified by AI.
- A persistent kill switch must block new entries.
- Closing positions requires explicit deterministic EA logic; agents cannot manually flatten through hidden tools.

If broker/account mode cannot be proven to be demo, the EA must refuse to open new trades.

## 3. Instruments and broker mapping

V1 covers these exact demo instruments:

| Broker | Canonical instrument | Demo symbol | Initial mode |
| --- | --- | --- | --- |
| HFM demo | Gold / USD | `XAUUSD` | Demo automation after gates pass |
| HFM demo | Euro / USD | `EURUSD` | Learn immediately; demo entries only after EUR candidate gate passes |
| IC Markets demo | Gold / USD | `XAUUSD` | Demo automation after gates pass |
| IC Markets demo | Euro / USD | `EURUSD` | Learn immediately; demo entries only after EUR candidate gate passes |

Gold starts closer to demo automation because existing research showed early historical candidate behavior. EURUSD starts stricter because current trend evidence was rejected. EURUSD is still imported, backtested, reviewed, and shadow-scored daily from day one; it simply cannot open demo trades until its own broker-specific validation gate passes.

## 4. Roles and responsibilities

### 4.1 MT5 EA Executor

The MT5 EA runs inside each MetaTrader 5 terminal. It owns:

- Tick and completed-bar observation.
- Broker/account/symbol validation.
- Position sizing.
- Stop-loss and take-profit placement.
- Order submission for demo accounts only.
- Deterministic risk gates.
- Local decision and execution logs.
- Kill-switch enforcement.

### 4.2 Learning Agent

The Learning Agent imports evidence and updates the learning ledger. It owns:

- MT5 orders/deals import.
- Manual, EA, other, and unknown trade-origin labels.
- Broker-specific cost observations.
- Daily learning summaries.
- Detection of stale or missing bridge/history data.

### 4.3 Strategy Steward

The Strategy Steward reviews backtests, forward demo evidence, manual trade outcomes, and market context. It owns:

- Daily strategy journal.
- Candidate status recommendation: `NO ACTION`, `MONITOR`, or `DEMO CANDIDATE`.
- Lessons learned from losing and winning trades.
- Overfitting warnings.

### 4.4 Risk Governor

The Risk Governor has veto power but no execution authority. It owns:

- Risk-policy review.
- Gate failure summaries.
- Drawdown and consecutive-loss monitoring.
- Spread, slippage, cost, stale-data, and broker-mismatch warnings.
- Promotion/demotion recommendation.

### 4.5 Execution Auditor

The Execution Auditor reconciles what the EA intended with what MT5 reports. It owns:

- Deal/order/fill reconciliation.
- Commission, swap, slippage, and spread checks.
- Detection of foreign/manual positions that conflict with EA rules.
- Ledger freshness checks.

## 5. Data flow

1. Each MT5 terminal exports account-scoped bridge and trade-history data.
2. The importer normalizes the data by broker, account, symbol, order, deal, position, magic number, and trade origin.
3. The research runner uses broker-specific market data and cost assumptions to run fixed backtests and walk-forward studies.
4. The learning ledger records each run, result, gate decision, and daily journal.
5. AI agents review the ledger and produce recommendations or vetoes.
6. The EA reads only approved deterministic configuration and local gate state.
7. The EA places demo orders only if every local gate passes.
8. The auditor reconciles the resulting broker history back into the ledger.

The Research Desk may display this evidence, but it must not submit orders.

## 6. Trade-history import requirements

The importer must preserve:

- Broker company, server, account login or local account key, and account trade mode.
- Exact broker symbol and canonical instrument.
- Order tickets, deal tickets, and position identifiers as strings.
- Open/close times with millisecond precision when available.
- Order type, deal type, entry/exit side, reason, state, filling mode, and expiration.
- Volume, requested price, fill price, stop loss, take profit, commission, fee, swap, profit, and balance operations.
- Magic number, comment, and external ID when present.
- Derived origin label: `manual`, `ea`, `other`, or `unknown`.

Manual winning trades are useful evidence, but they are not automatic training labels. The system may study them for context, timing, cost, and broker behavior; it must not blindly clone them as a strategy.

## 7. Broker cost model

V1 must keep separate cost models for HFM demo and IC Markets demo. It must not treat demo costs as live costs without a future explicit live-cost validation step.

Each cost model records:

- Spread observations by symbol and session.
- Commission and fee behavior.
- Swap/financing behavior.
- Slippage between requested and fill prices when available.
- Contract size, digits, point, tick value, minimum volume, volume step, stop distance, freeze level, filling mode, and trading mode.
- Rollover and high-cost time windows when observed.

Backtests that still use placeholder costs must be labelled as research-only and cannot unlock demo automation by themselves.

## 8. Strategy and learning loop

The daily learning loop runs in this order:

1. Import new MT5 history from both demo terminals.
2. Import or refresh bridge/spread observations.
3. Validate account, broker, symbol, and data freshness.
4. Run fixed backtests and walk-forward tests using eligible broker-specific data.
5. Compare simulated outcomes with manual and EA demo outcomes.
6. Update the learning ledger and daily journal.
7. Produce AI recommendations and vetoes.
8. Refresh Research Desk status.

The learning loop may improve hypotheses, review discipline, and strategy selection. It may not mine history until it finds a desired 90% win rate. Acceptance is based on robustness, realistic costs, drawdown, repeatability, and forward-demo behavior.

## 9. Candidate gates

### 9.1 Gold/XAUUSD gate

Gold may become demo-trade eligible when all of these are true:

- Broker account is confirmed demo.
- Exact demo symbol is allowlisted.
- Trade-history import is fresh.
- Bridge/spread telemetry is fresh.
- Broker cost model is not placeholder-only.
- Strategy version is fixed for the test window.
- No open manual or foreign Gold position conflicts with EA rules.
- Risk gates pass locally in the EA.

### 9.2 EURUSD gate

EURUSD starts as learn-and-shadow mode. It may become demo-trade eligible only when all Gold-style gates pass and EURUSD has its own broker-specific candidate decision recorded as `DEMO CANDIDATE`.

The EURUSD gate must fail closed if:

- The latest broker-specific walk-forward result remains rejected.
- The result depends on excluded fallback data.
- Cost model evidence is missing.
- The strategy only works on one broker while failing materially on the other.
- The AI recommendation is based mainly on a small set of recent manual wins.

## 10. Demo EA risk policy

Initial V1 EA settings:

- Account mode: demo only.
- Symbols: HFM `XAUUSD`, HFM `EURUSD`, IC Markets `XAUUSD`, IC Markets `EURUSD`.
- Lot size: `0.01` maximum for all symbols.
- Position limit: one EA-owned open position per broker/symbol.
- Pyramiding: disabled.
- Grid: disabled.
- Martingale/recovery sizing: disabled.
- Stop loss: required before entry.
- Take profit: optional only if strategy spec defines it; otherwise exit must be deterministic.
- Spread gate: required per broker/symbol.
- Slippage gate: required per broker/symbol.
- Daily loss gate: required.
- Consecutive-loss gate: required.
- Stale-data gate: required.
- Foreign/manual exposure gate: required.
- Persistent kill switch: required.
- Restart behavior: default to block new entries until state is reconciled.

If computed risk cannot be represented safely at the broker minimum lot, the EA must skip the trade instead of rounding risk upward.

## 11. User-visible states

Each broker/symbol should show one of these states:

- `NO DATA`: required data is missing.
- `LEARNING`: data exists and is being imported/reviewed.
- `SHADOW`: strategy produces would-trade decisions but EA does not submit orders.
- `DEMO ENABLED`: EA may place demo orders when every local gate passes.
- `BLOCKED`: a safety, data, cost, or validation gate failed.
- `PAUSED`: user or kill switch disabled new entries.

The UI must distinguish learning progress from permission to trade. A good journal or recent win must not appear as approval.

## 12. Error handling and fail-closed rules

The system blocks new entries when any of these occur:

- Account is not demo.
- Broker, server, account key, or symbol does not match the approved config.
- Trading is disabled in MT5 or Algo Trading is off.
- Bridge or trade-history data is stale.
- Spread or slippage exceeds limits.
- Stop loss cannot be placed.
- Minimum lot would exceed allowed risk.
- Manual or foreign exposure conflicts with one-position rules.
- Commission, swap, or fill history cannot be reconciled.
- Daily loss or consecutive-loss limit is hit.
- Disk logging fails.
- EA restarts and cannot reconcile open positions.

All skips and blocks must be logged with a human-readable reason.

## 13. Testing and verification

The implementation plan must include tests for:

- Trade-history parsing and origin labelling.
- Account/symbol allowlist enforcement.
- Demo-only refusal on non-demo account mode.
- Risk gate pass/fail behavior.
- Stop-loss-required behavior.
- One-position-per-symbol behavior.
- Kill-switch persistence.
- Ledger updates for taken and skipped trades.
- EURUSD remaining blocked until its candidate gate passes.
- Research Desk displaying evidence states without order-submission authority.

Broker-connected acceptance checks must be run on demo accounts only.

## 14. Out of scope for V1

- Live trading.
- Autonomous risk-rule changes by AI.
- LLM-driven order submission.
- Broker credential access inside AI agents.
- Martingale, grid, recovery, or averaging down.
- New brokers or new instruments beyond HFM/IC demo Gold and EURUSD.
- Profit guarantees or fixed win-rate promises.
- Copying manual trades without strategy validation.

## 15. Implementation sequencing

V1 should be implemented in small, reviewable slices:

1. Trade-history exporter/importer and account-scoped ledger.
2. Broker cost model ingestion.
3. Daily learning-loop runner and journal writer.
4. Research Desk status for learning, shadow, blocked, and demo-enabled states.
5. Paper/shadow signal generation.
6. Demo-only EA risk gate shell.
7. Demo order execution for Gold after gates pass.
8. EURUSD promotion from shadow to demo-enabled only after its candidate gate passes.
9. Execution reconciliation and auditor reports.

Each slice must preserve the live-trading lock.

## 16. Open user decision before any future live pilot

This spec does not approve live trading. Before any $100 live-account pilot is designed, the user must explicitly approve a live risk budget and pilot-loss cap. The recommended first cap is a hard total pilot-loss cap near `$2`, not 8-10%, because minimum-lot Gold risk can move quickly.

## 17. Acceptance criteria for this design

The design is accepted when:

- Gold and EURUSD are both included for HFM demo and IC Markets demo.
- EURUSD learns immediately but cannot demo-trade until its own candidate gate passes.
- AI agents have review/veto/journal roles only.
- MT5 EA is the only demo execution component.
- Live trading remains locked.
- Risk gates are deterministic and fail closed.
- The implementation can be broken into small, testable slices.
