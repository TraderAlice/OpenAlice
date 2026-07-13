# JMB Goldmine Demo Canary Execution Design

**Date:** 2026-07-13

**Status:** Approved design, pending implementation plan

**Scope:** HFM and IC Markets demo Gold execution; EURUSD remains shadow-only

**Safety boundary:** This design contains no live-account eligibility or live-mode switch

## 1. Purpose

Plan 3 adds the smallest execution-capable slice to JMB Goldmine: deterministic, broker-local demo orders for Gold after the existing shadow-decision and MT5 risk-shell gates pass.

The purpose is to validate execution plumbing, broker costs, protection, reconciliation, and learning records. It is not a profitability claim, live-trading approval, or permission for an AI agent to submit orders.

The repository does not contain the `PRD.txt` named by the workspace instructions. This design therefore uses `docs/PRD.md`, the existing JMB Goldmine PRD, as the product source of truth.

## 2. Approved product decisions

- Gold/XAUUSD is the only execution-eligible instrument in Plan 3.
- HFM demo is enabled first as the initial canary.
- IC Markets demo is enabled only after the HFM canary proves order submission, broker-side stop protection, durable logging, and restart reconciliation.
- After the IC canary passes, both Gold demo executors may remain enabled.
- EURUSD continues to produce shadow decisions but cannot submit orders.
- Maximum order volume is `0.01` lot.
- Each broker pauses new entries after four losing trades in the broker day.
- The daily loss-count pause resets automatically at the next broker day.
- A separate account-currency daily-loss gate also applies and resets at the next broker day.
- The current daily strategy may create at most one new entry per broker per completed daily observation. The four-loss rule is an upper safety boundary, not a target trade frequency.
- No martingale, grid, recovery sizing, pyramiding, or automatic lot growth is permitted.
- AI agents may review and journal outcomes but may not submit orders, change risk limits, override pauses, or change the strategy automatically.

## 3. Architecture choice

Plan 3 evolves the verified status-only risk shell into a new demo-canary EA while retaining the status-only EA as a rollback and diagnostic tool.

The new EA replaces `JmbGoldmineDemoRiskShell` on the existing Gold risk-shell chart after dry-run acceptance. The separate read-only bridge remains attached to its duplicate Gold chart. No third Gold chart is required.

Direct order submission from TypeScript, the Research Desk, Codex, an LLM, or a workspace agent is prohibited. The MT5 EA is the only execution authority and independently re-evaluates all gates using current broker state.

### Components

1. **Completed-observation decision cycle**
   - Reads broker-specific research, bridge, cost, and learning artifacts.
   - Writes an append-only decision record and atomic latest-decision CSV.
   - Uses a stable observation ID based on broker, symbol, strategy version, and completed-bar `as_of` date.
   - Repeated scheduler runs for the same completed observation do not create a new execution identity.

2. **Demo execution policy**
   - Stores broker-specific candidate approval, exact server allowlist, strategy allowlist, maximum spread, maximum slippage, risk limits, session rules, news blackout, and rollout stage.
   - Lives in persistent local data, not deployable source files.
   - Cannot be changed by the AI review loop.

3. **JMB Goldmine demo-canary EA**
   - Reads the latest decision and local policy.
   - Reconciles MT5 orders, positions, deals, and processed decision IDs.
   - Evaluates gates and either blocks, closes/reverses, or submits one protected demo order.
   - Writes append-only execution events plus an atomic latest-status CSV.

4. **Outcome reconciler**
   - Imports EA-owned order/deal outcomes using broker, account, symbol, magic number, decision ID, order ticket, deal ticket, and position ID.
   - Updates learning summaries without rewriting the original decision or execution event.

5. **Research Desk status**
   - Displays rollout stage, execution switch, gate state, latest decision, latest execution event, open EA-owned exposure, daily loss count, daily realized loss, and reconciliation errors.
   - Clearly labels all Plan 3 activity as demo-only.

## 4. Deployment and identity binding

The EA has no live-mode input. It refuses to initialize as execution-capable unless all of these identities match:

- `ACCOUNT_TRADE_MODE_DEMO`.
- Exact configured account login entered locally by the operator.
- Exact server allowlist:
  - HFM: `HFMarketsGlobal-Demo4`.
  - IC Markets: `ICMarketsSC-Demo`.
