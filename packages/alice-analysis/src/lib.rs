#![deny(clippy::all)]

pub mod error;
pub mod formula;
pub mod indicator;
pub mod napi_bindings;
pub mod thinking;

use napi_derive::napi;

#[napi]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
