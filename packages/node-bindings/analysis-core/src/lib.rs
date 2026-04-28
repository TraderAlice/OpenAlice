//! OpenAlice `analysis_core` Node binding crate.
//!
//! Phase 2 parser slice (OPE-17): in-process napi-rs bridge for the Rust
//! parser kernel that lives in `crates/analysis-core/`. The TypeScript
//! evaluator, data-access functions, statistics kernels, technical
//! indicators, and tool surface remain authoritative on the legacy path.
//!
//! ## Bridge contract
//!
//! - `bootstrapHealthcheck()` returns the literal `"analysis_core:bootstrap"`.
//! - `parseFormulaToJson(formula)` returns a JSON-encoded envelope.
//!   On success: `{ "ok": true, "ast": <AstNode> }`. On a parse error:
//!   `{ "ok": false, "error": { "kind": "parse", "message": <string>,
//!   "position": <number> } }`. The TypeScript wrapper (`index.js`)
//!   JSON-decodes this envelope and re-throws `BindingParseError`
//!   instances whose `.message` matches the legacy TypeScript parser
//!   exactly so existing callers, tests, and tool-shim error
//!   normalization continue to work unchanged.
//! - `evaluateFormulaToJson(formula)` parses *and* evaluates the
//!   formula in Rust when the AST is arithmetic-only (numeric literals
//!   and `+ - * /`). It returns one of four envelopes:
//!     * `{ "ok": true, "kind": "value", "value": <f64> }` on
//!       arithmetic success
//!     * `{ "ok": true, "kind": "unsupported", "ast": <AstNode> }`
//!       when any non-arithmetic node is present so the caller can
//!       hand the AST to the legacy TypeScript evaluator without
//!       re-parsing
//!     * `{ "ok": false, "error": { "kind": "parse", "message": ...,
//!       "position": ... } }` for parse failures (identical shape to
//!       `parseFormulaToJson`)
//!     * `{ "ok": false, "error": { "kind": "evaluate", "message":
//!       "Division by zero" } }` for arithmetic-only runtime errors
//!       whose `.message` matches the legacy TypeScript evaluator.
//! - `reduceNumbersToJson(kind, values)` (OPE-19) applies the finite
//!   `number[]` reduction `kind` (`"MIN"`, `"MAX"`, `"SUM"`, or
//!   `"AVERAGE"`) to a `Float64Array` of finite `f64`s and returns one of
//!   four envelopes:
//!     * `{ "ok": true, "kind": "value", "value": <f64> }` on success
//!     * `{ "ok": true, "kind": "unsupported" }` when the slice contains
//!       any non-finite element. The JS wrapper pre-screens for this so
//!       callers can route non-finite arrays back to the legacy
//!       TypeScript reductions; this envelope is a defensive second
//!       check on the Rust side.
//!     * `{ "ok": false, "error": { "kind": "reduce", "message":
//!       <legacy-format string> } }` for `MIN`/`MAX`/`AVERAGE` on an
//!       empty slice (`SUM([])` returns `Value(0.0)` to mirror
//!       `[].reduce((a, v) => a + v, 0)`).
//!     * `{ "ok": false, "error": { "kind": "argument", "message":
//!       <"unknown reduction kind: X"> } }` when `kind` does not parse
//!       to one of the four supported reductions.
//! - `movingAverageToJson(kind, values, period)` (OPE-20) applies the
//!   finite-`number[]` rolling-window moving average `kind` (`"SMA"` or
//!   `"EMA"`) over a `Float64Array` of finite `f64`s with a positive
//!   `u32` period. It returns one of four envelopes:
//!     * `{ "ok": true, "kind": "value", "value": <f64> }` on success.
//!     * `{ "ok": true, "kind": "unsupported" }` when the slice contains
//!       any non-finite element or `period == 0`. The JS wrapper
//!       pre-screens for non-finite values and for non-integer / non-
//!       positive periods; this envelope is a defensive second check on
//!       the Rust side.
//!     * `{ "ok": false, "error": { "kind": "rolling", "message":
//!       <legacy-format string> } }` when `values.len() < period`. The
//!       message matches the legacy TS implementation
//!       (`"<KIND> requires at least <period> data points, got <len>"`).
//!     * `{ "ok": false, "error": { "kind": "argument", "message":
//!       <"unknown moving-average kind: X"> } }` when `kind` does not
//!       parse to one of the two supported moving averages.
//!
//! ## Failure isolation (per ADR-003)
//!
//! - Parse failures surface as a structured envelope; they never throw on
//!   the Rust side.
//! - Panics inside the parser kernel are caught at the binding edge by
//!   `std::panic::catch_unwind` and re-emitted as a napi `Error` whose
//!   message starts with the literal sentinel `INTERNAL_RUST_PANIC:`. The
//!   JS wrapper maps that sentinel to a typed `RustPanicError` so a panic
//!   never crashes the Node process.
//! - Missing or unloadable native artifacts surface inside the JS wrapper
//!   as a typed `BindingLoadError`; the rest of OpenAlice is free to keep
//!   running on the legacy TypeScript parser path.
//!
//! `__triggerPanicForTest` exists solely so the parity harness can
//! exercise the panic boundary deterministically without injecting a real
//! bug into the parser. It is not part of the public binding surface.

