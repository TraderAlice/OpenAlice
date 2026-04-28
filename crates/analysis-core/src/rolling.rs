//! Finite `number[]` rolling-window moving averages slice (OPE-20).
//!
//! Ports `SMA` and `EMA` from
//! `src/domain/analysis/indicator/functions/statistics.ts` to Rust over a
//! finite `&[f64]` plus a positive `usize` period. The TypeScript module
//! still owns `toValues(...)`, `TrackedValues`, data-fetching, the
//! formula grammar, and every other rolling/technical indicator
//! (`STDEV`, `RSI`, `BBANDS`, `MACD`, `ATR`).
//!
//! Parity contract locked here:
//!
//! - `SMA(values, period)` requires `values.len() >= period`. Below that
//!   threshold it returns
//!   `Error("SMA requires at least <period> data points, got <len>")`,
//!   matching the legacy TS error string verbatim. Successful calls take
//!   the trailing `period` values, sum them sequentially left-to-right,
//!   and divide by `period`.
//! - `EMA(values, period)` has the same `len < period` error
//!   (`"EMA requires at least <period> data points, got <len>"`). On a
//!   valid input it seeds `ema` from the SMA of the first `period`
//!   values and then applies `multiplier = 2 / (period + 1)` across the
//!   remaining values, matching the legacy TS recurrence
//!   `ema = (v[i] - ema) * multiplier + ema` left-to-right.
//! - Non-finite inputs (`NaN`, `+/-Infinity`) come back as
//!   [`RollingOutcome::Unsupported`]. The JS wrapper pre-screens for
//!   these (the JSON envelope cannot carry them), so this is a
//!   defensive second check on the Rust side.
//! - A `period` of `0` is also returned as
//!   [`RollingOutcome::Unsupported`]. The JS wrapper additionally
//!   rejects non-integer / non-positive periods up-front so this
//!   defensive check on the kernel side only triggers if a future caller
//!   bypasses the wrapper.

/// Identifier for the rolling-window moving-average kernel to apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RollingKind {
    Sma,
    Ema,
}

impl RollingKind {
    /// Parse the JS-side spelling (`"SMA"`, `"EMA"`). Anything else
    /// returns `None` so the binding can surface an explicit
    /// "unknown moving-average kind" error rather than silently treating
    /// the input as one of the two kernels.
    pub fn parse(kind: &str) -> Option<Self> {
        match kind {
            "SMA" => Some(Self::Sma),
            "EMA" => Some(Self::Ema),
            _ => None,
        }
    }

    /// Stable string identifier used in error messages and bench reports.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sma => "SMA",
            Self::Ema => "EMA",
        }
    }
}

/// Outcome of a rolling-window moving-average attempt.
#[derive(Debug, Clone, PartialEq)]
pub enum RollingOutcome {
    /// The kernel succeeded; `value` matches the legacy TS implementation
    /// bit-for-bit on finite inputs (sequential left-to-right `f64`
    /// addition for `SMA`, and the `(v[i] - ema) * multiplier + ema`
    /// recurrence for `EMA`, both seeded the same way as the legacy TS).
    Value(f64),
    /// The kernel raised a runtime error whose `.message` is parity-
    /// locked with the legacy TypeScript implementation
    /// (e.g. `"SMA requires at least 5 data points, got 3"`).
    Error(RollingError),
    /// The slice contains at least one non-finite (`NaN` /
    /// `+/-Infinity`) element, or `period == 0`. The Rust kernel does not
    /// own these cases for OPE-20; the caller must hand the reduction
    /// back to the legacy TypeScript implementation.
    Unsupported,
}

/// Runtime rolling-window error with the legacy-format human-readable message.
#[derive(Debug, Clone, PartialEq)]
pub struct RollingError {
    pub message: String,
}

impl RollingError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for RollingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for RollingError {}

