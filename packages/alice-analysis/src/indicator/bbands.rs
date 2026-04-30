use crate::error::AnalysisError;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BbandsOutput {
    pub upper: f64,
    pub middle: f64,
    pub lower: f64,
}

// Quirk #3: BBANDS uses ONLY the last `period` points, not full history. Matches TS:
//   slice  = v.slice(-period)
//   middle = sum(slice) / period
//   var    = sum((x - middle)^2) / period
//   stdDev = sqrt(var)
//   { upper: middle + stdDev*mult, middle, lower: middle - stdDev*mult }
pub fn bbands(
    data: &[f64],
    period: usize,
    std_dev_multiplier: f64,
) -> Result<BbandsOutput, AnalysisError> {
    if period == 0 {
        return Err(AnalysisError::EvalError(
            "BBANDS period must be > 0".to_string(),
        ));
    }
    if data.len() < period {
        return Err(AnalysisError::InsufficientData {
            needed: period,
            got: data.len(),
            indicator: "BBANDS",
        });
    }

    let slice = &data[data.len() - period..];
    let mut sum = 0.0_f64;
    for &v in slice {
        sum += v;
    }
    let middle = sum / period as f64;
    let mut var_sum = 0.0_f64;
    for &v in slice {
        let d = v - middle;
        var_sum += d * d;
    }
    let std_dev = (var_sum / period as f64).sqrt();

    Ok(BbandsOutput {
        upper: middle + std_dev * std_dev_multiplier,
        middle,
        lower: middle - std_dev * std_dev_multiplier,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(n: usize, start: f64) -> Vec<f64> {
        (0..n).map(|i| start + i as f64).collect()
    }

    #[test]
    fn bbands_monotonic_on_50_bar_ramp() {
        let data = ramp(50, 100.0);
        let r = bbands(&data, 20, 2.0).unwrap();
        assert!(r.upper > r.middle, "{} > {}", r.upper, r.middle);
        assert!(r.middle > r.lower);
    }

    #[test]
    fn bbands_middle_equals_sma_of_last_period() {
        // last 20 of 100..149 = 130..149, mean = 139.5
        let data = ramp(50, 100.0);
        let r = bbands(&data, 20, 2.0).unwrap();
        assert_eq!(r.middle, 139.5);
    }

    #[test]
    fn bbands_uses_only_last_period_not_full_history() {
        // Build a series whose first 100 bars are wild (sd huge) and last 20 are constant.
        // BBANDS(20) should see only the constant tail → stdDev = 0, upper == middle == lower.
        let mut data: Vec<f64> = (0..100).map(|i| if i % 2 == 0 { 0.0 } else { 1000.0 }).collect();
        data.extend(std::iter::repeat(50.0).take(20));
        let r = bbands(&data, 20, 2.0).unwrap();
        assert_eq!(r.middle, 50.0);
        assert_eq!(r.upper, 50.0);
        assert_eq!(r.lower, 50.0);
    }

    #[test]
    fn bbands_at_minimum_size_boundary() {
        // exactly `period` points: must succeed and use all of them.
        let data = ramp(20, 100.0); // 100..119
        let r = bbands(&data, 20, 2.0).unwrap();
        // middle = avg(100..119) = 109.5
        assert_eq!(r.middle, 109.5);
    }

    #[test]
    fn bbands_insufficient_data() {
        let data = ramp(5, 100.0);
        let err = bbands(&data, 20, 2.0).unwrap_err();
        match err {
            AnalysisError::InsufficientData {
                needed: 20,
                got: 5,
                indicator: "BBANDS",
            } => {}
            _ => panic!("unexpected: {err:?}"),
        }
    }
}