- Exact chart and configured symbol: `XAUUSD`.
- Exact broker ID: `hfmarkets` or `icmarkets`.
- Strategy allowlist: `daily-trend-v1`.
- Broker-specific magic number:
  - HFM Gold: `880101`.
  - IC Markets Gold: `880201`.

Account logins are local MT5 inputs and must never be committed to the repository or written to the Research Desk API.

The EA defaults remain:

- `InpDemoExecutionEnabled=false`.
- `InpKillSwitch=true`.

Both must be changed deliberately before the initial HFM canary. Enabling IC Markets is a separate later operator action.

## 5. Decision idempotency

Every execution-eligible record includes:

- `decision_id`.
- `observation_id`.
- `observation_as_of`.
- Broker, server, account mode, symbol, and strategy version.
- Direction, reference price, volume, stop loss, and calculated risk ceiling.
- Cost-model version and candidate-policy version.
- All pre-decision gate results.

The EA persists processed decision and observation IDs. It must not send another entry when any of these are true:

- The decision ID was already accepted, rejected, filled, closed, stopped, or reconciled.
- The observation ID already produced an entry attempt.
- An EA-owned position already matches the decision direction.
- The current observation is not newer than the position's opening observation.
- A position stopped out and the decision still refers to the same completed observation.

Atomic latest-file replacement and append-only journals prevent a partially written decision from becoming executable.

## 6. Entry gates

All gates fail closed when their inputs are missing, malformed, stale, or unverifiable.

Before every entry the EA enforces:

1. Demo account, account login, server, broker, chart symbol, and magic-number binding.
2. `InpDemoExecutionEnabled=true` and persistent kill switch off.
3. HFM-first or IC-enabled rollout stage from the local policy.
4. Gold and `daily-trend-v1` allowlists.
5. Fresh decision, bridge heartbeat, candidate policy, broker cost model, and completed observation.
6. `0.01` requested volume and broker volume-minimum/step compatibility.
7. Required stop loss accepted by broker constraints before submission.
8. Real account-currency loss to the stop calculated with MT5 `OrderCalcProfit` and not greater than `10.00` demo account-currency units by default.
9. Daily realized loss not greater than `40.00` demo account-currency units by default.
10. Fewer than four losing EA-owned Gold trades in the broker day.
11. No EA-owned position, no pending EA-owned order, and no manual or foreign Gold exposure.
12. Sufficient margin: estimated order margin is available and post-order free margin retains at least a ten-times margin buffer.
13. Current spread at or below:
    - HFM Gold: `0.75` price units.
    - IC Markets Gold: `0.30` price units.
14. Maximum requested price deviation at or below:
    - HFM Gold: `0.50` price units.
    - IC Markets Gold: `0.30` price units.
15. Entry session:
    - Monday through Thursday, `06:00` to `20:00` UTC.
    - Friday, `06:00` to `16:00` UTC.
    - No weekend or rollover-window entries.
16. No high-impact USD economic event from 30 minutes before through 30 minutes after the event, using the MT5 economic calendar. Unavailable calendar data blocks new entries.
17. Durable event-log path is writable before order submission.
18. Restart reconciliation and unknown-order recovery are complete.

The `10.00` per-trade and `40.00` daily currency defaults are demo-canary plumbing limits. They are not approved settings for a future `100 USD` live account. Live-capital eligibility requires a separate design and a minimum-lot risk feasibility check.

## 7. Order submission and protection

- The EA sends one market request with the decision ID in the comment and the required broker-side stop loss in the original request.
- It records an `order_requesting` event before submission and flushes the journal.
- It records the full broker result code, accepted volume, accepted price, stop, order ticket, deal ticket, and position ID after the call.
- A broker rejection is terminal for that decision. The EA does not retry blindly.
- A timeout or unknown result enters `reconciliation_required`; the EA searches broker orders, deals, and positions by magic number, symbol, and decision comment before deciding whether an order exists.
- Partial or unexpected volume enters `reconciliation_required` and blocks further entries.
- If MT5 reports a fill without confirmed stop protection, the EA performs the explicitly designed emergency protective close, logs every attempt, and pauses the broker. It does not open replacement exposure.

