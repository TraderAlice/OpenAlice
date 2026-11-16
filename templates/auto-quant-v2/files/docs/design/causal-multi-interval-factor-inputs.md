# Causal multi-interval factor inputs

Status: V2 compatibility contract implemented. Configurable/session expansion
is specified in [[docs/design/configurable-session-interval-inputs]].

Related: [[docs/design/research-intake-and-dataset-snapshots]],
[[docs/design/ohlcv-factor-lab]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/quant-research-lifecycle]].

## Purpose

Multi-interval input lets a strategy make decisions on one base clock while
using only higher-horizon OHLCV bars that were fully closed at that decision.
It expands factor source material without creating another backtest engine or
another candidate DSL.

```text
content-locked 1h base bars
→ fixed complete-bar aggregation
→ 3h / 4h / 6h / 12h / 1d bars with close timestamps
→ backward-as-of causal alignment onto each 1h decision close
→ ordinary long-form pandas panel over the complete universe
→ Factor → mechanical Portfolio → governed RL
```

## Candidate surface

The editable API remains:

```python
def compute_factor(panel: pandas.DataFrame) -> pandas.Series:
    ...
```

Column availability is Project-specific and is never inferred from this
design's superset. Before editing, Agents read the focused Study's strict
`candidateContract` from `aq orient --json` or `aq study inspect --json`.
Legacy daily teaching Projects explicitly report `baseInterval: 1d`,
`featureIntervals: []`; V2/V3/V5 intake Projects report their exact
content-locked interval surface and resulting panel columns. The same
contract publishes legal component roles and is available through
`aq schema factor-candidate-contract`. Its explicit availability rule makes
the interval surface authoritative over reusable source branches or component
declarations that may be inactive on a particular Project.

The contract also publishes `observationSemantics`: timestamp meaning, panel
shape, missing-observation policy, context visibility, and target clock. V5
may use `baseInterval: 1d`, but remains base-only. Its exact completed close
timestamps let candidate code backward-as-of earlier context across markets;
Core does not supply a common date alignment or implicit fill.

The panel adds `asset` and retains familiar base interval columns:

```text
asset timestamp open high low close volume
```

Each higher interval contributes namespaced columns:

```text
bar_close__3h open__3h high__3h low__3h close__3h volume__3h age_bars__3h
bar_close__4h open__4h high__4h low__4h close__4h volume__4h age_bars__4h
...
bar_close__1d open__1d high__1d low__1d close__1d volume__1d age_bars__1d
```

`bar_close__<interval>` is the exact source close visible to the row.
`age_bars__<interval>` is elapsed base-bar count since that source close. A
candidate can therefore distinguish a newly completed daily bar from the same
daily value carried causally through later hourly decisions.

The fixed builder may carry the last completed high-period bar forward after
its close. It never forward-fills a missing base bar, manufactures an
incomplete high-period bar, or uses a high-period bar whose close exceeds the
decision timestamp.

## V2 time contract

V2 source timestamps mean bar close and are timezone-aware UTC instants.
The first implementation supports:

- market clock: `continuous`;
- timezone/anchor: `UTC`, aligned to midnight;
- base interval: `1h`;
- derived intervals: any declared subset of `3h`, `4h`, `6h`, `12h`, `1d`;
- exact complete groups only: 3, 4, 6, 12, or 24 consecutive base bars.

For one complete group:

- open = first base open;
- high = maximum base high;
- low = minimum base low;
- close = last base close;
- volume = sum of base volume;
- timestamp = last base bar close.

Missing, duplicate, out-of-order, or non-hourly base timestamps invalidate the
dataset. V2 rejects a gapped base panel before aggregation; it never silently
omits the affected group or manufactures continuity.

Session-market intraday support is deliberately later. It needs exchange
calendar identity, local session open/close, early closes, DST behavior, and a
rule for partial terminal buckets. Reusing UTC continuous anchors for US
equities would create plausible but false bars.

## Causal alignment

For decision row close `t`, each interval chooses the latest complete source
bar with `source_close <= t`. This is equivalent to a stable backward
`merge_asof`, grouped by asset.

The Harness verifies:

1. source closes are unique and increasing;
2. every aggregate reconciles to its exact base-bar group;
3. every joined source close is at or before its decision close;
4. removing future base bars cannot change any already emitted aggregate or
   aligned row;
5. Factor output still passes the existing prefix causality audit.

The target remains future return after the base decision close. A completed
bar ending at `t` may inform the decision at `t`; returns earned before or
during that bar never become the target for that decision.

## Dataset identity

V1 daily packages remain strict and unchanged. V2 adds explicit:

- `baseInterval`;
- ordered `featureIntervals`;
- `timestampSemantics: bar-close`;
- `market.clock`, timezone, and anchor;
- aggregation method/version;
- base source inventory;
- normalized per-interval output inventory and hashes;
- per-asset observation and coverage disclosure by interval.

Materialized layout:

```text
data/ohlcv/
├── snapshot.json
├── 1h/<asset>.csv
├── 3h/<asset>.csv
├── 4h/<asset>.csv
├── 6h/<asset>.csv
├── 12h/<asset>.csv
└── 1d/<asset>.csv
```

Study dataset paths continue to lock `ohlcv/**`, so every interval byte,
snapshot claim, and aggregation disclosure enters Run currentness.

## Cross-lane use

Factor Judge owns alignment and measures predictive evidence. Portfolio Judge
uses the same factor rows and translates them through the existing mechanical
entry/hold/exit, sizing, cost, and risk contracts. Governed RL sees causal
multi-horizon state or factor sleeves derived from the same rows; its fixed
baselines receive the same opportunity set.

Intervals are research inputs, not trade instructions. A caller may request
an asset, direction, and horizon; AutoQuant records the interval surface that
was requested, materialized, locked, and supplied to each lane, then returns
that evidence through RunResults, Reports, Studio, and the Project Dossier.
Core does not claim to infer which supplied pandas columns arbitrary candidate
code semantically used. The optional explicit declaration and diagnostic
contract is now defined by [[docs/design/factor-component-attribution]]; it
records candidate claims without pretending to instrument column access. No
interval grants order, account,
promotion, or trading authority.

## Invariants

1. One Project owns one content-locked interval surface.
2. Timestamps mean bar close; forming bars are invisible.
3. Higher bars use complete base groups only.
4. Candidate code receives the complete universe in ordinary long-form pandas,
   not provider or engine objects.
5. Factor, Portfolio, RL, and fixed baselines share the same aligned history.
6. Validation selects; visible test only audits interval hypotheses.
7. V1 daily Projects and immutable evidence remain readable.

## Known limitations

- This V2 schema remains continuous UTC 1h only; V3 adds bounded configurable
  continuous and XNYS regular-session inputs.
- No tick, L2, forming-bar, extended-hours, or halt synthesis.
- Cross-provider high-period bars are not trusted over deterministic
  aggregation from the locked base.
- A larger interval set increases multiple-testing risk; existing
  Project-family selection adjustment still applies.