// `napi-rs`'s `#[napi]` macro expands to Node-API entry points that
// contain `unsafe` blocks (FFI is inherently unsafe). The macro emits
// `#[allow(unsafe_code)]` overrides that would conflict with a
// crate-level `#![forbid(unsafe_code)]`, so we use `deny` instead. Any
// hand-rolled `unsafe` block in this crate still fails the build, but
// macro-generated `unsafe` is allowed via the macro's own `allow`.
#![deny(unsafe_code)]

use std::panic::{self, AssertUnwindSafe, UnwindSafe};
use std::sync::{Mutex, OnceLock};

use napi::bindgen_prelude::{Error, Float64Array, Result, Status};
use napi_derive::napi;

pub use analysis_core::{
    bootstrap_healthcheck, evaluate_arithmetic_only, moving_average, parse, reduce, AstNode,
    EvalOutcome, ParseError, ReductionKind, ReductionOutcome, RollingKind, RollingOutcome,
};

const PANIC_SENTINEL: &str = "INTERNAL_RUST_PANIC";

#[napi(js_name = "bootstrapHealthcheck")]
pub fn bootstrap_healthcheck_napi() -> &'static str {
    bootstrap_healthcheck()
}

/// Parse a formula and return a JSON-encoded envelope (see crate docs).
#[napi(js_name = "parseFormulaToJson")]
pub fn parse_formula_to_json(formula: String) -> Result<String> {
    let outcome = catch_unwind_quiet(AssertUnwindSafe(|| build_envelope(&formula)));
    match outcome {
        Ok(envelope) => serde_json::to_string(&envelope).map_err(|err| {
            Error::new(
                Status::GenericFailure,
                format!("analysis_core: failed to serialize parse envelope: {}", err),
            )
        }),
        Err(payload) => Err(Error::new(
            Status::GenericFailure,
            format!("{}: {}", PANIC_SENTINEL, panic_message(payload)),
        )),
    }
}

/// Parse + arithmetic-only evaluate; return a JSON-encoded envelope.
///
/// See the crate docs for the four possible envelope shapes. Panics in
/// either the parser or the evaluator are caught at the binding edge
/// and re-emitted as `INTERNAL_RUST_PANIC: ...` napi errors so Node
/// never crashes from a Rust panic.
#[napi(js_name = "evaluateFormulaToJson")]
pub fn evaluate_formula_to_json(formula: String) -> Result<String> {
    let outcome = catch_unwind_quiet(AssertUnwindSafe(|| build_evaluate_envelope(&formula)));
    match outcome {
        Ok(envelope) => serde_json::to_string(&envelope).map_err(|err| {
            Error::new(
                Status::GenericFailure,
                format!(
                    "analysis_core: failed to serialize evaluate envelope: {}",
                    err,
                ),
            )
        }),
        Err(payload) => Err(Error::new(
            Status::GenericFailure,
            format!("{}: {}", PANIC_SENTINEL, panic_message(payload)),
        )),
    }
}

/// Apply a finite `number[]` reduction (`MIN`/`MAX`/`SUM`/`AVERAGE`) to
/// a `Float64Array` and return a JSON-encoded envelope (see crate docs
/// for the four envelope shapes, including the `unsupported` defensive
/// branch for non-finite elements). Panics in the kernel are caught at
/// the binding edge and re-emitted as `INTERNAL_RUST_PANIC: ...`.
#[napi(js_name = "reduceNumbersToJson")]
pub fn reduce_numbers_to_json(kind: String, values: Float64Array) -> Result<String> {
    let outcome = catch_unwind_quiet(AssertUnwindSafe(|| build_reduce_envelope(&kind, &values)));
    match outcome {
        Ok(envelope) => serde_json::to_string(&envelope).map_err(|err| {
            Error::new(
                Status::GenericFailure,
                format!(
                    "analysis_core: failed to serialize reduce envelope: {}",
                    err,
                ),
            )
        }),
        Err(payload) => Err(Error::new(
            Status::GenericFailure,
            format!("{}: {}", PANIC_SENTINEL, panic_message(payload)),
        )),
    }
}

