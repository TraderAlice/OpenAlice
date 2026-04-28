# analysis_core: napi-rs binding hardening + binding-overhead capture (OPE-17)

- Status: shipped
- Issue: [OPE-17](/OPE/issues/OPE-17)
- Builds on: [OPE-16 rust-parser-parity-slice](./rust-parser-parity-slice.md), [OPE-15 entrypoint-parity-harness](./entrypoint-parity-harness.md), [adapter-bootstrap report](../adapter-bootstrap/analysis-core-rust-toolchain-bootstrap.md)
- ADRs: [ADR-001 rust-boundary](../../adr/ADR-001-rust-boundary.md), [ADR-002 feature-flag-policy](../../adr/ADR-002-feature-flag-policy.md), [ADR-003 binding-strategy](../../adr/ADR-003-binding-strategy.md)
- Manifest: [openalice-rust-refactor.manifest.yaml](../../openalice-rust-refactor.manifest.yaml)

## Summary

OPE-16 landed the first Rust parser slice as a `spawnSync` shell-out to a Cargo-built `analysis-core-parse` binary. That bought parity but cost ~1.4 ms per call in IPC + process-spawn overhead — useless for hot indicator paths and inappropriate as a Phase 2 baseline.

OPE-17 replaces that shell-out with the in-process napi-rs bridge mandated by [ADR-003 §"Default binding mechanism"](../../adr/ADR-003-binding-strategy.md). The legacy TypeScript parser remains the default and the only authorized fallback. The CLI binary is retained explicitly as a debug-only fallback (gated by `OPENALICE_ANALYSIS_CORE_USE_CLI=1`) so the binding-overhead benchmark can compare all three paths side-by-side.

## Scope

In scope:
- napi-rs bridge for the existing parser surface (`parseFormulaSync`).
- Typed JS error normalization (`BindingLoadError`, `BindingParseError`, `RustPanicError` per ADR-003 §"Failure isolation").
- Build helper that produces `analysis-core.node` from `cargo build` output without committing it.
- `.gitignore` coverage for `target/` and `**/*.node`.
- Vitest suites covering parity (flag 0/1) and binding boundaries (load failure, parse error, Rust panic, opt-in CLI fallback).
- Binding-overhead benchmark + report.

Out of scope (deferred):
- Rust evaluator port. The TypeScript evaluator stays authoritative.
- Statistics, technical-indicator, or data-access ports.
- Any change to the `OPENALICE_RUST_ANALYSIS=0` legacy default.
- Pre-built `.node` distribution. Local build-from-source remains the model.
- Cross-platform CI matrix for the binding (the existing `ubuntu-latest` job is extended to build the binding before `pnpm test`; macOS/Windows triples are a follow-up if/when production calls require them).

## Implementation

### Rust side

`packages/node-bindings/analysis-core/Cargo.toml`
- Adds `napi = { version = "3", default-features = false, features = ["napi4"] }`, `napi-derive = "3"`, and `napi-build = "2"` (build-dependency).
- Promotes `crate-type` to `["cdylib", "rlib"]` so the workspace still gets the rlib for `cargo test --workspace` while emitting the loadable Node-API addon.
- Keeps the `[[bin]] analysis-core-parse` entry; the CLI binary is the explicit debug-only fallback.

`packages/node-bindings/analysis-core/src/lib.rs`
- Replaces the rlib re-exports with a napi-rs bridge that exposes:
  - `bootstrapHealthcheck()` — bootstrap marker.
  - `parseFormulaToJson(formula)` — returns the parse envelope as a JSON string.
  - `__triggerPanicForTest(message)` — test-only hook to drive the panic boundary.
- Wraps the parser in `std::panic::catch_unwind`, temporarily suppresses Rust's default panic hook while the boundary is catching a panic, and re-emits panics as `napi::Error` with `Status::GenericFailure` whose message starts with the literal sentinel `INTERNAL_RUST_PANIC: ...`.
- Crate is `#![deny(unsafe_code)]` (not `forbid`) because the `#[napi]` macro expands to FFI that needs `unsafe`. Hand-rolled `unsafe` blocks still fail the build.

