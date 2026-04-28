# OPE-20 — Rust rolling-window moving-average slice (`SMA` / `EMA`)

Status: implemented, behind `OPENALICE_RUST_ANALYSIS=1`. Default
(`unset` / `0` / invalid) remains the legacy TypeScript moving averages
per ADR-002.

## Scope (locked)

In Rust now:

- `SMA(values, period)` and `EMA(values, period)` over a finite `&[f64]`
  produced by the legacy TypeScript `toValues(...)` helper, plus a
  positive `usize` period.
  - `SMA` averages the trailing `period` values (sequential left-to-right
    `f64` addition divided by `period`).
  - `EMA` seeds from the SMA of the first `period` values, then applies
    `multiplier = 2 / (period + 1)` across the rest with the legacy
    recurrence `ema = (v[i] - ema) * multiplier + ema`.
  - Too-short input produces
    `Error("<KIND> requires at least <period> data points, got <len>")`,
    parity-locked with the legacy TS error verbatim.
- Non-finite arrays (`NaN`, `+/-Infinity`) come back as
  `{ kind: 'unsupported' }` and the JS shim falls back to the legacy
  TypeScript moving average. The JS wrapper pre-screens for these so
  they never enter the JSON envelope (which cannot encode them); the
  Rust kernel also screens defensively.
- A `period` that is not a positive safe integer (`0`, negative,
  fractional, `NaN`, `Infinity`, `> 2^32-1`) likewise comes back as
  `{ kind: 'unsupported' }`. We do not introduce new validation
  behavior in this slice — the legacy TS path handles whatever shape it
  always handled (Infinity / NaN propagation, etc.) under both flag
  values.

Still TypeScript:

- `toValues(...)`, `TrackedValues`, `dataRange` metadata, data-fetching
  (`CLOSE` / `HIGH` / `LOW` / `OPEN` / `VOLUME`), the formula grammar
  and parser routing (already covered by OPE-16 / OPE-17 / OPE-18),
  the four bare reductions (`MIN` / `MAX` / `SUM` / `AVERAGE`, OPE-19),
  `STDEV`, and every technical indicator (`RSI`, `BBANDS`, `MACD`,
  `ATR`).

## Architecture

```
+----------------------+   +-----------------------------+   +-----------------+
| statistics.ts (TS)   |-->| movingAverageSync (JS shim) |-->| Rust kernel     |
| SMA / EMA            |   | packages/node-bindings/...  |   | crates/.../     |
| (after toValues)     |   | analysis-core/index.js      |   | rolling.rs      |
+----------------------+   +-----------------------------+   +-----------------+
        ^                              ^
        | flag=0/unset/invalid: stay TS| flag=1: route through Rust;
        |                              | non-finite values, period=0,
        |                              | non-integer / non-positive
        |                              | period, or unexpected envelope
        |                              | falls back silently to TS.
        +------------------------------+
```

- `crates/analysis-core/src/rolling.rs`: `RollingKind`,
  `RollingOutcome::{Value(f64), Error(RollingError), Unsupported}`, and
  the `moving_average(kind, values, period)` entry point. SMA uses a
  trailing-window sum; EMA seeds from the SMA of the first window then
  applies the legacy recurrence sequentially. Kernel tests cover the
  too-short branches, the `NaN` / `+/-Infinity` `Unsupported` branch,
  the `period == 0` defensive `Unsupported` branch, single-element
  arrays at period 1, and a poison-ordering input where reordered
  addition would diverge bit-wise so the left-to-right contract is
  exercised under floating-point loss.
- `packages/node-bindings/analysis-core/src/lib.rs`:
  `movingAverageToJson(kind, values: Float64Array, period: u32) -> String`
  returns a JSON envelope (`value` / `unsupported` / `rolling` error /
  `argument` error). Panics inside the kernel are still caught at the
  napi-rs boundary and re-emitted as `INTERNAL_RUST_PANIC: ...` per
  ADR-003 § "Failure isolation".
- `packages/node-bindings/analysis-core/index.js` and `index.d.ts`:
  expose `movingAverageSync(kind, values, period)` returning
  `{ kind: 'value', value: number } | { kind: 'unsupported' }`. New
  typed JS error `BindingRollingError` (legacy-format too-short
  message). The shim pre-screens non-positive / non-integer / non-finite
  periods and non-finite values so the FFI hop is skipped on those.
