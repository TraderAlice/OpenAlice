# analysis_core - Rust Parser Parity Slice

- Issue: [OPE-16](/OPE/issues/OPE-16)
- Type: port (parser-only Rust slice)
- Owner: CTO / Program Orchestrator (executor for this run)
- Date: 2026-04-28
- Feature flag: `OPENALICE_RUST_ANALYSIS=0|1` (default `0`)
- Related: [analysis-core contract](../../module-contracts/analysis-core.md), [ADR-001](../../adr/ADR-001-rust-boundary.md), [ADR-002](../../adr/ADR-002-feature-flag-policy.md), [ADR-003](../../adr/ADR-003-binding-strategy.md), [entry-point parity harness](./entrypoint-parity-harness.md), [adapter bootstrap report](../adapter-bootstrap/analysis-core-rust-toolchain-bootstrap.md)

## Outcome

Phase 2 first parity slice for `analysis_core` is **landed at the parser
boundary**. The Rust crate at `crates/analysis-core/` now contains a
faithful port of `IndicatorCalculator.parse`; the binding crate at
`packages/node-bindings/analysis-core/` exposes that parser to Node via
a CLI fallback shell; and `src/domain/analysis/indicator/calculator.ts`
routes parsing to the Rust parser only when
`OPENALICE_RUST_ANALYSIS=1`. With the flag at `0` (default, unset, or
any non-`1` value) the legacy in-process TypeScript parser remains the
only path executed.

No evaluator, data-access, statistics, technical, thinking, trading, or
store code was ported. No tool-schema files were touched. No native
`.node` artifact is committed.

## Working directory

- `pwd`: `/Users/opcw05/newtest/001/OpenAlice`
- `git rev-parse --show-toplevel`: `/Users/opcw05/newtest/001/OpenAlice`
- Branch at start: `master`
- Latest commit at start: `4e8f1d9 chore: align bootstrap shells to repo license + ASCII style (OPE-15)`
- Toolchain (post-source `~/.cargo/env`):

```text
rustc 1.95.0 (59807616e 2026-04-14)
cargo 1.95.0 (f2d3ce0bd 2026-03-21)
node v25.9.0
pnpm 9.15.4
```

## Files changed

All edits stay within OPE-16's allowed-files list.

| File | Kind | Change |
| --- | --- | --- |
| `crates/analysis-core/Cargo.toml` | M | Adds `serde` (parser DTO) and `serde_json` dev-dep (parser tests). |
| `crates/analysis-core/src/lib.rs` | M | Re-exports `parse`, `AstNode`, `ParseError`; keeps `bootstrap_healthcheck`. |
| `crates/analysis-core/src/parser.rs` | A | Recursive-descent parser + AST DTO + 25 unit tests. |
| `packages/node-bindings/analysis-core/Cargo.toml` | M | Adds the `analysis-core-parse` binary, plus `serde`/`serde_json` deps. |
| `packages/node-bindings/analysis-core/src/lib.rs` | M | Re-exports parser surface alongside the existing healthcheck. |
| `packages/node-bindings/analysis-core/src/bin/analysis_core_parse.rs` | A | CLI fallback binary (stdin -> JSON envelope on stdout). |
| `packages/node-bindings/analysis-core/index.js` | M | ESM module; spawns the binary via `child_process.spawnSync`; robust workspace-root resolution. |
| `packages/node-bindings/analysis-core/index.d.ts` | M | Adds `AstNode` discriminated-union and `parseFormulaSync` declaration. |
| `packages/node-bindings/analysis-core/package.json` | M | `"type": "module"` + cargo build scripts; updated smoke-test command. |
| `src/domain/analysis/indicator/calculator.ts` | M | Strict flag parser + parser-only routing shim (binding consumer). |
| `src/domain/analysis/__test__/rust-parser-parity.spec.ts` | A | Pins `OPENALICE_RUST_ANALYSIS=1` and re-runs the indicator-calculator fixture cases against the Rust parser path. |
| `Cargo.lock` | M | Regenerated for the new serde / serde_json crates. |
| `docs/autonomous-refactor/reports/analysis-core/rust-parser-parity-slice.md` | A | This report. |

`src/domain/analysis/indicator/types.ts` was reviewed but did not need
edits: the existing `ASTNode` discriminated union already matches the
DTO shape the Rust parser emits, so the legacy evaluator consumes the
Rust AST without any type adjustment.

