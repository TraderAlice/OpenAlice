//! OpenAlice `analysis_core` Node-API binding - bootstrap shell.
//!
//! The actual `napi-rs` bridge, DTO conversion, and `cdylib` `.node` build
//! land under a separate scoped implementation issue (see
//! `docs/autonomous-refactor/adr/ADR-003-binding-strategy.md`). For
//! bootstrap, this crate compiles as a plain `rlib` that re-exports the
//! upstream healthcheck so `cargo test --workspace` covers it.

#![forbid(unsafe_code)]

pub use analysis_core::bootstrap_healthcheck;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn re_exports_healthcheck() {
        assert_eq!(bootstrap_healthcheck(), "analysis_core:bootstrap");
    }
}