`packages/node-bindings/analysis-core/build.rs`
- Calls `napi_build::setup()` so the cdylib gets the platform link flags Node-API requires (`-rdynamic` on Unix, weak Node symbols on macOS/Windows). Without this the artifact would not load through `process.dlopen` / `require`.

### Build helper (no `@napi-rs/cli` dependency)

`packages/node-bindings/analysis-core/scripts/build-native.mjs`
- Calls `cargo build -p analysis-core-node-binding --lib` (or `--release` when `OPENALICE_NAPI_PROFILE=release`), then copies the resulting `lib*.dylib` / `lib*.so` / `*.dll` to `packages/node-bindings/analysis-core/analysis-core.node`.
- Resolves `cargo` via `$PATH` first and falls back to `~/.cargo/bin/cargo` (the rustup default) so the helper works under `pnpm`, vitest, and CI shells that don't source the user profile.
- We deliberately avoid pulling in `@napi-rs/cli` to keep the npm dependency surface inside the OPE-17 allowed-files policy. `napi-build` (a Rust build-dependency, not an npm package) still configures the platform link flags, so the artifact produced this way is fully Node-API compatible.

### TypeScript wrapper

`packages/node-bindings/analysis-core/index.js`
- Loads `analysis-core.node` via `createRequire(import.meta.url)`.
- Re-throws Rust panics as `RustPanicError` (`code = 'INTERNAL_RUST_PANIC'`) and parse failures as `BindingParseError` (`code = 'ANALYSIS_CORE_PARSE_ERROR'`) whose `.message` matches the legacy TypeScript parser exactly.
- Surfaces missing/unloadable artifacts as `BindingLoadError` (`code = 'ANALYSIS_CORE_BINDING_LOAD_FAILED'`) so the legacy `OPENALICE_RUST_ANALYSIS=0` path keeps Node alive.
- Exposes the OPE-16 CLI binary as an opt-in debug fallback when `OPENALICE_ANALYSIS_CORE_USE_CLI=1`. This is gated explicitly; production callers should never set it. The benchmark uses it to quantify the savings from in-process binding vs. process-spawn.
- `__resetForTest()` and `__triggerPanicForTest()` exist solely for the boundary spec; they are explicitly marked test-only in `index.d.ts`.

`packages/node-bindings/analysis-core/index.d.ts`
- Documents the typed errors and re-states that the CLI fallback is debug-only.

`src/domain/analysis/indicator/calculator.ts`
- Comment block updated to reflect the napi-rs route and the typed-error contract. The import path is unchanged (`parseFormulaSyncRust`), and the call site keeps the legacy parser as the default — only `OPENALICE_RUST_ANALYSIS=1` (literal `"1"` per ADR-002) routes through the binding.

### Tests

`src/domain/analysis/__test__/rust-parser-parity.spec.ts` (updated)
- `beforeAll` now builds both the napi binding and the CLI fallback if the artifacts are missing. `cargo` is resolved via `$PATH` then `~/.cargo/bin/cargo`. Suite timeout raised to 180 s to absorb a cold cargo build.

`src/domain/analysis/__test__/rust-binding-boundaries.spec.ts` (new)
- Locks the OPE-17 typed-error contract:
  - `bootstrapHealthcheck` and AST shape via the in-process bridge.
  - `BindingParseError` with legacy-format messages (`Unknown identifier 'AAPL' at position 4`, `Unexpected character ')' at position 6. Expected end of expression.`).
  - `RustPanicError` raised when `__triggerPanicForTest` panics inside Rust, including a follow-up parse to prove Node survived.
  - `BindingLoadError` raised when the `.node` artifact is renamed away (artifact is restored in `finally` so the spec is hermetic).
  - Opt-in CLI fallback parses successfully and surfaces the same `BindingParseError` shape.

Rust unit tests (`packages/node-bindings/analysis-core/src/lib.rs`)
- `build_envelope` success/failure shapes.
- `panic_message` extracts both `&'static str` and `String` panic payloads.

### CI

