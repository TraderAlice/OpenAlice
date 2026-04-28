// NAPI exports for the decimal codec. Surface intentionally tiny; growth is
// the consuming crate's job.
//
// Errors travel through the `CODE|message` envelope established in stage 1
// (`02-design.md` Q2): the TS side splits on the first `|`, validates against
// its allowlist, and rehydrates as a typed JS class.

use napi_derive::napi;

use crate::DecimalError;

impl From<DecimalError> for napi::Error {
    fn from(e: DecimalError) -> Self {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("{}|{}", e.code(), e.message()),
        )
    }
}

/// Validate and re-canonicalise a wire-format decimal string.
///
/// Round-trips through `rust_decimal::Decimal`. Rejects anything that doesn't
/// match `^-?\d+(\.\d+)?$` (no exponent, no whitespace, no thousands sep).
/// Useful in TS as a "is this a valid Money string?" check before persisting.
#[napi]
pub fn validate_wire_decimal(value: String) -> napi::Result<String> {
    let d = crate::decode(&value)?;
    Ok(crate::encode(&d))
}

/// Add two wire-decimal strings and return the result as a wire-decimal string.
#[napi]
pub fn add_wire_decimals(a: String, b: String) -> napi::Result<String> {
    crate::add(&a, &b).map_err(Into::into)
}

/// Returns the package crate version. Lets consumers verify they loaded the
/// expected `.node` artefact (handy for CI sanity).
#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
