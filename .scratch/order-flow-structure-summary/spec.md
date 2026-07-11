# Order-Flow Structure Summary

Status: ready-for-agent

## Problem Statement

Workspace AI agents can currently request approximate delta volume, CVD, and a window-scoped volume profile, but they must repeatedly interpret raw bars and profile bins themselves. That interpretation is expensive in agent context, inconsistent between runs, and prone to overstating an OHLCV-derived Delta Proxy as native order flow. Agents also cannot reliably distinguish a valid no-event result from a result that could not be evaluated because the window, intrabar coverage, or degraded data was insufficient.

The current response exposes useful inputs but does not directly describe current profile location, significant profile nodes, confirmed price/CVD disagreement, limited price response to extreme Delta Proxy values, participation decay, or the evidence and reliability behind those observations. The source bar contract also cannot prove that the latest returned bar is complete, so any current-bar observation can otherwise look more final than it is.

## Solution

Deepen the existing Delta Proxy with a deterministic, structured Order-Flow Structure Summary for Workspace AI agents. Keep one agent-facing order-flow tool: add the summary to the default combined context response and add a compact summary-only mode that performs the same analysis without returning raw delta bars or profile bins. Existing delta-only and profile-only behavior remains unchanged.

The summary describes observable context rather than recommending a trade. It reports the latest returned target bar's position relative to POC and value area, window-scoped Profile Nodes and Volume Gaps, current Delta Proxy/CVD structure, confirmed-pivot Order-Flow Divergence Candidates, Order-Flow Absorption Candidates, short-sequence Order-Flow Exhaustion Candidates, component-level reliability, and machine-readable Order-Flow Fidelity. Every candidate carries numeric evidence and source references. Unsupported components are explicitly unavailable rather than silently empty, and candidates involving the latest bar are provisional because bar completion is unknown.

## User Stories

