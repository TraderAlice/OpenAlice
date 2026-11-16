# Configurable base intervals and session-market inputs

Status: V3 implemented.

Related: [[docs/design/causal-multi-interval-factor-inputs]],
[[docs/design/research-intake-and-dataset-snapshots]],
[[docs/design/study-run-evidence]],
[[docs/design/portfolio-construction-lab]], and
[[docs/design/quant-research-lifecycle]].

## Purpose

Multi-interval factors need two independent pieces of time authority:

1. the decision/base bar duration;
2. the market clock that defines which closes should exist and how higher bars
   complete.

V2 proved the interface for continuous UTC `1h` data. V3 makes those
authorities explicit without turning interval parsing into a strategy-owned
DSL.

## Compatibility

- V1 remains one daily session row per asset.
- V2 remains continuous UTC `1h` with
  `complete-utc-midnight-bar-close-v1`.
- V3 carries configurable base/feature intervals and either continuous UTC or
  XNYS regular-session authority.

Loaders dispatch by snapshot schema version. Existing V2 objects are rebuilt
with their original constants and byte identity.

## Canonical interval algebra

Public identifiers use this bounded order:

```text
1m 5m 15m 30m 1h 3h 4h 6h 12h 1d
```

Continuous bases may be any identifier below `1d`. A feature interval must be
larger than the base and its duration must be an exact multiple.

XNYS V3 initially accepts bases through `1h`. Intraday feature intervals may
be larger supported identifiers up to `6h`; `1d` means one complete exchange
session. `12h` is rejected because it is indistinguishable from a session bar
on the supported regular-session clock.

## Continuous clock

Continuous input is timezone-aware UTC and must contain every exact base close
without a gap. Higher intervals use UTC-midnight-anchored complete buckets.
No incomplete bucket is emitted.

The V3 method is:

```text
complete-continuous-utc-midnight-bar-close-v2
```

## XNYS session clock

The first session implementation accepts:

```json
{
  "clock": "session",
  "calendar": "XNYS",
  "timezone": "America/New_York"
}
```

AutoQuant obtains regular-session opens/closes from a pinned
`exchange-calendars` version. Input must consist of complete sessions. For
each session, expected base closes are:

```text
min(open + n × base_duration, scheduled_close)
```

This handles:

- the UTC shift around US daylight-saving transitions;
- scheduled holidays and weekends;
- 13:00 local early closes;
- a final short base bar when the nominal duration does not divide the
  session.

Extra premarket/after-hours rows, missing expected closes, partial first/last
sessions, and unscheduled timestamps fail intake.

Provider normalization must establish this bar-close authority before Core
intake. For example, Yahoo historical `1h` labels provider bucket starts. Its
acquisition Skill may map an exact expected start to the corresponding
scheduled close, but it must retain that transformation in provider evidence
and may not reinterpret a null terminal bucket or zero-volume session-close
marker as valid OHLCV. Core continues to receive and verify only canonical
completed closes.

Higher intraday buckets use the same open anchor and scheduled-close terminal
rule. The last short bucket is a completed bar, not a forming bar, because the
exchange session has ended. Daily aggregation consumes the entire verified
session and closes at the exact scheduled market close.

The V3 method is:

```text
complete-xnys-regular-session-bar-close-v1
```

## Candidate pandas surface

The API stays unchanged:

```python
def compute_factor(panel: pandas.DataFrame) -> pandas.Series:
    ...
```

The complete universe is supplied in long form with `asset` and `timestamp`.
Base OHLCV keeps unqualified names. Each feature interval contributes:

```text
bar_close__1h open__1h high__1h low__1h close__1h volume__1h age_bars__1h
bar_close__1d open__1d high__1d low__1d close__1d volume__1d age_bars__1d
```

`age_bars__*` counts decision/base rows since the source bar close rather than
wall-clock duration. It therefore remains meaningful over overnight,
weekend, DST, and early-close boundaries.

## Identity and verification

The V3 interval surface records:

- base and ordered feature intervals;
- timestamp semantics;
- market clock, calendar, and timezone;
- aggregation method and anchor;
- terminal bucket policy.

The package manifest, source hashes, materialized per-interval files, snapshot,
Study dataset hash, RunResult, Reports, Dossier, and holdout compatibility all
retain that authority.

The calendar library does not own evidence. Its pinned version enters
`uv.lock` and Harness identity; the resulting expected closes and aggregated
OHLCV are independently verified by AutoQuant whenever intake or a Run is
loaded.

## Annualization

Intraday Portfolio and RL metrics annualize from the verified decision clock:

- continuous bars use `365 days / base duration`;
- XNYS bars use `252 × expected bars per regular session`, including the
  explicit terminal partial base bar.

Daily V1 behavior remains 252.

## Known limits

- XNYS regular sessions only; no extended hours or halts.
- No futures/FX calendars or sessions crossing UTC dates.
- Schedule rules are only as authoritative as the pinned calendar version and
  caller/provider claims.
- This feature changes research input cadence, not live Broker execution
  authority.
