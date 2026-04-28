//! Finite `number[]` reductions slice (OPE-19).
//!
//! Ports the smallest set of analysis_core statistics kernels to Rust:
//! `MIN`, `MAX`, `SUM`, and `AVERAGE` over a finite `f64` slice.
//!
//! The TypeScript `Statistics` module
//! (`src/domain/analysis/indicator/functions/statistics.ts`) keeps owning
//! `toValues(...)`, `TrackedValues` metadata, data-fetching, and any
//! rolling-window or technical indicators (`SMA`, `EMA`, `STDEV`, `RSI`,
//! `BBANDS`, `MACD`, `ATR`). Rust receives a plain `&[f64]` plus a
//! [`ReductionKind`] discriminator and produces a [`ReductionOutcome`].
//!
//! Parity contract locked here:
//!
//! - `MIN([])`     produces `Error("MIN requires at least 1 data point")`
//! - `MAX([])`     produces `Error("MAX requires at least 1 data point")`
//! - `AVERAGE([])` produces `Error("AVERAGE requires at least 1 data point")`
//! - `SUM([])`     produces `Value(0.0)` (legacy `[].reduce(...,0)` semantics)
//! - On a non-empty input the four kernels match the legacy TypeScript
//!   implementations bit-for-bit on finite inputs (sequential left-to-right
//!   `f64` addition; `<` / `>` comparisons against the running extreme).
//!
//! Non-finite inputs (`NaN`, `+/-Infinity`) are intentionally classified
//! as [`ReductionOutcome::Unsupported`]. The JS wrapper pre-screens for
//! these to keep them off the napi-rs JSON envelope (which cannot encode
//! them) and the legacy TypeScript reductions stay authoritative for
//! such arrays. This is a defensive second check on the Rust side so a
//! pre-screen bypass cannot land non-finite values in the kernel.

/// Identifier for the reduction kernel to apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReductionKind {
    Min,
    Max,
    Sum,
    Average,
}

impl ReductionKind {
    /// Parse the JS-side spelling (`"MIN"`, `"MAX"`, `"SUM"`, `"AVERAGE"`).
    /// Anything else returns `None` so the binding can surface an explicit
    /// "unknown reduction kind" error rather than silently treating the
    /// input as one of the four kernels.
    pub fn parse(kind: &str) -> Option<Self> {
        match kind {
            "MIN" => Some(Self::Min),
            "MAX" => Some(Self::Max),
            "SUM" => Some(Self::Sum),
            "AVERAGE" => Some(Self::Average),
            _ => None,
        }
    }

    /// Stable string identifier used in error messages and bench reports.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Min => "MIN",
            Self::Max => "MAX",
            Self::Sum => "SUM",
            Self::Average => "AVERAGE",
        }
    }
}

/// Outcome of a finite-array reduction attempt.
#[derive(Debug, Clone, PartialEq)]
pub enum ReductionOutcome {
    /// The reduction succeeded; `value` matches the legacy TypeScript
    /// reduction bit-for-bit on finite inputs.
    Value(f64),
    /// The reduction raised a runtime error whose `.message` is parity-
    /// locked with the legacy TypeScript implementation (e.g. `"MIN
    /// requires at least 1 data point"`).
    Error(ReductionError),
    /// The slice contains at least one non-finite (`NaN` / `+/-Infinity`)
    /// element. The Rust kernel does not own this case for OPE-19; the
    /// caller must hand the reduction back to the legacy TypeScript
    /// implementation.
    Unsupported,
}

/// Runtime reduction error with the legacy-format human-readable message.
#[derive(Debug, Clone, PartialEq)]
pub struct ReductionError {
    pub message: String,
}

impl ReductionError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ReductionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ReductionError {}

/// Apply [`ReductionKind`] to `values` with parity-locked semantics.
///
/// Returns [`ReductionOutcome::Unsupported`] up-front if any element is
/// non-finite, so a non-finite input never enters the kernel. Empty-array
/// behavior is per-kind: `MIN`/`MAX`/`AVERAGE` return the legacy error;
/// `SUM` returns `Value(0.0)` to mirror `[].reduce((a, v) => a + v, 0)`.
pub fn reduce(kind: ReductionKind, values: &[f64]) -> ReductionOutcome {
    if values.iter().any(|v| !v.is_finite()) {
        return ReductionOutcome::Unsupported;
    }
    match kind {
        ReductionKind::Min => reduce_min(values),
        ReductionKind::Max => reduce_max(values),
        ReductionKind::Sum => ReductionOutcome::Value(sum_finite(values)),
        ReductionKind::Average => reduce_average(values),
    }
}

fn reduce_min(values: &[f64]) -> ReductionOutcome {
    if values.is_empty() {
        return ReductionOutcome::Error(ReductionError::new("MIN requires at least 1 data point"));
    }
    let mut acc = values[0];
    for &v in &values[1..] {
        if v < acc {
            acc = v;
        }
    }
    ReductionOutcome::Value(acc)
}

fn reduce_max(values: &[f64]) -> ReductionOutcome {
    if values.is_empty() {
        return ReductionOutcome::Error(ReductionError::new("MAX requires at least 1 data point"));
    }
    let mut acc = values[0];
    for &v in &values[1..] {
        if v > acc {
            acc = v;
        }
    }
    ReductionOutcome::Value(acc)
}

fn reduce_average(values: &[f64]) -> ReductionOutcome {
    if values.is_empty() {
        return ReductionOutcome::Error(ReductionError::new(
            "AVERAGE requires at least 1 data point",
        ));
    }
    ReductionOutcome::Value(sum_finite(values) / values.len() as f64)
}