`pnpm-lock.yaml` is unchanged. No npm dependencies were added; the
binding remains a workspace package consumed by `src/` via a relative
path import.

## Parser parity decisions

- **AST DTO shape.** The Rust `AstNode` enum uses
  `#[serde(tag = "type")]` with explicit `#[serde(rename = ...)]`
  variants so the JSON discriminator matches the legacy
  `'number'`/`'string'`/`'function'`/`'binaryOp'`/`'arrayAccess'`
  values byte-for-byte. The TypeScript evaluator switches on
  `node.type`, so the Rust DTO drops in without adapter code.
- **Operator carrier.** `BinaryOp.operator` is serialized as a single
  `"+|-|*|/"` string, exactly mirroring the legacy `BinaryOpNode.operator`
  literal type.
- **Number normalization.** The Rust parser emits `f64` values (`10.0`,
  `-1.0`); `JSON.parse` normalizes these back to JavaScript `number`
  (`10`, `-1`) on the TS side, matching legacy `parseFloat` results.
- **Error messages.** All parser-relevant error strings are preserved
  1:1 with the legacy parser:
  - `Expected ')' at position N`
  - `Expected ']' at position N`
  - `Unterminated string at position N`
  - `Unexpected character 'X' at position N` (and the trailing-token
    variant `... Expected end of expression.`)
  - `Unknown identifier 'X' at position N`
- **Position semantics.** The Rust parser uses a `Vec<char>` cursor and
  emits the same character offsets the legacy parser emits for each
  message. The parity fixture `indicator-missing-closing-paren-error`
  (expected message `Expected ')' at position 26`) is locked by both
  the Rust unit suite and the new TS parity spec.

### Compatibility notes (parser only)

- **Numeric literal multiple-dot compatibility.** The legacy parser
  consumes all consecutive digit / dot characters and then runs the
  accumulated string through `parseFloat`, so formulas such as `1.2.3`
  evaluate as `1.2` and `1..2` evaluates as `1`. The Rust parser now
  preserves that legacy prefix behavior for finite numeric values; the
  Rust unit suite locks both cases.
- **Identifier without call.** Bare identifiers (e.g. `AAPL`) raise
  `Unknown identifier 'AAPL' at position 4` in the Rust parser, matching
  the legacy parser. No fixture currently asserts this exact message;
  the new Rust unit suite locks it as a regression-prevention boundary.

No parser divergences were observed by the cross-spec runs.

## Binding strategy

The OPE-16 issue authorizes the Adapter & Tooling team to "document the
blocker and keep any fallback test shell explicit" if a real `napi-rs`
binding cannot land within the allowed-files / dependency-churn budget
of this slice. That is the path taken.

### Why napi-rs is deferred

Landing the `napi-rs` bridge described in
[ADR-003](../../adr/ADR-003-binding-strategy.md) inside this slice
would require all of:

- adding `napi`, `napi-derive`, and `napi-build` Rust dependencies and
  changing `[lib] crate-type = ["rlib"]` to `["cdylib"]`;
- adding `@napi-rs/cli` and a postinstall build hook to the binding's
  `package.json`, which lives outside the allowed-files list for the
  root `package.json` / dependency machinery;
- introducing a multi-host platform `.node` build matrix with no
  current root-level CI scaffolding to support it;
- treating prebuilt binaries as out-of-scope per ADR-003 while still
  needing the binding to load on developer machines and CI.

Each of those items is "broad package/dependency churn" by the
issue's own gating language, so the napi-rs route is recorded here as a
known follow-up rather than executed in this slice.

### CLI fallback shell (this slice)

In place of the napi-rs bridge, the binding crate ships a small Rust
binary, `analysis-core-parse`, defined under
`packages/node-bindings/analysis-core/src/bin/analysis_core_parse.rs`.
The binary:

- reads the formula text from stdin;
- invokes `analysis_core::parse`;
- emits exactly one line of JSON to stdout - either
  `{ "ok": true, "ast": <AstNode> }` or
  `{ "ok": false, "message": <string>, "position": <number> }`;
- supports `--healthcheck` for parity with the existing
  `bootstrap_healthcheck` smoke test.

