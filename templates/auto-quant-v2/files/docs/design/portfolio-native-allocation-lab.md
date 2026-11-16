# Portfolio-native Allocation Lab

Status: implemented.

Related: [[docs/design/portfolio-construction-lab]],
[[docs/design/caller-owned-portfolio-research-policy]],
[[docs/design/caller-owned-decision-cadence]],
[[docs/design/portfolio-risk-governor]], and
[[docs/design/study-run-evidence]].

## Purpose

`ohlcv-allocation-lab` answers a portfolio-construction question that does not
contain a return forecast. It must not invent a Factor merely because the
existing Portfolio Lab starts from factor scores.

V1 supports exactly one caller-fixed method:

- long-only equal risk contribution (`equal-risk-contribution`);
- trailing completed-return covariance;
- one caller-fixed covariance window and minimum history;
- one caller-fixed contribution tolerance;
- caller-owned gross and per-asset caps;
- a scale-down-only annualized volatility ceiling;
- one complete funded non-negative `fixed-weights` reference portfolio.

This is a deliberately narrow construction contract, not an optimizer registry.
Expected-return models, efficient frontiers, Black-Litterman, HRP, shorts,
leverage targeting, tax lots, Orders, and account truth remain outside it.

## Request boundary

An Allocation request requires:

1. `direction: long`;
2. every requested asset explicitly classified `long-only` or `context-only`;
3. `portfolioPolicy`, including the decision schedule, costs, no-trade band,
   reference NAV, caps, and volatility ceiling;
4. `allocationPolicy` with exactly:
   `kind`, `covarianceWindow`, `minimumObservations`,
   `contributionTolerance`, and `scaleUp: false`;
5. `benchmarkPolicy.kind: fixed-weights` with positive weights that sum to one
   and name only requested long-only and/or context-only assets.

Public intake rejects partial roles, unfunded or unknown benchmark legs,
unsupported allocation fields, non-long authority, and attempts to combine the
route with Factor, event, position-snapshot, or position-sizing authority.
Reference membership never changes candidate authority: a context-only
benchmark leg stays out of ERC covariance targets, candidate caps, candidate
weights, and candidate risk contributions.

Intake materializes `strategies/allocation-policy.json`. The dependency freezes
the normalized request hash, method, complete universe, tradable/context
partition, Portfolio policy, reference, annualization, validation-only selection
rule, and `tradingAuthority: none`.

## Causal construction

At each caller-scheduled decision close `t`:

1. use returns through and including `t`, never later rows;
2. take at most the fixed trailing covariance window;
3. remain in cash until the fixed minimum complete history exists;
4. solve the positive equal-risk-budgeting objective with deterministic
   cyclical coordinate descent;
5. normalize to unit gross and project onto caller-owned upper caps;
6. recompute component-variance shares after projection;
7. label the decision `within-tolerance` only when the maximum absolute
   contribution-share error is within the fixed tolerance; otherwise label it
   `cap-induced-parity-gap`;
8. apply the existing Portfolio Core final-book constraints and scale-down-only
   volatility governor.

A cap can make exact parity infeasible. The Workbench preserves the funded
capped book and its measured parity error; it never calls that result exact
risk parity.

## Complete reference path

The fixed-weight reference is not a daily dot product and not a named security.
It is simulated as an independent portfolio:

- target weights are offered on the same decision schedule;
- weights drift between decisions;
- the same no-trade band and linear traded-notional cost apply;
- reference legs may drift beyond their target weights between rebalances;
- reference legs marked context-only remain reference-only while their
  independent reference weights and returns are still fully simulated;
- candidate caps and the candidate volatility ceiling do not govern the
  reference;
- both paths earn only the close after the decision close.

This prevents the candidate from being compared with a costless, continuously
rebalanced approximation of the caller's reference.

## Evidence and selection

The fixed Study has no editable source and no Session lifecycle. One successful
Run publishes:

- `allocation-report.json`;
- `allocation-daily.csv`;
- `allocation-target-weights.csv`;
- `allocation-executed-weights.csv`;
- `allocation-reference-weights.csv`;
- `allocation-decisions.csv`.

The immutable report contains chronological 60/20/20 splits. The conclusion is
selected only from validation candidate-minus-reference net Sharpe. Test is
visible audit only and cannot reverse the conclusion. That conclusion is
explicitly `relative-performance-only`: it does not claim that the constructed
book achieved the requested ERC contribution tolerance.

Construction fidelity is a separate immutable contract. For train,
validation, and test, `constructionFidelity` publishes:

- scheduled and history-eligible decision counts;
- within-tolerance and cap-induced-parity-gap counts;
- the eligible within-tolerance rate and maximum contribution error;
- the latest eligible decision's date, solver status, error, and binding caps.

Split membership follows the fixed daily-path intervals. Scheduled
insufficient-history decisions stay in the population but not its eligible
denominator. Validation remains the caller-facing selection split; test
fidelity is visible audit only.

`aq run allocation` verifies the Run inventory and frozen dependency, then
independently rederives split performance, costs, turnover, volatility
breaches, role/cap/gross compliance, solver counts, latest target/executed/
reference weights, component-risk shares, every split-fidelity field, parity
error, the end-of-dataset drifted book, whether an ordinary rebalance is due,
and validation-only conclusion authority. New reports carry the complete
block and are rejected if it differs from the decision ledger. Valid older
reports remain readable: Explorer derives the block without rewriting their
immutable artifacts. For request-driven Projects it also binds the Run's
snapshot hash before returning the complete per-symbol economic-class map.
Studio, orientation, and CLI consume the same strict read model.

After the current fixed Run succeeds, orientation has no primary CLI action
and explicitly hands off to an Agent-owned written answer. The Allocation
Explorer remains one supporting read-only action for evidence inspection; it
does not imply another construction or evaluation is required.

Latest weights are mechanical historical research targets. They are not
authenticated holdings, Orders, TPSL instructions, future-volatility
guarantees, or trading authority.
