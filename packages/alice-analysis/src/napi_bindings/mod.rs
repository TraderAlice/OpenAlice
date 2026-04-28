// NAPI surface for `alice-analysis`. Only this module imports `napi-derive`;
// the rest of the crate is plain Rust so it can be unit-tested without Node.
//
// Three layers exposed to JS:
//   1. `*_raw` indicator kernels  (sync, hot path) — see `raw.rs`.
//   2. `evaluate_formula`         (async, pre-fetches OHLCV via JS callback) — `formula.rs`.
//   3. `safe_calculate`           (sync, thinking calculator) — re-exported below.
//
// The wire-decimal codec moved to `@traderalice/alice-decimal` (task #11,
// Q-EXTRACT). The TS adapter `ts/src/index.ts` re-exports it for back-compat;
// no Rust code in this crate uses the codec, so there is no Rust-level
// dependency on `alice-decimal` from here.
//
// All errors are `napi::Error` produced via `AnalysisError::From`. The TS adapter
// peels the `CODE|message` envelope and rehydrates as a typed JS class.

pub mod formula;
pub mod raw;

use napi_derive::napi;

#[napi]
pub fn safe_calculate(expression: String) -> Result<f64, napi::Error> {
    crate::thinking::safe_calculate(&expression).map_err(Into::into)
}