`packages/node-bindings/analysis-core/index.js` exposes a single
synchronous entry point - `parseFormulaSync(formula: string): AstNode`
- that locates the binary under the Cargo workspace's `target/release`
or `target/debug` directory and shells out via
`child_process.spawnSync`. If the binary is missing, the module
attempts a one-off `cargo build` from the resolved workspace root; if
that still fails it raises a clear error pointing at the explicit
build command. Workspace-root resolution accepts an
`OPENALICE_ANALYSIS_CORE_REPO_ROOT` override and walks up from
`process.cwd()` looking for `Cargo.toml` + `Cargo.lock`/`target/` so
that a bundled production build does not lose track of the binary.

The binding remains a stable JS package surface: when the napi-rs
bridge does land, `parseFormulaSync` can be reimplemented over the
in-process binding without any caller change in
`src/domain/analysis/indicator/calculator.ts`.

### Performance posture

Spawn-per-call CLI shelling is fine for parser-only workloads in
`R0`/`R1` rollout phases, where the flag is off in shared environments
and developer / CI runs trade native-call overhead for build-pipeline
simplicity. Benchmarks vs. the legacy in-process parser are
intentionally out of scope for this slice; they belong to the
napi-rs hardening issue along with binding overhead measurement.

## Feature flag plumbing

Per [ADR-002](../../adr/ADR-002-feature-flag-policy.md), the parser
shim in `src/domain/analysis/indicator/calculator.ts` reads
`process.env.OPENALICE_RUST_ANALYSIS` and routes to the Rust parser
only when the trimmed value equals the literal string `"1"`. Every
other state - unset, empty string, `"0"`, `"true"`, `"yes"`, garbled
values - falls through to the legacy in-process TypeScript parser.
Resolution happens at call time, but each call is independent, so
process-level resolution semantics from ADR-002 hold (no flip-mid-
request behavior because every call is its own check). The TS
evaluator remains authoritative regardless of flag state.

The flag does not change tool names, input schemas, output schemas,
precision behavior, dataRange semantics, or error surfaces.

## Tests

### Rust unit tests (parser)

`crates/analysis-core/src/parser.rs` ships 26 parser unit tests covering:

- integer, decimal, negative, and legacy multiple-dot numeric literals
  (incl. `-.5`, `1.2.3`, and `1..2`)
- single- and double-quoted string literals
- arithmetic precedence (`+`/`-` vs. `*`/`/`)
- parenthesized and nested-parenthesized expressions
- function calls with no args / multiple args / nested calls
- array access with positive, negative, and expression indices
- whitespace tolerance
- left-associative chained subtraction
- the full legacy error matrix (missing `)`, missing `]`,
  unterminated string, unknown identifier, unexpected trailing token,
  bare `-` without numeric continuation, unknown leading character)
- camelCase JSON discriminator tags for compound nodes (regression
  guard for the TS evaluator handoff)

A 27th test (the inherited `bootstrap_healthcheck`) lives at the crate
root. The binding crate retains 2 tests (healthcheck + parser
re-export). Total: **29 Rust tests; all pass.**

### TypeScript parity tests

- `src/domain/analysis/__test__/legacy-parity.spec.ts` (existing) -
  pins `OPENALICE_RUST_ANALYSIS=0` and exercises every
  indicator-calculator and analysis-tool-shim case from
  `legacy-calculation-fixtures.json`.
- `src/domain/analysis/__test__/rust-parser-parity.spec.ts` (new) -
  pins `OPENALICE_RUST_ANALYSIS=1`, pre-builds the
  `analysis-core-parse` binary in `beforeAll`, and re-runs every
  indicator-calculator case against the Rust parser path. The
  tool-shim cases stay in the legacy-parity spec because their
  normalization is parser-agnostic and lives in
  `src/tool/analysis.ts`, which is intentionally untouched in this
  slice.

The new spec is the "parser parity" obligation of the issue acceptance
criteria: it proves that on the legacy fixture set, output values and
error messages produced by the Rust parser + TS evaluator are
identical to those produced by the legacy TS parser + TS evaluator.

### Verification commands

