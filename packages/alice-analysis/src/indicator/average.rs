use crate::error::AnalysisError;

// TS: throws on empty, otherwise sum / length.
pub fn average(data: &[f64]) -> Result<f64, AnalysisError> {
    if data.is_empty() {
        return Err(AnalysisError::InsufficientData {
            needed: 1,
            got: 0,
            indicator: "AVERAGE",
        });
    }
    let mut s = 0.0_f64;
    for &v in data {
        s += v;
    }
    Ok(s / data.len() as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(n: usize, start: f64) -> Vec<f64> {
        (0..n).map(|i| start + i as f64).collect()
    }

    #[test]
    fn average_50_bar_ramp_is_124_5() {
        let data = ramp(50, 100.0);
        assert_eq!(average(&data).unwrap(), 124.5);
    }

    #[test]
    fn average_empty_errors() {
        assert!(average(&[]).is_err());
    }

    #[test]
    fn average_single_point() {
        assert_eq!(average(&[7.5]).unwrap(), 7.5);
    }
}
