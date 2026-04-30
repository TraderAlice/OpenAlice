// Indicator kernels — pure Rust math, no NAPI.
//
// One module per indicator, ported from src/domain/analysis/indicator/functions/*.ts.
// All kernels accept `&[f64]` (or three slices for ATR) plus their parameters and return
// `Result<Output, AnalysisError>`. Arithmetic order is matched to the TS source — see
// 02-design.md §2 (quirks) and §5.2 (parity tolerances). No precision rounding here;
// that lives in the public NAPI entry points (task #6).

pub mod atr;
pub mod average;
pub mod bbands;
pub mod ema;
pub mod macd;
pub mod max;
pub mod min;
pub mod rsi;
pub mod sma;
pub mod stdev;
pub mod sum;

pub use atr::atr;
pub use average::average;
pub use bbands::{bbands, BbandsOutput};
pub use ema::ema;
pub use macd::{macd, MacdOutput};
pub use max::max;
pub use min::min;
pub use rsi::rsi;
pub use sma::sma;
pub use stdev::stdev;
pub use sum::sum;
