# JMB Goldmine Shadow-to-Demo Self-Trading Risk Shell Design

**Date:** 2026-07-13  
**Status:** Written for user review  
**Product:** JMB Goldmine  
**Builds on:** `2026-07-13-jmb-goldmine-demo-paper-autopilot-design.md`, `2026-07-13-jmb-goldmine-learning-foundation.md`  
**Approved direction:** Manual Gold trades are supporting broker/cost evidence. JMB Goldmine should learn primarily from its own logged shadow decisions and demo EA trades.

## 1. Purpose

This design defines the next safe layer after the learning foundation: a shadow-to-demo risk shell that lets JMB Goldmine generate its own trade decisions, record the reason for every decision, and later allow a deterministic MT5 EA to place tiny demo trades only when all local risk gates pass.

The main learning dataset becomes JMB Goldmine's own decisions, not manual trades. Manual trades remain useful for broker cost, spread, commission, swap, fill behavior, and comparison, but they are not treated as strategy labels.

## 2. Core principle

The system must know why it would enter a trade before it is allowed to learn from the trade result.

Every JMB-generated decision must have:

- Strategy version.
- Broker and exact symbol.
- Decision mode: `shadow`, `demo_blocked`, `demo_order_requested`, `demo_filled`, `demo_closed`, or `skipped`.
- Direction: `buy`, `sell`, or `flat`.
- Entry reason code.
- Invalidation reason or stop-loss basis.
- Spread at decision time.
- Expected risk and maximum allowed risk.
- Gate results.
- Outcome after close, when available.

If a trade has no JMB decision record, it may be audited but not used as a primary self-learning example.

## 3. Scope

### In scope

- HFM demo `XAUUSD`.
- HFM demo `EURUSD`.
- IC Markets demo `XAUUSD`.
- IC Markets demo `EURUSD`.
- Shadow decisions for all four broker/symbol pairs.
- Demo EA risk shell for all four broker/symbol pairs.
- Demo order requests only after deterministic gates pass.
- Manual trades used only as supporting broker/cost/context evidence.
- AI daily review of JMB's own shadow/demo decisions.

### Out of scope

- Live trading.
- AI clicking buy/sell.
- LLM-generated orders without EA risk gates.
- Martingale, grid, averaging down, recovery sizing, pyramiding.
- Copying manual trades as a strategy.
- Letting recent wins automatically loosen risk limits.
- EURUSD demo entries before its candidate gate passes.

## 4. Operating modes

### 4.1 Learning-only

The system imports broker data, bridge status, trade history, and manual/demo outcomes. It does not generate trade decisions.

### 4.2 Shadow mode

The strategy engine generates would-trade decisions and logs them, but no order request is sent to MT5. Shadow mode is the default first step for both Gold and EURUSD.

Shadow logs answer: "If JMB had been allowed to trade, what would it have done, why, and what would the result have been?"

### 4.3 Demo-blocked mode

The strategy engine produces a candidate decision, but one or more gates block it. The system logs the block reason. Blocked decisions are valuable learning data because they show discipline.

### 4.4 Demo-enabled mode

The MT5 EA may place a demo order only when:

- The account is confirmed demo.
- The symbol is allowlisted.
- The strategy version is approved for demo mode.
- The broker/symbol candidate gate is satisfied.
- Every local EA risk gate passes.
- No manual/foreign position conflict exists.
- The persistent kill switch is off.

Demo-enabled does not mean every signal trades. It means the EA may trade only when all gates pass.

## 5. Manual trades policy

Manual trades are not strategy labels unless the setup was recorded at decision time with a structured reason. The existing Gold manual wins are therefore treated as:

- Broker cost evidence.
- Spread and fill evidence.
- Commission/swap evidence.
- Risk and exposure context.
- Human benchmark for comparison.

They must not be used to claim that the system learned a profitable entry strategy.

## 6. Strategy candidate gates

### 6.1 Gold/XAUUSD

Gold may begin in shadow mode immediately and may progress to demo-enabled mode after the risk shell is implemented and these are true:

- Fresh bridge telemetry exists for the broker/symbol.
- Fresh trade ledger import exists.
- Account mode is demo.
- Cost model is not placeholder-only.
- Strategy version is fixed.
- Spread, stop, lot, daily-loss, and position gates are configured.
- The EA can log decisions and blocked decisions before order execution.

### 6.2 EURUSD

EURUSD may begin in shadow mode immediately. It must remain demo-blocked until its own broker-specific candidate record is approved.

