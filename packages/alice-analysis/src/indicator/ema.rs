use crate::error::AnalysisError;

// Matches TS:
//   const multiplier = 2 / (period + 1)
//   let ema = data.slice(0, period).reduce((acc, v) => acc + v, 0) / period
//   for i in period..len: ema = (data[i] - ema) * multiplier + ema
//
// Strict TS-order accumulation: no Kahan, no chunking. Per design §2 quirk #12.
pub fn ema(data: &[f64], period: usize) -> Result<f64, AnalysisError> {
    if period == 0 {
        return Err(AnalysisError::EvalError(
            "EMA period must be > 0".to_string(),
        ));
    }
    if data.len() < period {
        return Err(AnalysisError::InsufficientData {
            needed: period,
            got: data.len(),
            indicator: "EMA",
        });
    }
    let multiplier = 2.0_f64 / (period as f64 + 1.0);
    let mut seed = 0.0_f64;
    for &v in &data[..period] {
        seed += v;
    }
    let mut ema = seed / period as f64;
    for i in period..data.len() {
        ema = (data[i] - ema) * multiplier + ema;
    }
    Ok(ema)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(n: usize, start: f64) -> Vec<f64> {
        (0..n).map(|i| start + i as f64).collect()
    }

    #[test]
    fn ema_50_bar_ramp_period_10_above_140() {
        // Uptrend close 100..149: EMA should be high, > 140 like the survey says.
        let data = ramp(50, 100.0);
        let v = ema(&data, 10).unwrap();
        assert!(v > 140.0 && v < 150.0, "ema = {v}");
    }

    #[test]
    fn ema_period_eq_len_equals_simple_mean() {
        // When period == len, the loop doesn't execute and EMA == SMA == mean.
        let data = ramp(10, 100.0);
        let v = ema(&data, 10).unwrap();
        let mean: f64 = data.iter().sum::<f64>() / data.len() as f64;
        assert_eq!(v, mean);
    }

    #[test]
    fn ema_insufficient_data() {
        let data = ramp(5, 1.0);
        let err = ema(&data, 10).unwrap_err();
        match err {
            AnalysisError::InsufficientData {
                needed: 10,
                got: 5,
                indicator: "EMA",
            } => {}
            _ => panic!("unexpected: {err:?}"),
        }
    }

    #[test]
    fn ema_constant_series_equals_constant() {
        // f(x)=c, EMA stays c.
        let data = vec![7.0_f64; 30];
        assert_eq!(ema(&data, 5).unwrap(), 7.0);
    }
}
