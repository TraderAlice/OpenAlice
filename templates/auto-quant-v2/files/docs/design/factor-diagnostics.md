# Professional factor diagnostics

Status: V1 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]],
[[docs/design/ohlcv-factor-lab]],
[[docs/design/caller-owned-factor-outcomes]],
[[docs/design/factor-component-attribution]],
[[docs/design/factor-evidence-explorer]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/rl-factor-policy-lab]],
[[docs/design/research-selection-integrity]], and
[[docs/design/quant-research-lifecycle]].

## Scope

This document owns the fixed research diagnostics between a candidate's causal
factor Series and later portfolio/RL work. Candidate code remains one plain
observed-universe panel pandas function. The Judge owns every target, horizon,
split, bin, regime, style proxy, statistic, artifact, and acceptance rule.

The protocol is a research tear sheet, not a trading simulator. It describes
predictive evidence before sizing and execution assumptions are applied.
When the candidate explicitly declares components, the separate governed
contract in [[docs/design/factor-component-attribution]] adds component
diagnostics without changing this document's final-factor objective.

## Timing and purged splits

At close `t`, a candidate may use OHLCV through `t`. Horizon `h` evaluates the
outcome bound by the Factor Claim. Forward return is:

```text
factor(asset, t)
against
close(asset, t + h) / close(asset, t) - 1
```

Forward realized volatility is the unannualized square root of summed squared
close-to-close log returns across the next `h` observed base bars. Its complete
formula, missing-window rule, prediction populations, and downstream boundary
are fixed by [[docs/design/caller-owned-factor-outcomes]].

The dataset timestamp index fixes chronological 60/20/20 boundaries before the
candidate runs. Candidate warm-up or missingness cannot move those boundaries.
For every split and horizon, the Judge drops the final `h` signal rows of the
split so the target bar remains inside that split. This is an explicit purge,
not a random split or an inferred embargo.

The promotion objective remains validation mean rank IC at the Horizon
Mandate's primary bar. Non-primary horizons and all test metrics are
diagnostics only.

## Fixed evidence

### Observed input availability

The Judge treats input availability as evidence rather than preprocessing
noise. For every union timestamp it records observed input assets, finite
factor assets, and target-paired assets at every requested horizon. Aggregate
evidence includes observed/possible rows, complete and eligible timestamps,
input/factor/pair breadth summaries, and each asset's observed range and
coverage. V4–V6 missing, closed-market, and pre-listing combinations stay
absent; no fill or global intersection occurs. V5/V6 single-asset temporal
availability retains the complete asynchronous source-panel union. Its daily
IC, target, split, and purge evidence separately follows only the prediction
asset's observed timeline, so context-only timestamps cannot shorten an
observed-bar forward return or move a purge boundary.

### Horizon quality and inference

For four or more prediction assets, every Horizon Mandate diagnostic bar and
split reports daily cross-sectional Spearman rank IC and Pearson IC. For one
request-bound decision asset, the same artifact columns contain within-split
temporal correlation contributions. For exactly two symmetric dollar-neutral
decision assets, they contain contributions from the temporal correlation
between `factor(left) - factor(right)` and
`forwardReturn(left) - forwardReturn(right)`. Their mean exactly reconciles
the split Spearman/Pearson correlation:

- mean, population dispersion, ICIR, hit rate, and observations;
- Newey-West/HAC t-statistic with fixed lag `min(5, n - 1)` for
  cross-sectional evaluation, or `min(forwardBars, n - 1)` for temporal
  evaluation;
- a two-sided normal-approximation p-value, labeled as an approximation.

Overlapping multi-bar returns make naive independent-sample t-statistics
misleading. HAC does not remove all financial-model risk, but it makes the
autocorrelation treatment explicit and deterministic.

Before converting the fixed temporal primary validation objective to a finite
Run metric, Core inspects the exact purge-aware pair population. An unavailable
objective fails with one of three stable diagnostics:

- `factor.temporal-primary-observations` when fewer than 20 finite
  factor/target pairs remain;
- `factor.temporal-primary-candidate-variation` when those pairs contain fewer
  than two candidate values;
- `factor.temporal-primary-target-variation` when they contain fewer than two
  fixed-outcome values.

Each message discloses evaluation mode, split, primary horizon, pair count,
distinct candidate/target counts, and the required minimum. This is a failed
research Run with `failureDisposition: scientific-limit`, not a successful
null score. It may be reported as the exact fixed question's bounded answer,
but it never becomes qualifying Factor evidence. Missing candidate input stays
missing and an observed neutral score stays zero; Core does not coerce either
state to make the objective evaluable.

The ordered pair makes signal direction inspectable: a positive contrast
means long the first asset and short the second under the equal-funded model
contract. Reversing both contrast definitions leaves the correlation
unchanged. Context-only assets remain available to candidate features but
never enter the target contrast.

