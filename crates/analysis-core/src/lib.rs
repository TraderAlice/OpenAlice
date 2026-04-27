//! OpenAlice `analysis_core` crate - bootstrap shell.
//!
//! This crate exists so the Rust workspace, toolchain pin, and CI checks can
//! be wired up before any Phase 2 implementation begins. It must not contain
//! parser, evaluator, indicator, or DTO logic. The first implementation slice
//! lands under a separate, scoped issue.

#![forbid(unsafe_code)]

/// Bootstrap healthcheck. Returns a stable identifier so callers (tests,
/// future binding shell, CI smoke checks) can confirm the crate compiled
/// and linked. No domain meaning.
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
