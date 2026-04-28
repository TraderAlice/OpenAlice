use crate::error::AnalysisError;

// Match TS exactly:
//   changes[i] = data[i+1] - data[i]                  (length = N-1)
//   gains[i]   = changes[i] > 0 ? changes[i] : 0
//   losses[i]  = changes[i] < 0 ? -changes[i] : 0
//   avgGain    = sum(gains[0..period]) / period
//   avgLoss    = sum(losses[0..period]) / period
//   for i in period..gains.len:
//     avgGain  = (avgGain * (period - 1) + gains[i]) / period
//     avgLoss  = (avgLoss * (period - 1) + losses[i]) / period
//   if avgLoss == 0: return 100
//   rs = avgGain / avgLoss
//   100 - 100 / (1 + rs)
pub fn rsi(data: &[f64], period: usize) -> Result<f64, AnalysisError> {
    if period == 0 {
        return Err(AnalysisError::EvalError(
            "RSI period must be > 0".to_string(),
        ));
    }
    if data.len() < period + 1 {
        return Err(AnalysisError::InsufficientData {
            needed: period + 1,
            got: data.len(),
            indicator: "RSI",
        });
    }

    let n_changes = data.len() - 1;
    let mut gains = Vec::with_capacity(n_changes);
    let mut losses = Vec::with_capacity(n_changes);
    for i in 1..data.len() {
        let c = data[i] - data[i - 1];
        gains.push(if c > 0.0 { c } else { 0.0 });
        losses.push(if c < 0.0 { -c } else { 0.0 });
    }

    let mut sum_g = 0.0_f64;
    let mut sum_l = 0.0_f64;
    for i in 0..period {
        sum_g += gains[i];
        sum_l += losses[i];
    }
    let mut avg_gain = sum_g / period as f64;
    let mut avg_loss = sum_l / period as f64;

    let p_minus_1 = (period as f64) - 1.0;
    let p = period as f64;
    for i in period..gains.len() {
        avg_gain = (avg_gain * p_minus_1 + gains[i]) / p;
        avg_loss = (avg_loss * p_minus_1 + losses[i]) / p;
    }

    // Quirk #1: avgLoss == 0 → 100. Even if avgGain is also 0.
    if avg_loss == 0.0 {
        return Ok(100.0);
    }

    let rs = avg_gain / avg_loss;
    Ok(100.0 - 100.0 / (1.0 + rs))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(n: usize, start: f64) -> Vec<f64> {
        (0..n).map(|i| start + i as f64).collect()
    }

    #[test]
    fn rsi_strict_uptrend_returns_100() {
        // All gains, no losses → avgLoss = 0 → must return literal 100, not NaN/Inf.
        let data = ramp(50, 100.0);
        let v = rsi(&data, 14).unwrap();
        assert_eq!(v, 100.0);
    }

    #[test]
    fn rsi_constant_returns_100() {
        // All zero changes → both avgGain and avgLoss are 0 → return 100.
        let data = vec![100.0_f64; 30];
        assert_eq!(rsi(&data, 14).unwrap(), 100.0);
    }

    #[test]
    fn rsi_strict_downtrend_returns_zero() {
        // No gains, all losses → avgGain = 0, avgLoss > 0 → 100 - 100/(1+0) = 0.
        let data: Vec<f64> = (0..30).map(|i| 200.0 - i as f64).collect();
        let v = rsi(&data, 14).unwrap();
        assert_eq!(v, 0.0);
    }

    #[test]
    fn rsi_in_0_100_range_for_mixed_series() {
        // sin-like up/down series: should produce RSI in [0, 100].
        let data: Vec<f64> = (0..50)
            .map(|i| 100.0 + ((i as f64) * 0.5).sin() * 10.0)
            .collect();
        let v = rsi(&data, 14).unwrap();
        assert!((0.0..=100.0).contains(&v), "rsi out of range: {v}");
    }

    #[test]
    fn rsi_insufficient_data() {
        let data = ramp(10, 100.0);
        let err = rsi(&data, 14).unwrap_err();
        match err {
            AnalysisError::InsufficientData {
                needed: 15,
                got: 10,
                indicator: "RSI",
            } => {}
            _ => panic!("unexpected: {err:?}"),
        }
    }

    #[test]
    fn rsi_period_zero_errors() {
        let data = ramp(10, 100.0);
        assert!(rsi(&data, 0).is_err());
    }
}
