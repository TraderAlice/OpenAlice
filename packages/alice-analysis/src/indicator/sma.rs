use crate::error::AnalysisError;

pub fn sma(data: &[f64], period: usize) -> Result<f64, AnalysisError> {
    if period == 0 {
        return Err(AnalysisError::EvalError(
            "SMA period must be > 0".to_string(),
        ));
    }
    if data.len() < period {
        return Err(AnalysisError::InsufficientData {
            needed: period,
            got: data.len(),
            indicator: "SMA",
        });
    }
    let slice = &data[data.len() - period..];
    let mut sum = 0.0_f64;
    for &v in slice {
        sum += v;
    }
    Ok(sum / period as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(n: usize, start: f64) -> Vec<f64> {
        (0..n).map(|i| start + i as f64).collect()
    }

    #[test]
    fn sma_last_period_only() {
        // 50-bar mock close 100..149, SMA(10) = avg(140..149) = 144.5
        let data = ramp(50, 100.0);
        assert_eq!(sma(&data, 10).unwrap(), 144.5);
    }

    #[test]
    fn sma_full_history_when_period_eq_len() {
        let data = ramp(50, 100.0);
        // SMA(50) = avg(100..149) = 124.5
        assert_eq!(sma(&data, 50).unwrap(), 124.5);
    }

    #[test]
    fn sma_insufficient_data() {
        let data = ramp(5, 1.0);
        let err = sma(&data, 10).unwrap_err();
        match err {
            AnalysisError::InsufficientData {
                needed,
                got,
                indicator,
            } => {
                assert_eq!(needed, 10);
                assert_eq!(got, 5);
                assert_eq!(indicator, "SMA");
            }
            _ => panic!("expected InsufficientData"),
        }
    }

    #[test]
    fn sma_period_zero_errors() {
        let data = ramp(5, 1.0);
        assert!(sma(&data, 0).is_err());
    }
}