1. As a Workspace AI agent, I want one compact order-flow request to return interpreted structure, so that I do not have to re-derive the same conclusions from raw bars and bins on every run.
2. As a Workspace AI agent, I want the default combined context response to include the summary, so that existing context-oriented workflows gain the new information without discovering another tool.
3. As a Workspace AI agent, I want a summary-only mode, so that I can minimize context usage when raw delta bars and profile bins are unnecessary.
4. As an existing delta-only caller, I want delta mode to retain its current response behavior, so that the additive feature does not break focused workflows.
5. As an existing profile-only caller, I want profile mode to retain its current response behavior, so that the additive feature does not change an unrelated contract.
6. As a Workspace AI agent, I want every result to identify its fidelity as `bar_proxy`, so that I do not mistake lower-timeframe OHLCV estimates for native depth, trade prints, tape, or footprint data.
7. As a Workspace AI agent, I want `isApproximation: true` to remain available, so that existing approximation checks continue to work.
8. As a Workspace AI agent, I want fidelity and confidence represented separately, so that I can distinguish the kind of evidence from the quality of the available evidence.
9. As a Workspace AI agent, I want to know whether the latest returned close is above, below, or inside value area, so that I can describe current price acceptance relative to the requested window.
10. As a Workspace AI agent, I want the current price's relationship to POC reported numerically and categorically, so that I can compare location without parsing profile bins.
11. As a Workspace AI agent, I want significant HVNs represented as merged Profile Nodes, so that adjacent high-volume bins do not appear as duplicate areas.
12. As a Workspace AI agent, I want significant LVNs represented as merged Profile Nodes, so that I can identify locally thin areas without equating them with all globally low-ranked bins.
13. As a Workspace AI agent, I want Volume Gaps distinguished from ordinary LVNs and price gaps, so that I can identify internally bounded, exceptionally sparse profile regions without semantic ambiguity.
14. As a Workspace AI agent, I want Profile Nodes derived from local distribution shape and window-relative significance, so that the result adapts across instruments, timeframes, and requested windows.
15. As a Workspace AI agent, I want the latest delta direction, normalized delta strength, CVD direction, and recent CVD tendency summarized, so that I can describe participation without scanning every delta bar.
16. As a Workspace AI agent, I want bearish divergence candidates to compare confirmed higher price highs with CVD at the same confirmed pivot indexes, so that an unconfirmed window endpoint is not mislabeled as divergence.
17. As a Workspace AI agent, I want bullish divergence candidates to compare confirmed lower price lows with CVD at the same confirmed pivot indexes, so that the result has stable, symmetric semantics.
18. As a Workspace AI agent, I want divergence evidence to include both pivot references and CVD values, so that I can audit why the candidate was produced.
19. As a Workspace AI agent, I want an Order-Flow Absorption Candidate when window-relative Delta Proxy strength is extreme but ATR-normalized open-to-close progress in that direction is weak or opposing, so that limited price response is surfaced without claiming native-order absorption.
20. As a Workspace AI agent, I want absorption evidence to include delta ratio, applied percentile threshold, directional price progress, ATR, and the source bar reference, so that the classification remains explainable.
21. As a Workspace AI agent, I want an Order-Flow Exhaustion Candidate when price continues in one direction across a short sequence while same-direction delta-ratio strength fades, so that participation decay is distinct from a single low-delta bar.
22. As a Workspace AI agent, I want exhaustion evidence to include the sequence bounds, normalized price progress, delta-strength progression, and applied method, so that I can inspect the observed decay.
23. As a Workspace AI agent, I want divergence, absorption, and exhaustion to remain candidate observations rather than bullish or bearish signals, so that the tool does not prescribe a trade without strategy context.
24. As a Workspace AI agent, I want candidate arrays ordered most-recent first, so that the freshest evidence is cheapest to consume.
25. As a Workspace AI agent, I want at most three returned events per candidate type, so that long request windows cannot flood my context.
26. As a Workspace AI agent, I want each candidate collection to report its total detected count and whether it was truncated, so that bounded output does not hide the existence of older events.
27. As a Workspace AI agent, I want each evidence reference to include a timestamp and an index aligned with the returned analysis window, while preserving the existing source-window offset, so that I can correlate summary events with raw output when needed.
28. As a Workspace AI agent, I want applied detection defaults and sample information returned in structured form, so that I can explain the result without receiving a large threshold configuration surface.
29. As a Workspace AI agent, I want reliability evaluated per summary component, so that usable profile facts can survive when Delta Proxy candidates are unsupported.
30. As a Workspace AI agent, I want an unavailable component to report a stable reason, so that I can distinguish insufficient evidence from a successful evaluation that found no candidates.
31. As a Workspace AI agent, I want low intrabar coverage to suppress candidates whose evidence depends on those bars, so that a low-confidence label does not legitimize unsupported structure.
32. As a Workspace AI agent, I want degraded intrabar selection and truncation reflected in reliability, so that automatic adherence to the intrabar cap remains visible in the interpretation.
33. As a Workspace AI agent, I want short windows to preserve whatever facts are valid while suppressing detectors that lack their required sample, so that the entire tool does not fail unnecessarily.
34. As a Workspace AI agent, I want the latest target bar's completion reported as `unknown`, so that the system does not invent a completion guarantee absent from the source contract.
35. As a Workspace AI agent, I want absorption or exhaustion candidates involving the latest returned bar marked `provisional: true`, so that current observations remain fresh without being presented as final.
36. As a Workspace AI agent, I want confirmed-pivot divergence to exclude unconfirmed endpoints by construction, so that it never needs a provisional pivot label.
37. As a maintainer, I want summary calculations deterministic and free of model-generated prose, so that response changes are reviewable and regression-testable.
38. As a maintainer, I want named internal defaults instead of caller-provided tuning knobs in the first version, so that the public tool schema remains compact while the semantics are calibrated.
39. As a maintainer, I want no-event, unavailable, and provisional states covered independently, so that future refactors cannot collapse materially different meanings into a boolean.
40. As a maintainer, I want the existing no-target-bars and no-intrabars statuses preserved, so that current failure handling remains compatible while summary availability stays honest.

## Implementation Decisions