/// Apply [`RollingKind`] to `values` with parity-locked semantics.
///
/// Returns [`RollingOutcome::Unsupported`] up-front if `period == 0` or
/// if any element is non-finite, so a non-finite input never enters the
/// kernel. Otherwise the empty/short-input branch returns the legacy
/// error and successful inputs return the moving-average value.
pub fn moving_average(kind: RollingKind, values: &[f64], period: usize) -> RollingOutcome {
    if period == 0 {
        return RollingOutcome::Unsupported;
    }
    if values.iter().any(|v| !v.is_finite()) {
        return RollingOutcome::Unsupported;
    }
    if values.len() < period {
        return RollingOutcome::Error(RollingError::new(format!(
            "{} requires at least {} data points, got {}",
            kind.as_str(),
            period,
            values.len(),
        )));
    }
    match kind {
        RollingKind::Sma => RollingOutcome::Value(sma_finite(values, period)),
        RollingKind::Ema => RollingOutcome::Value(ema_finite(values, period)),
    }
}

fn sma_finite(values: &[f64], period: usize) -> f64 {
    let start = values.len() - period;
    let slice = &values[start..];
    let mut acc = 0.0_f64;
    for &v in slice {
        acc += v;
    }
    acc / period as f64
}

fn ema_finite(values: &[f64], period: usize) -> f64 {
    let multiplier = 2.0_f64 / (period as f64 + 1.0_f64);
    let mut seed = 0.0_f64;
    for &v in &values[..period] {
        seed += v;
    }
    let mut ema = seed / period as f64;
    for &v in &values[period..] {
        ema = (v - ema) * multiplier + ema;
    }
    ema
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_kind_round_trip() {
        for k in [RollingKind::Sma, RollingKind::Ema] {
            assert_eq!(RollingKind::parse(k.as_str()), Some(k));
        }
        assert!(RollingKind::parse("STDEV").is_none());
        assert!(RollingKind::parse("sma").is_none(), "case-sensitive");
        assert!(RollingKind::parse("").is_none());
    }

    #[test]
    fn sma_basic_period_3() {
        // Trailing-period semantics: SMA([1,2,3,4,5], 3) = (3+4+5)/3 = 4.
        assert_eq!(
            moving_average(RollingKind::Sma, &[1.0, 2.0, 3.0, 4.0, 5.0], 3),
            RollingOutcome::Value(4.0),
        );
    }

    #[test]
    fn sma_full_length_matches_average() {
        // SMA over the full slice equals AVERAGE.
        let values: Vec<f64> = (1..=10).map(|i| i as f64).collect();
        let expected = values.iter().sum::<f64>() / values.len() as f64;
        assert_eq!(
            moving_average(RollingKind::Sma, &values, values.len()),
            RollingOutcome::Value(expected),
        );
    }

    #[test]
    fn ema_basic_period_3() {
        // Legacy recurrence: seed = (v[0]+v[1]+v[2])/3 = 2; mult = 2/(3+1) = 0.5.
        // i=3: ema = (4 - 2)*0.5 + 2 = 3.
        // i=4: ema = (5 - 3)*0.5 + 3 = 4.
        assert_eq!(
            moving_average(RollingKind::Ema, &[1.0, 2.0, 3.0, 4.0, 5.0], 3),
            RollingOutcome::Value(4.0),
        );
    }

    #[test]
    fn ema_period_equal_length_matches_seed_sma() {
        // With len == period the recurrence loop is empty so EMA equals
        // the SMA of the same window.
        let values = [10.0_f64, 20.0, 30.0, 40.0, 50.0];
        let expected = values.iter().sum::<f64>() / values.len() as f64;
        assert_eq!(
            moving_average(RollingKind::Ema, &values, values.len()),
            RollingOutcome::Value(expected),
        );
    }

    #[test]
    fn period_one_sma_returns_last_value() {
        // SMA with period=1 always returns the last value (trailing window
        // of length 1).
        assert_eq!(
            moving_average(RollingKind::Sma, &[7.0, 8.0, 9.0], 1),
            RollingOutcome::Value(9.0),
        );
    }

    #[test]
    fn period_one_ema_returns_last_value() {
        // EMA with period=1: multiplier = 2/2 = 1, so ema = v[i] every
        // step. The result is the last value.
        assert_eq!(
            moving_average(RollingKind::Ema, &[7.0, 8.0, 9.0], 1),
            RollingOutcome::Value(9.0),
        );
    }

    #[test]
    fn sma_too_short_emits_legacy_error() {
        match moving_average(RollingKind::Sma, &[1.0, 2.0], 5) {
            RollingOutcome::Error(err) => {
                assert_eq!(err.message, "SMA requires at least 5 data points, got 2");
            }
            other => panic!("expected legacy SMA error, got {other:?}"),
        }
    }

    #[test]
    fn ema_too_short_emits_legacy_error() {
        match moving_average(RollingKind::Ema, &[1.0, 2.0], 5) {
            RollingOutcome::Error(err) => {
                assert_eq!(err.message, "EMA requires at least 5 data points, got 2");
            }
            other => panic!("expected legacy EMA error, got {other:?}"),
        }
    }

    #[test]
    fn empty_input_emits_legacy_error() {
        // Empty input under any positive period returns the legacy
        // "<KIND> requires at least <period> data points, got 0" error.
        match moving_average(RollingKind::Sma, &[], 1) {
            RollingOutcome::Error(err) => {
                assert_eq!(err.message, "SMA requires at least 1 data points, got 0");
            }
            other => panic!("expected legacy SMA error, got {other:?}"),
        }
        match moving_average(RollingKind::Ema, &[], 3) {
            RollingOutcome::Error(err) => {
                assert_eq!(err.message, "EMA requires at least 3 data points, got 0");
            }
            other => panic!("expected legacy EMA error, got {other:?}"),
        }
    }

    #[test]
    fn period_zero_is_unsupported_for_both_kinds() {
        // Period 0 is rejected by the JS wrapper, but the kernel also
        // refuses it defensively rather than dividing by zero.
        for k in [RollingKind::Sma, RollingKind::Ema] {
            assert_eq!(
                moving_average(k, &[1.0, 2.0, 3.0], 0),
                RollingOutcome::Unsupported,
            );
        }
    }

    #[test]
    fn nan_input_is_unsupported_for_both_kinds() {
        let with_nan = [1.0, f64::NAN, 3.0, 4.0, 5.0];
        for k in [RollingKind::Sma, RollingKind::Ema] {
            assert_eq!(moving_average(k, &with_nan, 3), RollingOutcome::Unsupported,);
        }
    }

    #[test]
    fn infinity_input_is_unsupported_for_both_kinds() {
        let with_inf = [1.0, f64::INFINITY, 3.0, 4.0, 5.0];
        let with_neg_inf = [1.0, f64::NEG_INFINITY, 3.0, 4.0, 5.0];
        for k in [RollingKind::Sma, RollingKind::Ema] {
            assert_eq!(moving_average(k, &with_inf, 3), RollingOutcome::Unsupported);
            assert_eq!(
                moving_average(k, &with_neg_inf, 3),
                RollingOutcome::Unsupported,
            );
        }
    }

    #[test]
    fn sma_matches_legacy_left_to_right_addition_at_period_window() {
        // Sequential left-to-right f64 addition over the trailing window
        // is the legacy SMA semantics. Pick a window where reordering
        // would change the bit-wise result.
        let values = [42.0_f64, 0.0, 1e16, 1.0, -1e16];
        let expected = (1e16_f64 + 1.0 + -1e16_f64) / 3.0;
        assert_eq!(
            moving_average(RollingKind::Sma, &values, 3),
            RollingOutcome::Value(expected),
        );
    }

    #[test]
    fn ema_matches_legacy_recurrence_step_by_step() {
        // Spot-check the recurrence on a non-trivial input. period=4,
        // multiplier = 2/5 = 0.4.
        // seed = (1+2+3+4)/4 = 2.5
        // i=4: ema = (5 - 2.5)*0.4 + 2.5 = 3.5
        // i=5: ema = (6 - 3.5)*0.4 + 3.5 = 4.5
        // i=6: ema = (7 - 4.5)*0.4 + 4.5 = 5.5
        let values = [1.0_f64, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0];
        assert_eq!(
            moving_average(RollingKind::Ema, &values, 4),
            RollingOutcome::Value(5.5),
        );
    }

    #[test]
    fn single_element_period_one_for_both_kinds() {
        // The shortest valid input. SMA returns the value, EMA seeds from
        // it and never enters the recurrence loop.
        for k in [RollingKind::Sma, RollingKind::Ema] {
            assert_eq!(moving_average(k, &[42.0], 1), RollingOutcome::Value(42.0),);
        }
    }
}
