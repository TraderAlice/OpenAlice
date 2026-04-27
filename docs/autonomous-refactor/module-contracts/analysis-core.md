# Analysis Core Module Contract

## Contract metadata

- Module ID: `analysis_core`
- Status: canonical Phase 1 contract; architecture approved
- Approval evidence: human architecture review on Paperclip issue [OPE-3](/OPE/issues/OPE-3) recorded at 2026-04-27T09:50:19Z accepting this file as the canonical Phase 1 `analysis_core` contract. No source edits are authorized by this approval alone.
- Reader: the Analysis Engineer, Architecture Lead, QA & Benchmark Engineer, and future agents implementing or reviewing analysis-core migration work.
- Post-read action: open a scoped implementation issue for `analysis_core`, verify that its allowed-file list matches this contract, and implement or review the first Rust migration slice without changing OpenAlice's outer tool behavior.
- Canonical sources:
  - `docs/autonomous-refactor/PAPERCLIP_OPENALICE_RUST_REFACTOR_PLAYBOOK.md`
  - `docs/autonomous-refactor/openalice-rust-refactor.manifest.yaml`
  - `docs/autonomous-refactor/reports/baseline/phase-1-baseline-report.md`

This contract defines the boundary for the planned Rust `analysis_core` migration. It does not authorize source code edits by itself. Every implementation issue must restate its exact allowed files before editing and must pass the approval gates listed below.

## Module purpose

`analysis_core` owns deterministic analysis and thinking-domain computation that can be migrated from TypeScript to Rust while preserving the existing OpenAlice tool surface.

The module is responsible for:

- formula tokenization, parsing, validation, and evaluation
- deterministic analysis kernels, including rolling-window indicator calculations
- cross-asset or multi-series calculations that are pure computation
- deterministic thinking-domain calculations that can be represented through stable DTOs
- legacy-compatible validation failures for unsupported or invalid expressions

The module is not responsible for orchestration, provider calls, UI behavior, connector behavior, or broad tool schema redesign.

## Current OpenAlice boundary

Implementation issues for this module may target only these OpenAlice areas when the issue explicitly allows them:

- `src/domain/analysis/`
- `src/domain/thinking/`
- `src/tool/analysis.ts`
- `src/tool/thinking.ts`

The tool files are integration shims only. They may route to the legacy TypeScript path or the Rust-backed path, but they must not become a place for new domain behavior or schema churn.

## Planned Rust boundary

The planned Rust implementation must live under:

- `crates/analysis-core/`
- `packages/node-bindings/analysis-core/`

The Rust crate owns deterministic kernels. The Node binding owns the TypeScript-facing DTO bridge. TypeScript remains the outer orchestration shell during the migration.

## Out of scope

The following areas are outside the `analysis_core` contract unless a later architecture-approved issue explicitly changes the boundary:

- UI surfaces and visual behavior
- connectors, network adapters, and market-data provider integrations
- AI provider integrations and prompt orchestration
- broad edits under `src/tool/` beyond thin analysis/thinking shims
- trading, storage, session, event-log, news archive, and symbol-index behavior
- cross-module cleanup, formatting-only churn, or speculative refactors
- changing external tool schemas, command names, or workflow semantics
- making the Rust path default-on

## Public DTO and tool-surface expectations

OpenAlice's existing TypeScript tool surface is the public contract for this migration.

Implementation work must preserve:

- tool names and registration behavior
- input field names, required/optional status, and validation semantics
- output field names, shapes, and success/error distinction
- invalid-expression rejection behavior
- observable error categories and user-facing error meaning
- ordering and cardinality of returned series, tables, or calculated values
- default behavior when no Rust feature flag is enabled

The Rust binding must expose DTO-based interfaces that are easy for TypeScript to validate and test:

- inputs and outputs must be JSON-compatible or explicitly converted at the binding boundary
- nullable, missing, and invalid numeric values must have documented handling
- date/time, symbol, interval, and series identifiers must not be reinterpreted silently
- Rust-specific errors must be normalized before crossing into the TypeScript tool surface
- any intentional output normalization must be approved by Architecture and covered by parity fixtures

The first implementation slice should freeze the current public calculation entry points and capture golden fixtures before porting internals.

## Parity expectations

The Rust-backed path must preserve current TypeScript behavior for supported analysis and thinking calculations.

Required parity areas:

- formula tokenization and parsing
- expression validation and invalid-expression rejection
- AST or equivalent evaluation behavior
- rolling-window indicator outputs
- cross-series alignment behavior
- empty, short, sparse, or malformed input handling
- NaN, infinity, null, missing, and divide-by-zero behavior where the legacy path defines it
- output ordering and stable serialization through the tool shims
- no TypeScript tool schema changes

