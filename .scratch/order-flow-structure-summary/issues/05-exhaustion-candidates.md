# 05 — Add Order-Flow Exhaustion Candidates

**What to build:** Complete the Order-Flow Structure Summary with explainable exhaustion candidates for short sequences where price continues in one direction while same-direction delta-ratio strength fades. Reuse the established price-response, reliability, bounded-collection, and provisional behavior so agents can distinguish participation decay from a single quiet bar or pivot divergence.

**Blocked by:** 04 — Add Order-Flow Absorption Candidates.

**Status:** ready-for-agent

- [ ] Upward and downward exhaustion use symmetric short-sequence semantics with named, reported internal defaults and no new public tuning inputs.
- [ ] A candidate requires continuing directional price progress across the sequence together with fading same-direction delta-ratio strength.
- [ ] A single low-delta bar, a sequence whose price direction breaks, steady participation, and confirmed-pivot divergence alone do not create exhaustion candidates.
- [ ] Each candidate reports sequence start/end timestamps and indexes, direction, normalized price progression, delta-strength progression, applied method, and reliability evidence.
- [ ] Evidence indexes align with the returned target-bar window and remain reconcilable through the existing target-window offset.
- [ ] Insufficient sequence length, missing normalization inputs, low coverage in a sequence member, or relevant degradation suppresses unsupported candidates with a stable unavailable reason.
- [ ] An available detector that finds no exhaustion returns an empty collection rather than an unavailable result.
- [ ] A sequence involving the latest returned bar is marked `provisional: true`; sequences ending earlier are not provisional.
- [ ] Candidates are ordered newest first, capped at three, and accompanied by `totalDetected` and `truncated` metadata.
- [ ] Domain-entry fixtures cover both directions, steady participation, isolated low Delta, broken direction, insufficient length, low coverage, provisional behavior, ordering, and truncation.
- [ ] The completed summary remains structured, descriptive, `bar_proxy` fidelity-aware, and free of trading scores or recommendations when all profile and candidate components coexist.
- [ ] Root strict TypeScript checking and the relevant monorepo tests pass.