/// Apply a finite `number[]` rolling-window moving average (`SMA` /
/// `EMA`) to a `Float64Array` plus a positive `u32` period and return a
/// JSON-encoded envelope (see crate docs for the four envelope shapes,
/// including the `unsupported` defensive branch for non-finite elements
/// or `period == 0`). Panics in the kernel are caught at the binding
/// edge and re-emitted as `INTERNAL_RUST_PANIC: ...`.
#[napi(js_name = "movingAverageToJson")]
pub fn moving_average_to_json(kind: String, values: Float64Array, period: u32) -> Result<String> {
    let outcome = catch_unwind_quiet(AssertUnwindSafe(|| {
        build_rolling_envelope(&kind, &values, period)
    }));
    match outcome {
        Ok(envelope) => serde_json::to_string(&envelope).map_err(|err| {
            Error::new(
                Status::GenericFailure,
                format!(
                    "analysis_core: failed to serialize rolling envelope: {}",
                    err,
                ),
            )
        }),
        Err(payload) => Err(Error::new(
            Status::GenericFailure,
            format!("{}: {}", PANIC_SENTINEL, panic_message(payload)),
        )),
    }
}

/// Test-only hook used by the parity harness to verify that panics are
/// caught at the binding edge and surfaced as `INTERNAL_RUST_PANIC`.
#[napi(js_name = "__triggerPanicForTest")]
pub fn trigger_panic_for_test(message: String) -> Result<()> {
    let outcome = catch_unwind_quiet(AssertUnwindSafe(|| {
        panic!("{}", message);
    }));
    match outcome {
        Ok(()) => Ok(()),
        Err(payload) => Err(Error::new(
            Status::GenericFailure,
            format!("{}: {}", PANIC_SENTINEL, panic_message(payload)),
        )),
    }
}

fn build_envelope(formula: &str) -> serde_json::Value {
    match parse(formula) {
        Ok(ast) => serde_json::json!({
            "ok": true,
            "ast": ast,
        }),
        Err(err) => serde_json::json!({
            "ok": false,
            "error": {
                "kind": "parse",
                "message": err.message,
                "position": err.position,
            },
        }),
    }
}

fn build_evaluate_envelope(formula: &str) -> serde_json::Value {
    let ast = match parse(formula) {
        Ok(ast) => ast,
        Err(err) => {
            return serde_json::json!({
                "ok": false,
                "error": {
                    "kind": "parse",
                    "message": err.message,
                    "position": err.position,
                },
            });
        }
    };
    match evaluate_arithmetic_only(&ast) {
        EvalOutcome::Value(value) => serde_json::json!({
            "ok": true,
            "kind": "value",
            "value": value,
        }),
        EvalOutcome::Unsupported => serde_json::json!({
            "ok": true,
            "kind": "unsupported",
            "ast": ast,
        }),
        EvalOutcome::Error(err) => serde_json::json!({
            "ok": false,
            "error": {
                "kind": "evaluate",
                "message": err.message,
            },
        }),
    }
}

fn build_reduce_envelope(kind: &str, values: &[f64]) -> serde_json::Value {
    let parsed = match ReductionKind::parse(kind) {
        Some(k) => k,
        None => {
            return serde_json::json!({
                "ok": false,
                "error": {
                    "kind": "argument",
                    "message": format!("unknown reduction kind: {}", kind),
                },
            });
        }
    };
    match reduce(parsed, values) {
        ReductionOutcome::Value(value) => serde_json::json!({
            "ok": true,
            "kind": "value",
            "value": value,
        }),
        ReductionOutcome::Unsupported => serde_json::json!({
            "ok": true,
            "kind": "unsupported",
        }),
        ReductionOutcome::Error(err) => serde_json::json!({
            "ok": false,
            "error": {
                "kind": "reduce",
                "message": err.message,
            },
        }),
    }
}

