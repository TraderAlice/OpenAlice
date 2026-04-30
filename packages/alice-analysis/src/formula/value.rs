// Runtime values produced by formula evaluation.
//
// Mirrors the TS `CalculationResult` union: number | string | TrackedValues | Record<string, number>.
// (The TS code also has a bare `number[]` arm, but in practice all arrays come from
// data-access functions, so they always arrive as TrackedValues.)

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub struct DataSourceMeta {
    pub symbol: String,
    pub interval: String,
    pub from: String,
    pub to: String,
    pub bars: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrackedValues {
    pub values: Vec<f64>,
    pub source: DataSourceMeta,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Number(f64),
    String(String),
    Array(TrackedValues),
    Object(BTreeMap<String, f64>),
}

impl Value {
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Number(_) => "number",
            Value::String(_) => "string",
            Value::Array(_) => "TrackedValues",
            Value::Object(_) => "object",
        }
    }
}
