# 02 — Add Profile Nodes and Volume Gaps

**What to build:** Extend the Order-Flow Structure Summary with window-scoped profile structure that an agent can use without interpreting bins. The completed slice should expose significant merged HVNs and LVNs plus internally bounded Volume Gaps, with numeric boundaries, significance evidence, applied methodology, and independent reliability.

**Blocked by:** 01 — Deliver the agent-readable Delta Proxy summary foundation.

**Status:** ready-for-agent

- [ ] The summary returns HVN Profile Nodes from significant local peaks in a lightly smoothed, window-scoped bin-volume distribution.
- [ ] The summary returns LVN Profile Nodes from significant local valleys rather than simply selecting globally lowest-ranked bins.
- [ ] Window-relative significance gates filter weak local extrema, and the applied smoothing and significance defaults are named and reported as method metadata.
- [ ] Adjacent qualifying bins of the same kind merge into one contiguous Profile Node with auditable price bounds and volume evidence.
- [ ] A Volume Gap is returned only for a contiguous zero-volume or window-relatively negligible region bounded on both sides by populated profile regions.
- [ ] Ordinary LVNs, profile-edge tails, and OHLCV price gaps are not labeled as Volume Gaps.
- [ ] Flat, empty, too-small, or otherwise unsupported distributions produce explicit component availability or an available empty result as semantically appropriate.
- [ ] Profile structure remains usable when delta-derived candidate components are unavailable.
- [ ] Domain-entry fixtures cover single and multiple nodes, adjacent-node merging, filtered weak extrema, internal gaps, edge tails, flat distributions, empty distributions, and value-area boundary locations.
- [ ] Root strict TypeScript checking and the relevant monorepo tests pass.