fn build_rolling_envelope(kind: &str, values: &[f64], period: u32) -> serde_json::Value {
    let parsed = match RollingKind::parse(kind) {
        Some(k) => k,
        None => {
            return serde_json::json!({
                "ok": false,
                "error": {
                    "kind": "argument",
                    "message": format!("unknown moving-average kind: {}", kind),
                },
            });
        }
    };
    match moving_average(parsed, values, period as usize) {
        RollingOutcome::Value(value) => serde_json::json!({
            "ok": true,
            "kind": "value",
            "value": value,
        }),
        RollingOutcome::Unsupported => serde_json::json!({
            "ok": true,
            "kind": "unsupported",
        }),
        RollingOutcome::Error(err) => serde_json::json!({
            "ok": false,
            "error": {
                "kind": "rolling",
                "message": err.message,
            },
        }),
    }
}

fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&'static str>() {
        return (*s).to_string();
    }
    if let Some(s) = payload.downcast_ref::<String>() {
        return s.clone();
    }
    String::from("(unknown panic payload)")
}

fn catch_unwind_quiet<F, T>(f: F) -> std::thread::Result<T>
where
    F: FnOnce() -> T + UnwindSafe,
{
    static HOOK_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = HOOK_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let previous_hook = panic::take_hook();
    panic::set_hook(Box::new(|_| {}));
    let outcome = panic::catch_unwind(f);
    panic::set_hook(previous_hook);
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn re_exports_healthcheck() {
        assert_eq!(bootstrap_healthcheck(), "analysis_core:bootstrap");
    }

    #[test]
    fn re_exports_parser() {
        let ast = parse("1 + 2").expect("parse");
        let value = serde_json::to_value(&ast).unwrap();
        assert_eq!(value["type"], "binaryOp");
        assert_eq!(value["operator"], "+");
    }

    #[test]
    fn build_envelope_success_shape() {
        let envelope = build_envelope("1 + 2");
        assert_eq!(envelope["ok"], serde_json::Value::Bool(true));
        assert_eq!(envelope["ast"]["type"], "binaryOp");
    }

    #[test]
    fn build_evaluate_envelope_arithmetic_value_shape() {
        let envelope = build_evaluate_envelope("2 + 3 * 4");
        assert_eq!(envelope["ok"], serde_json::Value::Bool(true));
        assert_eq!(envelope["kind"], "value");
        assert_eq!(envelope["value"], serde_json::json!(14.0));
    }

    #[test]
    fn build_evaluate_envelope_unsupported_includes_ast() {
        let envelope = build_evaluate_envelope("CLOSE('AAPL', '1d')[-1]");
        assert_eq!(envelope["ok"], serde_json::Value::Bool(true));
        assert_eq!(envelope["kind"], "unsupported");
        assert_eq!(envelope["ast"]["type"], "arrayAccess");
    }

    #[test]
    fn build_evaluate_envelope_division_by_zero_shape() {
        let envelope = build_evaluate_envelope("10 / 0");
        assert_eq!(envelope["ok"], serde_json::Value::Bool(false));
        assert_eq!(envelope["error"]["kind"], "evaluate");
        assert_eq!(envelope["error"]["message"], "Division by zero");
    }

    #[test]
    fn build_evaluate_envelope_parse_error_shape() {
        let envelope = build_evaluate_envelope("@");
        assert_eq!(envelope["ok"], serde_json::Value::Bool(false));
        assert_eq!(envelope["error"]["kind"], "parse");
        assert_eq!(
            envelope["error"]["message"],
            "Unexpected character '@' at position 0",
        );
        assert_eq!(envelope["error"]["position"], 0);
    }

    #[test]
    fn build_envelope_parse_error_shape() {
        let envelope = build_envelope("@");
        assert_eq!(envelope["ok"], serde_json::Value::Bool(false));
        assert_eq!(envelope["error"]["kind"], "parse");
        assert_eq!(
            envelope["error"]["message"],
            "Unexpected character '@' at position 0"
        );
        assert_eq!(envelope["error"]["position"], 0);
    }

    #[test]
    fn build_reduce_envelope_value_shape() {
        let envelope = build_reduce_envelope("SUM", &[1.0, 2.0, 3.0]);
        assert_eq!(envelope["ok"], serde_json::Value::Bool(true));
        assert_eq!(envelope["kind"], "value");
        assert_eq!(envelope["value"], serde_json::json!(6.0));
    }

    #[test]
    fn build_reduce_envelope_min_shape() {
        let envelope = build_reduce_envelope("MIN", &[3.0, 1.0, 2.0]);
        assert_eq!(envelope["kind"], "value");
        assert_eq!(envelope["value"], serde_json::json!(1.0));
    }

    #[test]
    fn build_reduce_envelope_empty_min_emits_legacy_message() {
        let envelope = build_reduce_envelope("MIN", &[]);
        assert_eq!(envelope["ok"], serde_json::Value::Bool(false));
        assert_eq!(envelope["error"]["kind"], "reduce");
        assert_eq!(
            envelope["error"]["message"],
            "MIN requires at least 1 data point",
        );
    }

    #[test]
    fn build_reduce_envelope_empty_sum_returns_zero() {
        let envelope = build_reduce_envelope("SUM", &[]);
        assert_eq!(envelope["kind"], "value");
        assert_eq!(envelope["value"], serde_json::json!(0.0));
    }

    #[test]
    fn build_reduce_envelope_unknown_kind_is_argument_error() {
        let envelope = build_reduce_envelope("STDEV", &[1.0]);
        assert_eq!(envelope["ok"], serde_json::Value::Bool(false));
        assert_eq!(envelope["error"]["kind"], "argument");
        assert_eq!(
            envelope["error"]["message"],
            "unknown reduction kind: STDEV"
        );
    }

    #[test]
    fn build_reduce_envelope_non_finite_is_unsupported() {
        let envelope = build_reduce_envelope("SUM", &[1.0, f64::NAN, 3.0]);
        assert_eq!(envelope["ok"], serde_json::Value::Bool(true));
        assert_eq!(envelope["kind"], "unsupported");
    }

    #[test]
    fn build_rolling_envelope_sma_value_shape() {
        let envelope = build_rolling_envelope("SMA", &[1.0, 2.0, 3.0, 4.0, 5.0], 3);
        assert_eq!(envelope["ok"], serde_json::Value::Bool(true));
        assert_eq!(envelope["kind"], "value");
        assert_eq!(envelope["value"], serde_json::json!(4.0));
    }

    #[test]
    fn build_rolling_envelope_ema_value_shape() {
        let envelope = build_rolling_envelope("EMA", &[1.0, 2.0, 3.0, 4.0, 5.0], 3);
        assert_eq!(envelope["ok"], serde_json::Value::Bool(true));
        assert_eq!(envelope["kind"], "value");
        assert_eq!(envelope["value"], serde_json::json!(4.0));
    }

    #[test]
    fn build_rolling_envelope_too_short_emits_legacy_message() {
        let envelope = build_rolling_envelope("SMA", &[1.0, 2.0], 5);
        assert_eq!(envelope["ok"], serde_json::Value::Bool(false));
        assert_eq!(envelope["error"]["kind"], "rolling");
        assert_eq!(
            envelope["error"]["message"],
            "SMA requires at least 5 data points, got 2",
        );
    }

    #[test]
    fn build_rolling_envelope_unknown_kind_is_argument_error() {
        let envelope = build_rolling_envelope("STDEV", &[1.0, 2.0, 3.0], 2);
        assert_eq!(envelope["ok"], serde_json::Value::Bool(false));
        assert_eq!(envelope["error"]["kind"], "argument");
        assert_eq!(
            envelope["error"]["message"],
            "unknown moving-average kind: STDEV",
        );
    }

    #[test]
    fn build_rolling_envelope_non_finite_is_unsupported() {
        let envelope = build_rolling_envelope("EMA", &[1.0, f64::NAN, 3.0, 4.0, 5.0], 3);
        assert_eq!(envelope["ok"], serde_json::Value::Bool(true));
        assert_eq!(envelope["kind"], "unsupported");
    }

    #[test]
    fn build_rolling_envelope_period_zero_is_unsupported() {
        let envelope = build_rolling_envelope("SMA", &[1.0, 2.0, 3.0], 0);
        assert_eq!(envelope["ok"], serde_json::Value::Bool(true));
        assert_eq!(envelope["kind"], "unsupported");
    }

    #[test]
    fn panic_message_extracts_static_str() {
        let payload: Box<dyn std::any::Any + Send> = Box::new("oops");
        assert_eq!(panic_message(payload), "oops");
    }

    #[test]
    fn panic_message_extracts_owned_string() {
        let payload: Box<dyn std::any::Any + Send> = Box::new(String::from("boom"));
        assert_eq!(panic_message(payload), "boom");
    }
}
