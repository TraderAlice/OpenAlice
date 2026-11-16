# Caller-owned Factor outcomes

Status: implemented for `forward-return` and
`forward-realized-volatility`.

Related: [[docs/design/ohlcv-factor-lab]],
[[docs/design/caller-owned-factor-population]],
[[docs/design/factor-diagnostics]],
[[docs/design/factor-qualification-funnel]],
[[docs/design/cross-study-factor-dependencies]],
[[docs/design/request-bound-research-horizon]],
[[docs/PROJECT_FORMAT]], and [[docs/CLI]].

## Purpose

A causal factor is a model of a future behavior, not inherently a forecast of
return. AutoQuant therefore lets the caller bind the behavior being predicted
before candidate work begins. Candidate code continues to produce only one
causal score; the fixed Judge owns outcome construction, alignment, missingness,
purge, evaluation, and evidence vocabulary.

The supported request surface is:

```json
{
  "factorPolicy": {
    "claim": "known-style-validation",
    "knownStyle": "realized_volatility_20",
    "outcome": "forward-realized-volatility"
  }
}
```

`outcome` is either `forward-return` or
`forward-realized-volatility`. Historical requests and immutable Factor Claims
that omit it retain their original implicit `forward-return` meaning. New risk
research must state it explicitly. The outcome is content-addressed inside
`strategies/factor-claim.json` and every new Run projects a complete
`metrics.factor_outcome` contract.

A `decision-signal` request additionally supplies unique
`factorPolicy.predictionAssets`. Core freezes that independent caller
authority in `strategies/factor-population.json`; position roles and a
Portfolio Mandate do not select Factor targets. Novel-factor and known-style
claims instead evaluate the complete research universe and reject a narrowed
population. See [[docs/design/caller-owned-factor-population]].

## Fixed outcome definitions

At signal close `t`, candidate features may use only information completed at
or before `t`. The Horizon Mandate supplies positive observed-base-bar horizons
`h` and fixed chronological purge boundaries.

### Forward return

```text
C(t + h) / C(t) - 1
```

This is the existing simple close-to-close return. A larger factor value means
a larger predicted future return. Qualification may admit a separately fixed
Portfolio study, but never grants trading authority by itself.

### Forward realized volatility

Let `r(t + k) = log(C(t + k) / C(t + k - 1))`. The target is:

```text
sqrt(sum(r(t + k)^2 for k = 1..h))
```

It is unannualized and uses exactly the next `h` observed base-bar returns.
Every constituent close and return must be finite; one missing constituent
invalidates the whole window. Core never fills a closure, skips across a
missing close, substitutes a shorter window, or infers a calendar scaling.

A larger factor value means larger predicted future realized risk. The target
is non-negative, but Factor evaluation still requires cross-sectional or
temporal variation. Rank IC, Pearson IC, HAC inference, folds, regimes,
style overlap, component diagnostics, and quantile outcome levels retain their
ordinary meanings against this bound target.

## Prediction populations

Both outcomes support the population modes frozen by the Factor Population:

- one `decision-signal` prediction asset, evaluated as within-split temporal
  association on that asset's observed clock; or
- four or more prediction assets, evaluated as per-timestamp cross-sectional
  association.

Only forward return currently supports the exact two-asset relative-value
contrast. Subtracting two realized-volatility targets would not establish the
caller-owned economic meaning, funding rule, or risk-budget interpretation of
a relative-risk trade. Three-asset baskets remain unsupported without fixed
contrast weights.

## Evidence and read models

New Factor Runs retain:

- the exact Factor Claim, including explicit outcome when supplied;
- a derived `factor_outcome` object with label, target semantics, direction,
  annualization, downstream meaning, and explicit no-trading authority;
- generic outcome-aware IC, quantile, availability, qualification, component,
  and report semantics;
- the same validation-only objective and visible-test discipline.

`factor-quantiles.csv` keeps numeric `low`, `middle`, `high`, and
`high_minus_low` columns because those are factor-score groups. The aggregate
metric is `mean_outcome_by_quantile`; it is not called return when the target
is risk. Factor Explorer independently reconciles the artifact and exposes a
top-level `factorOutcome` used by CLI and Studio labels. Historical Runs retain
their stored `mean_return_by_quantile` and legacy component target text; the
read model derives only their implicit outcome and never mutates evidence.

## Qualification and downstream authority

The request-bound claim (`decision-signal`, `novel-factor`, or
`known-style-validation`) still determines the qualification funnel. Outcome
changes what the positive association predicts, not how validation/test
authority works.

A positive forward-return funnel may proceed to the existing separately gated
Portfolio route. A positive realized-volatility funnel terminates at
`risk-forecast-positive` with the next focus
`risk-model-report-and-external-holdout`. It sets
`qualifiesForPortfolio: false`, opens no RL lane, and gives no target-weight or
trading meaning. The research agenda freezes the factor and requests a fresh
external holdout rather than more in-sample tuning.

If a governed Session was created from that exact positive baseline, technical
worktree writability does not override the scientific stop. Orientation routes
the Agent directly to an exact baseline-bound Report and Session completion;
it must not label the state `CANDIDATE EDIT REQUIRED`. The external-holdout move
remains optional follow-up outside the visible in-sample evidence budget.

Intake admits realized-volatility outcomes only to `ohlcv-factor-lab`, which
does not create a Portfolio Mandate.
Portfolio and RL Judges independently reject a non-return Factor Claim as a
defense against hand-edited dependencies. A future risk-budget consumption
contract must be designed and proven separately; it cannot inherit the current
return-score bridge accidentally.

## Authoritative implementation

- Request/Claim validation and outcome description:
  `autoquant/factor_claims.py`, `autoquant/briefs.py`.
- Template routing and intake compatibility:
  `autoquant/templates.py`, `autoquant/intake.py`.
- Target construction and fixed evaluation:
  `autoquant/project_templates/ohlcv_factor_lab/factor_diagnostics.py` and
  `judge.py`.
- Independent reconciliation and bounded projection:
  `autoquant/factor_explorer.py`.
- Downstream refusal:
  Portfolio and RL template Judges plus research-program gates.
- Human/Agent projection: `autoquant/cli.py`, `autoquant/studio.py`, Studio
  assets, `autoquant/orientation.py`, Report/Dossier decision support, and the
  Factor template program.

## Change checklist

- Bind every new outcome in caller request and fixed Claim before candidate
  iteration.
- Define exact causal alignment, missing-window behavior, units, sign, and
  horizon semantics.
- Prove target construction numerically, including final-window and internal
  missingness.
- Reconcile metrics and artifacts independently in Factor Explorer.
- State whether Portfolio/RL consumption is meaningful; default to no
  authority rather than inventing an economic sign.
- Keep CLI, JSON, Studio, schemas, template routing, Agent instructions, and
  design documents semantically identical.
- Preserve immutable historical evidence without rewriting it to the current
  vocabulary.