### Quantile behavior

Each cross-sectional date sorts valid assets by factor and partitions them into fixed
low/middle/high groups. Each split/horizon reports:

- mean outcome for each group;
- high-minus-low mean outcome spread;
- rank correlation between group order and group mean outcome as monotonicity;
- valid observation count.

With the small reference universe, tertiles are honest; pretending to have
stable deciles or quintiles would create mostly singleton bins.
Single-asset temporal V1 emits an empty, reconciled quantile artifact and
declares quantiles unavailable; it does not manufacture one-asset groups.

### Stability

The primary-horizon IC is sliced without changing the objective:

- two fixed chronological folds inside each train/validation/test split;
- causal `up/down × calm/stressed` market regimes;
- per-asset time-series rank correlation between factor and the fixed outcome.

Regime direction uses trailing equal-weight market return through `t`.
Regime volatility uses trailing market volatility through `t` compared with a
lagged rolling median threshold. No future sample statistic labels a past row.
Sparse cells remain present with observation counts and null statistics.
Every slice also carries its fixed minimum-observation threshold and an
explicit `sufficient` flag.

### Fixed style overlap

The Judge compares factor ranks with four causal OHLCV style proxies:

- 20-bar momentum;
- 5-bar reversal;
- 20-bar realized volatility;
- 20-bar relative volume.

Mean rank correlation by split describes overlap. It is cross-sectional for
four or more prediction assets and temporal for one decision asset. It does
not prove economic equivalence, neutralize the candidate, or reject a signal
automatically.

## Artifacts

Every successful reference Run publishes:

- `factor-report.json`: semantics, split protocol, aggregate diagnostics,
  causality cuts, and coverage;
- `daily-factor-evidence.csv`: timestamp, fixed split, causal regime, and
  purge-aware request-bound daily rank/Pearson IC;
- `factor-quantiles.csv`: timestamp, split, horizon, low/middle/high outcome,
  and high-minus-low outcome spread.
- `factor-availability.csv`: source-panel-union timestamp-level observed
  input, finite-factor, and per-horizon target-pair breadth reconciled to
  aggregate availability. Its timeline is intentionally independent from the
  prediction-clock `daily-factor-evidence.csv` timeline.
- `factor-qualification.csv`: timestamp, split, request-fixed or train-selected
  comparison style,
  and candidate/style/style-neutral/equal-blend daily rank IC for fixed
  request-bound horizons.
- optional `factor-components.json`: bounded candidate-declared component
  roles; evaluation-mode-correct score quality, association, redundancy,
  residual, and fixed-blend evidence; and timestamp-context occupancy,
  transitions, and matching conditional contribution evidence.

The Run metric object contains the complete machine-readable summary. The
bounded Core projection in [[docs/design/factor-evidence-explorer]] verifies
and reconciles the fixed artifacts before CLI and Studio expose their path,
stability, and optional component evidence. Research Reports retain the full
verified Run as authority.

The reference Study keeps a 60-second hard Judge timeout. Normal warm source
runs are much faster; the allowance covers cold pandas/NumPy import and
bytecode startup from an installed wheel without turning routine research into
an unbounded backtest.

## Invariants

1. Candidate code controls only factor values.
2. Split dates are dataset-fixed and candidate-independent.
3. A target bar never crosses its split boundary.
4. Validation primary-horizon mean rank IC is the only promotion objective.
5. Test, horizon, slice, style, and significance metrics never become hidden
   acceptance rules.
6. Regime labels are causal at the signal close.
7. Sparse slices are disclosed, not silently omitted or pooled.
8. Daily artifacts reconcile to aggregate metrics.
9. Synthetic evidence is a Harness regression, not a market claim.
10. Optional component diagnostics never enter the final-factor promotion
    score or dynamically alter Portfolio/RL authority.
11. An unavailable primary temporal objective fails with a domain diagnostic
    before numeric conversion; it never falls through to a Python `TypeError`.

## Known limits

- HAC p-values are asymptotic normal approximations, not exact finite-sample
  inference or multiple-testing corrections.
- OHLCV style proxies are intentionally small and do not represent a complete
  commercial risk model.
- Temporal rank-correlation contribution answers a different question from
  cross-sectional IC. The Judge selects the request-bound evaluation mode;
  neither component diagnostic enters the promotion score.
- A sparse binary event indicator remains an association score. It does not
  establish a frozen event population, conditional return distribution,
  overlap policy, or matched reference; those belong to
  [[docs/design/ohlcv-price-event-study]].
- Causal regime labels are descriptive conditioning variables, not a guarantee
  that the same states recur in live markets.
- Portfolio capacity, constraints, costs, and execution remain owned by the
  Portfolio Lab.
