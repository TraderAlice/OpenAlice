use crate::error::AnalysisError;

pub fn min(data: &[f64]) -> Result<f64, AnalysisError> {
    if data.is_empty() {
        return Err(AnalysisError::InsufficientData {
            needed: 1,
            got: 0,
            indicator: "MIN",
        });
    }
    let mut m = data[0];
    for &v in &data[1..] {
        if m.is_nan() || v.is_nan() {
            m = f64::NAN;
        } else if v < m {
            m = v;
        }
    }
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(n: usize, start: f64) -> Vec<f64> {
        (0..n).map(|i| start + i as f64).collect()
    }

    #[test]
    fn min_50_bar_ramp_is_100() {
        let data = ramp(50, 100.0);
        assert_eq!(min(&data).unwrap(), 100.0);
    }

    #[test]
    fn min_empty_errors() {
        assert!(min(&[]).is_err());
    }

    #[test]
    fn min_with_nan_propagates() {
        let data = vec![1.0, f64::NAN, 2.0];
        assert!(min(&data).unwrap().is_nan());
    }
}