- Preserve the existing single deep order-flow tool. Do not create a second summarization tool.
- Extend the mode vocabulary with `summary`.
- In the default combined `context` mode, calculate and return delta, profile, summary, and metadata.
- In `summary` mode, calculate the required underlying delta and profile inputs but omit raw delta bars and raw profile bins from the public response.
- Preserve existing `delta` and `profile` mode behavior; neither gains unrelated summary output.
- Modes that request a summary return a stable summary envelope even when a component is unavailable. Existing top-level status and error semantics remain authoritative for no target bars and no intrabars.
- Keep the summary fully deterministic and structured. Do not generate a prose interpretation, directional score, entry, exit, or trade recommendation.
- Add `fidelity: 'bar_proxy'` while retaining `isApproximation: true`. Fidelity describes the evidence source; reliability describes whether the available proxy data supports a specific component.
- Center current-state fields on the latest target bar returned by the source. Use its close for profile location, and report `barCompletion: 'unknown'` because the bar contract provides no authoritative completion state.
- Represent current profile location with stable categorical states for below value area, inside value area, above value area, and unavailable. Include numeric POC/value-area evidence rather than only the category.
- Derive Profile Nodes from a lightly smoothed, window-scoped bin-volume distribution. Detect local peaks for HVNs and local valleys for LVNs, apply window-relative significance gates, and merge adjacent qualifying bins into a single contiguous node.
- Define a Volume Gap as a contiguous run of zero-volume or window-relatively negligible bins bounded on both sides by populated volume regions. Profile-edge tails and OHLCV price gaps are not Volume Gaps.
- Use named internal defaults for smoothing, percentile gates, minimum samples, ATR period, pivot lookback, and exhaustion sequence length. Do not expose these as new tool inputs in the first version.
- Return applied defaults and method metadata needed to explain each component. Exact initial constants may be selected conservatively during implementation, but once selected they must be locked by semantic fixtures rather than left implicit.
- Reuse the existing confirmed pivot semantics at the internal structure level for divergence. Compare the last two confirmed price highs or lows and read CVD at those same indexes; do not invent endpoint or regression-slope divergence.
- A bearish Order-Flow Divergence Candidate requires a confirmed higher price high whose corresponding CVD does not exceed the prior confirmed-high CVD. A bullish candidate is the symmetric lower-low case whose CVD does not fall below the prior confirmed-low CVD.
- Detect Order-Flow Absorption Candidates from window-relative extremes in absolute delta ratio combined with weak or opposing open-to-close progress in the Delta direction after ATR normalization. Full candle range and previous-close gaps are not the price-progress measure.
- Detect Order-Flow Exhaustion Candidates as short directional sequences in which price continues to progress while same-direction delta-ratio strength fades. Do not redefine a single low-delta bar or confirmed-pivot divergence as exhaustion.
- Candidate evidence includes its type, direction where applicable, timestamps, indexes, measurements, applied thresholds or method, reliability, and `provisional` state.
- Evidence indexes align with the returned target-bar window. Preserve the existing target-window offset so callers can reconcile a capped window with a larger supplied source array.
- Sort each candidate type newest first, return at most three events, and report `totalDetected` plus `truncated` for each collection.
- Mark an absorption or exhaustion candidate provisional when its evidence includes the latest returned bar. Confirmed-pivot divergence remains non-provisional because a pivot requires right-side confirmation.
- Gate reliability per component using the component's sample requirements, intrabar coverage of its evidence, and relevant degradation state. Suppressed components or candidates return a stable unavailable reason; an available empty candidate collection means evaluation succeeded and found none.
- Profile-only facts remain independently available when profile inputs are valid, even if delta-derived components are unavailable. Do not fail the whole summary because one detector is gated.
- Preserve the current bounded intrabar planning behavior and its precision metadata. The summary consumes that metadata rather than creating a second data-loading or degradation policy.
- Keep the analysis window-scoped. The same input window that produces delta and profile also provides all summary statistics and relative thresholds.
- Keep result types explicit and closed where practical: category, availability, candidate kind, fidelity, and unavailable reason should be machine-readable enumerations rather than free-form labels.

## Testing Decisions