```text
$ rustc --version
rustc 1.95.0 (59807616e 2026-04-14)

$ cargo --version
cargo 1.95.0 (f2d3ce0bd 2026-03-21)

$ node -v
v25.9.0

$ pnpm -v
9.15.4

$ cargo metadata --no-deps --format-version 1 >/dev/null
(exit 0)

$ cargo fmt --all --check
(exit 0)

$ cargo clippy --workspace -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.03s

$ cargo test --workspace
test result: ok. 27 passed; 0 failed; ...   (analysis_core lib unit tests)
test result: ok.  2 passed; 0 failed; ...   (analysis_core_node_binding lib)
test result: ok.  0 passed; 0 failed; ...   (binary suite has no in-source tests)
(no doctests; all suites green)

$ OPENALICE_RUST_ANALYSIS=0 pnpm test -- src/domain/analysis src/domain/thinking
Test Files  5 passed (5)
Tests       129 passed (129)

$ OPENALICE_RUST_ANALYSIS=1 pnpm test -- src/domain/analysis
Test Files  3 passed (3)
Tests       105 passed (105)

$ pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
Already up to date

$ pnpm build
ESM Build success in 56ms
DTS Build success in 3027ms

$ pnpm test
Test Files  59 passed (59)
Tests       1162 passed (1162)

$ pnpm test:e2e
Test Files  12 passed (12)
Tests       23 passed | 58 skipped (81)

$ npx tsc --noEmit
(no output, exit 0)
```

`pnpm test:e2e` mirrors the existing baseline (23 passed / 58 skipped
exactly as recorded in the OPE-15 bootstrap report). No e2e regressions
attributable to this slice.

## Allowed-files compliance

Every modified or created path is inside the OPE-16 allowed list:

- `crates/analysis-core/**` (parser code + Cargo manifest)
- `packages/node-bindings/analysis-core/**` (binary, JS/TS shim,
  package metadata, Cargo manifest, lib re-exports)
- `Cargo.toml` (no diff this run; only crate-level `Cargo.toml`s
  changed)
- `Cargo.lock` (regenerated)
- `pnpm-lock.yaml` (unchanged - no new pnpm deps)
- `pnpm-workspace.yaml` (unchanged)
- `src/domain/analysis/indicator/calculator.ts` (parser-selection
  shim only; no new domain behavior)
- `src/domain/analysis/indicator/types.ts` (unchanged - reviewed but
  not edited)
- `src/domain/analysis/__test__/**` (new Rust parity spec)
- `src/domain/analysis/indicator/**/*.spec.ts` (unchanged)
- `docs/autonomous-refactor/reports/analysis-core/**` (this report)
- `docs/autonomous-refactor/module-contracts/analysis-core.md` (unchanged)

`src/tool/analysis.ts`, `src/tool/thinking.ts`, evaluator helpers
(`src/domain/analysis/indicator/functions/**`), thinking
(`src/domain/thinking/**`), trading, store, and CI config files are
not modified.

## Rollback contract

Per ADR-002 and the analysis_core contract, rollback is
"set the flag and restart":

1. Set `OPENALICE_RUST_ANALYSIS=0` (or unset it; or any non-`"1"`
   value).
2. Restart the OpenAlice process. The shim re-reads the env var on
   every call, so even hot reuse of an existing process picks up the
   change.
3. Confirm the legacy in-process TypeScript parser handles the
   workflow.

If a deeper rollback is required, revert this issue's commit. The
legacy TypeScript parser/evaluator remains intact and tested by the
preserved unit and parity specs.

## Recommendation for the next analysis_core slice

Among the three options the issue lists - evaluator planning, parser
gap fix, or binding hardening - **binding hardening (napi-rs)** is the
recommended next slice. Rationale:

- The parser parity slice has shipped with no parser gaps observed
  against the existing fixture set; another parser-fix slice is
  unnecessary today.
- The CLI fallback shell is functionally correct but operationally
  unfit for a default-on rollout: spawn-per-call overhead, no
  panic-boundary enforcement, and no platform binary distribution
  story. Promoting the parser path beyond R1 (developer opt-in) is
  blocked on the in-process napi-rs bridge.
- Evaluator porting remains a larger, more numerically sensitive
  effort. It should follow binding hardening so that benchmark
  evidence (binding overhead vs. evaluator improvement) is measured
  on the production binding shape, not against the CLI fallback.

The napi-rs hardening issue should also bring with it the deferred
`.gitignore` follow-up flagged in the OPE-15 bootstrap report
(`target/` ignore at the repo root) and the binding-overhead benchmark
fixtures the analysis-core contract expects.
