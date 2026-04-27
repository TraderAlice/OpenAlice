# Phase 2 Planning Kickoff

## Metadata

- Issue: [OPE-13](/OPE/issues/OPE-13) Phase 2 planning kickoff and ADR scaffolding
- Scope: planning/doc-only; no Rust implementation
- Allowed write surface (this issue): `docs/autonomous-refactor/adr/**`, `docs/autonomous-refactor/reports/phase-2-planning/**`, `docs/autonomous-refactor/module-contracts/analysis-core.md`, `docs/autonomous-refactor/module-contracts/trading-core.md`
- Author: CTO / Program Orchestrator
- Plan date (UTC): 2026-04-28
- Resolved working directory (`pwd`): `/Users/opcw05/newtest/001/OpenAlice`
- Git root (`git rev-parse --show-toplevel`): `/Users/opcw05/newtest/001/OpenAlice`
- Git commit at planning start (`git rev-parse HEAD`): `c077382461b92dd713530f77988bf9a8855e6448`
- Branch: `master`
- Working tree status before this issue: clean (`git status --short` empty)
- Node version: `v25.9.0`
- pnpm version: `9.15.4`
- Playbook read: `docs/autonomous-refactor/PAPERCLIP_OPENALICE_RUST_REFACTOR_PLAYBOOK.md`
- Manifest read: `docs/autonomous-refactor/openalice-rust-refactor.manifest.yaml`
- Closeout read: `docs/autonomous-refactor/reports/phase-1-closeout/phase-1-closeout-and-phase-2-readiness.md`

## Headline

**Phase 2 implementation may not start yet.** This issue produces only ADR scaffolding, contract metadata normalization, and a Phase 2 planning report. Implementation activation is gated on (1) review of this planning issue and (2) completion of the Adapter & Rust toolchain bootstrap issue named below.

## Phase 1 Closeout Dependency Check

| Dependency | Source | Status |
| --- | --- | --- |
| Phase 1 closeout report exists | `docs/autonomous-refactor/reports/phase-1-closeout/phase-1-closeout-and-phase-2-readiness.md` | OK present |
| Phase 1 closeout headline recommendation | "Go for Phase 2 planning." | OK green |
| `pnpm test` baseline at closeout | 56 files, 1097 passed at `b4e9020` | OK green |
| `pnpm test:e2e` baseline at closeout | 12 files, 23 passed / 58 skipped / 0 failed at `b4e9020` | OK green |
| Trading e2e numeric/string blocker | resolved at `a427f9f` | OK closed |
| `analysis_core` golden fixtures | `docs/autonomous-refactor/fixtures/analysis-core/legacy-calculation-fixtures.json` (38 cases) | OK present |
| `trading_core` golden fixtures | `stage-commit-push.fixture.json`, `guard-outcomes.fixture.json`, `snapshot-accounting-precision.fixture.json` | OK present |
| `store_core` golden fixtures | event-log, session, news JSONL bundles | OK present |
| Phase 1 benchmark baseline | `docs/autonomous-refactor/reports/benchmarks/phase-1-baseline-benchmark-results.json` + writeup | OK present |
| Module contract: `analysis_core` | `docs/autonomous-refactor/module-contracts/analysis-core.md` | OK approved (OPE-3) |
| Module contract: `trading_core` | `docs/autonomous-refactor/module-contracts/trading-core.md` | OK approved (OPE-4) |
| Module contract: `store_core` | `docs/autonomous-refactor/module-contracts/store-core.md` | OK approved (OPE-5) |
| OPE-12 (Phase 1 closeout issue) | Paperclip status `done` | OK done |

All required Phase 1 closeout artifacts are present at the planning commit. No rollback condition triggered.

## ADRs Authored in This Issue

| ADR | Path | Summary | Status |
| --- | --- | --- | --- |
| ADR-001 | `docs/autonomous-refactor/adr/ADR-001-rust-boundary.md` | Names the three in-scope Rust modules (`analysis_core`, `trading_core`, `store_core`), keeps the outer TypeScript shell off-limits, makes per-issue allowed-file lists mandatory, defers `symbol_index` | Accepted (planning-only) |
| ADR-002 | `docs/autonomous-refactor/adr/ADR-002-feature-flag-policy.md` | Pins `OPENALICE_RUST_<MODULE>=0|1` strict parsing, default-off in shared environments, per-module isolation, the R0-R4 rollout phases, dual-lane CI, and a single-step rollback contract | Accepted (planning-only) |
| ADR-003 | `docs/autonomous-refactor/adr/ADR-003-binding-strategy.md` | Default to in-process Node-API bindings via `napi-rs`; `crates/<module>/` (pure Rust) + `packages/node-bindings/<module>/` (Node-API bridge); JSON-compatible DTOs; trading money/quantity remain strings; panics convert to `INTERNAL_RUST_PANIC` | Accepted (planning-only) |