EURUSD cannot become demo-enabled merely because Gold performs well.

## 7. Decision record schema

Each JMB decision should be append-only and include:

```json
{
  "schema_version": 1,
  "decision_id": "stable unique id",
  "created_at": "ISO-8601 UTC",
  "broker": "hfmarkets",
  "server": "broker server",
  "account_mode": "demo",
  "symbol": "XAUUSD",
  "canonical_instrument": "Gold / USD",
  "strategy_version": "daily-trend-v1",
  "mode": "shadow",
  "direction": "buy",
  "reason_code": "daily_trend_breakout",
  "reason_detail": "Completed daily trend filter is positive and spread gate passed.",
  "entry_reference_price": 2410.25,
  "stop_loss": 2402.25,
  "take_profit": null,
  "volume": 0.01,
  "spread": 0.36,
  "risk_amount": 0.80,
  "max_allowed_risk": 1.00,
  "gate_results": [
    { "gate": "account_demo", "state": "pass", "detail": "MT5 reports demo mode" },
    { "gate": "spread", "state": "pass", "detail": "0.36 <= configured limit" }
  ],
  "order_ticket": null,
  "position_id": null,
  "outcome": null
}
```

The exact field names may be implemented in TypeScript/MQL5-friendly CSV or JSONL, but the persisted meaning must remain intact.

## 8. EA risk shell requirements

The MT5 EA risk shell must enforce:

- Demo account only.
- Broker/server/account binding.
- Exact symbol allowlist.
- Strategy version allowlist.
- `0.01` maximum lot for V1.
- One EA-owned open position per broker/symbol.
- No pyramiding.
- No martingale or recovery sizing.
- Stop loss required before order submission.
- Maximum spread.
- Maximum slippage.
- Maximum daily loss.
- Maximum consecutive losses.
- Minimum free margin.
- No manual/foreign position conflict on the same symbol.
- Fresh decision file and bridge state.
- Persistent kill switch.
- Restart reconciliation before new entries.
- Disk logging must work before new entries.

If any gate cannot be evaluated, it fails closed.

## 9. AI role

AI agents may:

- Review shadow decisions.
- Review demo trades after close.
- Compare JMB decisions against manual trades.
- Identify repeated mistakes.
- Recommend `NO ACTION`, `MONITOR`, `SHADOW`, `DEMO CANDIDATE`, or `PAUSE`.
- Draft daily and weekly learning journals.

AI agents may not:

- Submit orders.
- Change EA risk limits.
- Switch live mode on.
- Override kill switches.
- Reclassify manual trades as system strategy labels without recorded setup reasons.

## 10. Learning loop

Daily loop:

1. Import bridge status and trade ledger.
2. Import JMB decision records.
3. Reconcile demo orders/deals with decision records.
4. Mark outcomes for closed demo trades.
5. Score gate discipline and strategy behavior.
6. Compare shadow decisions with actual market movement.
7. Write daily journal with mistakes, protected-risk skips, and next bounded hypothesis.

The system learns from discipline as much as from profit. A correctly skipped bad trade is a positive learning event.

## 11. User-visible states

Each broker/symbol should display:

- `LEARNING`: trade history and bridge evidence are being collected.
- `SHADOW`: JMB is logging would-trade decisions, no orders.
- `DEMO BLOCKED`: a candidate exists but a gate blocks execution.
- `DEMO ENABLED`: EA may place demo trades if all gates pass.
- `PAUSED`: kill switch or user pause blocks new entries.
- `ERROR`: required evidence/logging is malformed or stale.

The UI must say that shadow/demo status is not live-trading approval.

## 12. Acceptance criteria

This design is ready for implementation planning when:

- Manual trades are explicitly supporting evidence, not primary strategy labels.
- JMB-generated decisions are the primary learning dataset.
- Shadow mode exists before demo execution.
- Demo execution remains EA-only and deterministic.
- Gold and EURUSD are both included.
- EURUSD remains demo-blocked until its own candidate gate passes.
- Live trading remains out of scope.
- Every decision and skip is logged with reason and gate results.

## 13. Future live boundary

This design does not approve live trading. A future live pilot requires a separate PRD/spec with:

- Explicit account.
- Explicit broker/server/account binding.
- Fixed strategy version.
- Human approval ceremony.
- Hard pilot-loss cap.
- Live cost validation.
- Emergency stop procedure.

Until that exists, live remains blocked.