- Use the existing `analyzeOrderFlowContext` domain entry point as the primary behavior seam. Drive it with synthetic target bars, synthetic intrabars, and a mocked BarService so tests exercise loading, delta/profile derivation, summary construction, reliability, and response shape together.
- Use the agent-facing tool adapter only for thin contract tests: the new mode is accepted by the schema, the description explains fidelity and modes, and execution returns the domain result. Do not duplicate every detector scenario at this layer.
- Do not directly test smoothing, percentile, slope, or merging helpers unless a required boundary cannot be expressed at the primary seam. Tests assert public behavior rather than private function structure.
- Build deterministic fixtures for each positive and negative divergence direction, including equal price/CVD cases and insufficient confirmed pivots.
- Build deterministic fixtures for positive and negative absorption, non-absorption with adequate price progress, opposing progress, percentile boundaries, missing ATR warmup, and low-coverage evidence.
- Build deterministic fixtures for upward and downward exhaustion, steady participation, a single low-delta bar, broken directional sequences, insufficient sequence length, and low-coverage sequence members.
- Build profile fixtures with one and multiple HVNs/LVNs, adjacent qualifying bins that must merge, insignificant local extrema that must be filtered, internal Volume Gaps, edge tails that must not become gaps, and flat or empty distributions.
- Cover price-location categories at value-area boundaries as well as above, inside, below, and unavailable cases.
- Cover component-level degradation: too few bars, no target bars, no intrabars, partial intrabar coverage, automatic intrabar degradation, and capped supplied target windows.
- Cover latest-bar behavior explicitly: current fields report `barCompletion: 'unknown'`; latest-bar absorption/exhaustion is provisional; historical-only candidates are not provisional; confirmed pivots never use the unconfirmed endpoint.
- Assert candidate collection invariants: newest-first ordering, maximum length three, correct total count, correct truncation flag, valid timestamp/index references, and stable evidence payloads.
- Assert reliability invariants: unavailable is distinct from available-with-no-events; unsupported candidates are absent rather than emitted as low-confidence candidates; one unavailable component does not erase independent usable components.
- Assert fidelity invariants: summary-bearing results identify `bar_proxy`, preserve `isApproximation: true`, and never use native-order-flow terminology for proxy-derived evidence.
- Assert mode compatibility: context includes all views, summary omits raw views, and delta/profile retain their prior shapes and semantics.
- Avoid live provider snapshots and network-dependent tests. They are nondeterministic and cannot provide controlled counterexamples.
- Do not use strategy profitability as an acceptance gate. These tests establish the declared analysis semantics, not entry/exit performance.
- Use the repository's existing unit-test framework and order-flow fixture style as prior art. The completed implementation must pass the root strict TypeScript check and the monorepo test suite.

## Out of Scope

- Native order-book depth, CCXT depth summaries, imbalance, slippage estimation, and streaming book updates.
- Public trade-print ingestion, quote/aggressor classification, tape, footprint, or true bid/ask CVD.
- Trade-order lifecycle behavior such as order placement, amendment, cancellation, partial fills, or broker synchronization.
- Trading signals, bullish/bearish scores, setup rankings, entries, exits, stops, targets, or profitability claims.
- New UI charts, profile overlays, visual annotations, notifications, or Inbox delivery.
- Session profiles, exchange-session calendars, Composite Profiles, anchored profiles, and multi-window or multi-timeframe comparison.
- Public detector threshold inputs or a broad tuning API.
- A first-class completed-bar field across BarService providers or time/calendar-based completion inference.
- Persistence, alerting, historical event storage, replay services, or scheduled scans.
- Wyckoff-specific labels or rules in the core order-flow domain.
- Broker-interface expansion or provider-specific entitlement handling.
- Changes to the current intrabar maximum-bar policy or data-loading architecture.

## Further Notes

- The canonical domain terms are Delta Proxy, Order-Flow Structure Summary, Order-Flow Divergence Candidate, Order-Flow Absorption Candidate, Order-Flow Exhaustion Candidate, Profile Node, Volume Gap, Order-Flow Reliability Gate, Provisional Order-Flow Candidate, and Order-Flow Fidelity.
- ADR-0002 records why the summary stays descriptive, structured, fidelity-aware, and honest about unknown bar completion.
- Existing research ranks this summary and profile-node work as the highest-value, lowest-risk next step because it reuses the current bar-derived contract without crossing into broker or persistence boundaries.
- Initial internal constants are calibration choices constrained by this spec. They should be conservative, named, returned as method metadata, and fixed by fixtures before the feature is considered complete.
- A later feature may add provider-aware depth or trade-print fidelity values, but it must not retroactively reinterpret `bar_proxy` results.
