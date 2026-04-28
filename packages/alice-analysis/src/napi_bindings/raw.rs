// Raw indicator kernels exposed as sync `#[napi]` functions.
//
// Inputs cross the boundary as `Float64Array` (zero-copy on the JS side); we
// borrow `&[f64]` from it directly. Periods and multipliers are plain numbers.
//
// The struct returns (`bbands_raw`, `macd_raw`) use `#[napi(object)]` so JS
// sees plain `{ upper, middle, lower }` / `{ macd, signal, histogram }` objects
// — no class wrappers, no DataView decoding.

use napi::bindgen_prelude::Float64Array;
use napi_derive::napi;

use crate::indicator;

fn slice<'a>(arr: &'a Float64Array) -> &'a [f64] {
    arr.as_ref()
}

#[napi]
pub fn sma_raw(data: Float64Array, period: u32) -> Result<f64, napi::Error> {
    indicator::sma(slice(&data), period as usize).map_err(Into::into)
}

#[napi]
pub fn ema_raw(data: Float64Array, period: u32) -> Result<f64, napi::Error> {
    indicator::ema(slice(&data), period as usize).map_err(Into::into)
}

#[napi]
pub fn stdev_raw(data: Float64Array) -> Result<f64, napi::Error> {
    indicator::stdev(slice(&data)).map_err(Into::into)
}

#[napi]
pub fn max_raw(data: Float64Array) -> Result<f64, napi::Error> {
    indicator::max(slice(&data)).map_err(Into::into)
}

#[napi]
pub fn min_raw(data: Float64Array) -> Result<f64, napi::Error> {
    indicator::min(slice(&data)).map_err(Into::into)
}

#[napi]
pub fn sum_raw(data: Float64Array) -> Result<f64, napi::Error> {
    indicator::sum(slice(&data)).map_err(Into::into)
}

#[napi]
pub fn average_raw(data: Float64Array) -> Result<f64, napi::Error> {
    indicator::average(slice(&data)).map_err(Into::into)
}

#[napi]
pub fn rsi_raw(data: Float64Array, period: u32) -> Result<f64, napi::Error> {
    indicator::rsi(slice(&data), period as usize).map_err(Into::into)
}

#[napi(object)]
pub struct BbandsResult {
    pub upper: f64,
    pub middle: f64,
    pub lower: f64,
}

#[napi]
pub fn bbands_raw(
    data: Float64Array,
    period: u32,
    std_dev_multiplier: f64,
) -> Result<BbandsResult, napi::Error> {
    let r = indicator::bbands(slice(&data), period as usize, std_dev_multiplier)?;
    Ok(BbandsResult {
        upper: r.upper,
        middle: r.middle,
        lower: r.lower,
    })
}

#[napi(object)]
pub struct MacdResult {
    pub macd: f64,
    pub signal: f64,
    pub histogram: f64,
}

#[napi]
pub fn macd_raw(
    data: Float64Array,
    fast_period: u32,
    slow_period: u32,
    signal_period: u32,
) -> Result<MacdResult, napi::Error> {
    let r = indicator::macd(
        slice(&data),
        fast_period as usize,
        slow_period as usize,
        signal_period as usize,
    )?;
    Ok(MacdResult {
        macd: r.macd,
        signal: r.signal,
        histogram: r.histogram,
    })
}

#[napi]
pub fn atr_raw(
    highs: Float64Array,
    lows: Float64Array,
    closes: Float64Array,
    period: u32,
) -> Result<f64, napi::Error> {
    indicator::atr(
        slice(&highs),
        slice(&lows),
        slice(&closes),
        period as usize,
    )
    .map_err(Into::into)
}
