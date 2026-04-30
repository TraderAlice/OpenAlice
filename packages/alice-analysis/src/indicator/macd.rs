use crate::error::AnalysisError;
use crate::indicator::ema::ema;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MacdOutput {
    pub macd: f64,
    pub signal: f64,
    pub histogram: f64,
}

// Match TS exactly. Note the quirky way TS computes signal: it recomputes EMA on every
// expanding-prefix slice from `slowPeriod..=v.length` to build a `macdHistory`, then
// EMA(macdHistory, signalPeriod). We must preserve this O(N^2) shape for parity.
//
//   fastEMA = EMA(v, fast)
//   slowEMA = EMA(v, slow)
//   macd    = fastEMA - slowEMA
//   for i in slow..=len: macdHistory.push(EMA(v[..i], fast) - EMA(v[..i], slow))
//   signal  = EMA(macdHistory, signal)
//   hist    = macd - signal
//
// Min points: ≥ slow + signal (per survey).
pub fn macd(
    data: &[f64],
    fast_period: usize,
    slow_period: usize,
    signal_period: usize,
) -> Result<MacdOutput, AnalysisError> {
    if fast_period == 0 || slow_period == 0 || signal_period == 0 {
        return Err(AnalysisError::EvalError(
            "MACD periods must be > 0".to_string(),
        ));
    }
    let needed = slow_period + signal_period;
    if data.len() < needed {
        return Err(AnalysisError::InsufficientData {
            needed,
            got: data.len(),
            indicator: "MACD",
        });
    }

    let fast_ema = ema(data, fast_period)?;
    let slow_ema = ema(data, slow_period)?;
    let macd_value = fast_ema - slow_ema;

    // TS: `for (let i = slowPeriod; i <= v.length; i++) { slice = v.slice(0, i); ... }`
    // i ranges inclusive of v.length, producing v.length - slowPeriod + 1 entries.
    let mut macd_history: Vec<f64> = Vec::with_capacity(data.len() - slow_period + 1);
    for i in slow_period..=data.len() {
        let slice = &data[..i];
        let fast = ema(slice, fast_period)?;
        let slow = ema(slice, slow_period)?;
        macd_history.push(fast - slow);
    }

    let signal_value = ema(&macd_history, signal_period)?;
    let histogram = macd_value - signal_value;

    Ok(MacdOutput {
        macd: macd_value,
        signal: signal_value,
        histogram,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(n: usize, start: f64) -> Vec<f64> {
        (0..n).map(|i| start + i as f64).collect()
    }

    #[test]
    fn macd_50_bar_ramp_returns_three_finite_numbers() {
        let data = ramp(50, 100.0);
        let r = macd(&data, 12, 26, 9).unwrap();
        assert!(r.macd.is_finite());
        assert!(r.signal.is_finite());
        assert!(r.histogram.is_finite());
        // Hist == macd - signal by construction.
        assert!((r.histogram - (r.macd - r.signal)).abs() < 1e-12);
    }

    #[test]
    fn macd_uptrend_macd_positive() {
        // For a clean uptrend the fast EMA exceeds the slow EMA → macd > 0.
        let data = ramp(60, 100.0);
        let r = macd(&data, 12, 26, 9).unwrap();
        assert!(r.macd > 0.0, "macd = {}", r.macd);
    }

    #[test]
    fn macd_insufficient_data_at_boundary() {
        // slow + signal = 35; with 34 we should error.
        let data = ramp(34, 100.0);
        let err = macd(&data, 12, 26, 9).unwrap_err();
        match err {
            AnalysisError::InsufficientData {
                needed: 35,
                got: 34,
                indicator: "MACD",
            } => {}
            _ => panic!("unexpected: {err:?}"),
        }
    }

    #[test]
    fn macd_at_minimum_size_succeeds() {
        let data = ramp(35, 100.0);
        let r = macd(&data, 12, 26, 9).unwrap();
        assert!(r.macd.is_finite());
    }

    #[test]
    fn macd_constant_series_is_all_zero() {
        // Constant input: both EMAs == constant → macd = 0, signal = 0, hist = 0.
        let data = vec![50.0_f64; 60];
        let r = macd(&data, 12, 26, 9).unwrap();
        assert_eq!(r.macd, 0.0);
        assert_eq!(r.signal, 0.0);
        assert_eq!(r.histogram, 0.0);
    }
}