- `src/domain/analysis/indicator/functions/statistics.ts`: `SMA` and
  `EMA` consult `OPENALICE_RUST_ANALYSIS` (same predicate as the OPE-19
  reductions); under flag=`1` they call the Rust moving average first
  after `toValues(...)` and fall back to the legacy TypeScript
  implementation on `unsupported`. `STDEV` and the four bare reductions
  are unchanged structurally; the four bare reductions still route
  through OPE-19.

## Parity contract

- `OPENALICE_RUST_ANALYSIS=0` / unset / `"true"` / `"yes"` / etc. → `SMA`
  and `EMA` are byte-identical to the legacy TypeScript implementations
  (verified by the existing parity test suite at `pnpm test`, all 1259
  tests green; specifically
  `src/domain/analysis/__test__/rust-rolling-parity.spec.ts`).
- `OPENALICE_RUST_ANALYSIS=1` → the three `IndicatorCalculator.calculate`
  outputs called out in the issue acceptance criteria match the
  flag-`0` outputs `value`-for-`value` and `dataRange`-for-`dataRange`
  on the linear OHLCV fixture:
  - `SMA(CLOSE('AAPL', '1d'), 5)`
  - `EMA(CLOSE('AAPL', '1d'), 5)`
  - `SMA(CLOSE('AAPL', '1d'), 10) + EMA(CLOSE('AAPL', '1d'), 10)`
- Direct statistics-module parity at periods 1, 3, 5, 20 across array
  lengths 16, 64, 256, 1024 (32 cell pairs) compares flag=0 vs flag=1
  bit-for-bit via `expect(...).toBe(...)`.
- Too-short-input parity: `SMA([1,2], 5)`, `EMA([1,2], 4)`, `SMA([], 1)`,
  and `EMA([], 3)` all throw the legacy
  `"<KIND> requires at least <period> data points, got <len>"`
  message under both flag values.
- Non-finite parity: `[1, 2, NaN, 4, 5, 6]` (and `+/-Infinity` variants)
  produce identical `Object.is`-equal results under both flags because
  the JS shim falls back to the legacy reduction on the `unsupported`
  envelope.
- Unsupported-period parity: `SMA(series, p)` and `EMA(series, p)` for
  `p ∈ {0, -1, 1.5, 2.5, NaN}` produce identical observable output (or
  identical thrown messages) under both flag values; the Rust route
  never adds new validation, it just stays out of the way.

The OPE-16 / OPE-17 parser-binding tests, the OPE-18 evaluator parity
tests, the OPE-19 reductions parity tests, and the legacy parity
harness all still pass. No DTO, tool schema, or public error surface
changed.

## Verification

```
$ /Users/opcw05/.cargo/bin/cargo fmt --all --check
$ /Users/opcw05/.cargo/bin/cargo clippy --workspace -- -D warnings
$ /Users/opcw05/.cargo/bin/cargo test --workspace
   ... 67 passed in analysis-core, 22 passed in analysis-core-node-binding
$ node packages/node-bindings/analysis-core/scripts/build-native.mjs
$ OPENALICE_RUST_ANALYSIS=0 pnpm test -- src/domain/analysis  # 202 passed
$ OPENALICE_RUST_ANALYSIS=1 pnpm test -- src/domain/analysis  # 202 passed
$ pnpm build                                                  # clean
$ pnpm test                                                   # 1259 passed
$ npx tsc --noEmit                                            # clean
```

## Bench (honest)

Command:

```
$ OPENALICE_NAPI_PROFILE=release node packages/node-bindings/analysis-core/scripts/build-native.mjs
$ node packages/node-bindings/analysis-core/scripts/rolling-overhead-bench.mjs \
    --iterations 5000 --warmup 500 --out /tmp/rolling-bench.json
```

Hardware: `darwin/arm64`, Node `v25.9.0`, release-profile
`analysis-core.node`. Both paths consume a plain `number[]`; the `napi`
row includes the JS `number[] → Float64Array` copy that the production
`movingAverageSync` shim performs on every call. Mean / p50 in
microseconds per call:

