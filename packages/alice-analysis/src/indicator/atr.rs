use crate::error::AnalysisError;

// Average True Range. Match TS exactly:
//   if h.len != l.len || l.len != c.len || h.len < period+1: error
//   for i in 1..h.len:
//     tr = max(h[i] - l[i], |h[i] - c[i-1]|, |l[i] - c[i-1]|)
//     trueRanges.push(tr)
//   atr = sum(trueRanges[..period]) / period
//   for i in period..trueRanges.len:
//     atr = (atr * (period - 1) + trueRanges[i]) / period
//
// Quirk #5: bar 0 has no previous close, so the TR loop starts at i=1 (data[0] is consumed
// only as `c[i-1]` for i=1). Caller must supply ≥ period+1 aligned bars.
pub fn atr(
    highs: &[f64],
    lows: &[f64],
    closes: &[f64],
    period: usize,
) -> Result<f64, AnalysisError> {
    if period == 0 {
        return Err(AnalysisError::EvalError(
            "ATR period must be > 0".to_string(),
        ));
    }
    if highs.len() != lows.len() || lows.len() != closes.len() {
        return Err(AnalysisError::EvalError(format!(
            "ATR requires aligned arrays: highs={}, lows={}, closes={}",
            highs.len(),
            lows.len(),
            closes.len()
        )));
    }
    if highs.len() < period + 1 {
        return Err(AnalysisError::InsufficientData {
            needed: period + 1,
            got: highs.len(),
            indicator: "ATR",
        });
    }

    let mut true_ranges: Vec<f64> = Vec::with_capacity(highs.len() - 1);
    for i in 1..highs.len() {
        let a = highs[i] - lows[i];
        let b = (highs[i] - closes[i - 1]).abs();
        let c = (lows[i] - closes[i - 1]).abs();
        // Mirror Math.max(a, b, c) NaN-poison behaviour.
        let mut tr = a;
        if tr.is_nan() || b.is_nan() {
            tr = f64::NAN;
        } else if b > tr {
            tr = b;
        }
        if tr.is_nan() || c.is_nan() {
            tr = f64::NAN;
        } else if c > tr {
            tr = c;
        }
        true_ranges.push(tr);
    }

    let mut sum = 0.0_f64;
    for i in 0..period {
        sum += true_ranges[i];
    }
    let mut atr_v = sum / period as f64;
    let p_minus_1 = (period as f64) - 1.0;
    let p = period as f64;
    for i in period..true_ranges.len() {
        atr_v = (atr_v * p_minus_1 + true_ranges[i]) / p;
    }

    Ok(atr_v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(n: usize, start: f64) -> Vec<f64> {
        (0..n).map(|i| start + i as f64).collect()
    }

    #[test]
    fn atr_50_bar_ramp_is_positive() {
        // Mock: high = 102+i, low = 99+i, close = 100+i. So h-l = 3 every bar;
        // |h_i - c_{i-1}| = (102+i) - (100+i-1) = 3; |l_i - c_{i-1}| = |99+i - (100+i-1)| = 0.
        // TR = max(3, 3, 0) = 3 always. ATR = 3.
        let highs: Vec<f64> = (0..50).map(|i| 102.0 + i as f64).collect();
        let lows: Vec<f64> = (0..50).map(|i| 99.0 + i as f64).collect();
        let closes: Vec<f64> = (0..50).map(|i| 100.0 + i as f64).collect();
        let v = atr(&highs, &lows, &closes, 14).unwrap();
        assert_eq!(v, 3.0);
    }

    #[test]
    fn atr_insufficient_data() {
        // need period+1 = 15; give 14.
        let h = ramp(14, 102.0);
        let l = ramp(14, 99.0);
        let c = ramp(14, 100.0);
        let err = atr(&h, &l, &c, 14).unwrap_err();
        match err {
            AnalysisError::InsufficientData {
                needed: 15,
                got: 14,
                indicator: "ATR",
            } => {}
            _ => panic!("unexpected: {err:?}"),
        }
    }

    #[test]
    fn atr_at_minimum_size_boundary() {
        // exactly period+1 = 15 bars: 14 true ranges, no smoothing tail.
        let h = ramp(15, 102.0);
        let l = ramp(15, 99.0);
        let c = ramp(15, 100.0);
        let v = atr(&h, &l, &c, 14).unwrap();
        // Same constant TR = 3 by construction.
        assert_eq!(v, 3.0);
    }

    #[test]
    fn atr_misaligned_arrays_error() {
        let h = ramp(20, 102.0);
        let l = ramp(19, 99.0);
        let c = ramp(20, 100.0);
        assert!(atr(&h, &l, &c, 14).is_err());
    }

    #[test]
    fn atr_period_zero_errors() {
        let h = ramp(20, 102.0);
        let l = ramp(20, 99.0);
        let c = ramp(20, 100.0);
        assert!(atr(&h, &l, &c, 0).is_err());
    }

    #[test]
    fn atr_first_close_used_only_as_prev_close_not_for_tr() {
        // Build a series where the FIRST close is wildly out-of-band; if the kernel
        // used data[0] for an actual TR computation the result would explode.
        // Instead it's only `c[i-1]` for i=1, so bar 1's TR uses it; bars 2..end don't.
        let mut h = vec![1e9_f64];
        let mut l = vec![-1e9_f64];
        let mut c = vec![1e6_f64];
        for i in 0..20 {
            h.push(102.0 + i as f64);
            l.push(99.0 + i as f64);
            c.push(100.0 + i as f64);
        }
        // The first TR (bar 1) will use c[0]=1e6 → huge spike → seed avg dominated by it.
        // We only assert the call succeeds and returns a finite number; the smoothing
        // window was 14 so the spike survives. This documents the "first close consumed
        // as prev-close, never as a TR input" invariant.
        let v = atr(&h, &l, &c, 14).unwrap();
        assert!(v.is_finite(), "atr = {v}");
    }
}