Numeric parity is exact unless the legacy behavior depends on floating-point accumulation order. If an implementation needs tolerance-based comparison, the issue must document the tolerance, justify it, add fixtures that prove the difference is operationally insignificant, and get Architecture plus QA approval before review.

## Feature flag expectation

The Rust-backed path must be guarded by:

```text
OPENALICE_RUST_ANALYSIS=0|1
```

Rules:

- default is off in shared environments until release approval
- unset, `0`, or invalid values must use the legacy TypeScript path
- `1` may route eligible deterministic calculations through Rust
- tests must exercise both the legacy and Rust paths where practical
- fallback to the TypeScript path must not require code changes
- any default-on rollout requires release approval after parity and benchmark evidence is recorded

## Required tests

Every implementation issue must run the smallest useful baseline before editing and the full required acceptance set before review. The issue must record exact commands and summarized results.

Required test layers:

| Layer | Required coverage |
| --- | --- |
| TypeScript baseline | Existing analysis and thinking tests must remain green with the feature flag off. |
| Rust unit tests | Parser, evaluator, indicator kernels, validation, and edge-case numeric handling. |
| Binding tests | DTO conversion, error normalization, nullable values, and invalid input handling. |
| Parity tests | Legacy TypeScript path versus Rust path against golden fixtures. |
| Tool schema tests | Prove `src/tool/analysis.ts` and `src/tool/thinking.ts` retain their external schemas. |
| Feature-flag tests | Off path uses legacy TypeScript; on path uses Rust for eligible deterministic work; fallback is verified. |
| Property or invariant tests | Numeric and series invariants where fixed fixtures are too narrow. |
| End-to-end smoke tests | Tool-facing workflows that exercise analysis/thinking behavior without requiring unrelated module rewrites. |

Minimum command set for implementation review:

```bash
pnpm build
pnpm test
cargo test --workspace
cargo fmt --all --check
cargo clippy --workspace -- -D warnings
```

Run `pnpm test:e2e` when the implementation touches user-facing tool workflows or when requested by QA. The Phase 1 baseline currently records a trading lifecycle e2e failure caused by numeric/string expectation mismatches; that is not an analysis-core blocker, but full release readiness must account for any remaining repository-wide e2e failures.

## Benchmark plan and targets

Benchmarks must compare the legacy TypeScript path against the Rust-backed path using the same fixtures, process conditions, and command environment.

Required benchmark scenarios:

- formula evaluation speed for representative simple, nested, and invalid expressions
- rolling-window indicator speed for small, medium, and large OHLCV-style series
- cross-series calculation speed for aligned and partially missing input series
- binding overhead for DTO conversion across the TypeScript/Rust boundary
- cold-start or first-call overhead if the binding has measurable initialization cost

Minimum benchmark reporting fields:

- command executed
- machine/runtime metadata, including Node, pnpm, Rust, and operating system versions
- fixture sizes and iteration counts
- median, p95, and worst observed duration where practical
- memory or allocation notes when available
- comparison against the legacy TypeScript baseline

Targets:

- The Rust-backed path must not regress median runtime by more than 10% for small fixtures unless Architecture and QA explicitly approve the tradeoff.
- Medium and large formula/indicator workloads should show a measurable improvement over the TypeScript baseline.
- Binding overhead must be reported separately so small-workload regressions are not hidden inside aggregate numbers.
- No benchmark can justify a public behavior change without an approved contract update.

## Approval gates before code edits

The following gates apply to `analysis_core`:

1. Architecture approval is required before the first source code edit for this module or before changing the binding strategy.
2. Integration approval is required before any TypeScript tool path calls into Rust.
3. QA approval is required before review if parity fixtures, benchmark evidence, or feature-flag fallback tests are incomplete or inconclusive.
4. Release approval is required before enabling the Rust path by default in any shared environment.

Any issue that changes public tool behavior, error semantics, DTO shape, or benchmark acceptance thresholds must update this contract and receive Architecture approval before implementation continues.

## Rollback path

Rollback must be fast and boring:

1. Set `OPENALICE_RUST_ANALYSIS=0` or unset it.
2. Confirm the TypeScript legacy path handles the affected workflow.
3. Preserve the failing fixture, command output, and benchmark evidence.
4. Revert only the smallest integration slice if disabling the feature flag is insufficient.
5. Keep the module contract and test fixtures updated with the failure mode before resuming migration work.

Rollback is not complete until the issue comment records the failing command, the restored command result, and whether any follow-up remediation is required.

## First future implementation issue

Name: `analysis_core: freeze public calculation entry points and capture golden fixtures`

Purpose:

- identify the existing analysis/thinking calculation entry points
- capture representative valid, invalid, edge-case, and performance fixtures
- add or update tests that lock the legacy TypeScript behavior with the Rust flag off
- leave the Rust implementation untouched until the fixture baseline is reviewed

This issue should be assigned only after Architecture accepts this contract and the allowed-file list is written explicitly in the issue body.
