# ADR-002: Feature Flag Policy for Rust-Backed Modules

- Status: Accepted (planning-only; no source code authorized by this ADR)
- Date: 2026-04-28
- Authors: CTO / Program Orchestrator (drafting); Architecture Lead (review owner)
- Supersedes: none
- Related: [ADR-001](./ADR-001-rust-boundary.md), [Playbook section 10.2](../PAPERCLIP_OPENALICE_RUST_REFACTOR_PLAYBOOK.md), module contracts for [analysis_core](../module-contracts/analysis-core.md), [trading_core](../module-contracts/trading-core.md), [store_core](../module-contracts/store-core.md)

## Context

Each Rust-backed module must be safely toggleable. Phase 1 contracts already name a per-module environment flag (`OPENALICE_RUST_ANALYSIS`, `OPENALICE_RUST_TRADING_CORE`, `OPENALICE_RUST_STORE_CORE`). The post-approval clarification on [OPE-4](/OPE/issues/OPE-4) (2026-04-27T10:34:09Z) canonicalized `OPENALICE_RUST_TRADING_CORE=0|1` as the only accepted shape for the trading flag. ADR-002 generalizes that decision to all in-scope modules and pins the rules every Phase 2+ issue must follow.

Open questions before this ADR: how flags are parsed, whether they are per-module or aggregated, what counts as "default off", how rollout proceeds, and what the rollback contract is.

## Decision

### Flag identity and shape

There is exactly one runtime feature flag per in-scope module:

| Module | Flag name | Accepted values | Meaning of `0` / unset / invalid | Meaning of `1` |
| --- | --- | --- | --- | --- |
| `analysis_core` | `OPENALICE_RUST_ANALYSIS` | `0` or `1` | Use legacy TypeScript path | Route eligible deterministic calculations through Rust |
| `trading_core` | `OPENALICE_RUST_TRADING_CORE` | `0` or `1` | Use legacy TypeScript path | Approved opt-in/canary Rust execution during parity validation and staged rollout |
| `store_core` | `OPENALICE_RUST_STORE_CORE` | `0` or `1` | Use legacy TypeScript path | Route approved store-core operations through Rust |

Rules common to all flags:

1. **Parsing is strict.** Only the literal strings `0` and `1` are accepted as the active state. Unset, empty string, anything that is not `0` or `1`, including the strings `true`, `false`, `on`, `off`, `yes`, `no`, must behave as `0` (legacy path). Whitespace must be trimmed before comparison.
2. **Per-module isolation.** Flags are independent. There is no aggregate "enable Rust everywhere" flag. Combining flags for a release is a release decision recorded in a release ADR, not a code default.
3. **Default is off in every shared environment** (CI, staging, production). Defaults may be overridden per developer in local shells.
4. **Reversible without data migration.** Setting any flag to `0` after running with `1` must restore legacy behavior with no migration step. Persisted artifacts (JSONL files, commit history) written under `1` must remain readable under `0`.
5. **Process-level resolution.** Flag state is read at process start (or at first use, cached for the process lifetime). No flip-mid-request behavior. A change to flag value requires a process restart.
6. **No sub-flags, no comma lists.** A single bit per module. Behaviors that need finer control require an ADR.

### Rollout phases

Every Rust-backed module follows the same rollout sequence, gated by the approvals listed in its module contract. Skipping a phase requires an ADR.

| Phase | Flag default | Where it runs | Required evidence to advance |
| --- | --- | --- | --- |
| **R0 Disabled** | `0` everywhere | nowhere (legacy only) | Architecture approval of the Rust crate boundary, integration design, and DTO mapping |
| **R1 Developer opt-in** | `0`; developers may set `1` locally | individual developer machines | Rust unit tests, parity tests against golden fixtures, no schema diffs |
| **R2 CI dual-run** | `0` for default test runs; `1` enabled in a dedicated CI lane | CI only | Both lanes green; benchmark deltas captured; rollback test (set flag to `0` after running with `1`) passes |
| **R3 Canary opt-in** | `0` by default; one named canary environment runs `1` | canary env only | QA approval; parity evidence over a measured observation window; rollback drill executed |
| **R4 Default on** | `1` is the new default; `0` remains a supported override | broad rollout | Release approval (Trading also requires Trading Safety + board approval per its contract) |

A module may sit at any phase indefinitely. Demotion (e.g., R3 -> R0) is always allowed without a new ADR if parity, performance, or safety evidence breaks.

### Test obligations while the flag exists

For every module currently behind a flag, the test suite must contain:

- a legacy-path test set that runs with the flag forced to `0`
- a Rust-path test set that runs with the flag forced to `1` for the slice currently routed through Rust
- at least one "fallback after Rust write" test for `store_core`, proving a JSONL file written under `1` is readable under `0`
- a parity test against the relevant golden fixture set (`analysis-core`, `trading-core`, `store-core`)

The test runner must surface which flag value produced a failure. CI failures must distinguish "legacy regression" from "Rust regression."

### Documentation obligations

Every Phase 2+ implementation issue must:

- restate the flag name, default, and accepted values in the issue body
- record the exact commands used to run the legacy lane, the Rust lane, and the rollback test
- update the module contract checklist when its parity or rollback evidence changes

### Rollback contract

If the Rust path causes a regression at any rollout phase:

1. Set the relevant flag to `0`.
2. Confirm legacy path handles the affected workflow end-to-end.
3. Preserve the failing fixture, command output, and any benchmark or operational evidence.
4. File a focused remediation issue.
5. Do not advance to a later rollout phase until the regression is resolved or the phase is formally descoped via a new ADR.

For `trading_core`, rollback evidence must additionally satisfy the Trading Safety review gate before the next staged enablement.

## Consequences

- All three module contracts already align with this policy; no contract edits are required by ADR-002 beyond the metadata normalization performed in [OPE-13](/OPE/issues/OPE-13).
- The Adapter & Tooling Engineer must wire flag plumbing once and reuse it for all three modules; per-module re-implementation is not permitted.
- CI gains at minimum one additional lane per active Rust module (R2 dual-run). Capacity planning must account for this before any module reaches R2.
- Operators get a single deterministic recovery action per module: "set `OPENALICE_RUST_<MODULE>=0` and restart." This is the entire emergency procedure.
- Default-on rollout (R4) is governed by release approvals (and Trading Safety / board approval where the contract demands it), not by this ADR.

## Rejected alternatives

- **Aggregate flag (e.g., `OPENALICE_USE_RUST=0|1`).** Rejected. Couples module rollout timelines and prevents per-module rollback. Operationally unsafe.
- **Permissive parsing (`true`, `false`, `on`, etc.).** Rejected. Increases surface for misconfiguration; strict `0|1` is unambiguous and matches the OPE-4 clarification.
- **Sub-flags or comma-separated routing (`OPENALICE_RUST_ANALYSIS=parser,evaluator`).** Rejected. Adds combinatorial complexity for no operational gain. If granular routing is ever needed, it requires a new ADR.
- **Build-time `cfg` flags only.** Rejected. Build-time toggles cannot be flipped operationally without a redeploy and break the rollback contract.
- **Database/feature service for flag state.** Rejected. Adds runtime dependency to a control path that must work offline. Environment variable is sufficient.

## Approval requirement

This ADR is **planning-only**. It authorizes no source code edits. Implementation work that wires flag plumbing happens under a future Adapter & Tooling Engineer issue with its own allowed-file list, gates, and review.
