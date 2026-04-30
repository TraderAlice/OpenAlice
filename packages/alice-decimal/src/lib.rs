// String-encoded decimal codec (shared) — the wire format from
// `_rust-port/02-design.md` §4 and re-affirmed in stage-2 design `06` §1.4
// (Q-EXTRACT).
//
// Format:
//   * Plain decimal: regex `^-?\d+(\.\d+)?$`. No scientific notation.
//   * No whitespace. Strict.
//   * NaN/Infinity not representable — we error.
//   * Trailing zeros preserved (rust_decimal preserves scale).
//   * 28-significant-digit cap (rust_decimal's hard limit).
//   * "0" and "-0" both decode to zero; encode emits whatever scale rust_decimal
//     stores (a stage-2 concern, not a codec concern).
//
// This crate is consumed by:
//   * `alice-analysis` (stage 1) — re-exports from its TS adapter for back-compat.
//   * `alice-trading-core` (stage 2) — primary use site for Money/Quantity/Price.
//
// Only `napi.rs` imports `napi-derive`; this module is plain Rust so future
// crates can pull it in via `path = "../alice-decimal"` (rlib build) without
// dragging in a Node runtime. Cargo.toml ships `["cdylib", "rlib"]` so
// alice-trading-core (task #12) can `use alice_decimal::{encode, decode, ...}`
// directly.

#![deny(clippy::all)]

#[cfg(feature = "napi")]
pub mod napi;

use std::str::FromStr;

use rust_decimal::Decimal;

/// Errors produced by the codec. Each variant has a stable string `code()` so
/// the napi layer can surface it through the same `CODE|message` envelope
/// shape stage 1 established. Keep it tiny — codec scope is intentionally
/// narrow (encode/decode/checked-add) and broader errors belong to consumers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecimalError {
    /// Wire-format string did not match `^-?\d+(\.\d+)?$`, or the string
    /// parsed as a regex match but `rust_decimal` rejected it (e.g. > 28 sig
    /// figs). Body is a human-readable hint; the `code()` is the contract.
    Format(String),
    /// Arithmetic overflow inside `rust_decimal`. The codec only does this for
    /// the `add` helper; consumers doing more arithmetic should map their own
    /// overflows through this variant for code parity.
    Overflow,
}

impl DecimalError {
    pub fn code(&self) -> &'static str {
        match self {
            DecimalError::Format(_) => "DECIMAL_FORMAT",
            DecimalError::Overflow => "DECIMAL_OVERFLOW",
        }
    }

    pub fn message(&self) -> String {
        match self {
            DecimalError::Format(m) => m.clone(),
            DecimalError::Overflow => "decimal overflow".to_string(),
        }
    }
}

impl std::fmt::Display for DecimalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for DecimalError {}

/// Encode a `rust_decimal::Decimal` as the wire string. Round-trips with
/// `decimal.js`'s `toFixed()` (no exponent form) on the TS side.
pub fn encode(d: &Decimal) -> String {
    // rust_decimal::Decimal::to_string preserves scale and never emits exponent
    // form, exactly matching `decimal.js` `toFixed()` shape.
    d.to_string()
}

/// Decode the wire string into a `rust_decimal::Decimal`. Validates the format
/// strictly — anything outside `^-?\d+(\.\d+)?$` is rejected.
pub fn decode(s: &str) -> Result<Decimal, DecimalError> {
    if !is_valid_wire_format(s) {
        return Err(DecimalError::Format(format!(
            "invalid decimal wire format: {s:?}"
        )));
    }
    Decimal::from_str(s).map_err(|e| DecimalError::Format(e.to_string()))
}

/// Lossless `a + b` returning the sum as a wire string. Errors on bad format
/// inputs or arithmetic overflow.
pub fn add(a: &str, b: &str) -> Result<String, DecimalError> {
    let da = decode(a)?;
    let db = decode(b)?;
    let sum = da.checked_add(db).ok_or(DecimalError::Overflow)?;
    Ok(encode(&sum))
}

fn is_valid_wire_format(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let bytes = s.as_bytes();
    let mut i = 0;
    if bytes[0] == b'-' {
        i = 1;
        if bytes.len() == 1 {
            return false;
        }
    }
    let int_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == int_start {
        return false;
    }
    if i == bytes.len() {
        return true;
    }
    if bytes[i] != b'.' {
        return false;
    }
    i += 1;
    let frac_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == frac_start {
        return false;
    }
    i == bytes.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_basic() {
        let s = "123.456";
        let d = decode(s).unwrap();
        assert_eq!(encode(&d), s);
    }

    #[test]
    fn round_trip_negative() {
        let d = decode("-100.5").unwrap();
        assert_eq!(encode(&d), "-100.5");
    }

    #[test]
    fn round_trip_integer() {
        let d = decode("42").unwrap();
        assert_eq!(encode(&d), "42");
    }

    #[test]
    fn trailing_zeros_preserved() {
        // rust_decimal preserves scale: "100.00" stays as "100.00".
        let d = decode("100.00").unwrap();
        assert_eq!(encode(&d), "100.00");
    }

    #[test]
    fn rejects_scientific_notation() {
        assert!(decode("1.5e10").is_err());
        assert!(decode("1E5").is_err());
    }

    #[test]
    fn rejects_whitespace() {
        assert!(decode(" 1.5").is_err());
        assert!(decode("1.5 ").is_err());
        assert!(decode("1. 5").is_err());
    }

    #[test]
    fn rejects_empty() {
        assert!(decode("").is_err());
    }

    #[test]
    fn rejects_lone_minus() {
        assert!(decode("-").is_err());
    }

    #[test]
    fn rejects_lone_dot() {
        assert!(decode(".").is_err());
        assert!(decode("1.").is_err());
        assert!(decode(".5").is_err());
    }

    #[test]
    fn rejects_double_dot() {
        assert!(decode("1.2.3").is_err());
    }

    #[test]
    fn rejects_thousands_separators() {
        assert!(decode("1,000.5").is_err());
        assert!(decode("1_000.5").is_err());
    }

    #[test]
    fn rejects_special_values() {
        assert!(decode("NaN").is_err());
        assert!(decode("Infinity").is_err());
        assert!(decode("-Infinity").is_err());
    }

    #[test]
    fn negative_zero_decodes_to_zero() {
        // Both "0" and "-0" decode; rust_decimal normalises to zero.
        let z = decode("0").unwrap();
        let nz = decode("-0").unwrap();
        assert_eq!(z, nz);
        // We don't assert encode("-0") == "0" because rust_decimal preserves the
        // negative sign on -0; this is a stage-2 concern (which Money flavour wins).
    }

    #[test]
    fn add_two_strings() {
        assert_eq!(add("1.5", "2.5").unwrap(), "4.0");
        assert_eq!(add("0.1", "0.2").unwrap(), "0.3");
        assert_eq!(add("-1", "1").unwrap(), "0");
    }

    #[test]
    fn add_propagates_format_error() {
        let err = add("nope", "1").unwrap_err();
        assert_eq!(err.code(), "DECIMAL_FORMAT");
    }

    #[test]
    fn error_codes_stable() {
        assert_eq!(DecimalError::Format("x".into()).code(), "DECIMAL_FORMAT");
        assert_eq!(DecimalError::Overflow.code(), "DECIMAL_OVERFLOW");
    }
}
