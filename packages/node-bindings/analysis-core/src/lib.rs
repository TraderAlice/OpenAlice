//! OpenAlice `analysis_core` Node binding crate.
//!
//! Phase 2 first parity slice: this crate exposes the Rust parser to the
//! Node side via a small CLI binary (`analysis-core-parse`). The binary
//! reads a formula from stdin and emits a JSON-encoded
//! `{ "ok": true, "ast": <AstNode> }` or
//! `{ "ok": false, "message": <string>, "position": <number> }`
//! envelope to stdout.
//!
//! The `napi-rs` in-process bridge described in
//! `docs/autonomous-refactor/adr/ADR-003-binding-strategy.md` is a
//! documented blocker for this slice: pulling in `napi`, `napi-derive`,
//! `napi-build`, and `@napi-rs/cli` plus the platform-specific `.node`
//! build pipeline counts as broad package/dependency churn and cannot
//! land within the OPE-16 allowed-files policy. The CLI binary is the
//! "explicit fallback test shell" that the issue authorizes in lieu of
//! the napi-rs bridge.
//!
//! The `lib.rs` here stays as a tiny `rlib` so `cargo test --workspace`
//! continues to cover the binding crate's healthcheck, and so the
//! eventual napi-rs bridge can drop in next to it without renaming the
//! crate.

#![forbid(unsafe_code)]

pub use analysis_core::{bootstrap_healthcheck, parse, AstNode, ParseError};

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
}
