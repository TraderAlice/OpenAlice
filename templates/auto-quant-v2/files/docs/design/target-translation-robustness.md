# Target-translation robustness

Status: accepted for `0.9.3`.

Related: [[docs/design/prediction-mode-target-weight-translation]],
[[docs/design/portfolio-parameter-neighborhood]],
[[docs/design/portfolio-decision-explorer]], and
`plans/target-translation-robustness-and-loss-attribution`.

## Purpose

A temporal Factor can be valid while its mechanical target path depends too
strongly on one arbitrary history length. AutoQuant therefore asks a narrow
robustness question before treating one 60-observation translation as a stable
description of portfolio behavior:

> Do the same causal Factor, Mandate, thresholds, sizing, risk, execution, and
> cost rules produce materially similar signal states and target weights when
> the translation history is locally shortened or lengthened?

This surface diagnoses an assumption. It is not a window optimizer.

## Fixed profiles

Temporal and two-asset relative-value Portfolio Runs evaluate exactly:

| Profile | History | Minimum | Role |
| --- | ---: | ---: | --- |
| `short-history` | 40 observed values | 20 | context stress |
| `base` | 60 observed values | 20 | ordinary fixed policy |
| `long-history` | 120 observed values | 20 | context stress |

All percentiles are causal and include only observations known through the
decision timestamp. Single-asset mode uses the target's own Factor history;
relative-value mode uses the same caller-ordered `left - right` spread and
keeps both leg scores complementary. Context-only assets never receive a
score or target.

Cross-sectional mode has no temporal history window. It publishes an explicit
`not-applicable` result and does not create alternate constructions.

## Evidence and diagnosis

The immutable `portfolio-translation-robustness.json` artifact contains, for
every temporal profile and reconciled decision timestamp:

- exact score, causal observation count, signal state, and governed target for
  each prediction asset;
- validation and visible-test net return, benchmark return, one-way turnover,
  cost, and rebalance paths.

RunResult carries split-level score availability, active-state and target-
direction agreement with the base, mean absolute target delta, performance,
turnover, and cost. The current block is the last fully reconciled decision,
not an unreconciled pending forecast.

Validation alone classifies the path:

- `stable-target-path`: every adjacent profile has at least 80% active-state
  agreement and no profile exceeds 5% mean absolute target-weight delta;
- `translation-sensitive-target-path`: either fixed threshold is missed;
- `insufficient-active-targets`: no base-or-adjacent validation state is
  active, so active-path stability cannot be measured.

Net-Sharpe range and sign agreement are descriptive. They do not determine the
stability label and cannot select a profile. Test is visible audit only.

## Strict projection

The Portfolio Explorer verifies artifact identity and deterministic ordering,
reconstructs every profile's causal score and hysteretic state from the Factor
ledger, requires the base profile to match ordinary Portfolio targets and
accounting, checks caps, direction, and exact relative-value opposition, then
recomputes all aggregate claims. Missing, extra, reordered, non-causal, or
rehashed inconsistent evidence is invalid.

The existing signal-monetization bridge remains responsible for downstream
loss attribution:

```text
equal signal intent
→ sizing and caps
→ covariance risk governor
→ execution and no-trade retention
→ cost
```

Translation robustness sits immediately upstream. When it is sensitive, the
research agenda may propose a bounded change to the editable causal Factor
representation. It must not expose fixed Judge mechanics or recommend the
best stress window.

## Authority

The entire surface has `robustness-only` / `context-only` authority. It cannot
change the ordinary 60/20 policy, validation objective, KEEP/REVERT verdict,
promotion, Report recommendation, Order, Broker, account, or trading state.
If a researcher changes candidate source after seeing visible test evidence,
the existing external-holdout rule still applies.
