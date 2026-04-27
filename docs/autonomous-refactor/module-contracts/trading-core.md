# Trading Core Module Contract

## Contract metadata

- Module ID: `trading_core`
- Status: contract captured; Rust implementation not started
- Canonical path: `docs/autonomous-refactor/module-contracts/trading-core.md`
- Source playbook: `docs/autonomous-refactor/PAPERCLIP_OPENALICE_RUST_REFACTOR_PLAYBOOK.md`
- Source manifest: `docs/autonomous-refactor/openalice-rust-refactor.manifest.yaml`
- Baseline report: `docs/autonomous-refactor/reports/baseline/phase-1-baseline-report.md`

## Objective

Define the stable module boundary for the future Rust `trading_core` refactor. The
Rust path must preserve Trading-as-Git semantics, guard behavior, snapshot and
accounting precision, and the existing TypeScript-facing workflow while keeping
broker adapters and user-interface surfaces outside this module.

## Scope

### In-scope OpenAlice paths

- `src/domain/trading/git/`
- `src/domain/trading/guards/`
- `src/domain/trading/snapshot/`
- deterministic/accounting sections relevant to `src/domain/trading/account-manager.ts`

### Future Rust deliverable paths

- `crates/trading-core/`
- `packages/node-bindings/trading-core/`

### Explicitly excluded paths

- `src/domain/trading/brokers/`
- `src/connectors/`
- `ui/`

The excluded paths must not be rewritten as part of the `trading_core` migration.
Broker SDK plumbing, connector routes, and UI approval flows remain TypeScript
integration concerns.

## Public Behavior Rule

The public behavior rule for this module is:

`preserve_stage_commit_push_workflow`

The Rust implementation must preserve the outer Trading-as-Git workflow:

1. `stage` records intended trading operations without broker side effects.
2. `commit` creates an auditable decision record from staged operations after
   deterministic validation and guard evaluation.
3. `push` hands committed intent to the existing TypeScript broker layer without
   changing broker adapter contracts.

Any change that alters staging, commit history, guard outcomes, execution
semantics, snapshot math, or serialized commit compatibility requires explicit
approval under the review gates below.

## Canonical DTO Expectations

DTOs crossing the TypeScript/Rust boundary must be JSON-serializable, stable at
the TypeScript API boundary, and deterministic under round-trip serialization.
Rust-only types, binary encodings, and lossy conversions must not leak into the
existing OpenAlice public surface.

### Money

- Represents a monetary amount plus currency or asset code.
- Uses decimal-safe representation internally; binary floating-point arithmetic
  is not allowed for persisted or compared monetary values.
- Preserves the existing outward representation for each public field unless an
  ADR explicitly approves a normalized representation change.
- Records rounding mode where rounding is unavoidable.

### Quantity

- Represents trade size, position size, or asset quantity.
- Uses decimal-safe representation with instrument-appropriate scale.
- Preserves sign semantics for long, short, debit, and credit values.
- Rejects invalid values deterministically before commit.

### Order intent

- Captures the broker-agnostic intent required by the current staged workflow:
  symbol or instrument identity, side, quantity, order type, optional price
  constraints, time-in-force where supported, and client metadata needed for
  audit.
- Broker-specific payloads remain outside this module. The Rust core may carry
  opaque metadata only when it is already part of the current TypeScript boundary
  and round-trips without interpretation.

### Staged operation

- Captures a stable staged operation identifier, order intent, creation metadata,
  deterministic validation status, and guard inputs.
- Must be idempotent under re-read and replay.
- Must not perform broker I/O.

### Commit record

- Captures commit identity, parent or predecessor relationship when present,
  staged operation references, guard results, snapshot/accounting evidence,
  timestamp or logical sequence, and audit metadata.
- Serialized commit history must remain compatible at the outer API and storage
  boundary.
- Commit ordering and hashing/checksummed evidence must be deterministic.

### Guard result

- Captures guard rule identity, pass/fail result, severity, machine-readable
  reason code where available, human-readable explanation, and the deterministic
  inputs required to audit the decision.
- Guard failures must preserve current stop/continue semantics.
- New guard behavior is not allowed without ADR and trading safety approval.

### Snapshot summary

- Captures deterministic account state used by trading decisions: balances,
  positions, exposure, valuation currency, FX conversion inputs, realized or
  unrealized accounting values where currently present, and source sequence or
  timestamp.
- Must be replayable from the same inputs with identical results.
- Must not require broker adapter changes.

## Stage/Commit/Push Parity Requirements

- Preserve current valid and invalid stage outcomes.
- Preserve commit creation rules, commit ordering, conflict behavior, and
  idempotency.