## 8. Position lifecycle

- A same-direction completed observation while a JMB position is open is a no-op and is logged.
- An opposite completed observation requests closure of the existing JMB position.
- A reversal entry is considered only after the close is confirmed, the close event is durable, and all entry gates are re-evaluated.
- A stop-loss close marks the observation as consumed. The EA cannot re-enter from the same observation.
- No fixed take-profit is added in Plan 3 because the research baseline is daily time-series momentum. Adding a take-profit would create an untested strategy variant.
- The kill switch blocks new entries. It does not close a correctly protected position.
- Emergency closing is limited to an unprotected EA-owned position or a separately confirmed opposite-signal close. No hidden AI or remote close command exists.

## 9. Daily loss policy

The loss day is the broker server's calendar day and is recorded with the server identifier and UTC conversion.

An EA-owned Gold trade counts as a losing trade when its fully reconciled net result is below zero after commission, swap, and fees.

New entries pause for the remainder of the broker day when either condition is true:

- Four losing EA-owned Gold trades have closed during that broker day.
- Reconciled realized EA-owned Gold loss reaches `40.00` demo account-currency units.

The count and realized-loss gate reset automatically when the broker day changes. The reset does not clear unresolved orders, unprotected exposure, reconciliation errors, kill switches, or identity mismatches.

The current daily strategy is limited to one new entry per completed daily observation per broker, so it normally cannot accumulate four new stopped trades in one day. The four-loss rule remains defense in depth for later separately approved strategies and unexpected lifecycle conditions.

## 10. Scheduler and learning loop

- A local JMB scheduler evaluates artifacts every five minutes while the desktop service is running.
- It only emits a new execution identity when a newer completed daily observation exists.
- Scheduler downtime cannot remove broker-side stop protection. On restart it catches up once, then resumes the five-minute cadence.
- It never shells through PowerShell or launches MetaEditor.
- The execution cycle is deterministic and does not call an LLM.

After reconciliation, AI workspaces may create daily and weekly journals that:

- Compare decision context with the eventual net result.
- Summarize spread, slippage, commission, swap, adverse excursion, favorable excursion, blocks, and operational errors.
- Recommend `NO ACTION`, `MONITOR`, `SHADOW`, `DEMO CANDIDATE`, or `PAUSE` for human review.

AI output cannot alter policy files, strategy parameters, EA inputs, processed IDs, or broker state.

## 11. Execution and outcome records

Execution events are append-only JSONL records with an atomic latest-status CSV for MT5 and UI interoperability. Each record includes:

- Schema version and event ID.
- Event type and UTC timestamp.
- Broker, server, account mode, symbol, strategy, magic number, and masked account identity.
- Decision and observation IDs.
- Gate results and risk calculations.
- Requested and accepted order fields.
- MT5 return code and human-readable result.
- Order, deal, and position identifiers stored as strings.
- Reconciliation state.
- Daily loss count and realized loss.
- Outcome fields when closed.

Permitted lifecycle states are:

- `disabled`.
- `paused`.
- `blocked`.
- `ready`.
- `order_requesting`.
- `order_rejected`.
- `reconciliation_required`.
- `filled_protected`.
- `close_requesting`.
- `closed`.
- `stopped`.
- `emergency_close`.
- `error`.

No local state may claim `filled_protected` unless broker state confirms both exposure and stop protection.

## 12. Error handling

- Missing, stale, or malformed inputs produce a durable `blocked` event with a safe next action.
- Unwritable logs block entry before the broker call.
- Unknown broker results never trigger an automatic resend.
- Restart with unknown exposure enters reconciliation before processing decisions.
- Foreign or manual Gold exposure blocks entry in both netting and hedging account modes.
- Broker/account mismatch remains blocked even if the decision file otherwise passes.
- Economic-calendar failure blocks entry but does not interfere with management of an existing protected position.
- An exception in the app scheduler cannot grant MT5 authority or bypass EA gates.

## 13. Research Desk behavior

For HFM and IC Markets Gold, the Research Desk displays:

