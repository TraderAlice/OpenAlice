# analysis_core: Rust arithmetic-only evaluator slice (OPE-18)

- Status: shipped
- Issue: [OPE-18](/OPE/issues/OPE-18)
- Builds on: [OPE-17 napi-binding-hardening](./napi-binding-hardening.md), [OPE-16 rust-parser-parity-slice](./rust-parser-parity-slice.md), [OPE-15 entrypoint-parity-harness](./entrypoint-parity-harness.md)
- ADRs: [ADR-001 rust-boundary](../../adr/ADR-001-rust-boundary.md), [ADR-002 feature-flag-policy](../../adr/ADR-002-feature-flag-policy.md), [ADR-003 binding-strategy](../../adr/ADR-003-binding-strategy.md)
- Manifest: [openalice-rust-refactor.manifest.yaml](../../openalice-rust-refactor.manifest.yaml)

## Summary

OPE-16/OPE-17 ported the analysis_core formula parser to Rust and put it
behind an in-process napi-rs bridge. The TypeScript evaluator stayed
authoritative — every `OPENALICE_RUST_ANALYSIS=1` call paid the binding
cost (~1.5 µs FFI + JSON envelope round-trip) on top of the legacy JS
evaluator, which is why the OPE-17 benchmark showed `napi-parse` running
roughly 2× slower than the pure-TS path on small formulas.

OPE-18 ports the smallest useful evaluator slice into Rust:
**arithmetic-only** formulas — numeric literals and binary `+ - * /`
between numbers. Anything else (strings, function calls, array access,
data-access, statistics, technical indicators) stays on the
authoritative TypeScript evaluator via the OPE-16/OPE-17 Rust-parser +
TS-evaluator route. The new path keeps the AST inside Rust between
parse and evaluate, returns a single `f64` across the binding, and
amortizes the FFI cost over the full computation.

The legacy default is unchanged: `OPENALICE_RUST_ANALYSIS=0`, unset, or
any other value still routes the entire calculation through the legacy
TypeScript parser + evaluator. The flag remains a strict `0|1` switch
per [ADR-002](../../adr/ADR-002-feature-flag-policy.md).

## Scope

In scope:
- Rust arithmetic-only evaluator over the existing `AstNode` shape:
  numeric literals and `binaryOp` with `+ - * /`.
- Whole-tree authority check: any non-arithmetic node anywhere in the
  AST returns `Unsupported` *before* any Rust evaluation runs, so we
  never half-evaluate a tree the TS evaluator owns.
- Division-by-zero parity (`Division by zero`, verbatim).
- Synchronous JSON-compatible binding entry point
  (`evaluateFormulaToJson` / `evaluateFormulaSync`) with four explicit
  envelope shapes: arithmetic value, unsupported (with AST), parse
  error, evaluate error.
- Routing in `src/domain/analysis/indicator/calculator.ts`:
  arithmetic-only formulas evaluate in Rust; non-arithmetic formulas
  consume the AST returned by the binding directly so we don't re-parse
  the formula on the fallback path.
- Evaluator parity tests (`rust-evaluator-parity.spec.ts`) covering
  arithmetic success, custom precision, division by zero, fallback to
  the legacy TS evaluator for data-access/indicator formulas, and
  fallback error parity.
- New evaluator-overhead benchmark
  (`scripts/evaluator-overhead-bench.mjs`).

Out of scope (deferred):
- Statistics, technical indicators, data access (CLOSE/HIGH/LOW/OPEN/
  VOLUME), or array literals.
- `src/tool/analysis.ts` and `src/tool/thinking.ts` changes.
- Any default-on rollout. `OPENALICE_RUST_ANALYSIS=0` remains the
  legacy default.
- Native-object AST optimization (still a JSON envelope across the
  evaluate boundary; it's now a 64-bit number on the success path
  instead of an AST tree, which is the immediate win).
- CLI fallback for the evaluator slice — the OPE-16 binary still
  exposes only the parser surface.
- Cross-platform pre-built `.node` distribution.

## Implementation

### Rust side

`crates/analysis-core/src/evaluator.rs` (new)
- `pub enum EvalOutcome { Value(f64), Error(EvalError), Unsupported }`.
- `pub fn evaluate_arithmetic_only(&AstNode) -> EvalOutcome`.
- Whole-tree gate: `is_arithmetic_only` walks the AST; only after it
  certifies every node as arithmetic does `eval_pure_arithmetic` run.
  The non-arithmetic branches in `eval_pure_arithmetic` are
  `unreachable!` since the gate would have returned `Unsupported`
  first.
