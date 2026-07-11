# OpenAlice

OpenAlice is an AI trading agent. This glossary captures project-specific domain language that implementation agents must preserve.

## Language

**Zone Trigger Source**:
The price source used to test whether a price-action zone event has happened. Valid sources are `body`, `wick`, and `midpoint`; the source selects the trigger price, while each event still defines its own target line.
_Avoid_: mitigation mode, close/wick option

**Body**:
A zone trigger source using the candle body's adverse-side boundary: `min(open, close)` for bullish zones and `max(open, close)` for bearish zones.
_Avoid_: close

**Wick**:
A zone trigger source using the candle extreme: `low` for bullish zones and `high` for bearish zones.
_Avoid_: extreme point of the body

**Midpoint**:
A zone trigger source whose target is the zone midpoint, `(zone.top + zone.bottom) / 2`, reached by the body trigger price. It is not the candle body midpoint.
_Avoid_: average candle price, body midpoint

**First Touch**:
The first candle whose range intersects a zone range. It is range-based and independent of the configured zone trigger source.
_Avoid_: mitigation

**Mitigation**:
An effective test of a zone: the configured zone trigger source reaches that zone's mitigation target.
_Avoid_: fill, break

**Full Fill**:
The selected source reaches the far edge of a zone: at or below `bottom` for bullish zones, or at or above `top` for bearish zones.
_Avoid_: mitigation

**FVG Fill Fields**:
Public FVG `isFilled`, `filledAtIndex`, and `completelyFilled` refer to full fill. Partial retrace is represented by `fillPercentage`, touch and mitigation lifecycle indexes, and the current `state`.
_Avoid_: using filledAtIndex for first partial retrace

**Break**:
A source zone defense failure where the selected source crosses the far edge and the zone becomes an opposite-side breaker candidate.
_Avoid_: mitigation

**Invalidation**:
A breaker-zone failure after the breaker has formed, where price crosses back through the breaker in the invalidating direction.
_Avoid_: break

**Zone Envelope**:
A shared lightweight result shape for price-action zones, carrying common identity, direction, bounds, recency indexes, state, lifecycle, and source-reference fields while leaving pattern-specific fields on each zone kind.
_Avoid_: one giant zone type

**Zone State**:
The mutually exclusive current state of a zone: `active`, `touched`, `mitigated`, `filled`, `broken`, or `invalidated`.
_Avoid_: lifecycle history

**Zone Lifecycle**:
The event history of a zone, including first touch, last touch, current inside status, mitigation, fill percentage, full fill, break, and invalidation indexes. First and last touch are lifecycle facts; `touched` is the current zone state when touch has happened but no stronger lifecycle event has happened.
_Avoid_: state

**Source Zone Reference**:
A lightweight link from a derived zone to its source zone, containing enough identity and context to trace lineage without nesting the full source object.
_Avoid_: original full object

**Overlap Policy**:
The rule for removing redundant same-group zones after lifecycle filtering. OpenAlice defaults to ranked overlap filtering within the same kind, direction, timeframe, and state bucket.
_Avoid_: previous/recent as primary semantics

**Delta Proxy**:
OpenAlice's bar-derived order-flow context: approximate delta/CVD and volume profile estimated from lower-timeframe OHLCV. It excludes native order-book depth, trade prints, footprint, and trade-order lifecycle.
_Avoid_: true order flow, tape, footprint

**Order-Flow Structure Summary**:
An agent-facing description centered on the latest target bar returned by the source, with window context and a bounded set of recent candidate events. The latest bar's completion is unknown; the summary covers profile location, delta/CVD structure, candidate divergences, candidate absorption or exhaustion, and data reliability without prescribing a trade direction or entry.
_Avoid_: trading signal, bullish/bearish score

**Order-Flow Divergence Candidate**:
A mismatch between the last two confirmed price pivots and CVD at those same indexes: price extends to a higher high or lower low while CVD does not confirm the extension. It remains a candidate because CVD is derived from the Delta Proxy.
_Avoid_: divergence signal, divergence at an unconfirmed window endpoint

**Order-Flow Absorption Candidate**:
A target bar whose absolute delta ratio is extreme relative to the request window but whose open-to-close progress in the delta direction is weak or opposing after ATR normalization. It is evidence of limited price response to the Delta Proxy, not proof of native-order absorption.
_Avoid_: confirmed absorption, small full-range candle