None of these ADRs authorize source code edits. Each implementation issue must still satisfy module-contract gates and the relevant rollout phase from ADR-002.

## Module Contract Metadata Normalization

This issue normalized only the metadata block at the top of two contract files. Module boundaries, allowed implementation paths, scope rules, parity requirements, and rollback content were not modified.

| File | Edit type | Before -> After (status line) | Approval evidence |
| --- | --- | --- | --- |
| `docs/autonomous-refactor/module-contracts/analysis-core.md` | metadata only | `contract draft for architecture review` -> `canonical Phase 1 contract; architecture approved` (with explicit OPE-3 timestamp) | OPE-3 comment by `local-board` at 2026-04-27T09:50:19Z accepting this file as the canonical Phase 1 `analysis_core` contract |
| `docs/autonomous-refactor/module-contracts/trading-core.md` | metadata only | `contract captured; Rust implementation not started` -> `canonical Phase 1 contract; architecture approved; Rust implementation not started` (with explicit OPE-4 timestamps) | OPE-4 comment by `local-board` at 2026-04-27T10:09:08Z accepting this file as the canonical Phase 1 `trading_core` contract; OPE-4 follow-up at 2026-04-27T10:34:09Z confirming `OPENALICE_RUST_TRADING_CORE=0|1` semantics |
| `docs/autonomous-refactor/module-contracts/store-core.md` | not modified | already says `canonical Phase 1 contract; architecture approved` | OPE-5 architecture approval already stamped in commit `a664216` |

No edits were made to module boundary lists, allowed implementation paths, parity expectations, or feature-flag rules in either file.

## Phase 2 Gate Checklist Before Implementation

Each item must be true (or formally waived by a new ADR / approval) before the first Phase 2 implementation issue activates.

- [x] Phase 1 closeout report exists and is green
- [x] All three module contracts approved (`analysis_core`, `trading_core`, `store_core`)
- [x] `analysis_core`, `trading_core`, `store_core` golden fixtures captured
- [x] Phase 1 benchmark baseline captured
- [x] Trading e2e numeric/string blocker resolved
- [x] ADR-001 Rust boundary authored (this issue)
- [x] ADR-002 feature flag policy authored (this issue)
- [x] ADR-003 binding strategy authored (this issue)
- [x] Analysis/trading contract metadata normalized to match OPE-3/OPE-4 approvals (this issue)
- [ ] **Architecture review of this planning issue recorded on Paperclip**
- [ ] **Adapter & Rust toolchain bootstrap issue completed and integration-approved** (covers `rustc`/`cargo` install, `provision_command` end-to-end pass, `crates/` and `packages/node-bindings/` workspace shells, CI lanes for `cargo fmt --check` and `cargo clippy -D warnings`)
- [ ] First Phase 2 implementation issue authored with explicit allowed-file list, the relevant flag at `R0` default, and parity test set against `legacy-calculation-fixtures.json`

The two unchecked operational items are the gate. They are not authorized by this planning issue; they require their own scoped issues.

## First Three Recommended Phase 2 Issues

These are recommendations only. This issue does **not** create or assign any of them. Each requires explicit human approval and issue creation before work begins. The first item below (architecture review) is satisfied implicitly when this issue's review records pass; the remaining two are the operational unblockers.

### 1. `analysis_core: freeze public calculation entry points and capture parity harness` *(prep, not implementation)*

- Type: `qa` / `module-contract`
- Owner: Analysis Engineer (QA & Benchmark Engineer co-reviews)
- Depends on: review approval of [OPE-13](/OPE/issues/OPE-13)
- Scope: enumerate the existing analysis/thinking calculation entry points; cross-check that `legacy-calculation-fixtures.json` covers each entry point class; add a TypeScript-only test that locks the legacy path with `OPENALICE_RUST_ANALYSIS=0`; document any uncovered cases as fixture follow-ups; do not author Rust code.
- Allowed files: tests under `src/domain/analysis/__test__/` and `src/domain/thinking/__test__/`, fixture additions under `docs/autonomous-refactor/fixtures/analysis-core/`, the analysis-core contract checklist, a short report under `docs/autonomous-refactor/reports/analysis-core/`. No edits to `src/tool/`, no schema changes, no Rust paths.
- Exit gate: QA approval that the legacy parity harness is sufficient to validate a Rust port.