- `EvalError::new("Division by zero")` is the only runtime-error path
  this slice produces; the message is parity-locked with the legacy
  TypeScript evaluator's `throw new Error('Division by zero')`.
- Twelve unit tests cover literal parity (integer, decimal, negative),
  precedence, parens, nested negative arithmetic, division-by-zero,
  unsupported strings/functions/array-access, function-inside-arithmetic,
  and the "unsupported takes priority over arithmetic eval errors"
  contract that lets the TS evaluator own full evaluation semantics for
  any tree it would otherwise inherit.

`crates/analysis-core/src/lib.rs`
- Exports the new module and re-exports `evaluate_arithmetic_only`,
  `EvalError`, `EvalOutcome`. Crate-level docstring updated to reflect
  the OPE-18 slice.

### Binding crate

`packages/node-bindings/analysis-core/src/lib.rs`
- New `evaluateFormulaToJson(formula)` napi entry point. Wrapped in
  the same `catch_unwind_quiet` panic boundary as `parseFormulaToJson`
  so panics surface as `RustPanicError` (`code = INTERNAL_RUST_PANIC`).
- New `build_evaluate_envelope` helper produces one of:
  - `{ "ok": true, "kind": "value", "value": <f64> }`
  - `{ "ok": true, "kind": "unsupported", "ast": <AstNode> }`
  - `{ "ok": false, "error": { "kind": "parse", "message": ...,
    "position": ... } }`
  - `{ "ok": false, "error": { "kind": "evaluate", "message":
    "Division by zero" } }`
- Four new Rust unit tests lock those four envelope shapes.

### TypeScript wrapper

`packages/node-bindings/analysis-core/index.js`
- New `BindingEvaluateError` (`name: 'BindingEvaluateError'`,
  `code: 'ANALYSIS_CORE_EVALUATE_ERROR'`).
- New `decodeEvaluateEnvelope` and `callNativeEvaluate` helpers parse
  the new envelope and surface typed errors.
- New `evaluateFormulaSync(formula)` returns either
  `{ kind: 'value', value: number }` or
  `{ kind: 'unsupported', ast: AstNode }`. Throws `BindingParseError`
  on parse failure and `BindingEvaluateError` on arithmetic-only
  runtime errors. The CLI fallback is intentionally not wired here —
  the OPE-16 binary exposes only the parser surface.
- Required-export check now includes `evaluateFormulaToJson`.

`packages/node-bindings/analysis-core/index.d.ts`
- Adds `BindingEvaluateError`, `EvaluateOutcome`, and
  `evaluateFormulaSync` declarations.

### Calculator routing

`src/domain/analysis/indicator/calculator.ts`
- Imports `evaluateFormulaSync` instead of `parseFormulaSync` for the
  Rust path. With `OPENALICE_RUST_ANALYSIS=1`:
  - arithmetic-only formulas return `{ kind: 'value', value }` and skip
    the entire TS evaluator; the existing precision wrapper applies and
    `dataRange` is naturally empty.
  - non-arithmetic formulas return `{ kind: 'unsupported', ast }` and
    we hand `ast` straight to the legacy `this.evaluate(ast)` so we
    never re-parse the formula on the fallback path.
- With the flag unset/`0`/invalid, behaviour is byte-identical to the
  legacy TypeScript parser + evaluator path. `shouldUseRustParser()`
  is unchanged.

### Tests

`src/domain/analysis/__test__/rust-evaluator-parity.spec.ts` (new)
- Arithmetic parity for six formulas across both flag values
  (`2 + 3 * 4`, `(2 + 3) * 4`, `10 / 3` default and precision=2,
  `((1 - -2) * 3) + (-4 / -2)`, `-5 + 2 * -3`); asserts byte-equal
  output and empty `dataRange`.
- Division-by-zero parity: legacy `Division by zero` message holds
  under flag=0 and flag=1.
- Routing assertion: arithmetic-only `2 + 2` returns 4 with empty
  `dataRange`, immediately followed by `CLOSE('AAPL','1d')[-1]` which
  populates `dataRange` correctly — proving routing is decided per-call
  and the arithmetic call did not corrupt calculator state.
- Parse-error parity under flag=1 preserves
  `Unexpected character ')' at position 6. Expected end of expression.`
- Fallback parity for `CLOSE(...)[-1]`,
  `SMA(CLOSE('AAPL','1d'),10)`, and the production-shape price-deviation
  formula across both flags.
- Fallback error parity for the bare-string formula and the unknown-
  function formula.

