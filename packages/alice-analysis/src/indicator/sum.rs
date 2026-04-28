use crate::error::AnalysisError;

// TS: `v.reduce((acc, val) => acc + val, 0)`. No length check — empty returns 0.
// This diverges from the survey's table (which says "≥ 1") but matches the actual TS
// implementation. Parity is against the implementation.
pub fn sum(data: &[f64]) -> Result<f64, AnalysisError> {
    let mut s = 0.0_f64;
    for &v in data {
        s += v;
    }
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(n: usize, start: f64) -> Vec<f64> {
        (0..n).map(|i| start + i as f64).collect()
    }

    #[test]
    fn sum_50_bar_ramp_is_6225() {
        let data = ramp(50, 100.0);
        assert_eq!(sum(&data).unwrap(), 6225.0);
    }

    #[test]
    fn sum_empty_returns_zero() {
        // TS reduce with 0 seed returns 0 for empty; we match.
        assert_eq!(sum(&[]).unwrap(), 0.0);
    }

    #[test]
    fn sum_single_point() {
        assert_eq!(sum(&[7.5]).unwrap(), 7.5);
    }
}