### 2. `Adapter & Rust toolchain bootstrap` *(adapter/tooling prep)*

- Type: `adapter`
- Owner: Adapter & Tooling Engineer
- Depends on: items above + an operator decision on Rust toolchain pin
- Scope: install and pin `rustc`/`cargo` in the project worktree provisioner; verify the manifest's `provision_command` (`pnpm install && cargo metadata --no-deps >/dev/null`) runs end-to-end on a clean checkout; create empty `crates/` Cargo workspace and `packages/node-bindings/` package shells that compile to no-op libraries (no domain code, no DTOs); wire `cargo fmt --all --check` and `cargo clippy --workspace -- -D warnings` into the agreed CI surface; confirm OpenAlice's existing `pnpm build`, `pnpm test`, and `pnpm test:e2e` remain green with the toolchain installed.
- Allowed files: `Cargo.toml`, `crates/**` shell files only (lib.rs stubs), `packages/node-bindings/**` shell files only, CI/scripts touchpoints listed in the issue body. No edits to `src/`, no edits to existing tests beyond CI wiring.
- Exit gate: integration review approval; full `pnpm test`, `pnpm test:e2e`, `cargo fmt --check`, `cargo clippy` pass on a clean checkout; rollback documented (revert the bootstrap commit).

### 3. `analysis_core: first Rust parity slice - formula tokenizer + parser` *(implementation, contingent on items 1 and 2 passing)*

- Type: `port` (analysis_core)
- Owner: Analysis Engineer
- Depends on: items 1 and 2 done and integration-approved
- Scope: smallest testable Rust slice that re-implements formula tokenization and parsing in `crates/analysis-core/`; expose a Node-API entry point in `packages/node-bindings/analysis-core/` that returns parser output as a JSON-compatible DTO; wire the TypeScript adapter behind `OPENALICE_RUST_ANALYSIS=0|1` (default `0`); add Rust unit tests, binding tests, and parity tests against `legacy-calculation-fixtures.json` for parser cases; do not port the evaluator in this issue.
- Allowed files: `crates/analysis-core/**`, `packages/node-bindings/analysis-core/**`, the smallest possible shim wiring under `src/domain/analysis/` and `src/tool/analysis.ts`. No schema changes; no edits to `src/domain/thinking/` beyond shared types if absolutely required; no edits to other modules.
- Exit gate: architecture + integration approvals; all parity fixtures match for parser cases; legacy path remains the default; rollback (set `OPENALICE_RUST_ANALYSIS=0`) verified by test.

If items 1 or 2 surface unexpected blockers (Rust toolchain availability, adapter incompatibility, fixture gaps, ADR rework), item 3 must remain unassigned until those blockers clear.

## No Rust Implementation Was Started

This issue wrote no Rust code, created no crates, generated no Node bindings, modified no source files, modified no tests, modified no package manifests or lockfiles, and modified no CI configuration. The only writes performed by this issue are:

- `docs/autonomous-refactor/adr/ADR-001-rust-boundary.md` (new)
- `docs/autonomous-refactor/adr/ADR-002-feature-flag-policy.md` (new)
- `docs/autonomous-refactor/adr/ADR-003-binding-strategy.md` (new)
- `docs/autonomous-refactor/reports/phase-2-planning/phase-2-planning-kickoff.md` (this file, new)
- `docs/autonomous-refactor/module-contracts/analysis-core.md` (metadata-only normalization)
- `docs/autonomous-refactor/module-contracts/trading-core.md` (metadata-only normalization)

No new Paperclip issues were created or assigned by this issue.

## May Phase 2 Implementation Start?

**No, not yet.** Phase 2 implementation may start only after:

1. this planning issue is reviewed and approved on Paperclip, and
2. the Adapter & Rust toolchain bootstrap issue (recommendation 2 above) completes and is integration-approved.

Until both gates close, no `crates/`, `packages/node-bindings/`, `Cargo.toml`, or Rust source file may be authored by any agent.
