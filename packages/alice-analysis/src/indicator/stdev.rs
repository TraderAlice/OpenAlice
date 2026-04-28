use crate::error::AnalysisError;

// Population stdev (divides by N, not N-1) — matches TS:
//   mean = sum(v)/N
//   variance = sum((v-mean)^2)/N
//   sqrt(variance)
pub fn stdev(data: &[f64]) -> Result<f64, AnalysisError> {
    if data.is_empty() {
        return Err(AnalysisError::InsufficientData {
            needed: 1,
            got: 0,
            indicator: "STDEV",
        });
    }
    let n = data.len() as f64;
    let mut sum = 0.0_f64;
    for &v in data {
        sum += v;
    }
    let mean = sum / n;
    let mut var_sum = 0.0_f64;
    for &v in data {
        let d = v - mean;
        var_sum += d * d;
    }
    let variance = var_sum / n;
    Ok(variance.sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(n: usize, start: f64) -> Vec<f64> {
        (0..n).map(|i| start + i as f64).collect()
    }

    #[test]
    fn stdev_50_bar_ramp_close_to_14_43() {
        let data = ramp(50, 100.0);
        let v = stdev(&data).unwrap();
        assert!((v - 14.43).abs() < 0.01, "stdev = {v}");
    }

    #[test]
    fn stdev_constant_series_is_zero() {
        let data = vec![5.0_f64; 10];
        assert_eq!(stdev(&data).unwrap(), 0.0);
    }

    #[test]
    fn stdev_empty_errors() {
        let data: Vec<f64> = vec![];
        let err = stdev(&data).unwrap_err();
        match err {
            AnalysisError::InsufficientData { needed: 1, got: 0, indicator: "STDEV" } => {}
            _ => panic!("unexpected: {err:?}"),
        }
    }

    #[test]
    fn stdev_single_point_is_zero() {
        let data = vec![42.0];
        assert_eq!(stdev(&data).unwrap(), 0.0);
    }
}
