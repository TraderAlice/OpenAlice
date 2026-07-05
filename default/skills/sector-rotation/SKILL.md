---
name: sector-rotation
description: >
  Read what's moving across the whole market right now — which sectors are
  surging vs crashing, and where capital is rotating between them, across long /
  medium / short timeframes. The right-side, top-of-funnel "what is the market
  actually doing" read. Use when the user has no specific target and wants the
  lay of the land: "what's hot right now", "what sectors are surging / crashing",
  "where is money rotating", "what's leading and lagging", "is this risk-on or
  risk-off", "what should I be looking at this week", "show me the rotation
  map". Hands the standout movers off to a value-chain scan to dig into.
---

# Sector rotation — what's moving and where money is going

Rotation between sectors is often a clearer trend than anything inside a single
value chain. This is the right-side read most real (medium/short-term) trading
runs on — and the thing you'll open most often. The point is not a gainers
list; it's "where is money rotating, on what timeframe, and does it hold
together."

## Procedure (don't answer from memory — go to the data)

The data is on your CLIs: `traderhub board` / `traderhub etf` for sector & theme
performance, `alice analysis quant` for momentum across timeframes and breadth,
`alice rss grep` for the news narrative. (See the `traderhub`, `alice-analysis`
skills.)

1. **Rank the field across timeframes.** Look at sector/theme performance and
   momentum over long, medium, and short windows. The signal isn't any single
   window — it's how they line up:
   - long up + short up → established uptrend (real, but maybe late)
   - long up + short down → pullback in an uptrend (buy-the-dip, not a top)
   - long down + short up → a bounce or early rotation-in — decide which
   - long down + short down → downtrend (avoid, or watch for capitulation)
2. **Map the rotation, not just the levels.** Rotation is a FROM → TO: money
   leaving sectors that were strong and are now breaking, going into ones
   turning up. Name both ends. A one-day pop with nothing behind it is noise,
   not rotation.
3. **Confirm or doubt it.** A rotation is trustworthy when timeframes, market
   breadth (what's leading vs lagging beneath the index), and the news narrative
   point the same way. When only the shortest timeframe moves, distrust it.
4. **Overlay the macro regime.** Rotations make sense inside a regime — risk-on
   vs risk-off, rates up vs down, early vs late cycle. Tie what you see to the
   macro picture: does the rotation fit a coherent story, or is it noise? A
   rotation that contradicts the regime is either early (valuable) or wrong.
5. **Hand off the standouts.** For each surging/crashing sector worth a look,
   give a one-line read and the next move — usually "decompose this one"
   (the `scan-value-chain` skill) to find the names carrying the move.

## Output — persist a dated snapshot

Rotation is about change over time, so write a **dated** snapshot
(`rotation/<date>.md`, or whatever layout the user agrees) rather than
overwriting one file. The latest snapshot is the current read; the series is the
rotation itself — next session diffs against the last one ("what changed since
Tuesday"). Don't impose a layout; settle it with the user, then CRUD the series.

## Worked example (schematic — illustrates the read, NOT the current tape)

Run this live; the tape moves daily. The shape to produce:

| sector | long | mid | short | read |
|---|---|---|---|---|
| A | strong | strong | pulling back | buy-the-dip in an uptrend — not a top |
| B | weak | turning up | surging | early rotation-in **if** breadth + news confirm; else a dead-cat bounce |
| C | strong | rolling over | down | distribution — money leaving; a FROM end |
| D | weak | weak | down | downtrend, no read |

**Rotation call:** money rotating C → B (out of the rolling-over leader into the
turning-up laggard). **Confirm:** is B's strength broad (many names) or one
ticker? does the news support a reason? **Regime fit:** does C → B match the
macro regime (e.g. a rates move favoring B's profile), or is it a head-fake?
**Hand off:** B looks like the live thread → decompose B's value chain next to
find which names carry it.
