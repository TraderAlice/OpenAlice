// AnalysisError — shape per design 02-design.md §1.3.
//
// Each variant has a stable string code (`error_code()`) so TS callers can branch
// on `error.code` without parsing the message text. Per design Q2 (codes-only
// parity), the message is best-effort and may evolve; the code is the contract.

#[derive(Debug)]
pub enum AnalysisError {
    ParseError { position: usize, message: String },
    EvalError(String),
    InsufficientData { needed: usize, got: usize, indicator: &'static str },
    DivisionByZero,
    IndexOutOfBounds { index: i64, len: usize },
    UnknownFunction(String),
    TypeMismatch { expected: &'static str, got: &'static str },
    DataFetch(String),
    StringResult,
    Decimal(String),
    Internal(String),
}

impl AnalysisError {
    /// Stable machine-readable code. Matches the names used by the TS adapter's
    /// `AnalysisError` class.
    pub fn code(&self) -> &'static str {
        match self {
            AnalysisError::ParseError { .. } => "PARSE_ERROR",
            AnalysisError::EvalError(_) => "EVAL_ERROR",
            AnalysisError::InsufficientData { .. } => "INSUFFICIENT_DATA",
            AnalysisError::DivisionByZero => "DIV_BY_ZERO",
            AnalysisError::IndexOutOfBounds { .. } => "INDEX_OUT_OF_BOUNDS",
            AnalysisError::UnknownFunction(_) => "UNKNOWN_FUNCTION",
            AnalysisError::TypeMismatch { .. } => "TYPE_MISMATCH",
            AnalysisError::DataFetch(_) => "DATA_FETCH_ERROR",
            AnalysisError::StringResult => "STRING_RESULT",
            AnalysisError::Decimal(_) => "DECIMAL_ERROR",
            AnalysisError::Internal(_) => "INTERNAL_ERROR",
        }
    }

    /// Human-readable message. Mirrors TS message text where the survey calls it
    /// out as load-bearing (e.g. "Division by zero", "requires at least N data
    /// points, got M"); otherwise descriptive.
    pub fn message(&self) -> String {
        match self {
            AnalysisError::ParseError { position, message } => {
                format!("{message} at position {position}")
            }
            AnalysisError::EvalError(m) => m.clone(),
            AnalysisError::InsufficientData { needed, got, indicator } => {
                format!("{indicator} requires at least {needed} data points, got {got}")
            }
            AnalysisError::DivisionByZero => "Division by zero".to_string(),
            AnalysisError::IndexOutOfBounds { index, .. } => {
                format!("Array index out of bounds: {index}")
            }
            AnalysisError::UnknownFunction(name) => format!("Unknown function: {name}"),
            AnalysisError::TypeMismatch { expected, got } => {
                format!("Type mismatch: expected {expected}, got {got}")
            }
            AnalysisError::DataFetch(m) => format!("Data fetch failed: {m}"),
            AnalysisError::StringResult => {
                "Invalid formula: result cannot be a string".to_string()
            }
            AnalysisError::Decimal(m) => format!("Decimal error: {m}"),
            AnalysisError::Internal(m) => format!("Internal error: {m}"),
        }
    }
}

impl std::fmt::Display for AnalysisError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for AnalysisError {}

/// Convert an `AnalysisError` into a `napi::Error`. The code is tucked into the
/// message via a `CODE|message` envelope so the TS adapter can split it out and
/// rehydrate as a strongly-typed `AnalysisError` JS class. We chose this over
/// returning a tagged `{ code, message }` object because napi-rs 2.16's
/// `Result<T>` mapping always produces a JS `Error` (any function that throws
/// surfaces as `throw new Error(...)`); returning a plain object instead would
/// force every consumer through a manual `if (result.code) throw ...` dance.
/// Keeping the JS error path means existing TS code that catches by message
/// substring keeps working unchanged.
impl From<AnalysisError> for napi::Error {
    fn from(e: AnalysisError) -> Self {
        napi::Error::new(
            napi::Status::GenericFailure,
            format!("{}|{}", e.code(), e.message()),
        )
    }
}
