# Executed-book hard compliance

Status: V2 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]],
[[docs/design/portfolio-risk-governor]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/rl-factor-policy-lab]],
[[docs/design/portfolio-decision-explorer]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns the causal hard-compliance decision applied after portfolio
drift and before a book earns its next return. It covers Portfolio Mandate
sign, context-only, gross, side, net, and per-asset constraints; covariance
risk; no-trade overrides; exact daily evidence; and Portfolio/RL parity.

It does not own the request-derived ceiling, covariance estimator, raw target
construction, live orders, Broker/UTA state, account capital, or intraday risk.

## Why target compliance is not enough

The signal policy first produces a capped, covariance-governed target.
Accounting then drifts the prior book through the return ending at close `t`
and may retain that book when the proposed trade is inside the no-trade band.
The retained book is neither the target checked by the constraint audit nor
the target checked by the first risk governor.

The authoritative compliance object must be the final weight vector that earns
`close(t) → close(t+1)`.

## Fixed execution decision

At decision close `t`:

```text
prior executed book
→ drift through return ending at t
→ causally forecast drifted-book volatility from returns through t
→ enforce the complete Mandate on the proposed target
→ causally recheck that target under the same covariance policy
→ ordinary target/no-trade decision
→ repair the chosen book to all Mandate sign/cap/gross/side/net constraints
→ if that compliant chosen book breaches the ceiling:
     scale that chosen book proportionally by ceiling / forecast
→ record the final constraint error and executed-book forecast
→ earn only the next close-to-close return
```

Hard Mandate compliance and covariance-risk compliance both outrank the
no-trade band and the ordinary decision schedule. Constraint repair clips
forbidden signs and per-asset caps, zeros context assets, scales sides down to
their limits, and restores exact dollar neutrality by reducing the larger
side. It never creates additional exposure. Risk repair then scales the whole
compliant book down proportionally and never scales it up.

Every repair is an actual trade against the drifted pretrade book. Its turnover,
cost, participation, return, and decision evidence therefore use the repaired
weights. If covariance history is unavailable or invalid, the fixed risk
policy remains fail-flat.

## Evidence

Every daily Portfolio row records:

- constraint override, repair one-way turnover, and maximum final constraint
  error;
- execution-risk status and forecast observations;
- drifted/pretrade annualized forecast;
- proposed-target annualized forecast after the runtime recheck;
- final executed annualized forecast and declared ceiling;
- ordinary proposed turnover, risk repair scale, override flag, and execution
  reason.

The per-asset decision ledger repeats date-level authority fields beside exact
weights and trades. Governed RL action rows and every same-pretrade
counterfactual action publish the same constraint and risk fields for every
declared fold and seed.

Split summaries expose:

- eligible and unavailable dates;
- drifted-book breach count/rate;
- risk-only override count/rate;
- executed-book breach count/rate;
- mean and maximum executed forecast;
- maximum ceiling error.

Any available executed breach beyond numeric tolerance fails the Judge rather
than becoming a warning.

## Selection and authority

Executed-book compliance is an invariant, not alpha. Its Session descriptors
use context preference and cannot affect KEEP/REVERT or non-dominance. Reports,
Dossiers, and Studio may explain how often risk governance changed the
mechanical path, but zero breaches do not make one candidate better than
another.

All resulting weights remain historical target-weight research evidence.
Nothing in this contract authorizes live orders, authenticated capital
allocation, or external trading-account mutation.

## Invariants

1. Every forecast at close `t` uses no return after `t`.
2. The final executed book satisfies every request-bound Mandate constraint.
3. The final executed book is the object compared with the risk ceiling.
4. Constraint and risk repairs are scale-down-only and outrank no-trade and
   ordinary decision cadence.
5. A risk repair is proportional and no larger than needed.
6. Portfolio and RL call the same Core decision primitive.
7. Constraint or available-risk breaches fail fixed evaluation.
8. Compliance never enters candidate selection or live-trading authority.

## Change checklist

- Prove prefix causality and exact quadratic forecast reconciliation.
- Test safe no-trade, constraint-only, risk-only, joint constraint/risk, and
  unavailable-history paths.
- Reconcile every redundant RunResult, report, daily, decision, and RL action
  field before projection.
- Update CLI, Reports, Dossiers, Studio, schemas, templates, and wheel assets
  together.
- Run repository-required documentation and full test suites.
