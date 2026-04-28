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

use napi::bindgen_prelude::{Error, Result, Status};
use napi_derive::napi;

pub use analysis_core::{bootstrap_healthcheck, parse, AstNode, ParseError};

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