**Order-Flow Exhaustion Candidate**:
A short sequence in which price continues to progress in one direction while same-direction delta-ratio strength fades. It describes participation decay in the Delta Proxy and is distinct from a pivot-based order-flow divergence candidate.
_Avoid_: single low-delta bar, divergence

**Profile Node**:
A contiguous price region derived from local peaks or valleys in the lightly smoothed, window-scoped volume-profile distribution. HVNs are significant local peaks, LVNs are significant local valleys, and adjacent qualifying bins merge into one node.
_Avoid_: highest/lowest bins by global rank

**Volume Gap**:
A contiguous run of profile bins whose volume is zero or below a window-relative floor and that lies between populated volume regions. It is more selective than an LVN and is unrelated to an OHLCV price gap.
_Avoid_: any LVN, price gap, profile-edge tail

**Order-Flow Reliability Gate**:
A component-level availability check that suppresses order-flow candidates when their sample size, intrabar coverage, or degradation state cannot support them while preserving other usable summary facts. An unavailable component reports why it could not be evaluated, which is distinct from evaluating successfully and finding no candidate.
_Avoid_: low-confidence candidate, whole-analysis failure

**Provisional Order-Flow Candidate**:
An absorption or exhaustion candidate whose evidence includes the latest target bar returned by the source when that bar's completion is unknown. It may be reported for freshness but must remain distinguishable from candidates based entirely on historical bars.
_Avoid_: confirmed candidate, completed-bar event

**Order-Flow Fidelity**:
A machine-readable classification of the source evidence behind an order-flow result. `bar_proxy` means signed volume and derived structures are estimated from lower-timeframe OHLCV rather than native depth or trade prints; fidelity is distinct from confidence in the available proxy data.
_Avoid_: confidence, precision

**Liquidity Sweep**:
A wick penetration of a liquidity target followed by body or close reclaim back inside the level. A body-confirmed break is market structure, not a sweep.
_Avoid_: BOS, CHoCH

**FVG Raid**:
A zone-specific liquidity sweep where price wicks into or through an FVG-like zone and reclaims outside it without reaching the configured mitigation target.
_Avoid_: mitigation, break

**Breaker Zone**:
A role-reversal zone created when a source zone is broken through its far edge. It inherits the source zone bounds, reverses direction, and remains linked to its source zone.
_Avoid_: mitigation, raid

**Inverse FVG**:
A confirmed subset of FVG breakers where a broken FVG-like zone also receives reversal or impulse confirmation.
_Avoid_: generic breaker

**Liquidity Pool**:
An equal-high or equal-low target formed by multiple swing touches within a volatility-normalized tolerance band.
_Avoid_: single swing level

**Equal High**:
An above-price liquidity pool formed from repeated swing highs within tolerance. Its sweep direction is bearish.
_Avoid_: resistance line

**Equal Low**:
A below-price liquidity pool formed from repeated swing lows within tolerance. Its sweep direction is bullish.
_Avoid_: support line

**Premium/Discount Range**:
The selected structure range used to locate current price and zones as premium, discount, or equilibrium. OpenAlice defaults this to the latest confirmed swing high/low range.
_Avoid_: trend signal

**Equilibrium**:
The midpoint band of the premium/discount range. It is a location context, not a trigger source unless explicitly used as a zone trigger source.
_Avoid_: midpoint trigger

**Pivot Structure Mode**:
The stable market-structure mode based on confirmed pivot swings at configured lookbacks. It preserves sensitivity across internal, swing, and external levels.
_Avoid_: main structure

**Extreme Structure Mode**:
A cleaner market-structure mode that compresses minor pivots into active range extremes for top-down bias.
_Avoid_: replacement for pivot

**Adjusted Structure Mode**:
A reserved future structure mode for refined CHoCH/MSS detection after fixtures distinguish failed CHoCH, MSS, and sweep-into-reversal cases.
_Avoid_: public mode before fixtures

**Strong High/Low**:
A defended structural anchor aligned with the active trend context.
_Avoid_: any unswept swing

**Weak High/Low**:
A liquidity target likely to be swept or already swept in the active trend context.
_Avoid_: broken structure

**Multi-Timeframe Summary**:
A condensed top-down price-action read across multiple intervals. It reports bias, conflicts, confluences, and interval summaries; full detail remains in single-timeframe analysis.
_Avoid_: concatenated single-timeframe results
