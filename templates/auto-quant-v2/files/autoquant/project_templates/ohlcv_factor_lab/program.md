# Mine a causal OHLCV factor

## Research question

Can one causal transformation of ordinary OHLCV history produce stable
information about the caller-bound future outcome across the fixed
prediction-eligible universe and both held-out chronological periods?

## Editable API

Edit only `factors/candidate.py` and preserve:

```python
def compute_factor(panel: pandas.DataFrame) -> pandas.Series:
    ...
```

`panel` is the observed Study universe in long form, with one row per available
`asset`/`timestamp` and base plus available completed higher-interval OHLCV.
The complete research universe remains available for causal cross-asset
features. The fixed Judge, not candidate code, selects target observations:
`decision-signal` evaluates caller-owned `factorPolicy.predictionAssets`, while
`novel-factor` and `known-style-validation` evaluate the complete research
universe. Core freezes that evaluation-only authority in
`strategies/factor-population.json`; this Factor Lab has no Portfolio Mandate.
Inspect `predictionUniverse.evaluationMode` in Factor diagnostics.
A decision signal with exactly one eligible asset uses within-split temporal
Spearman/Pearson evidence for that asset. Exactly two eligible assets use
within-split temporal evidence between the first-minus-second factor contrast
and matching forward-return contrast. A later Portfolio lane must separately
prove a symmetric two-sided dollar-neutral Mandate before monetization. Four
or more eligible assets use the cross-sectional contract. Three require
explicit caller-owned relative-basket contrast weights. No mode may borrow
context-only target observations.
The fixed Factor Claim also binds `outcome`. `forward-return` uses the simple
close-to-close return from signal close `t` to `t+h`. `forward-realized-
volatility` uses the unannualized square root of summed squared close-to-close
log returns over the next `h` observed base bars. The latter supports one
temporal prediction asset or at least four cross-sectional assets, and a
higher score means higher predicted risk—not positive expected return. It has
no Portfolio or RL admission path. Do not invert, monetize, or relabel it.
Aligned inputs are rectangular; V4 daily and V5 observed-bar input is ragged and
does not invent, fill, or globally intersect missing/pre-listing/closed-market
rows. V5 temporal targets, split boundaries, and purge counts follow the one
prediction asset's observed bars, not context-only union timestamps.
For asynchronous V5 context, explicitly use a backward as-of operation and
accept only source rows whose completed timestamp is at or before the target
row. Core never fills an absent context observation or aligns civil dates.
Use ordinary `groupby("asset")` for rolling time-series features and
`groupby("timestamp")` for contemporaneous cross-sectional context. The
returned Series must align exactly with the input index. Missing warm-up values
are allowed. Future timestamps, centered windows, negative shifts, global
full-sample normalization, external data, and mutation of the input are not.

Missing input is not the same state as an observed false condition or a neutral
score. When the candidate branches on a required regime, filter, denominator,
or other component, preserve `NaN` until that input exists unless the Research
Request explicitly predeclares a different missing-data policy. In particular,
`Series.where(condition, other=0)` treats an unavailable/`NaN` predicate as
false; mask the unavailable predicate separately before returning the factor.
Reconcile final-factor coverage against every required component before
execution and explain any intentional excess coverage in `research.md`.

A sparse binary event indicator is still evaluated as a temporal association
score; it does not create an event population or estimate a conditional event
return. If the caller instead froze an OHLCV-observable price event, delayed
entry/exit clock, overlap policy, unconditional history, and matched reference,
use `ohlcv-event-study-lab`. Do not disguise that descriptive question as a
Factor merely to obtain a Run. When the fixed primary temporal population has
too few finite pairs or no candidate/target variation, preserve the structured
failed Run as the truthful `scientific-limit`, report that exact bounded
answer, and change the hypothesis or route only as separately declared
work—not the missing values or Judge. Do not repeat the unchanged Run.

When a hypothesis has meaningful sub-signals, also export
`FACTOR_COMPONENTS` and
`compute_factor_components(panel) -> pandas.DataFrame`. Declare one causal
column per falsifiable source component, including its label, role, claimed
`base`/3h/4h/6h/12h/1d intervals, and hypothesis. Use
`cross-sectional-score` for values meant to rank assets and
`timestamp-context` for one market/regime value shared by every asset at a
timestamp. Context components must be exactly cross-sectionally constant;
Core evaluates their train-tertile occupancy and transitions. Cross-sectional
Runs measure score components with per-date rank IC and context with
conditional final-factor IC. Single-asset and two-asset relative-value Runs
measure score components and context with within-split temporal rank-
correlation contributions. The component table must remain aligned,
deterministic, numeric, immutable, and prefix causal. Do not declare
presentation-only duplicates or imply that Core inferred column use. Temporal
quantile attribution remains unavailable; do not treat that explicit protocol
boundary as positive evidence.