- `EXECUTION DISABLED`, `CANARY READY`, `DEMO ENABLED`, `PAUSED`, `BLOCKED`, or `RECONCILIATION REQUIRED`.
- Latest completed observation and decision age.
- Latest broker execution event.
- Whether broker-side stop protection is confirmed.
- Current EA-owned position summary without exposing account login.
- Daily losing-trade count and realized loss.
- Current blocking gate and next safe action.
- HFM-first / IC-pending / both-enabled rollout stage.

EURUSD continues to display `DEMO BLOCKED` and shadow decisions. The UI must state that demo performance is not live approval or evidence of future profit.

## 14. Rollout

### Stage 0: status-only dry run

- Compile with zero errors and zero warnings.
- Attach the new EA with execution disabled and kill switch on.
- Compare every new EA gate with the existing risk-shell output.
- Run restart, stale-file, foreign-position, spread, session, news, and disk-failure checks without submitting an order.

### Stage 1: HFM canary

- Explicitly set the expected HFM demo account login locally.
- Enable demo execution and turn off the kill switch on HFM Gold only.
- Observe one eligible decision through request, fill/rejection, stop confirmation, event persistence, and restart reconciliation.
- Any unprotected fill, unknown result, or reconciliation mismatch returns the rollout to Stage 0.

### Stage 2: IC Markets canary

- Keep HFM protected and reconciled.
- Repeat the same ceremony for IC Markets Gold.
- Verify IC-specific spread, slippage, volume, server, cost, and identifier behavior.

### Stage 3: both demo brokers

- Both Gold demo EAs may remain enabled with independent gates, magic numbers, loss days, and pauses.
- EURUSD remains shadow-only.
- Live execution remains absent.

## 15. Testing strategy

### TypeScript tests

- Stable observation and decision IDs.
- No duplicate execution identity for repeated scheduler runs.
- New identity only for a newer completed daily observation.
- Demo-candidate and rollout-policy validation.
- Broker-specific cost-model validation.
- Execution-event parsing, append-only persistence, and fail-closed malformed-state handling.
- Outcome reconciliation and daily net-loss summaries.
- Research API/UI states without account-login exposure.

### MQL5 tests and harness scenarios

- Demo-only, account, server, symbol, strategy, and magic binding.
- Execution-disabled and kill-switch defaults.
- `0.01` lot enforcement and broker step compatibility.
- `OrderCalcProfit` stop-risk and `OrderCalcMargin` buffer gates.
- Spread, deviation, session, Friday, rollover, and economic-calendar gates.
- One-position, foreign-exposure, and pending-order conflicts.
- Decision/observation idempotency.
- Four-loss and account-currency daily pause with next-day reset.
- Same-direction no-op, opposite-direction close/re-evaluate, and stopped-observation consumption.
- Broker rejection, timeout, unknown result, partial fill, unprotected fill, emergency close, and restart reconciliation.
- Log-write failure before submission.

### Acceptance checks

- Source scan confirms no live-mode input or live-account bypass.
- Source scan confirms no martingale, grid, recovery, or automatic lot-growth path.
- Dry-run produces no broker orders.
- HFM canary satisfies the rollout evidence before IC can be enabled.
- IC canary satisfies the same evidence before both-enabled status.
- Every broker submission has a durable pre-request event and reconciled broker result.
- No repeated scheduler run can duplicate a broker entry.

## 16. Explicitly out of scope

- Any live-account order.
- EURUSD demo execution.
- Intraday or high-frequency strategies.
- Self-modifying strategy logic or autonomous risk-limit changes.
- Profit, win-rate, or drawdown guarantees.
- Automatic promotion based only on demo profit.
- Remote order commands from AI, Codex, Research Desk, chat, or workspaces.
- Take-profit, trailing-stop, martingale, grid, recovery, or portfolio allocation features.

## 17. Completion criteria

Plan 3 is complete only when:

- The approved automated tests pass.
- The new EA compiles with zero errors and zero warnings.
- Status-only dry-run evidence is captured for both brokers.
- HFM canary evidence is reviewed before IC enablement.
- IC canary evidence is reviewed before both-enabled status.
- Research Desk and journals truthfully display broker-confirmed lifecycle states.
- EURUSD and all non-demo accounts remain unable to execute.
- Documentation explains installation, inputs, enablement, rollback, pause, recovery, and evidence review.
