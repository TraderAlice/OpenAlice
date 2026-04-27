# ADR-001: Rust Boundary for the OpenAlice Refactor

- Status: Accepted (planning-only; no source code authorized by this ADR)
- Date: 2026-04-28
- Authors: CTO / Program Orchestrator (drafting); Architecture Lead (review owner)
- Supersedes: none
- Related: [Playbook section 2 / section 10](../PAPERCLIP_OPENALICE_RUST_REFACTOR_PLAYBOOK.md), `docs/autonomous-refactor/openalice-rust-refactor.manifest.yaml`, [OPE-3](/OPE/issues/OPE-3), [OPE-4](/OPE/issues/OPE-4), [OPE-5](/OPE/issues/OPE-5)

## Context

OpenAlice is a TypeScript/Node application with three distinct architectural layers:

1. **Outer orchestration shell** - UI, connectors, AI providers, broker SDK adapters, tool registry. I/O- and SDK-heavy. Changes frequently.
2. **Domain logic** - analysis kernels, trading-as-git semantics, append-only persistence, archive search. Largely deterministic, performance-sensitive, correctness-critical.
3. **Cross-cutting integration** - `src/tool/*` shims, `src/core/tool-center.ts`, session and event-log wiring.

Phase 1 captured baseline tests, golden fixtures, benchmark results, and three module contracts ([analysis_core](../module-contracts/analysis-core.md), [trading_core](../module-contracts/trading-core.md), [store_core](../module-contracts/store-core.md)). Each contract names a planned Rust crate and Node binding path but does not yet authorize implementation. Phase 2 needs an explicit, written boundary decision so every implementation issue can verify scope before editing.

## Decision

The OpenAlice Rust refactor moves **only deterministic, correctness-critical domain internals** into Rust. The outer orchestration shell remains TypeScript-first for the entire program.

### In-scope Rust modules (Phase 2 onward)

| Module ID | Owning crate | Owning Node binding | OpenAlice surfaces |
| --- | --- | --- | --- |
| `analysis_core` | `crates/analysis-core/` | `packages/node-bindings/analysis-core/` | `src/domain/analysis/`, `src/domain/thinking/`, thin shims at `src/tool/analysis.ts`, `src/tool/thinking.ts` |
| `trading_core` | `crates/trading-core/` | `packages/node-bindings/trading-core/` | `src/domain/trading/git/`, `src/domain/trading/guards/`, `src/domain/trading/snapshot/`, deterministic/accounting helpers in `src/domain/trading/account-manager.ts` |
| `store_core` | `crates/store-core/` | `packages/node-bindings/store-core/` | `src/core/event-log.ts`, `src/core/session.ts`, deterministic persistence/search portions of `src/domain/news/` |

### Out of scope for the program

These layers stay TypeScript and are **not** rewritten in Rust by any in-scope Phase 2-5 issue:

- `ui/`
- `src/connectors/`
- `src/ai-providers/`
- `src/tool/` beyond thin integration shims for in-scope modules
- `src/domain/trading/brokers/` (broker SDK adapters)
- `src/openclaw/` (frozen)
- `src/core/agent-center.ts`, `src/core/ai-provider-manager.ts`, `src/core/tool-center.ts`
- broad market-data network adapters

### Boundary rules

1. **One issue = one module boundary.** A Rust issue may modify exactly one in-scope crate, its binding package, and the smallest TypeScript shim wiring required by the module's contract. Cross-module Rust changes require a new ADR.
2. **TypeScript stays the outer shell.** The Rust crate must not own connectors, broker SDKs, AI providers, UI, or tool registration. The Node binding exposes JSON-compatible DTOs only.
3. **Public tool/CLI/connector surface is frozen by default.** Tool names, registration behavior, input/output field names, error categories, and serialized commit history must be preserved unless an issue-scoped ADR explicitly approves a normalization.
4. **Allowed file lists are mandatory and verified.** Every Rust implementation issue restates its allowed paths in the issue body and is rejected at review if any edit lands outside that list.
5. **No speculative cross-module cleanup.** Formatting, refactor, or "while we're here" edits outside an issue's allowed paths are out of scope.
6. **Symbol Index is deferred** (`symbol_index`, manifest priority 4) until Phases 2-5 are stable and an explicit ADR opens the boundary.

### Layered responsibilities inside an in-scope module

```
TypeScript orchestration shell
        |
        v
  src/tool/<module>.ts (thin integration shim, JSON in/out)
        |
        v
  src/domain/<module>/* (TypeScript adapter + legacy fallback)
        |
        v
  packages/node-bindings/<module>/ (Node-API DTO bridge, error normalization)
        |
        v
  crates/<module>/ (deterministic Rust kernels, no I/O, no SDK calls)
```

Rust may not call broker SDKs, AI providers, network APIs, or UI surfaces directly. Any required external interaction stays in TypeScript.

## Consequences

- Implementation issues for Phases 2, 3, and 4 can be authored against a single, named scope without re-litigating boundaries.
- Reviewers can reject any diff that touches files outside the issue's allowed list, regardless of how attractive the cleanup looks.
- The Rust workspace stays small and focused: three crates and three Node-binding packages are the only Rust units permitted by this ADR.
- Future expansion (e.g., `symbol_index`, additional broker logic) requires a new ADR and a new module contract; it is **not** implicitly authorized by this decision.
- Outer-shell evolution (new tools, new connectors, new AI providers) remains a TypeScript-only concern and does not require Rust review.

## Rejected alternatives

- **Full rewrite of OpenAlice into Rust.** Rejected. The orchestration shell, AI provider integrations, broker SDKs, and UI are not high-leverage Rust targets and would explode scope.
- **Rust at the tool surface (replace `src/tool/*`).** Rejected. Tool registration, schema validation, and AI provider integration are dynamic, schema-driven, and TypeScript-native; rewriting them gains no determinism payoff and breaks the public contract.
- **Rust inside broker adapters.** Rejected. Broker SDKs are vendor-specific TypeScript/Node libraries; wrapping them via FFI adds risk without changing observable behavior.
- **One mega-crate (`openalice-core`) covering all domains.** Rejected. Couples analysis, trading, and storage release timelines and prevents per-module rollback via independent feature flags.

## Approval requirement

This ADR is **planning-only**. It authorizes no source code edits. Each Phase 2+ implementation issue must still satisfy the gates defined in [ADR-002](./ADR-002-feature-flag-policy.md), [ADR-003](./ADR-003-binding-strategy.md), and the relevant module contract before any crate or binding edit lands.
