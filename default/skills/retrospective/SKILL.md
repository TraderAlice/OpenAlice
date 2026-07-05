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
  date-windowed news, and the backtest into one honest replay — and it is
  ruthless about data freshness, because a retro built on a stale or
  future-leaking price is worse than no retro.
---

# Retrospective / Time-Machine analysis

Rewind a name to a moment, see it as it was THEN, attribute the move to
catalysts, and test whether a tradeable edge actually existed. The whole value
is honesty: **no lookahead** (never use a price the moment didn't yet know) and
**no stale data** (never report yesterday's close as "now").

The tools (run them — don't answer from memory):
`alice analysis snapshot`, `alice analysis simulate`, `alice rss window`,
`alice rss grep` / `read`. (See the `alice`, `alice-analysis` skills for the
quant scripting language.)

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

2. **Align the catalysts to the price.** Pull the news IN the window,
   oldest-first, and lay the timestamps against the bars.
   ```bash
   alice rss window --from 2026-04-01 --to 2026-04-10 --pattern "Iran|oil|OPEC"
   ```
   Each hit has an ISO `time` — put it next to the bar it moved. This is how you
   answer "was the spike policy or earnings". Coverage is the user's SUBSCRIBED
   feeds only: an empty window means "not in the feeds", NOT "nothing happened"
   — say so, and don't pretend you saw everything. (Cookie-gated sources —
   Barchart options flow, Reddit sentiment — are unreachable from a headless
   run; if the call needs them, flag the gap rather than imply full coverage.)

3. **Test the entry (backtest the hypothesis).** "If I'd bought at the anchor,
   would a stop/exit have worked?"
   ```bash
   alice analysis simulate --query XLE --entryDate 2026-04-03 \
     --exitRule trailing_stop --exitPct 8
   # also try: --exitRule ma_break --exitPeriod 50   (trend exit)
   #           --exitRule hold                        (just measure to now)
   ```
   Read `entry`/`exit` (date·price·reason), `returnPct`, and **MFE/MAE** (the
   best and worst it went while you held — the round trip a single end-number
   hides). `open: true` means it never triggered the exit; the return is
   mark-to-market, not realized. Compare a couple of exit rules — the
   interesting finding is usually "the move was real but giving it back to a
   loose stop ate most of it", or vice-versa.

4. **Map the index to dates when you need the path in a quant script.** Most
   reads are covered by snapshot; when you must compute over the series and want
   the date axis, add `--dates` to `alice analysis quant` (it returns
   `dates[barId]` so you can map a dumped value back to its day).

## Write it down honestly

A retro is only worth as much as its weakest assumption. State, every time:
- the **asOf** and that the analysis used no later data,
- the **source + freshness** of every "current" number,
- what you **couldn't see** (feeds didn't cover it / cookie-gated / SIP didn't
  have the latest day) — name the gap rather than paper over it.

The failure mode this skill exists to prevent: a confident call built on a
stale or future-leaking price. When in doubt, distrust the data before the
market.