`.github/workflows/ci.yml`
- Adds a `node packages/node-bindings/analysis-core/scripts/build-native.mjs` step before `pnpm build` so the binding is present for `pnpm test` and the typecheck without forcing vitest to invoke cargo.
- Adds a follow-up `pnpm test -- src/domain/analysis` invocation with `OPENALICE_RUST_ANALYSIS=1` so the Rust parser path is exercised in CI on every push, in addition to the default flag-0 run.

### `.gitignore`

- `target/` and `**/*.node` are now ignored so cargo builds and the binding artifact never accidentally land in commits. `git status` and `git check-ignore -v` confirm.

## Verification

All required commands from the OPE-17 issue body run clean on `darwin/arm64`, Node `v25.9.0`, Rust `1.95.0`:

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | clean |
| `cargo metadata --no-deps --format-version 1` | clean |
| `cargo fmt --all --check` | clean |
| `cargo clippy --workspace -- -D warnings` | clean |
| `cargo test --workspace` | 27 + 6 unit tests pass |
| `OPENALICE_RUST_ANALYSIS=0 pnpm test -- src/domain/analysis src/domain/thinking` | 138 tests pass |
| `OPENALICE_RUST_ANALYSIS=1 pnpm test -- src/domain/analysis` | 114 tests pass |
| `pnpm build` | success (tsup ESM bundle 771 KB) |
| `pnpm test` | 1171 tests pass |
| `pnpm test:e2e` | 23 pass, 58 skipped (no regressions) |
| `npx tsc --noEmit` | clean |

The boundary spec deliberately panics inside Rust to exercise the catch path; vitest output is clean and Node never crashes — the panic surfaces as `RustPanicError` and the next `parseFormulaSync` call succeeds.

## Binding overhead

Captured with `node packages/node-bindings/analysis-core/scripts/binding-overhead-bench.mjs` on `darwin/arm64`, Node `v25.9.0`, release-profile binding (`cargo build --release -p analysis-core-node-binding`). The script measures pure parser cost (no data fetch, no evaluator) for three implementations:

- `ts`: legacy in-process TypeScript recursive-descent parser (mirror of `IndicatorCalculator.parse`).
- `napi`: in-process napi-rs binding (the OPE-17 normal path).
- `cli`: OPE-16 `spawnSync` fallback (`OPENALICE_ANALYSIS_CORE_USE_CLI=1`).

Times are per-call microseconds (µs).

### Small expression (`1+2`)

| label | iter | mean | p50 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ts   | 5000 | 0.37    | 0.29    | 0.46    | 0.54    | 0.25    | 77.33   |
| napi | 5000 | 1.82    | 1.58    | 2.00    | 3.71    | 1.38    | 353.29  |
| cli  |  200 | 1418.78 | 1360.88 | 1845.71 | 2218.83 | 1242.42 | 2277.88 |

### Production-shape formula (price-deviation %)

`(CLOSE('AAPL','1d')[-1] - SMA(CLOSE('AAPL','1d'),50)) / SMA(CLOSE('AAPL','1d'),50) * 100`

| label | iter | mean | p50 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ts   | 5000 | 3.75    | 3.08    | 7.13    | 10.58   | 2.67    | 122.08  |
| napi | 5000 | 8.34    | 8.08    | 9.00    | 13.46   | 7.08    | 224.75  |
| cli  |  200 | 1429.31 | 1365.38 | 1810.88 | 2205.17 | 1204.92 | 2317.63 |

### Larger composite (multiple indicators across two assets)

`MACD(CLOSE('AAPL','1d'),12,26,9) + EMA(CLOSE('AAPL','1d'),50) * STDEV(CLOSE('AAPL','1d')) / RSI(CLOSE('AAPL','1d'),14) - SMA(CLOSE('BTCUSD','1h'),200)`

| label | iter | mean | p50 | p95 | p99 | min | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ts   | 2000 | 6.26    | 5.50    | 8.25    | 21.54   | 4.71    | 169.88  |
| napi | 2000 | 11.82   | 11.13   | 13.50   | 19.21   | 10.83   | 387.67  |
| cli  |  200 | 1430.87 | 1372.21 | 1820.17 | 1923.13 | 1265.92 | 1953.29 |

### Reading the numbers