- Preserve push preconditions and failure surfaces at the TypeScript boundary.
- Preserve serialized commit history compatibility.
- Ensure replay from existing staged operations and commit records produces the
  same visible state as the legacy TypeScript path.
- Keep broker execution in the existing TypeScript broker layer; Rust may return
  validated intent or execution plans but must not call broker SDKs directly.

## Guard Parity Requirements

- Preserve the existing guard registry surface, guard ordering, rule identity,
  pass/fail behavior, and rejection messages where those messages are part of the
  current testable contract.
- Treat max-position, cooldown, allowlist/denylist, and any existing registered
  trading guard as safety-critical behavior.
- Guard evaluation must be deterministic for the same staged operation, snapshot,
  account state, and clock/input fixture.
- Any intentionally improved guard behavior requires an ADR plus architecture,
  QA, trading safety, and board approval before default-on rollout.

## Snapshot and Accounting Requirements

- Preserve snapshot construction, snapshot summary semantics, and account-manager
  deterministic accounting behavior relevant to trading decisions.
- Preserve FX conversion semantics and source ordering for deterministic
  calculations.
- Preserve cash, position, exposure, and PnL semantics where currently exposed.
- Preserve error behavior for missing, stale, or inconsistent snapshot inputs.
- Do not introduce accounting behavior that depends on runtime iteration order,
  locale formatting, or non-deterministic clock reads.

## Precision Requirements

- No precision regression is allowed for money, quantity, FX, positions,
  exposure, or PnL.
- Persisted, compared, and guard-relevant numeric values must use decimal-safe
  representation.
- Numeric/string representation at the public TypeScript boundary must be
  fixture-backed before implementation. The baseline report currently records a
  trading e2e mismatch where numeric expectations received string payload values;
  future implementation work must resolve, document, or ADR-approve that
  representation before claiming parity.
- Rounding must be explicit, deterministic, and covered by golden fixtures.
- Legacy and Rust paths must produce identical serialized results for approved
  golden cases unless an approved ADR defines an intentional normalization.

## Feature Flag Expectation

- The Rust path must be guarded by `OPENALICE_RUST_TRADING_CORE=0|1`.
- Default behavior remains the legacy TypeScript path until parity, rollback,
  QA, trading safety, and release gates pass.
- The flag must be reversible without data migration.
- Tests must exercise both legacy and Rust paths while the flag exists.
- Rollout must support: disabled, opt-in/canary, staged enablement, and default
  on only after board-approved release.

## Required Approval Gates

- Architecture approval: required before the first code edit for the Rust
  trading-core crate, binding strategy, or DTO boundary.
- Integration approval: required before any TypeScript path calls into Rust.
- QA approval: required before relying on Rust parity for trading workflows.
- Trading safety approval: required for any change that can alter trade staging,
  guard logic, execution semantics, snapshot accounting, or precision behavior.
- Board approval: required before default-on rollout for any real-money behavior.

## Required Test and Evidence Matrix

Future implementation issues must provide evidence for:

- TypeScript contract tests comparing legacy and Rust behavior.
- Golden fixtures for stage, commit, push, guard, snapshot, accounting, and
  precision cases.
- Failure-mode tests for invalid DTOs, guard rejection, stale snapshots,
  precision edge cases, and rollback.
- Property or invariant tests for state transitions and numeric/accounting
  invariants where feasible.
- `pnpm build`
- `pnpm test`
- relevant trading e2e tests, including the lifecycle suite once the known
  baseline numeric/string mismatch is resolved or formally documented.
- Rust crate checks when the Rust crate exists:
  - `cargo test --workspace`
  - `cargo fmt --all --check`
  - `cargo clippy --workspace -- -D warnings`

## Rollback Plan

If the Rust migration causes parity failure, precision regression, performance
collapse, or operational instability:

1. Disable `OPENALICE_RUST_TRADING_CORE`.
2. Route all trading-core behavior back to the legacy TypeScript path.
3. Preserve the failing fixture, command output, and benchmark or regression
   evidence.
4. Keep broker adapters unchanged.
5. Do not continue later trading rollout steps until the failure is fixed,
   approved as an intentional behavior change, or the phase is formally
   descoped.

## Contract Checklist

- [x] Module ID is defined as `trading_core`.
- [x] In-scope and excluded paths are listed.
- [x] Stage/commit/push parity is required.
- [x] Guard parity is required.
- [x] Snapshot/accounting parity is required.
- [x] Precision requirements are explicit.
- [x] Feature-flag expectation is explicit.
- [x] Rollback plan is defined.
- [x] Extra review gates for trading changes are defined.
- [ ] Field-level DTO fixtures captured from the legacy TypeScript path.
- [ ] Known baseline trading lifecycle numeric/string mismatch resolved,
      documented, or ADR-approved.
- [ ] Rust implementation parity evidence attached.