## Iteration protocol

Before this protocol begins on a new caller assignment, replace the generic
scaffold candidate with the first predeclared caller-relevant candidate
without executing the scaffold. Start the governed Session only after that
source is fixed; its baseline Run is the first visible audit. Never rewrite
Core's `testGuidanceObservability=not-observable` as a factual claim that test
evidence was unused.

1. Run `aq orient . --json` and read the current immutable leader's
   `researchAgenda`. Treat its ordered moves as validation-only scientific
   priorities, not executable actions or permission to inspect test for
   selection.
2. Read `strategies/factor-claim.json`,
   `strategies/factor-population.json`, the current candidate, and immutable
   leader evidence. The request-bound `decision-signal`, `novel-factor`, or
   `known-style-validation` claim, outcome, and prediction population are
   fixed evidence authority, not editable strategy metadata.
3. State one falsifiable hypothesis about price or volume behavior.
4. Make one coherent code change inside the editable closure.
5. Run the bounded Experiment command supplied by the Session.
6. Inspect validation/test primary-horizon IC, HAC strength, diagnostic
   horizon decay, tertile monotonicity/spread, train-selected dominant style,
   style-neutral residual
   primary-horizon association, equal-blend uplift, declared-component
   raw/residual association, pairwise
   redundancy, fixed diagnostic-blend leave-one-out delta, residual fold
   stability, asset/regime stability, observed input/factor/target-pair
   availability, coverage, turnover, errors, verdict, Project-family trial
   count, and family-wise adjusted HAC significance.
7. KEEP only when the fixed objective improves; otherwise accept restoration
   and form a different hypothesis.

The fixed objective is validation mean IC only. Test IC is visible diagnostic
evidence and never enters KEEP/REVERT. Changing a candidate after inspecting
test evidence consumes its holdout value; obtain a new external period or
dataset before a production-grade claim.

Starting a new Session does not create a fresh statistical search. Core counts
unique editable source hashes across every Run with the same fixed Study,
Judge, data, dependencies, and objective. Treat the Bonferroni-HAC result as a
selection-risk diagnostic, not permission to hide failed attempts or override
the immutable verdict.

Session construction reuses an exact successful current baseline Run. It
executes a new baseline only when Study, program, candidate, Judge, dataset,
dependency, or Harness identity differs.

The Judge fixes dataset-derived split dates and purges each declared diagnostic
horizon before a boundary. Treat sparse regimes, one weak fold, one dominant
asset, fast decay, or near-perfect overlap with a familiar OHLCV style as
findings to explain—not fields to hide or alternate scores to optimize
opportunistically.

For a `decision-signal` claim, validation requires statistically supported
positive raw IC and positive raw IC in both fixed chronological folds. The
train-selected style, residual, and blend remain disclosure without creating
a novelty hurdle. For a `novel-factor` claim, the dominant comparison style is chosen on train
overlap only. Validation asks whether raw and style-neutral IC are positive
with fixed HAC t at least 1.96, whether an equal rank blend improves the
selected style, and whether both residual folds remain positive. For a
`known-style-validation` claim, the request fixes the comparison style before
research; validation instead requires at least 0.95 train rank identity,
positive statistically supported raw IC, and positive raw IC in both fixed
chronological folds. This prioritizes the next research lane; it does not
change KEEP/REVERT, replace Project-family selection adjustment, or
automatically admit the source into Portfolio or RL.

When the fixed outcome is `forward-realized-volatility`, a positive funnel is
terminal risk-model evidence for this in-sample Study. Freeze, report, and seek
a fresh external holdout; never treat the result as an expected-return signal
or open Portfolio/RL work merely because the association is positive.

Component leave-one-out applies only to the Judge's fixed equal-rank
diagnostic blend. It is not an ablation of arbitrary `compute_factor` code.
Component validation evidence may prioritize the next hypothesis, but it never
changes `validation_mean_ic`, KEEP/REVERT, Portfolio mechanics, or the
governed RL action set. Test component evidence remains visible audit only.

Do not modify the Study, Judge, program, dataset, or AutoQuant Core to improve a
candidate. Do not treat this synthetic benchmark as a real-market alpha claim.