The OPE-16 parser parity spec (`rust-parser-parity.spec.ts`) and the
OPE-17 binding-boundary spec (`rust-binding-boundaries.spec.ts`) were
not modified and remain green; they continue to lock the
`parseFormulaSync` + typed-error surface.

## Verification

All gating commands from the OPE-18 issue body run clean on
`darwin/arm64`, Node `v25.9.0`, Rust `1.95.0`:

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | clean (no lockfile changes) |
| `cargo metadata --no-deps --format-version 1` | clean |
| `cargo fmt --all --check` | clean |
| `cargo clippy --workspace -- -D warnings` | clean |
| `cargo test --workspace` | 50 unit tests pass (40 in `analysis-core`, 10 in the binding) |
| `node packages/node-bindings/analysis-core/scripts/build-native.mjs` | clean |
| `OPENALICE_RUST_ANALYSIS=0 pnpm test -- src/domain/analysis src/domain/thinking` | 152 tests pass |
| `OPENALICE_RUST_ANALYSIS=1 pnpm test -- src/domain/analysis` | 128 tests pass |
| `pnpm build` | success |
| `pnpm test` | full suite green |
| `npx tsc --noEmit` | clean |

The binding-boundary spec deliberately panics inside Rust to exercise
the `RustPanicError` boundary; both the parse and evaluate entry points
share the same `catch_unwind_quiet` wrapper, so the panic-safety
contract carries over to `evaluateFormulaToJson` automatically.

## Benchmark evidence

Captured with
`node packages/node-bindings/analysis-core/scripts/evaluator-overhead-bench.mjs`
on `darwin/arm64`, Node `v25.9.0`, release-profile binding
(`OPENALICE_NAPI_PROFILE=release node ... build-native.mjs`),
`--iterations 5000 --warmup 500`. Times are per-call microseconds (µs);
all three labels run a full *parse + evaluate* of an arithmetic-only
formula:

- `ts`: in-process TypeScript parse + JS arithmetic evaluator (mirror
  of `IndicatorCalculator`).
- `napi-parse`: OPE-17 path — Rust parser via napi-rs (AST JSON
  envelope) + TypeScript arithmetic evaluator.
- `napi-eval`: OPE-18 path — Rust parser + Rust arithmetic evaluator
  via `evaluateFormulaSync` (returns a `number` directly).

| formula | label | mean | p50 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `1 + 2` | ts         | 0.460 | 0.292 | 0.541 | 1.292 | 0.250 | 204.375 |
| `1 + 2` | napi-parse | 1.773 | 1.750 | 1.834 | 1.958 | 1.583 | 89.458  |
| `1 + 2` | napi-eval  | 0.679 | 0.667 | 0.709 | 0.792 | 0.583 | 4.042   |
| `(2 + 3) * 4` | ts         | 0.688 | 0.542 | 1.125 | 1.667 | 0.500 | 99.541  |
| `(2 + 3) * 4` | napi-parse | 2.445 | 2.375 | 2.625 | 3.084 | 2.166 | 100.541 |
| `(2 + 3) * 4` | napi-eval  | 0.741 | 0.750 | 0.792 | 0.833 | 0.666 | 5.459   |
| `((1 - -2) * 3) + (-4 / -2)` | ts         | 1.226 | 1.125 | 1.292 | 1.542 | 1.000 | 65.500  |
| `((1 - -2) * 3) + (-4 / -2)` | napi-parse | 4.073 | 3.834 | 4.333 | 4.667 | 3.625 | 163.958 |
| `((1 - -2) * 3) + (-4 / -2)` | napi-eval  | 0.942 | 0.958 | 1.000 | 1.042 | 0.833 | 9.250   |
| `10 / 3` | ts         | 0.277 | 0.250 | 0.333 | 0.375 | 0.166 | 74.458  |
| `10 / 3` | napi-parse | 1.537 | 1.500 | 1.667 | 1.958 | 1.416 | 105.792 |
| `10 / 3` | napi-eval  | 0.611 | 0.625 | 0.667 | 0.709 | 0.541 | 0.833   |

### Reading the numbers

- **OPE-18 amortizes the OPE-17 binding overhead.** `napi-eval` is
  consistently ~2.5–4× faster than `napi-parse` for the same formula
  (e.g. on `1 + 2`: 0.68 vs 1.77 µs; on `((1 - -2) * 3) + (-4 / -2)`:
  0.94 vs 4.07 µs). Keeping the AST inside Rust between parse and
  evaluate eliminates the JSON-envelope round-trip and the JS-side AST
  walk on the success path. **This is the primary OPE-18 win.**
