//! CLI fallback shell for the `analysis_core` parser.
//!
//! Reads the formula text from stdin (or `--healthcheck` from argv) and
//! writes a single-line JSON envelope to stdout.
//!
//! Envelope shapes:
//!
//! ```text
//! { "ok": true,  "ast": <AstNode> }
//! { "ok": false, "message": <string>, "position": <number> }
//! ```
//!
//! The TypeScript shim under `src/domain/analysis/indicator/calculator.ts`
//! consumes this envelope behind the `OPENALICE_RUST_ANALYSIS=1` feature
//! flag. With the flag at `0` (default) the shim does not invoke this
//! binary at all; the legacy in-process TypeScript parser is used.

use std::io::{self, Read, Write};

use analysis_core::parse;

fn main() {
    let mut args = std::env::args().skip(1);
    if let Some(arg) = args.next() {
        if arg == "--healthcheck" {
            println!("{}", analysis_core::bootstrap_healthcheck());
            return;
        }
        eprintln!("unknown argument: {}", arg);
        std::process::exit(2);
    }

    let mut formula = String::new();
    if let Err(err) = io::stdin().read_to_string(&mut formula) {
        eprintln!("failed to read stdin: {}", err);
        std::process::exit(2);
    }

    let stdout = io::stdout();
    let mut out = stdout.lock();
    match parse(&formula) {
        Ok(ast) => {
            let envelope = serde_json::json!({
                "ok": true,
                "ast": ast,
            });
            // serde_json on AstNode uses the camelCase `type` discriminator.
            let line = serde_json::to_string(&envelope).expect("serialize ast envelope");
            writeln!(out, "{}", line).expect("write stdout");
        }
        Err(err) => {
            let envelope = serde_json::json!({
                "ok": false,
                "message": err.message,
                "position": err.position,
            });
            let line = serde_json::to_string(&envelope).expect("serialize err envelope");
            writeln!(out, "{}", line).expect("write stdout");
        }
    }
}
