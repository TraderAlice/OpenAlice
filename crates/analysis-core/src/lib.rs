//! OpenAlice `analysis_core` kernel crate.
//!
//! Phase 2 lands incrementally. OPE-16/OPE-17 ported the parser; OPE-18
//! adds the smallest useful evaluator slice on top of it: arithmetic-only
//! evaluation for numeric literals and `+ - * /` between numbers, with
//! parity-locked `Division by zero` semantics. Strings, function calls,
//! array access, statistics kernels, technical indicators, data-access
//! functions, and the public tool surface remain authoritative on the
//! TypeScript side until later slices port them.
//!
//! Per ADR-003 this crate must not depend on Node-API; the binding crate
//! at `packages/node-bindings/analysis-core/` is the only place allowed
//! to know about Node-API.

#![forbid(unsafe_code)]

pub mod evaluator;
pub mod parser;

pub use evaluator::{evaluate_arithmetic_only, EvalError, EvalOutcome};
pub use parser::{parse, AstNode, ParseError};

/// Bootstrap healthcheck retained from the OPE-15 toolchain shell so the
/// binding crate, JS package, and CI smoke checks keep a stable, no-op
/// entry point that does not exercise parser logic.
pub fn bootstrap_healthcheck() -> &'static str {
    "analysis_core:bootstrap"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn healthcheck_returns_bootstrap_marker() {
        assert_eq!(bootstrap_healthcheck(), "analysis_core:bootstrap");
    }
}
