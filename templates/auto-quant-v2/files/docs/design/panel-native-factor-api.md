# Panel-native factor API

Status: implemented.

Related: [[docs/design/ohlcv-factor-lab]],
[[docs/design/causal-multi-interval-factor-inputs]],
[[docs/design/factor-component-attribution]],
[[docs/design/portfolio-construction-lab]], and
[[docs/design/rl-factor-policy-lab]].

## Purpose

AutoQuant factor research needs one Agent-friendly surface for both
time-series and cross-asset OHLCV hypotheses. The candidate API therefore uses
one ordinary long-form pandas DataFrame over the observed Study universe:

```python
def compute_factor(panel: pandas.DataFrame) -> pandas.Series:
    ...
```

No event-engine object, indicator registry, hidden line graph, or factor DSL is
introduced.

## Input contract

`panel` has one row per asset and decision-bar close, sorted stably by
`timestamp` then Study-universe asset order. It has a unique RangeIndex and
contains:

```text
asset timestamp open high low close volume
```

Every configured higher interval adds the existing completed-bar columns:

```text
bar_close__<interval>
open__<interval> high__<interval> low__<interval>
close__<interval> volume__<interval> age_bars__<interval>
```

All assets receive the same ordered column surface. `asset` is the exact Study
universe identifier. `timestamp` retains verified bar-close semantics.

The runtime contract is `panel-v2`. Aligned V1–V3 inputs remain rectangular.
V4 date-only daily and V5/V6 close-time-aware observed inputs are
`ragged-observed-only`: an
asset/timestamp row exists only when the locked dataset contains that
observation. Missing, closed-market, and pre-listing rows are not synthesized,
filled, or introduced as all-null records. Consequently a same-timestamp
cross section may contain fewer than the full Study universe; candidate code
must operate on the rows actually supplied. For V5/V6 single-asset temporal
evaluation, the prediction asset's observed timestamps alone own targets,
split boundaries, and purge counts. Context-only union timestamps remain
available to the candidate but never advance the target clock.

Candidate code may:

- use `groupby("asset")` for rolling or expanding time-series features;
- use `groupby("timestamp")` for contemporaneous ranks, breadth, dispersion,
  neutralization, and market context;
- join or pivot the supplied rows to express pairs and relative relationships;
- explicitly backward-as-of context rows whose completed timestamp is no
  later than the evaluated row timestamp;
- combine base and completed higher-interval values;
- define arbitrary deterministic helper functions under the editable factor
  closure.

Candidate code may not mutate `panel`, access future timestamps, read Project
data or Judge outputs directly, depend on clocks/randomness/mutable globals, or
change the supplied row population.

## Output contract

`compute_factor` returns one numeric pandas Series:

- exact input length and index;
- finite values or `NaN` warm-up values;
- at least one finite value;
- one scalar research score per input asset/timestamp row.

Names are descriptive only and do not grant authority. The fixed Judge pivots
the result to timestamp × asset form and owns targets, splits, selection,
portfolio construction, costs, and evidence.

Optional candidate-declared components retain the existing pair:

```python
FACTOR_COMPONENTS = {...}

def compute_factor_components(panel: pandas.DataFrame) -> pandas.DataFrame:
    ...
```

The component DataFrame uses the exact panel index. The 1–12 materialized
component bound and metadata/evidence contract remain fixed.

## Surface-aligned baseline

Project construction seeds the editable baseline from the verified interval
surface, not from every interval the reference implementation knows how to
consume. `AVAILABLE_FEATURE_INTERVALS` is empty for daily V1/V4 and
observed-only V5/V6 intake, and equals the package's exact `featureIntervals` for
V2/V3 intake. The baseline always declares base-clock momentum; it declares
3h, 12h, or 1d components only when those bars are present.

The source may retain generic helper definitions for supported feature
components, but `FACTOR_COMPONENTS` and `compute_factor_components` materialize
only the seeded available set. A request-predeclared known-style candidate
still replaces this baseline completely.

## Shared runtime

One Core runtime serves candidate preflight, Factor, Portfolio, and governed
RL. It:

1. validates and combines per-asset dataset frames into the canonical panel;
2. verifies panel identity, ordering, and column parity;
3. executes the candidate twice on identical deep copies;
4. rejects input mutation, exceptions, misalignment, nonnumeric output,
   infinity, empty output, and non-determinism;
5. executes and validates optional components;
6. truncates the observed panel at fixed timestamp cuts;
7. recomputes candidate and components on each prefix;
8. rejects any already-emitted value that changes when future timestamps are
   removed;
9. pivots verified values into a timestamp × asset evidence shape while
   retaining missing combinations as absent evidence.

The audit intentionally permits one asset to use another asset's value at the
same timestamp or an earlier completed timestamp. A missing context row stays
missing unless candidate code performs an explicit backward as-of operation.
It rejects dependence on any later timestamp. As with the old audit, this is a
strong misuse detector rather than a hostile-code sandbox.

## Breaking boundary

The old per-asset `compute_factor(frame)` execution contract is retired.
AutoQuant V2 is pre-alpha, and silently detecting both APIs would make the
meaning of `frame`, prefix causality, and cross-lane identity ambiguous.
Candidate source must migrate explicitly to the panel contract.

Immutable historical Run artifacts remain files in Git/Project history, but
old candidate source is not executed under new semantics.

## Bounds

- universe: at most 256 assets;
- panel rows: inherited from the content-locked Study dataset;
- materialized components: 1–12;
- complete Judge timeout: 60 seconds by default;
- preflight: at most two position-capable assets, every fixed mandate context
  or benchmark asset in the Study universe, and 256 timestamps;
- causality cuts: bounded fixed timestamp prefixes.

## Invariants

1. One candidate source has one meaning in Factor, Portfolio, governed RL, and
   preflight.
2. Cross-asset same-or-prior-timestamp information is visible and causal.
3. Future timestamps are invisible to already-emitted values.
4. Input and output use ordinary pandas objects and exact row alignment.
5. Candidate code owns scores, not targets, weights, evaluation, or trading.
6. Dataset, interval, universe, and candidate bytes remain content-locked in
   Study and Run evidence.
7. Ragged input availability is evidence: no candidate or runtime step may
   silently repair it.

## Known limits

- Input remains OHLCV-only.
- V4 changing-universe semantics are Factor-only; Portfolio and governed RL
  reject that intake contract.
- There is no sector/fundamental metadata or heterogeneous asset feature table.
- The factor output is one scalar, not a multi-target model.
- A formal fit/freeze/predict lifecycle belongs in a future governed ML Study,
  not hidden inside `compute_factor`.
- Prefix comparison cannot prove safety against deliberately hostile code.
