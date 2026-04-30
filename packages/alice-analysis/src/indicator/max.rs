use crate::error::AnalysisError;

// Matches TS Math.max(...v): NaN-poison semantics — if any input is NaN, returns NaN.
// Also matches: Math.max(...[]) === -Infinity, but TS throws on empty before reaching that.
pub fn max(data: &[f64]) -> Result<f64, AnalysisError> {
    if data.is_empty() {
        return Err(AnalysisError::InsufficientData {
            needed: 1,
            got: 0,
            indicator: "MAX",
        });
    }
    let mut m = data[0];
    for &v in &data[1..] {
        // Match JS Math.max NaN propagation: if either side is NaN, result is NaN.
        if m.is_nan() || v.is_nan() {
            m = f64::NAN;
        } else if v > m {
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
    fn max_50_bar_ramp_is_149() {
        let data = ramp(50, 100.0);
        assert_eq!(max(&data).unwrap(), 149.0);
    }

    #[test]
    fn max_empty_errors() {
        assert!(max(&[]).is_err());
    }

    #[test]
    fn max_single_point() {
        assert_eq!(max(&[7.5]).unwrap(), 7.5);
    }

    #[test]
    fn max_with_nan_propagates() {
        // Mirrors JS Math.max(1, NaN, 2) === NaN.
        let data = vec![1.0, f64::NAN, 2.0];
        assert!(max(&data).unwrap().is_nan());
    }
}
