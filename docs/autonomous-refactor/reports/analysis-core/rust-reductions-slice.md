# OPE-19 — Rust finite-`number[]` reductions slice

Status: implemented, behind `OPENALICE_RUST_ANALYSIS=1`. Default
(`unset` / `0` / invalid) remains the legacy TypeScript reductions per
ADR-002.

## Scope (locked)

In Rust now:

- `MIN(number[])`, `MAX(number[])`, `SUM(number[])`, `AVERAGE(number[])`
  on a finite `&[f64]` produced by the legacy TypeScript `toValues(...)`
  helper. Empty-array semantics are parity-locked:
  - `MIN([])`     → `Error("MIN requires at least 1 data point")`
  - `MAX([])`     → `Error("MAX requires at least 1 data point")`
  - `AVERAGE([])` → `Error("AVERAGE requires at least 1 data point")`
  - `SUM([])`     → `0` (mirrors `[].reduce((a, v) => a + v, 0)`).
- Non-finite arrays (`NaN`, `+/-Infinity`) come back as
  `{ kind: 'unsupported' }` and the JS shim falls back to the legacy
  TypeScript reduction. The JS wrapper pre-screens for these so they
  never enter the JSON envelope (which cannot encode them); the Rust
  kernel also screens defensively, so a pre-screen bypass cannot land
  non-finite values inside the kernel.

Still TypeScript:

- `toValues(...)`, `TrackedValues`, `dataRange` metadata, data-fetching
  (`CLOSE` / `HIGH` / `LOW` / `OPEN` / `VOLUME`), the formula grammar /
  parser routing (already covered by OPE-16 / OPE-17 / OPE-18),
  rolling-window indicators (`SMA`, `EMA`), `STDEV`, technical
  indicators (`RSI`, `BBANDS`, `MACD`, `ATR`), all tool surfaces and
  DTOs.

## Architecture

```
+----------------------+   +-----------------------------+   +-----------------+
| statistics.ts (TS)   |-->| reduceNumbersSync (JS shim) |-->| Rust kernel     |
| MIN/MAX/SUM/AVERAGE  |   | packages/node-bindings/...  |   | crates/.../     |
| (after toValues)     |   | analysis-core/index.js      |   | reductions.rs   |
+----------------------+   +-----------------------------+   +-----------------+
        ^                              ^
        | flag=0/unset/invalid: stay TS| flag=1: route through Rust;
        |                              | non-finite or unexpected envelope
        |                              | falls back silently to TS.
        +------------------------------+
```

- `crates/analysis-core/src/reductions.rs`: `ReductionKind`,
  `ReductionOutcome::{Value(f64), Error(ReductionError), Unsupported}`,
  and the `reduce(kind, values)` entry point. Sequential left-to-right
  `f64` addition for `SUM`/`AVERAGE`; first-element-wins scan with `<` /
  `>` for `MIN`/`MAX` (matches `Math.min(...v)` / `Math.max(...v)` on
  finite input). Reduction kernel tests cover the empty-array branches,
  the `NaN` / `+/-Infinity` `Unsupported` branch, single-element arrays,
  and a poison-ordering input where reordered addition would diverge
  bit-wise so the left-to-right contract is exercised under floating
  point loss.
- `packages/node-bindings/analysis-core/src/lib.rs`:
  `reduceNumbersToJson(kind, values: Float64Array) -> String` returns a
  JSON envelope (`value` / `unsupported` / `reduce` error / `argument`
  error). Panics inside the kernel are still caught at the napi-rs
  boundary and re-emitted as `INTERNAL_RUST_PANIC: ...` per ADR-003 §
  "Failure isolation".
- `packages/node-bindings/analysis-core/index.js` and `index.d.ts`:
  expose `reduceNumbersSync(kind, values)` returning
  `{ kind: 'value', value: number } | { kind: 'unsupported' }`. New
  typed JS errors `BindingReduceError` (legacy-format empty-array
  message) and `BindingArgumentError` (unknown kind / wrong shape).
- `src/domain/analysis/indicator/functions/statistics.ts`: `MIN` / `MAX`
  / `SUM` / `AVERAGE` consult `OPENALICE_RUST_ANALYSIS`; under flag=`1`
  they call the Rust reduction first and fall back to the legacy
  TypeScript path on `unsupported`. `SMA` / `EMA` / `STDEV` are
  unchanged (still TypeScript), as required by the issue scope.

## Parity contract

- `OPENALICE_RUST_ANALYSIS=0` / unset / `"true"` / `"yes"` / etc. → the
  four reductions are byte-identical to the legacy TypeScript reduction
  (verified by the existing parity test suite at `pnpm test`, all 1203
  tests green; specifically `src/domain/analysis/__test__/rust-reductions-parity.spec.ts`).
- `OPENALICE_RUST_ANALYSIS=1` → the four `IndicatorCalculator.calculate`
  outputs called out in the issue acceptance criteria match the
  flag-`0` outputs `value`-for-`value` and `dataRange`-for-`dataRange`
  on the linear OHLCV fixture:
  - `MAX(CLOSE('AAPL', '1d'))`
  - `MIN(CLOSE('AAPL', '1d'))`
  - `SUM(CLOSE('AAPL', '1d'))`
  - `AVERAGE(CLOSE('AAPL', '1d'))`
  - `MAX(CLOSE('AAPL', '1d')) - MIN(CLOSE('AAPL', '1d'))`
- Non-finite input: `[1, NaN, 3]` and `[1, +Infinity, 3]` produce
  identical observable output (per-reduction value + `dataRange`)
  under both flags because the JS shim falls back to the legacy
  TypeScript reduction on the `unsupported` envelope.

