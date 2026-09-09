---
name: retrospective
description: >
  Subjective retrospective / time-machine analysis: rewind a name to a past
  point, reconstruct what it looked like THEN (no future knowledge), align the
  news catalysts to the price path, and pressure-test "if I'd entered there,
  would it have worked?". Use when the question is about a past moment or a
  hypothetical entry: "rewind XLE to early April", "what did NVDA look like
  before earnings", "if we'd bought energy after the Iran headline, easy
  money?", "replay the SMH spike — policy or earnings?", "was there an entry
  signal at the time", "would an 8% trailing stop have saved me", "event study
  on the Hormuz escalation". It strings together the as-of snapshot, the
  date-windowed news, and Workspace research code into one honest replay — and it is
  ruthless about data freshness, because a retro built on a stale or
  future-leaking price is worse than no retro.
---

# Retrospective / Time-Machine analysis

Rewind a name to a moment, see it as it was THEN, attribute the move to
catalysts, and test whether a tradeable edge actually existed. The whole value
is honesty: **no lookahead** (never use a price the moment didn't yet know) and
**no stale data** (never report yesterday's close as "now").

`alice analysis snapshot` provides dated market summaries; the `alice-analysis`
skill describes quantitative queries. Choose historical news sources with
coverage of the period being studied.

## The freshness gate — DO THIS FIRST, every time

Every snapshot/quant result carries a freshness contract:
`asOf`, `isLatestActual`, `staleTradingDays`, and a `freshnessWarning` when the
data does not reach the anchor. **Before you state any "current" number, check
it.**

- `isLatestActual: false` → the close you're holding is STALE. Do not call it
  the current price. Say "as of <date>, N trading days behind" and, for
  anything live, pull a realtime broker source.
- A free vendor (yfinance) lags a day or two and a free broker tier (alpaca
  SIP) may not have today yet. An overnight catalyst can land in exactly that
  blind spot — the classic trap is reporting a flat green close while the real
  reaction already happened after the bar you can see.
- `snapshot --query <SYM>` auto-picks the freshest source (realtime broker >
  delayed vendor). Prefer it over hand-fetching from a delayed vendor.

## Procedure

1. **Snapshot the anchor (no lookahead).** Reconstruct the moment with
   `asOf` — bars never run past it.
   ```bash
   alice analysis snapshot --query XLE --asOf 2026-04-03            # summary
   alice analysis snapshot --query XLE --asOf 2026-04-03 --bars 30  # + dated path
   ```
   Read the `latest` print (close, vs-prevClose, day high/low, **amplitude** —
   a sleepy vs-prevClose number hides an intraday plunge-and-recover) and
   `levels` (sma20/50, rsi14, distance from the period high — the "how far off
   the top" feel). The snapshot is **summary-only by default** (the dated path
   can be large); add `--bars N` when you actually need the per-day series.
   `windowBars` tells you how many are available.

2. **Align the catalysts to the price.** Build a dated event timeline from
   relevant sources and compare it with the bars. Distinguish evidence of a
   catalyst from a coincident headline, and note material gaps in coverage.

3. **Test the hypothesis in Workspace research code.** If the question needs
   a hypothetical trade, save the dated inputs and write an inspectable script
   with the native Coding Agent. Pin the source and evaluation window. State
   signal timing, executable entry/exit prices, position sizing, fees and
   slippage explicitly. Do not use a closing-price signal to assume an
   executable fill at that same close. Exclude pre-entry price extremes from
   holding-period MFE/MAE. Save the script, inputs and results together so the
   assumptions can be changed and the calculation reproduced.

4. **Map the index to dates when you need the path in a quant script.** Most
   reads are covered by snapshot; when you must compute over the series and want
   the date axis, add `--dates` to `alice analysis quant` (it returns
   `dates[barId]` for one interval, or `dates["barId@interval"]` when the same
   barId appears at multiple intervals, so you can map each value to its day).

## Write it down honestly

A retro is only worth as much as its weakest assumption. State, every time:
- the **asOf** and that the analysis used no later data,
- the **source + freshness** of every "current" number,
- what you **couldn't see** (feeds didn't cover it / cookie-gated / SIP didn't
  have the latest day) — name the gap rather than paper over it.

The failure mode this skill exists to prevent: a confident call built on a
stale or future-leaking price. When in doubt, distrust the data before the
market.
