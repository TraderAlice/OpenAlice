# Mechanical signal policy and portfolio attribution

Status: V1 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]],
[[docs/design/factor-diagnostics]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/executed-book-risk-compliance]],
[[docs/design/portfolio-decision-explorer]],
[[docs/design/rl-factor-policy-lab]],
[[docs/design/research-selection-integrity]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns the fixed causal path from one candidate factor value to
signal intent, proposed target, executed bar weight, and attributed portfolio
evidence. It makes a research position explainable without granting the
candidate or AutoQuant live-trading authority.

It does not define Broker orders, TPSL, intrabar fills, exchange rules,
available balance, or OpenAlice UTA mutation.

## Dataset-fixed timing

At close `t`, the policy may use factors and OHLCV through `t`. The resulting
executed weight earns only close `t` to close `t + 1` return.

Train/validation/test boundaries are fixed from the dataset timestamp panel,
not from candidate coverage, warm-up length, active targets, or successful
trades. The final signal row of each split is purged so its `t + 1` target
return cannot cross into the next split.

Validation net Sharpe remains the sole promotion objective. Test, attribution,
policy comparison, and robustness fields are visible diagnostics.

## Signal-state machine

For each date, valid factor values become cross-sectional percentile scores on
`[0, 1]` using `(rank - 1) / (count - 1)`. The fixed intent states are `short
(-1)`, `flat (0)`, and `long (+1)`.

Entry thresholds:

- flat enters long at score `>= 0.75`;
- flat enters short at score `<= 0.25`.

Exit thresholds create hysteresis:

- long remains long at score `>= 0.55`, exits below `0.55`, and reverses
  directly to short at `<= 0.25`;
- short remains short at score `<= 0.45`, exits above `0.45`, and reverses
  directly to long at `>= 0.75`.

The fixed Portfolio Mandate limits this state machine:

- `long-cash` uses only long entry/hold/exit events;
- `short-cash` uses only short entry/hold/exit events;
- dollar-neutral uses the full two-sided transition set;
- `asset-role` selects long-only, short-only, or the full two-sided
  transition set independently for each asset;
- context-only assets always emit `context_only` and remain flat.

Missing or insufficient cross-sectional evidence resets permitted intent to
flat. Every tradable asset/date receives one fixed event such as `enter_long`,
`hold_short`, `exit_long`, `reverse_short_to_long`, `stay_flat`, or
`unavailable_reset`.

Hysteresis changes signal intent, while the existing portfolio no-trade band
changes execution. They are separate controls and both remain visible.

## Conviction and target sizing

An active intent receives:

```text
conviction = 2 * abs(percentile_score - 0.5)
risk_strength = conviction / trailing_20_bar_volatility
```

Dollar-neutral long and short strengths are independently water-filled into
fixed `+0.5` and `-0.5` budgets under the `0.30` absolute asset cap. If either
side lacks sufficient breadth to fund its budget, the proposed portfolio is
flat and the allocation status records the reason.

Directional strengths are water-filled up to gross `1.0` on the permitted
side under the same cap. Unused capacity remains cash; it never creates the
opposite side. Context-only assets receive zero strength and target.

This is inverse-volatility conviction sizing under diagonal risk assumptions,
not covariance optimization or equal risk contribution. The raw allocation is
then passed through the fixed one-sided covariance governor defined in
[[docs/design/portfolio-risk-governor]]. The ledger discloses each asset's
conviction, volatility, raw strength, pre-governor target, governed target,
and diagonal-risk-budget share.

## Execution and decision ledger

Before trading at close `t`, the prior executed book is drifted through the
return from `t - 1` to `t`. The fixed portfolio band compares this pre-trade
book with the proposed target:

- rebalance when proposed one-way turnover is at least `0.05`;
- otherwise retain the drifted book.

That ordinary choice is not yet final. Core forecasts the chosen post-drift
book with the same causal covariance policy. If it exceeds the mandate
ceiling, Core applies the minimum uniform scale-down needed to comply. This
risk-only repair outranks the no-trade band, records an explicit override, and
never increases exposure. Unavailable covariance follows the mandate's
existing fail-flat policy. See
[[docs/design/executed-book-risk-compliance]].

Each asset/date ledger row contains:

- factor value, percentile, prior/new signal state, and signal event;
- mandate id, tradability, permitted construction family, and allocation
  status;
- conviction, volatility, risk strength, allocation status, and proposed
  target before/after the governor;
- covariance observations, pre/post annualized forecast, fixed ceiling,
  scale, and governor status;
- drifted pre-trade weight, executed weight, trade, target action, execution
  action, and execution reason;
- pretrade/proposed/executed annualized forecasts, final ceiling, runtime and
  repair scales, forecast availability, observation count, ordinary rebalance,
  and risk-only override;
- next-bar asset return, gross contribution, allocated linear cost, and net
  contribution;
- causal market regime and ex-ante component variance contribution/share from
  trailing returns through `t`.

Signal intent can be flat while the execution band retains a small residual
position. Keeping both fields is deliberate: it exposes implementation lag
rather than rewriting history.

## Current mechanical decision

The bounded Portfolio diagnostics read model turns the latest verified ledger
date into one research-only decision chain:

```text
current percentile + prior state
→ current signal event and state
→ next permitted state thresholds
→ pre-governor and governed target
→ drifted pretrade book
→ proposed one-way turnover versus the fixed no-trade band
→ ordinary rebalance or hold
→ final risk repair when required
→ historical executed research book
```

The next-trigger set is state and Mandate dependent. A flat long/cash asset
shows only `enter_long >= long_entry`; a current long shows only
`exit_long < long_exit`. Short/cash is symmetric. Dollar-neutral flat state
shows both entry boundaries, while active long/short state shows the ordinary
exit boundary and the farther direct-reversal boundary. Context-only assets
show no trigger because they have no position authority.

For an available current percentile, Core reports the non-negative distance to
each boundary. Its exact semantics are
`current-cross-sectional-percentile-points-with-peer-ranks-held-fixed`.
This is an interpretation of the current rank-state buffer, not a price
target, time estimate, probability, or forecast: the next bar changes the
whole cross-section.

Core separately reconciles:

```text
proposed one-way turnover
  = 0.5 * sum(abs(governed target - drifted pretrade weight))
```

against the immutable execution record before exposing the decision. This
keeps signal-state change, target resizing, risk scaling, the portfolio
no-trade gate, and final risk override visibly separate. The object carries
`quantitative-decision-support` authority and `tradingAuthority: none`.

## Attribution

For every split, Core/Judge evidence groups the exact ledger by:

- asset;
- signal-intent state;
- causal `up/down × calm/stressed` market regime.

It reports gross, cost, net, and one-way-turnover contribution plus average
absolute executed weight and variance-contribution share. Reconciliation
audits prove, per date:

```text
sum(asset gross contribution) = portfolio gross return
sum(asset allocated cost) = portfolio cost
sum(asset net contribution) = portfolio net return
sum(abs(asset trade)) = portfolio traded notional
sum(component variance share) = 1 when variance is positive
```

Concentration reports maximum absolute net-contribution and trailing
component-variance shares across assets, plus their Herfindahl indices. This
identifies whether aggregate return or ex-ante risk is effectively one-name
research.

## Signal monetization bridge

The bounded Portfolio diagnostics also reconstruct a validation and
visible-test additive transmission bridge:

```text
prediction-mode-aware normalized signal intent
→ fixed conviction / inverse-volatility sizing and caps
→ covariance-governed target
→ historical executed gross contribution
→ historical executed net contribution
```

The normalized-intent layer follows the verified prediction mode. Directional
and ordinary cross-sectional modes give active permitted signals equal shares
of the applicable fixed Mandate side budget and respect per-asset caps.
Ordinary cross-sectional dollar-neutral intent is flat unless both long and
short sides can fully fund their fixed side budgets, matching that allocator's
side-breadth rule.

An explicit `two-asset-relative-value` pair is a different construction. Its
two signal states must be complementary; both legs receive the same absolute
weight bounded by the half-gross budget and both leg caps, and unused capacity
remains Cash. This normalized pair intent therefore matches the fixed
pre-governor pair exactly instead of being zeroed merely because a leg cap is
below the full side budget. Strict reconciliation exposes the evaluation mode,
construction id, and maximum pair-intent/target error. Context-only assets
always receive zero diagnostic weight.

Every stage is arithmetic `weight × next-bar asset return`, aggregated by split
and asset. It is not a separately compounded counterfactual portfolio:
substituting historical weights would also change drift, turnover, the
no-trade decision, final risk repair, and cost. The bridge therefore diagnoses
transmission without claiming an investable equal-weight baseline.

Core reports the additive delta introduced by sizing/caps, the risk governor,
historical execution/no-trade retention, and cost. It also discloses signal
coverage, active dates, risk-limited dates, target/executed mismatches,
no-trade retention, and rebalances. Reconciliation requires the executed gross
and net stages to equal the immutable decision and daily ledgers exactly.

Only validation determines whether normalized signal intent is already
non-positive, a positive intent is destroyed during transmission, or the edge
remains positive after cost. The largest adverse transformation yields a
bounded next research focus. Test is visible audit only; the bridge never enters
KEEP/REVERT, promotion, or trading.

## Hysteresis baseline

The Judge also constructs a fixed no-hysteresis diagnostic policy whose exit
thresholds equal its entry thresholds. It reports signal-transition counts,
target turnover, implementation turnover, and validation/test net performance
beside the governed policy.

This comparison does not enter KEEP/REVERT. It shows whether persistence
actually reduces signal churn and whether any reduction survives portfolio
accounting.

## Artifacts

Every successful Portfolio Lab Run publishes:

- `portfolio-report.json`: full policy, performance, attribution, stress,
  constraint, split, and causality evidence;
- `daily-portfolio.csv`: portfolio-level accounting;
- `proposed-target-weights.csv`: exact signal-policy targets;
- `executed-weights.csv`: exact post-band research weights;
- `portfolio-decisions.csv`: the long-form per-asset decision and attribution
  ledger.

The reference Study keeps a 60-second hard Judge timeout for installed-wheel
cold pandas/NumPy startup and the fixed attribution pass. Normal warm Runs are
much faster; this is still a bounded research evaluation, not permission for a
long backtest.

## Invariants

1. Candidate code controls factor values only.
2. Dataset-fixed split boundaries and one-bar purge are candidate-independent.
3. Every asset/date has one explicit signal event and allocation status.
4. Signal hysteresis and portfolio no-trade execution remain separate.
5. Proposed targets obey the mandate's tradable set, permitted sign, cash,
   gross/net, side-budget, and asset-cap rules.
6. Every executed trade and contribution reconciles exactly to portfolio
   accounting.
7. Risk attribution uses only trailing information available at the decision
   close.
8. Validation net Sharpe alone controls promotion.
9. Output is research target-weight evidence with no trading authority.
10. Every available final executed-book forecast is within the exact mandate
    ceiling; risk may override no-trade but may only reduce exposure.
11. A projected current trigger is derived only from the fixed current state,
    construction family, and fixed thresholds; it cannot introduce another
    signal or position permission.
12. Current proposed turnover reconciles the exact governed-target and
    pretrade vectors before the execution gate is shown.
13. Signal-monetization stages are additive diagnostics; they cannot be
    presented as independently compounded portfolios or selection baselines.
14. Normalized intent obeys both the verified prediction mode and fixed
    Mandate. Explicit relative value uses a capped complementary pair with
    Cash; ordinary cross-sectional dollar-neutral construction retains the
    full-side-breadth rule.

## Known limits

- The state machine is one fixed reference policy, not a universal strategy
  DSL.
- Diagonal inverse-vol sizing and trailing covariance attribution do not model
  a production optimizer or covariance-estimation uncertainty.
- Linear costs and OHLCV participation remain coarse implementation proxies.
- This implemented contract still realizes targets through coarse historical
  target-weight accounting. The active
  [[docs/design/order-native-portfolio-decisions]] design will move simulated
  stop-loss/take-profit and bar-order realization into fixed AutoQuant
  research authority. Authenticated submission and live execution remain
  external.
