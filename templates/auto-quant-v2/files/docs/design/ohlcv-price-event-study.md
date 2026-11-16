# OHLCV price-event Study

## Purpose

The OHLCV Price Event Study answers a narrow class of caller-fixed historical
questions that continuous Factor correlation does not preserve:

> When one observable price event occurs, wait a fixed number of closed bars,
> observe a fixed holding return, and compare those event observations with
> explicit references.

The first contract supports one downside opening-gap event on one asset,
close-to-close delayed outcomes, one same-asset unconditional reference, and
one matched-date asset reference. It is intentionally not a general event DSL,
an earnings/news taxonomy, a strategy optimizer, a Backtest Broker, or an
Order surface.

## Boundary

The caller or delegating Agent owns:

- event asset;
- opening-gap threshold and direction;
- number of complete bars waited before the entry close;
- holding bars from entry close to exit close; and
- matched reference asset.

The researcher owns, but freezes before the Run:

- minimum useful event count; and
- primary overlap policy.

AutoQuant owns:

- exact causal event and forward-return alignment;
- raw, complete-outcome, right-censored, and primary event populations;
- same-asset unconditional and matched-date reference construction;
- deterministic descriptive statistics and uncertainty;
- immutable artifacts and strict result re-derivation; and
- an explicit evidence-status conclusion.

No result grants account, Broker, order, execution, or live-trading authority.

## Request and authority

`autoquant-research-request` may contain one `eventPolicy`:

```json
{
  "kind": "opening-gap-delayed-close-return",
  "asset": "NVDA",
  "comparator": "less-than-or-equal",
  "thresholdReturn": -0.05,
  "waitBars": 2,
  "holdingBars": 5,
  "referenceAsset": "SPY",
  "overlapPolicy": "keep-first-until-exit",
  "minimumEvents": 8
}
```

Only `ohlcv-event-study-lab` consumes this field. Intake validates that both
assets are requested and present in the content-locked dataset, then derives
`strategies/event-study.json`. That manifest records the normalized event,
timing, references, overlap/inference method, request hash, no-trading
authority, and content-derived id. It is a fixed Study dependency.

Because this route is descriptive and grants no position authority, a
`research-only` Event request may explicitly mark every requested asset
`context-only`. It must not invent a long-capable event leg merely to satisfy
a Portfolio role contract. The fixed Judge consumes OHLC only; aligned daily
inputs therefore keep finite zero-volume observations rather than deleting a
valid session from both assets. Prices remain finite and strictly positive,
volume must remain finite and non-negative, and execution-sensitive templates
retain their stricter volume policy.

For event session `t`:

```text
gap[t]   = open[t] / adjusted_close[t-1] - 1
entry    = close[t + waitBars]
exit     = close[t + waitBars + holdingBars]
outcome  = exit / entry - 1
```

`waitBars=2` therefore means waiting through event session `t` and session
`t+1`, then observing entry at `t+2` close.

## Event populations

The immutable event ledger preserves every qualifying event:

- `complete` when event, entry, and exit observations exist for both event and
  reference assets;
- `right-censored` when the fixed forward clock extends past the dataset; and
- `primary` when complete and accepted by the frozen overlap policy.

`keep-first-until-exit` walks complete events chronologically. The earliest
event is primary; a later event is excluded when its entry precedes the
previous primary exit. Entry exactly at the previous exit is allowed because
the close-to-close return intervals touch but do not overlap.

Raw complete-event and primary non-overlapping results are both reported. The
policy never deletes ledger rows or pretends clustered observations are
independent.

## References and statistics

The Judge returns:

- raw-complete and primary event return distributions;
- the unconditional same-asset holding-return distribution across every
  aligned dataset entry date;
- matched-date reference returns for every event;
- event-minus-reference excess returns;
- primary conditional mean minus unconditional same-asset mean;
- count, mean, median, sample standard deviation, quartiles, minimum, maximum,
  and positive-return rate; and
- deterministic normal-approximation mean standard error and 95% interval for
  the primary asset and excess returns when at least two observations exist.

The normal interval is a descriptive approximation, not a causal claim. The
result is `insufficient-events` below the frozen minimum. Otherwise it reports
`observed-advantage` only when both the primary asset mean exceeds the
unconditional same-asset mean and the primary matched excess mean is positive;
all other sufficient samples report `no-observed-advantage`.

This conclusion is deliberately weaker than “the event caused returns” or
“trade the next event.”

## Immutable evidence

One completed Run declares exactly:

- `event-study-report.json`;
- `event-study-events.csv`; and
- `event-study-reference-distribution.csv`.

The strict Event Explorer verifies Run identity and harness metadata, validates
the frozen authority, checks the artifact inventory and schemas, re-derives
event timing, returns, overlap eligibility, distributions, uncertainty, and
conclusion, and rejects tampering before CLI or Studio projection.

The fixed Study has no editable candidate and is ready for a direct bounded
Run. A Session is not offered because there is no selection loop or strategy
source to optimize.

After that Run is current, orientation has no primary CLI action and tells the
Agent to write and return the historical decision-support answer.
`aq run event-study ... --json` remains one supporting read-only evidence path;
it is not unfinished research.

## Limitations

- Only daily or other already-validated base-bar OHLCV observations are
  interpreted; event labels, earnings, news, and intraday order paths are not.
- Provider-adjusted OHLC claims come from the input package and are not
  independently authenticated by AutoQuant.
- The first contract supports one event asset and one matched reference asset.
- Threshold, wait, holding period, reference, and overlap policy are never
  searched inside the fixed Run.
- Unconditional observations overlap by construction and are a descriptive
  market-history reference, not an independent control sample.
