# 01 — Deliver the agent-readable Delta Proxy summary foundation

**What to build:** Make the existing order-flow analysis return a useful structured summary for Workspace AI agents. The default combined context should include the summary, while a new summary-only mode should omit raw delta bars and profile bins. The first slice must already describe the latest returned bar's Delta Proxy, CVD, POC/value-area location, fidelity, bar-completion uncertainty, and component availability without changing focused delta-only or profile-only behavior.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Default context responses include a deterministic Order-Flow Structure Summary alongside the existing raw delta and profile views.
- [ ] Summary-only mode returns the same summary and metadata without returning raw delta bars or raw profile bins.
- [ ] Existing delta-only and profile-only modes preserve their prior public behavior and response semantics.
- [ ] Summary-bearing responses report Order-Flow Fidelity as `bar_proxy` and retain `isApproximation: true`, with fidelity kept distinct from confidence.
- [ ] Current state identifies the latest returned target bar, reports `barCompletion: 'unknown'`, and describes its close relative to POC and value area with both categorical and numeric evidence.
- [ ] Current Delta Proxy state includes latest delta direction, normalized delta strength, CVD direction, and a deterministic recent CVD tendency without emitting a trading score or recommendation.
- [ ] Components distinguish available-with-no-observation from unavailable, and unavailable components return stable reasons based on missing bars, missing intrabars, insufficient samples, coverage, or degradation as applicable.
- [ ] No-target-bars and no-intrabars results preserve existing top-level status/error behavior while summary-requesting modes return an honest availability envelope.
- [ ] Applied method names, sample counts, target-window offset, and relevant precision metadata remain visible to the agent without adding detector-tuning inputs.
- [ ] Domain-entry behavior tests cover context, summary, delta, profile, no-target-bars, no-intrabars, short windows, and capped target windows; the thin tool contract test covers the new mode and description.
- [ ] Root strict TypeScript checking and the relevant monorepo tests pass.
