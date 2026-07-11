# 03 — Add confirmed-pivot Order-Flow Divergence Candidates

**What to build:** Extend the Order-Flow Structure Summary with auditable bullish and bearish divergence candidates based on confirmed price pivots and CVD at those same indexes. The completed slice should give agents recent stable disagreements without treating an unconfirmed endpoint as structure or presenting a candidate as a trade signal.

**Blocked by:** 01 — Deliver the agent-readable Delta Proxy summary foundation.

**Status:** ready-for-agent

- [ ] Divergence detection reuses the project's confirmed internal-pivot semantics rather than rolling endpoints or regression-slope substitutions.
- [ ] A bearish candidate requires a confirmed higher price high whose corresponding CVD does not exceed CVD at the prior confirmed high.
- [ ] A bullish candidate requires a confirmed lower price low whose corresponding CVD does not fall below CVD at the prior confirmed low.
- [ ] Each candidate includes both pivot timestamps/indexes, price values, corresponding CVD values, direction, method information, and reliability evidence.
- [ ] Evidence indexes align with the returned target-bar window and remain reconcilable through the existing target-window offset.
- [ ] Candidate evaluation is suppressed with an explicit unavailable reason when confirmed pivots, samples, intrabar coverage, or CVD evidence are insufficient.
- [ ] An available detector that finds no divergence returns an empty collection rather than an unavailable result.
- [ ] Candidates are ordered newest first, capped at three, and accompanied by `totalDetected` and `truncated` metadata.
- [ ] Confirmed-pivot candidates never use the latest unconfirmed endpoint and therefore are not marked provisional.
- [ ] Domain-entry fixtures cover both directions, no-confirmation cases, equal price/CVD boundaries, insufficient pivots, low-coverage evidence, ordering, and truncation.
- [ ] Root strict TypeScript checking and the relevant monorepo tests pass.