- **napi-eval crosses over the in-process TS path on nontrivial
  arithmetic.** On `((1 - -2) * 3) + (-4 / -2)`, `napi-eval` (0.94 µs)
  is faster than `ts` (1.23 µs). On `1 + 2` it stays slightly behind
  `ts` (0.68 vs 0.46 µs) because per-call FFI of ~0.5 µs is in the same
  order as the work itself.
- **`napi-parse` stays a regression for arithmetic-only inputs**, as
  expected from OPE-17. That's why the OPE-18 routing skips it
  entirely on arithmetic-only formulas and only falls back to the
  Rust-parser + TS-evaluator path when the AST contains nodes only the
  TypeScript evaluator can evaluate. For those non-arithmetic trees
  the per-call cost is dominated by data-fetching and indicator math
  rather than the parser, so the OPE-17 overhead is not the dominant
  term anyway.
- The exact crossover formula size is hardware-dependent; the
  benchmark script accepts `--formula "..."` so future evaluator slices
  (statistics/indicators) can re-run it against their target shapes
  without rebuilding the bench.

### Reproducing

```bash
OPENALICE_NAPI_PROFILE=release node packages/node-bindings/analysis-core/scripts/build-native.mjs
node packages/node-bindings/analysis-core/scripts/evaluator-overhead-bench.mjs \
  --iterations 5000 --warmup 500 --out report.json
```

`scripts/binding-overhead-bench.mjs` from OPE-17 still works for
parser-only timings; OPE-18 added a separate evaluator-overhead bench
because the success-path call shape (no AST returned across the
boundary) is materially different from the parser benchmark.

## Risks + follow-ups

- **Non-arithmetic fallback still pays the OPE-17 binding cost.** When
  the binding returns `unsupported`, it has parsed the formula in Rust
  and serialized the AST as JSON; the TypeScript evaluator then walks
  it. That's the same per-call shape as OPE-17 and the same trade-off
  applies (the parser FFI cost is dominated by data-fetching/indicator
  math on the formulas that actually need it). **Follow-up:** when the
  next evaluator slice ports indicator math into Rust, keep the AST
  inside Rust for that slice too so the binding cost stays amortized.
- **Arithmetic-only is a small surface.** The Rust evaluator currently
  handles only literals and binary `+ - * /`. Any future change to the
  arithmetic semantics (e.g. unary minus as an operator, modulus,
  exponent) requires updating both the Rust evaluator and the
  parity-locked legacy fixtures. **Follow-up:** none required today;
  the current parser does not produce those shapes and the slice is
  intentionally small.
- **`f64` exact-comparison for division-by-zero.** The Rust path
  detects `right == 0.0`; positive-zero, negative-zero, and `0.0 / 0.0`
  all classify as the legacy "Division by zero" case (matching JS's
  `right === 0` check). **Follow-up:** none; the parity test locks
  this and the legacy evaluator behaves the same.

## Acceptance checklist

- [x] Rust crate exposes an arithmetic-only evaluator for the existing
      `AstNode` shape.
- [x] Binding exposes a synchronous JSON-compatible evaluation entry
      point (`evaluateFormulaToJson` / `evaluateFormulaSync`) with four
      explicit envelope shapes.
- [x] `OPENALICE_RUST_ANALYSIS=1` routes arithmetic-only formulas
      through Rust parse+evaluate.
- [x] Non-arithmetic formulas remain on the existing Rust-parser +
      TypeScript-evaluator path and preserve fixture outputs/errors.
- [x] `OPENALICE_RUST_ANALYSIS` unset/`0`/invalid stays entirely on the
      legacy TypeScript path.
- [x] Arithmetic parity tests cover `2 + 3 * 4`, `(2 + 3) * 4`,
      `10 / 3` with default and custom precision, `10 / 0` with exact
      `Division by zero` message, and a nested expression with
      negative numbers.
- [x] Fallback parity tests cover at least one data-access formula and
      one indicator formula from the golden fixtures.
- [x] Existing parser parity and binding-boundary tests remain green.
- [x] Benchmark report records whether Rust parse+evaluate amortizes
      OPE-17 binding overhead for arithmetic-only formulas (it does:
      ~2.5–4× faster than `napi-parse` across the four bench formulas).
- [x] No tool schema, DTO, dataRange, or public error surface changes.
- [x] No out-of-scope files modified.
- [x] No `target/`, `.node`, or other generated artifacts staged.