The OPE-16 / OPE-17 parser-binding tests, the OPE-18 evaluator parity
tests, and the legacy parity harness all still pass. No DTO, tool
schema, or public error surface changed.

## Verification

```
$ /Users/opcw05/.cargo/bin/cargo fmt --all --check
$ /Users/opcw05/.cargo/bin/cargo clippy --workspace -- -D warnings
$ /Users/opcw05/.cargo/bin/cargo test --workspace
   ... 54 passed in analysis-core, 16 passed in analysis-core-node-binding
$ node packages/node-bindings/analysis-core/scripts/build-native.mjs
$ OPENALICE_RUST_ANALYSIS=0 pnpm test -- src/domain/analysis  # 146 passed
$ OPENALICE_RUST_ANALYSIS=1 pnpm test -- src/domain/analysis  # 146 passed
$ pnpm build                                                  # clean
$ pnpm test                                                   # 1203 passed
$ npx tsc --noEmit                                            # clean
```

## Bench (honest)

Command:

```
$ OPENALICE_NAPI_PROFILE=release node packages/node-bindings/analysis-core/scripts/build-native.mjs
$ node packages/node-bindings/analysis-core/scripts/reductions-overhead-bench.mjs \
    --iterations 5000 --warmup 500 --out /tmp/reductions-bench-release.json
```

Hardware: `darwin/arm64`, Node `v25.9.0`, release-profile `analysis-core.node`.
Both paths consume a plain `number[]`; the `napi` row includes the JS
`number[] → Float64Array` copy that the production
`reduceNumbersSync` shim performs on every call. Mean / p50 in
microseconds per call:

| reduction | size | TS mean | TS p50 | napi mean | napi p50 |
|-----------|------|---------|--------|-----------|----------|
| MIN       |   16 |   0.160 |  0.083 |    0.976  |   0.875  |
| MAX       |   16 |   0.100 |  0.042 |    0.935  |   0.750  |
| SUM       |   16 |   0.175 |  0.125 |    0.781  |   0.750  |
| AVERAGE   |   16 |   0.134 |  0.125 |    0.798  |   0.750  |
| MIN       |  256 |   0.653 |  0.500 |    1.314  |   1.208  |
| MAX       |  256 |   0.547 |  0.458 |    1.425  |   1.209  |
| SUM       |  256 |   0.060 |  0.042 |    1.372  |   1.250  |
| AVERAGE   |  256 |   0.061 |  0.042 |    1.384  |   1.250  |
| MIN       | 4096 |   8.868 |  7.375 |    9.393  |   8.875  |
| MAX       | 4096 |   8.155 |  7.042 |    9.312  |   8.916  |
| SUM       | 4096 |   0.947 |  0.917 |    9.534  |   9.125  |
| AVERAGE   | 4096 |   0.949 |  0.917 |    9.545  |   9.084  |

Reading honestly: the Rust kernel itself is plenty fast, but the
combined per-call cost of the napi-rs FFI hop, JSON envelope encode /
decode, and the JS-array → `Float64Array` copy dominates these
reductions even at 4 K elements. V8 already inlines `Math.min(...)`,
`Math.max(...)`, and the `Array.reduce` over `+` very effectively, so
the Rust route does not beat the legacy TypeScript path on any of
these four reductions today. `MIN` / `MAX` close to a tie at size 4096
because `Math.min(...v)` / `Math.max(...v)` start to feel the
`apply`-style argument spread; the kernel still loses for `SUM` and
`AVERAGE`, where V8's monomorphic reduce loop is unbeatable for the
cost of the FFI hop.

This is the expected shape of the slice — the issue does not call for a
default-on rollout, and `OPENALICE_RUST_ANALYSIS=0` remains the
legacy default. The benefit of this slice is the **architectural
move**: it lands the JSON-typed-array binding shape that later slices
(rolling windows, technical indicators) will need, while the production
default remains the legacy reductions until a higher-arithmetic-density
slice lets the FFI cost amortize.

Debug-profile numbers (in `/tmp/reductions-bench.json`) were ~3-32 µs
per `napi` call, dominated by debug `serde_json` overhead. Numbers
above are release-profile only; all CI tests run against the debug
artifact and exercise correctness, not steady-state cost.

## Risks & rollback

- **No default-on rollout.** Production stays on the TypeScript path
  unless `OPENALICE_RUST_ANALYSIS=1` is set explicitly.
- **Runtime rollback.** Unset or set `OPENALICE_RUST_ANALYSIS=0` and the
  next call goes back to the legacy reductions. No code change needed.
- **Non-finite handling.** Documented and tested: any `NaN` /
  `+/-Infinity` element transparently falls back to the legacy
  reduction at the JS shim layer. Rust kernel unit tests still cover
  the `Unsupported` envelope so a pre-screen bypass cannot crash the
  kernel.
- **Binding shape.** The new `reduceNumbersToJson(kind, Float64Array)`
  entry point is additive; all existing entry points (`bootstrapHealthcheck`,
  `parseFormulaToJson`, `evaluateFormulaToJson`,
  `__triggerPanicForTest`) are unchanged. The JS surface adds
  `reduceNumbersSync`, `BindingReduceError`, and
  `BindingArgumentError` and leaves every other export alone.

## Next recommended issue

OPE-20 should pick up a **rolling-window** kernel slice (`SMA` and
`EMA` over `number[] | TrackedValues`). That slice has higher
per-call arithmetic density relative to the FFI cost (window size
multiplied by length), so it is the natural place for the Rust route
to actually start winning the bench while staying inside the
`number[]` boundary. `STDEV` would be a reasonable companion in the
same slice; technical indicators (`RSI`, `BBANDS`, `MACD`, `ATR`)
should still be deferred until rolling windows are stable.