- The CLI fallback is dominated by process spawn + IPC (~1.4 ms per call regardless of formula size). It is unusable on hot paths, which is why OPE-17 replaces it as the normal Rust route.
- The napi-rs binding is consistently **~170× faster than the CLI fallback** at the parser surface (e.g. 8.34 µs vs 1429.31 µs on the production-shape formula). That is the core OPE-17 win.
- The napi-rs binding is currently **~2× slower than the legacy TypeScript parser** for parser-only workloads of this size. The dominant overhead is the JSON envelope round-trip across the binding boundary (`serde_json::to_string` in Rust + `JSON.parse` in JS) plus per-call FFI cost of ~1.5 µs. For a parser this small, that overhead is in the same order of magnitude as the work itself, so V8's tight in-process loop wins.
- This is exactly the trade-off [ADR-001 §"Migration"](../../adr/ADR-001-rust-boundary.md) anticipated for early Rust slices: parser parity first, performance second. The eventual port of the evaluator + indicator math (a separate, future issue) keeps the AST inside Rust and amortizes the FFI cost across far more work per call. At that point the napi-rs route should win on absolute time too. Today the win is the parity/quality story (one source of truth in Rust, panic-safe boundary, structured errors), not the per-call latency.

### Reproducing

```bash
# build the napi binding (release) and CLI fallback (release)
cargo build --release -p analysis-core-node-binding
OPENALICE_NAPI_PROFILE=release node packages/node-bindings/analysis-core/scripts/build-native.mjs

# run the benchmark
node packages/node-bindings/analysis-core/scripts/binding-overhead-bench.mjs \
  --iterations 5000 --warmup 500 --out report.json
```

The script accepts `--formula "..."` to benchmark arbitrary expressions and `--out path.json` for downstream tooling.

## Risks + follow-ups

- **Per-call FFI overhead.** ~1.5 µs per call is the floor today; cutting it further requires returning the AST as a native NAPI Object instead of a JSON string. That is a future optimization gated by an actual hot-path workload demanding it; for the current parser-only Rust slice the JSON route is simpler, smaller blast radius, and easier to reason about. **Follow-up:** open a separate issue if/when the Rust evaluator port shows up and we need to keep the AST inside Rust between parse and eval.
- **CI host coverage.** The CI matrix is still `ubuntu-latest` only. The binding builds locally on `darwin/arm64` but macOS/Windows runners are not exercised here. **Follow-up:** add `macos-latest` and `windows-latest` jobs once the cross-platform load surface justifies the runtime budget; track in the same future issue as the cross-platform pre-built `.node` decision (§ "Build, distribution, and CI" in [ADR-003](../../adr/ADR-003-binding-strategy.md)).
- **Stable Node ABI.** napi-rs targets `napi4` (Node 10+ ABI); OpenAlice runs on Node 22. No risk under the supported matrix; documented here so a future Node downgrade triggers a deliberate revisit.
- **`@napi-rs/cli` deferred.** Skipping the npm CLI keeps the dependency surface minimal under the OPE-17 allowed-files policy. If we ever ship pre-built binaries (release flow) we will revisit this; it is not blocking today.

## Acceptance checklist

- [x] Root `.gitignore` ignores `target/` and `**/*.node`.
- [x] `parseFormulaSync` uses an in-process napi-rs binding, not `spawnSync`, on the normal `OPENALICE_RUST_ANALYSIS=1` parser path.
- [x] CLI fallback retained as explicit debug-only (`OPENALICE_ANALYSIS_CORE_USE_CLI=1`) and documented above.
- [x] Missing/failed native binding produces a typed `BindingLoadError`; legacy TypeScript parser path remains the supported fallback.
- [x] Rust panic boundary tested via `__triggerPanicForTest`; surfaces as `RustPanicError` (`code = 'INTERNAL_RUST_PANIC'`).
- [x] OPE-16 parser parity fixtures green with `OPENALICE_RUST_ANALYSIS=0` and `OPENALICE_RUST_ANALYSIS=1`.
- [x] Binding overhead numbers captured (this report).
- [x] No `target/`, `.node`, or other build outputs staged.
- [x] No out-of-scope files modified.
