# 04 — Add Order-Flow Absorption Candidates

**What to build:** Extend the Order-Flow Structure Summary with explainable Order-Flow Absorption Candidates when an extreme window-relative Delta Proxy produces weak or opposing ATR-normalized open-to-close progress. The completed slice should work in both directions, remain honest about proxy fidelity and data quality, and distinguish current provisional evidence from historical evidence.

**Blocked by:** 01 — Deliver the agent-readable Delta Proxy summary foundation.

**Status:** ready-for-agent

- [ ] Absolute delta-ratio extremes are determined relative to the requested analysis window using a named, reported internal default rather than a new public tuning input.
- [ ] Price response is the open-to-close move in the Delta direction normalized by ATR; full candle range and previous-close gaps are not substituted for this measure.
- [ ] Bullish-side and bearish-side absorption candidates follow symmetric semantics and remain candidate observations rather than trade signals or proof of native-order absorption.
- [ ] Each candidate reports timestamp/index, direction, delta ratio, applied percentile threshold, directional price progress, ATR, method information, and reliability evidence.
- [ ] Evidence indexes align with the returned target-bar window and remain reconcilable through the existing target-window offset.
- [ ] Insufficient percentile samples, ATR warmup, low intrabar coverage, or relevant degradation suppresses unsupported candidates with a stable unavailable reason.
- [ ] An available detector that finds no absorption returns an empty collection rather than an unavailable result.
- [ ] A candidate involving the latest returned bar is marked `provisional: true`; candidates based entirely on prior bars are not provisional.
- [ ] Candidates are ordered newest first, capped at three, and accompanied by `totalDetected` and `truncated` metadata.
- [ ] Domain-entry fixtures cover both directions, adequate price progress, weak progress, opposing progress, threshold boundaries, insufficient samples, missing ATR, low coverage, provisional behavior, ordering, and truncation.
- [ ] Root strict TypeScript checking and the relevant monorepo tests pass.
