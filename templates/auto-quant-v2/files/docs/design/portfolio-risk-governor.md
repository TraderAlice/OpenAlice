# Causal portfolio risk governor

Status: V1 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/signal-policy-and-attribution]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/executed-book-risk-compliance]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns the first portfolio-level pre-trade risk control shared by
request-bound Portfolio and governed-RL research. It converts a signal-policy
target into a lower-or-equal-risk target using only covariance information
available through the decision close.

It does not choose expected returns, optimize a frontier, infer authenticated
account risk tolerance, add leverage, place live orders, or model Broker/UTA
margin.

## Fixed risk policy

Every newly generated Portfolio Mandate binds:

```json
{
  "method": "trailing-covariance-volatility-ceiling-v1",
  "annualizedVolatilityCeiling": 0.15,
  "covarianceWindow": 60,
  "minimumObservations": 20,
  "annualizationPeriods": 252,
  "scaleUp": false
}
```

The complete object enters the content-derived Mandate id, Study dependency
hash, Run input, Session lock, Portfolio Report, governed-RL evidence, and
Project Dossier. Candidate factor/model source cannot edit it.

Historical mandate-free Projects retain `legacy-none` behavior and are not
silently assigned the new policy.

## Causal sizing

At decision close `t`, the fixed signal policy first creates an ordinary
request-permitted target `w_raw(t)` from state, conviction, inverse asset
volatility, side budgets, and caps.

The governor then:

1. takes at most the latest 60 aligned close-to-close return rows ending at
   `t`;
2. requires 20 complete observations;
3. estimates the sample covariance matrix `Σ(t)` with population normalization;
4. computes annualized forecast volatility
   `σ_raw(t) = sqrt(252 × max(w_raw' Σ(t) w_raw, 0))`;
5. applies
   `scale(t) = min(1, 0.15 / σ_raw(t))`;
6. publishes `w(t) = scale(t) × w_raw(t)`.

Flat targets remain flat. A missing valid estimate cannot create exposure.
The implementation records the explicit status instead of substituting a
future/full-sample statistic. The governor never scales up.

Uniform scaling preserves signs, dollar-neutral net zero, context-only zero
weights, relative conviction, and per-asset caps. Directional unused capacity
becomes research cash budget. Dollar-neutral sides may both fall below their
pre-governor side budgets by the identical scale.

## Evidence

Every asset/date decision row records:

- pre-governor target weight;
- governed proposed target weight;
- pre/post annualized covariance forecast;
- fixed ceiling and applied scale;
- governor status and estimation observations.

Every split reports activation rate, average active scale, maximum pre/post
forecast volatility, and unavailable-estimate counts. Portfolio robustness
compares the governed policy with the same fixed signal policy without the
ceiling on validation and visible-test data. That ablation is diagnostic only;
the governed validation net Sharpe remains the sole primary objective.

CLI and Studio consume a verified Core projection. The browser may format the
policy or plot its chronology but cannot recompute covariance or choose a
scale.

This target governor is followed by the separate fixed execution decision in
[[docs/design/executed-book-risk-compliance]]. That step rechecks the actual
post-drift/no-trade book under this identical policy; target compliance alone
is not treated as final-book compliance.

## Governed RL

Every fixed expert and mixture action is converted to a complete signal sleeve
through the same `construct_signal_policy(..., mandate=mandate)` path before
training or rollout. Therefore RL may choose among already-governed sleeves;
the editable state encoder cannot change or bypass the risk policy.

RL evidence freezes the same Mandate id and full policy. An incompatible
Portfolio/RL policy is a dependency failure, not a comparable result.

## Invariants

1. Forecast rows never use a return after decision close `t`.
2. Scale is finite, lies in `[0, 1]`, and never adds leverage.
3. Governed targets preserve every Mandate sign, asset, gross, net, and cap
   constraint.
4. Portfolio and governed RL bind exactly one identical risk policy.
5. Pre/post weights and forecast volatility reconcile deterministically.
6. The ungoverned comparison is diagnostic and never enters selection.
7. Legacy evidence is not reinterpreted.
8. All weights remain historical quantitative decision support with no trading
   authority.
9. The final executed book is independently checked after drift and no-trade
   selection.

## Research basis and limits

Volatility-managed exposure is a documented portfolio technique; the first V1
uses it only as a one-sided safety ceiling, not as a claim of market-timing
alpha. See Moreira and Muir,
[Volatility Managed Portfolios](https://www.nber.org/papers/w22208).

Sample covariance is noisy, particularly with short histories and many
assets. V1 deliberately avoids a covariance optimizer, risk-parity solver, or
scale-up. Shrinkage, stress covariance, multiple horizons, and caller-approved
risk budgets require separate evidence and plans.
