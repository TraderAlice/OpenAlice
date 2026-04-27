//! OpenAlice `analysis_core` kernel crate.
//!
//! Phase 2 lands incrementally. The first slice is parser-only: a faithful
//! Rust port of `IndicatorCalculator.parse` from
//! `src/domain/analysis/indicator/calculator.ts`. The TypeScript evaluator,
//! data-access functions, statistics kernels, technical indicators, and
//! tool surface remain authoritative until later slices port them.
//!
//! Per ADR-003 this crate must not depend on Node-API; the binding crate
//! at `packages/node-bindings/analysis-core/` is the only place allowed
//! to know about Node-API.

#![forbid(unsafe_code)]

pub mod parser;

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