fn sum_finite(values: &[f64]) -> f64 {
    let mut acc = 0.0_f64;
    for &v in values {
        acc += v;
    }
    acc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_kind_round_trip() {
        for k in [
            ReductionKind::Min,
            ReductionKind::Max,
            ReductionKind::Sum,
            ReductionKind::Average,
        ] {
            assert_eq!(ReductionKind::parse(k.as_str()), Some(k));
        }
        assert!(ReductionKind::parse("STDEV").is_none());
        assert!(ReductionKind::parse("min").is_none(), "case-sensitive");
        assert!(ReductionKind::parse("").is_none());
    }

    #[test]
    fn min_basic() {
        assert_eq!(
            reduce(ReductionKind::Min, &[3.0, 1.0, 2.0]),
            ReductionOutcome::Value(1.0),
        );
    }

    #[test]
    fn max_basic() {
        assert_eq!(
            reduce(ReductionKind::Max, &[3.0, 1.0, 2.0]),
            ReductionOutcome::Value(3.0),
        );
    }

    #[test]
    fn sum_basic() {
        assert_eq!(
            reduce(ReductionKind::Sum, &[1.0, 2.0, 3.0]),
            ReductionOutcome::Value(6.0),
        );
    }

    #[test]
    fn average_basic() {
        assert_eq!(
            reduce(ReductionKind::Average, &[1.0, 2.0, 3.0]),
            ReductionOutcome::Value(2.0),
        );
    }

    #[test]
    fn min_empty_is_legacy_error() {
        match reduce(ReductionKind::Min, &[]) {
            ReductionOutcome::Error(err) => {
                assert_eq!(err.message, "MIN requires at least 1 data point");
            }
            other => panic!("expected legacy MIN error, got {other:?}"),
        }
    }

    #[test]
    fn max_empty_is_legacy_error() {
        match reduce(ReductionKind::Max, &[]) {
            ReductionOutcome::Error(err) => {
                assert_eq!(err.message, "MAX requires at least 1 data point");
            }
            other => panic!("expected legacy MAX error, got {other:?}"),
        }
    }

    #[test]
    fn average_empty_is_legacy_error() {
        match reduce(ReductionKind::Average, &[]) {
            ReductionOutcome::Error(err) => {
                assert_eq!(err.message, "AVERAGE requires at least 1 data point");
            }
            other => panic!("expected legacy AVERAGE error, got {other:?}"),
        }
    }

    #[test]
    fn sum_empty_returns_zero_like_legacy_reduce() {
        assert_eq!(
            reduce(ReductionKind::Sum, &[]),
            ReductionOutcome::Value(0.0),
        );
    }

    #[test]
    fn nan_input_is_unsupported_for_all_kinds() {
        let with_nan = [1.0, f64::NAN, 3.0];
        for k in [
            ReductionKind::Min,
            ReductionKind::Max,
            ReductionKind::Sum,
            ReductionKind::Average,
        ] {
            assert_eq!(reduce(k, &with_nan), ReductionOutcome::Unsupported);
        }
    }

    #[test]
    fn infinity_input_is_unsupported_for_all_kinds() {
        let with_inf = [1.0, f64::INFINITY, 3.0];
        let with_neg_inf = [1.0, f64::NEG_INFINITY, 3.0];
        for k in [
            ReductionKind::Min,
            ReductionKind::Max,
            ReductionKind::Sum,
            ReductionKind::Average,
        ] {
            assert_eq!(reduce(k, &with_inf), ReductionOutcome::Unsupported);
            assert_eq!(reduce(k, &with_neg_inf), ReductionOutcome::Unsupported);
        }
    }

    #[test]
    fn min_max_match_legacy_left_to_right_scan() {
        // Legacy MIN/MAX use Math.min(...v) / Math.max(...v); that's
        // equivalent to a left-to-right scan with `<` / `>`. Lock that
        // ordering on a value that appears multiple times.
        assert_eq!(
            reduce(ReductionKind::Min, &[2.5, 2.5, 2.5]),
            ReductionOutcome::Value(2.5),
        );
        assert_eq!(
            reduce(ReductionKind::Max, &[-1.0, -1.0, -1.0]),
            ReductionOutcome::Value(-1.0),
        );
    }

    #[test]
    fn sum_average_match_legacy_left_to_right_addition() {
        // Sequential left-to-right f64 addition is the legacy reduction
        // order. Pick values where reordering would change the float
        // result so this property would fail under a different ordering.
        let values = [1e16_f64, 1.0, -1e16_f64];
        assert_eq!(
            reduce(ReductionKind::Sum, &values),
            ReductionOutcome::Value(1e16_f64 + 1.0 + -1e16_f64),
        );
        // The legacy AVERAGE divides the sequential sum by length, not
        // by a pair-wise mean. Lock that on the same poison-ordering.
        assert_eq!(
            reduce(ReductionKind::Average, &values),
            ReductionOutcome::Value((1e16_f64 + 1.0 + -1e16_f64) / 3.0),
        );
    }

    #[test]
    fn single_element_arrays() {
        assert_eq!(
            reduce(ReductionKind::Min, &[42.0]),
            ReductionOutcome::Value(42.0),
        );
        assert_eq!(
            reduce(ReductionKind::Max, &[42.0]),
            ReductionOutcome::Value(42.0),
        );
        assert_eq!(
            reduce(ReductionKind::Sum, &[42.0]),
            ReductionOutcome::Value(42.0),
        );
        assert_eq!(
            reduce(ReductionKind::Average, &[42.0]),
            ReductionOutcome::Value(42.0),
        );
    }
}