| kind | size | period | TS mean | TS p50 | napi mean | napi p50 |
|------|------|--------|---------|--------|-----------|----------|
| SMA  |   16 |      5 |   0.254 |  0.083 |    0.952  |   0.834  |
| EMA  |   16 |      5 |   0.110 |  0.083 |    0.951  |   0.792  |
| SMA  |  256 |      5 |   0.057 |  0.042 |    1.309  |   1.209  |
| EMA  |  256 |      5 |   0.538 |  0.459 |    1.708  |   1.583  |
| SMA  |  256 |     20 |   0.044 |  0.042 |    1.332  |   1.209  |
| EMA  |  256 |     20 |   0.467 |  0.458 |    1.803  |   1.625  |
| SMA  | 4096 |      5 |   0.056 |  0.042 |    8.639  |   7.834  |
| EMA  | 4096 |      5 |   7.196 |  7.041 |   16.030  |  15.500  |
| SMA  | 4096 |     20 |   0.032 |  0.042 |    8.410  |   7.708  |
| EMA  | 4096 |     20 |   7.192 |  7.000 |   15.371  |  14.542  |

Reading honestly: the Rust kernel itself is fast, but the combined
per-call cost of the napi-rs FFI hop, JSON envelope encode/decode, and
the JS-array → `Float64Array` copy still dominates these moving
averages even at 4 K elements. `SMA` is unbeatably cheap on the
TypeScript path because the trailing-window slice is a constant-period
sum (V8's monomorphic reduce loop amortizes very well, and the trailing
period of 5 / 20 keeps the inner sum tiny). `EMA` does pay the full
length sweep on both paths; at 4 K elements, the napi route is roughly
2× the TS route — closer than `SMA` but still a regression at this
slice size.

The shape is the same as OPE-19: the slice is the **architectural move**
(typed-array-backed rolling-window kernel binding), not a perf win at
production sizes today. `OPENALICE_RUST_ANALYSIS=0` remains the legacy
default, and there is no default-on rollout requested by this issue.
The benefit of this slice is that it lands the
`(Float64Array, period: u32)` binding shape that later slices
(`STDEV`, `BBANDS`, `RSI`, `MACD`, `ATR`) will need, and exercises that
binding shape under release-profile bench so the rollout-readiness
picture stays honest.

## Risks & rollback

- **No default-on rollout.** Production stays on the TypeScript path
  unless `OPENALICE_RUST_ANALYSIS=1` is set explicitly.
- **Runtime rollback.** Unset or set `OPENALICE_RUST_ANALYSIS=0` and the
  next call goes back to the legacy moving averages. No code change
  needed.
- **Non-finite handling.** Documented and tested: any `NaN` /
  `+/-Infinity` element transparently falls back to the legacy moving
  average at the JS shim layer. Rust kernel unit tests still cover the
  `Unsupported` envelope so a pre-screen bypass cannot crash the
  kernel.
- **Period handling.** Non-positive / non-integer / non-finite periods
  fall back to the legacy TS path verbatim — this slice intentionally
  does not add new validation behavior. The legacy module's existing
  semantics for `SMA(series, 0)` (returns `Infinity` from `sum/0`) and
  `EMA(series, 0)` (returns `NaN` from the seed `0/0`) are preserved
  under both flag values.
- **Binding shape.** The new `movingAverageToJson(kind, Float64Array,
  u32)` entry point is additive; all existing entry points
  (`bootstrapHealthcheck`, `parseFormulaToJson`,
  `evaluateFormulaToJson`, `reduceNumbersToJson`,
  `__triggerPanicForTest`) are unchanged. The JS surface adds
  `movingAverageSync` and `BindingRollingError` and leaves every other
  export alone.

## Next recommended issue

OPE-21 should pick up `STDEV` (and possibly the rolling-window variant
that derives `BBANDS`). `STDEV` is the smallest remaining bare
statistics kernel and reuses the same finite-`number[]` boundary plus
the OPE-19 sum primitive, so it is a natural follow-up while keeping
this slice tightly scoped. Technical indicators with multi-output DTOs
(`RSI`, `BBANDS`, `MACD`, `ATR`) should still be deferred until
`STDEV` lands so that the next binding shape (struct-of-arrays return
envelope vs. scalar) is decided in isolation.
