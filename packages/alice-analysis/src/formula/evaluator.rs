// Formula evaluator — walks the AST and produces a `Value`.
//
// Generic over two traits so this module has no dependency on the indicator kernels
// or the NAPI layer:
//
// * `DataAccessor` — fetches OHLCV columns. Implementations bridge to TS at the NAPI
//   boundary (task #6). Sync interface; the NAPI layer wraps the JS async callback in
//   a runtime block_on if needed.
// * `FunctionDispatcher` — invokes named indicator/statistics kernels. The NAPI layer
//   provides an impl that calls into `crate::indicator`.
//
// Quirks preserved (see _rust-port/02-design.md §2):
// * #4: precision is *not* applied here — evaluator returns raw f64 values.
// * #6: negative array indices Pythonic (`-1` = last).
// * #7: TrackedValues provenance bubbles through every data-access call.
// * #8: dataRange empty for pure arithmetic.
// * #10: division-by-zero only checked in binary `/`.
// * #11: BinaryOp on Array → TypeMismatch.
//
// Function name dispatch: data-access (`CLOSE/HIGH/LOW/OPEN/VOLUME`) is handled
// in-evaluator because it needs to mint TrackedValues with provenance. Everything
// else is delegated to `FunctionDispatcher`.

use std::collections::BTreeMap;

use crate::error::AnalysisError;
use crate::formula::ast::{ArrayAccessNode, AstNode, BinaryOp, BinaryOpNode, FunctionNode};
use crate::formula::value::{DataSourceMeta, TrackedValues, Value};

/// Which OHLCV column a data-access call wants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Field {
    Close,
    Open,
    High,
    Low,
    Volume,
}

impl Field {
    pub fn as_str(self) -> &'static str {
        match self {
            Field::Close => "close",
            Field::Open => "open",
            Field::High => "high",
            Field::Low => "low",
            Field::Volume => "volume",
        }
    }

    fn from_fn_name(name: &str) -> Option<Self> {
        match name {
            "CLOSE" => Some(Field::Close),
            "OPEN" => Some(Field::Open),
            "HIGH" => Some(Field::High),
            "LOW" => Some(Field::Low),
            "VOLUME" => Some(Field::Volume),
            _ => None,
        }
    }
}

/// Source of OHLCV column data. Implementations bridge to TS at the NAPI layer.
pub trait DataAccessor {
    fn fetch(
        &mut self,
        symbol: &str,
        interval: &str,
        field: Field,
    ) -> Result<TrackedValues, AnalysisError>;
}

/// Dispatch table for indicator / statistics functions (everything except the five
/// data-access functions). Implementations live at the NAPI layer (task #6) and
/// route into `crate::indicator`. The evaluator passes raw `Value` args so the
/// dispatcher can inspect types (e.g. distinguish array vs scalar).
pub trait FunctionDispatcher {
    fn call(&mut self, name: &str, args: &[Value]) -> Result<Value, AnalysisError>;
}

/// Result of evaluating a formula.
#[derive(Debug, Clone, PartialEq)]
pub struct EvalOutput {
    pub value: Value,
    /// Symbols touched by data-access calls, keyed by symbol. Mirrors TS dataRange.
    pub data_range: BTreeMap<String, DataSourceMeta>,
}

pub fn evaluate<D: DataAccessor, F: FunctionDispatcher>(
    ast: &AstNode,
    data: &mut D,
    funcs: &mut F,
) -> Result<EvalOutput, AnalysisError> {
    let mut state = EvalState {
        data_range: BTreeMap::new(),
    };
    let value = eval_node(ast, &mut state, data, funcs)?;
    // Top-level string result is a hard error per TS calculator.ts:46.
    if let Value::String(s) = &value {
        return Err(AnalysisError::EvalError(format!(
            "Invalid formula: result cannot be a string. Got: \"{s}\""
        )));
    }
    Ok(EvalOutput {
        value,
        data_range: state.data_range,
    })
}

struct EvalState {
    data_range: BTreeMap<String, DataSourceMeta>,
}

fn eval_node<D: DataAccessor, F: FunctionDispatcher>(
    node: &AstNode,
    state: &mut EvalState,
    data: &mut D,
    funcs: &mut F,
) -> Result<Value, AnalysisError> {
    match node {
        AstNode::Number(n) => Ok(Value::Number(*n)),
        AstNode::String(s) => Ok(Value::String(s.clone())),
        AstNode::BinaryOp(b) => eval_binop(b, state, data, funcs),
        AstNode::Function(f) => eval_function(f, state, data, funcs),
        AstNode::ArrayAccess(a) => eval_array_access(a, state, data, funcs),
    }
}

fn eval_binop<D: DataAccessor, F: FunctionDispatcher>(
    node: &BinaryOpNode,
    state: &mut EvalState,
    data: &mut D,
    funcs: &mut F,
) -> Result<Value, AnalysisError> {
    let l = eval_node(&node.left, state, data, funcs)?;
    let r = eval_node(&node.right, state, data, funcs)?;
    match (&l, &r) {
        (Value::Number(a), Value::Number(b)) => {
            let out = match node.op {
                BinaryOp::Add => a + b,
                BinaryOp::Sub => a - b,
                BinaryOp::Mul => a * b,
                BinaryOp::Div => {
                    if *b == 0.0 {
                        return Err(AnalysisError::DivisionByZero);
                    }
                    a / b
                }
            };
            Ok(Value::Number(out))
        }
        _ => {
            // TS message: "Binary operations require numbers, got {leftType} and {rightType}"
            Err(AnalysisError::EvalError(format!(
                "Binary operations require numbers, got {} and {}",
                l.type_name(),
                r.type_name()
            )))
        }
    }
}

fn eval_function<D: DataAccessor, F: FunctionDispatcher>(
    node: &FunctionNode,
    state: &mut EvalState,
    data: &mut D,
    funcs: &mut F,
) -> Result<Value, AnalysisError> {
    // Data access — handled in-evaluator so we can mint provenance.
    if let Some(field) = Field::from_fn_name(&node.name) {
        if node.args.len() < 2 {
            return Err(AnalysisError::EvalError(format!(
                "{}() requires (symbol, interval)",
                node.name
            )));
        }
        // Args are evaluated left-to-right; for data access TS takes the literal
        // string node values, but the parser may have parsed them as expressions
        // (e.g. CLOSE('AAPL', '1' + 'd') — invalid in TS too, but only fails when
        // the eval walk produces a non-string). We reproduce TS: evaluate, then
        // require Value::String.
        let symbol_v = eval_node(&node.args[0], state, data, funcs)?;
        let interval_v = eval_node(&node.args[1], state, data, funcs)?;
        let symbol = match symbol_v {
            Value::String(s) => s,
            other => {
                return Err(AnalysisError::TypeMismatch {
                    expected: "string",
                    got: other.type_name(),
                })
            }
        };
        let interval = match interval_v {
            Value::String(s) => s,
            other => {
                return Err(AnalysisError::TypeMismatch {
                    expected: "string",
                    got: other.type_name(),
                })
            }
        };
        let tracked = data.fetch(&symbol, &interval, field)?;
        // Provenance: collect into dataRange (TS calculator.ts:257-262).
        state
            .data_range
            .insert(tracked.source.symbol.clone(), tracked.source.clone());
        return Ok(Value::Array(tracked));
    }

    // Eagerly evaluate args, then hand off to the dispatcher.
    let mut evaluated = Vec::with_capacity(node.args.len());
    for arg in &node.args {
        evaluated.push(eval_node(arg, state, data, funcs)?);
    }
    funcs.call(&node.name, &evaluated)
}

fn eval_array_access<D: DataAccessor, F: FunctionDispatcher>(
    node: &ArrayAccessNode,
    state: &mut EvalState,
    data: &mut D,
    funcs: &mut F,
) -> Result<Value, AnalysisError> {
    let arr = eval_node(&node.array, state, data, funcs)?;
    let idx = eval_node(&node.index, state, data, funcs)?;
    let values = match &arr {
        Value::Array(t) => &t.values[..],
        other => {
            return Err(AnalysisError::EvalError(format!(
                "Array access requires an array, got {}",
                other.type_name()
            )))
        }
    };
    let idx_n = match idx {
        Value::Number(n) => n,
        other => {
            return Err(AnalysisError::EvalError(format!(
                "Array index must be a number, got {}",
                other.type_name()
            )))
        }
    };
    // TS uses `parseFloat(numStr)` so non-integer indices reach this point. Mirror
    // TS by truncating-via-cast — we cast to i64 (TS: `index < 0 ? len + index : index`,
    // with implicit truncation through array indexing). Use rounding-toward-zero (`as i64`).
    let idx_i = idx_n as i64;
    let len_i = values.len() as i64;
    let actual = if idx_i < 0 { len_i + idx_i } else { idx_i };
    if actual < 0 || actual >= len_i {
        return Err(AnalysisError::EvalError(format!(
            "Array index out of bounds: {idx_i}"
        )));
    }
    Ok(Value::Number(values[actual as usize]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formula::parser::parse;

    // ---------- Test doubles ----------

    struct StubData {
        // (symbol, interval) → values for each field
        data: std::collections::HashMap<(String, String), [Vec<f64>; 5]>,
    }

    impl StubData {
        fn new() -> Self {
            Self {
                data: std::collections::HashMap::new(),
            }
        }

        fn add(
            mut self,
            symbol: &str,
            interval: &str,
            cols: [Vec<f64>; 5], // [close, open, high, low, volume]
        ) -> Self {
            self.data
                .insert((symbol.to_string(), interval.to_string()), cols);
            self
        }
    }

    impl DataAccessor for StubData {
        fn fetch(
            &mut self,
            symbol: &str,
            interval: &str,
            field: Field,
        ) -> Result<TrackedValues, AnalysisError> {
            let arr = self
                .data
                .get(&(symbol.to_string(), interval.to_string()))
                .ok_or_else(|| {
                    AnalysisError::DataFetch(format!("no data for {symbol} {interval}"))
                })?;
            let idx = match field {
                Field::Close => 0,
                Field::Open => 1,
                Field::High => 2,
                Field::Low => 3,
                Field::Volume => 4,
            };
            Ok(TrackedValues {
                values: arr[idx].clone(),
                source: DataSourceMeta {
                    symbol: symbol.to_string(),
                    interval: interval.to_string(),
                    from: "2025-01-01".to_string(),
                    to: "2025-02-19".to_string(),
                    bars: arr[0].len(),
                },
            })
        }
    }

    /// Stub dispatcher that knows MAX/MIN/SUM/AVERAGE/SMA/STDEV. Enough to drive
    /// the evaluator tests without depending on the kernels module.
    struct StubFns;

    impl FunctionDispatcher for StubFns {
        fn call(&mut self, name: &str, args: &[Value]) -> Result<Value, AnalysisError> {
            fn vals(v: &Value) -> Result<Vec<f64>, AnalysisError> {
                match v {
                    Value::Array(t) => Ok(t.values.clone()),
                    other => Err(AnalysisError::TypeMismatch {
                        expected: "array",
                        got: other.type_name(),
                    }),
                }
            }
            match name {
                "MAX" => {
                    let v = vals(&args[0])?;
                    Ok(Value::Number(
                        v.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
                    ))
                }
                "MIN" => {
                    let v = vals(&args[0])?;
                    Ok(Value::Number(v.iter().cloned().fold(f64::INFINITY, f64::min)))
                }
                "SUM" => {
                    let v = vals(&args[0])?;
                    Ok(Value::Number(v.iter().sum()))
                }
                "AVERAGE" => {
                    let v = vals(&args[0])?;
                    let s: f64 = v.iter().sum();
                    Ok(Value::Number(s / v.len() as f64))
                }
                "SMA" => {
                    let v = vals(&args[0])?;
                    let p = match args[1] {
                        Value::Number(n) => n as usize,
                        _ => {
                            return Err(AnalysisError::TypeMismatch {
                                expected: "number",
                                got: args[1].type_name(),
                            })
                        }
                    };
                    if v.len() < p {
                        return Err(AnalysisError::InsufficientData {
                            needed: p,
                            got: v.len(),
                            indicator: "SMA",
                        });
                    }
                    let slice = &v[v.len() - p..];
                    let s: f64 = slice.iter().sum();
                    Ok(Value::Number(s / p as f64))
                }
                "STDEV" => {
                    let v = vals(&args[0])?;
                    let n = v.len() as f64;
                    let mean = v.iter().sum::<f64>() / n;
                    let var = v.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n;
                    Ok(Value::Number(var.sqrt()))
                }
                other => Err(AnalysisError::UnknownFunction(other.to_string())),
            }
        }
    }

    fn ramp_close(n: usize, start: f64) -> Vec<f64> {
        (0..n).map(|i| start + i as f64).collect()
    }

    fn aapl_50_bars() -> StubData {
        let close = ramp_close(50, 100.0);
        let open = ramp_close(50, 100.0);
        let high: Vec<f64> = (0..50).map(|i| 102.0 + i as f64).collect();
        let low: Vec<f64> = (0..50).map(|i| 99.0 + i as f64).collect();
        let mut vol: Vec<f64> = (0..50).map(|i| 1000.0 + 10.0 * i as f64).collect();
        vol[48] = 0.0;
        StubData::new().add("AAPL", "1d", [close, open, high, low, vol])
    }

    fn run(formula: &str, mut data: StubData) -> Result<EvalOutput, AnalysisError> {
        let ast = parse(formula).unwrap();
        let mut funcs = StubFns;
        evaluate(&ast, &mut data, &mut funcs)
    }

    // ---------- Pure arithmetic ----------

    #[test]
    fn arithmetic_addition() {
        let out = run("2 + 3", StubData::new()).unwrap();
        assert_eq!(out.value, Value::Number(5.0));
    }

    #[test]
    fn arithmetic_precedence() {
        let out = run("2 + 3 * 4", StubData::new()).unwrap();
        assert_eq!(out.value, Value::Number(14.0));
    }

    #[test]
    fn arithmetic_parens() {
        let out = run("(2 + 3) * 4", StubData::new()).unwrap();
        assert_eq!(out.value, Value::Number(20.0));
    }

    #[test]
    fn arithmetic_chained_left_to_right() {
        let out = run("10 - 3 - 2", StubData::new()).unwrap();
        assert_eq!(out.value, Value::Number(5.0));
    }

    #[test]
    fn arithmetic_negative_numbers() {
        let out = run("-5 + 3", StubData::new()).unwrap();
        assert_eq!(out.value, Value::Number(-2.0));
    }

    #[test]
    fn arithmetic_division_by_zero() {
        let err = run("10 / 0", StubData::new()).unwrap_err();
        assert!(matches!(err, AnalysisError::DivisionByZero));
    }

    #[test]
    fn arithmetic_decimal_division() {
        let out = run("15 / 4", StubData::new()).unwrap();
        assert_eq!(out.value, Value::Number(3.75));
    }

    #[test]
    fn pure_arithmetic_has_empty_data_range() {
        let out = run("2 + 3", StubData::new()).unwrap();
        assert!(out.data_range.is_empty());
    }

    // ---------- Data access + provenance ----------

    #[test]
    fn close_returns_50_bars() {
        let out = run("CLOSE('AAPL', '1d')", aapl_50_bars()).unwrap();
        match out.value {
            Value::Array(tv) => {
                assert_eq!(tv.values.len(), 50);
                assert_eq!(tv.values[0], 100.0);
                assert_eq!(tv.values[49], 149.0);
            }
            _ => panic!("expected array"),
        }
        assert!(out.data_range.contains_key("AAPL"));
    }

    #[test]
    fn data_range_collects_symbol_metadata() {
        let out = run("CLOSE('AAPL', '1d')[-1]", aapl_50_bars()).unwrap();
        assert_eq!(out.value, Value::Number(149.0));
        let meta = out.data_range.get("AAPL").unwrap();
        assert_eq!(meta.bars, 50);
    }

    // ---------- Array access ----------

    #[test]
    fn positive_index() {
        let out = run("CLOSE('AAPL', '1d')[0]", aapl_50_bars()).unwrap();
        assert_eq!(out.value, Value::Number(100.0));
    }

    #[test]
    fn negative_index_one() {
        let out = run("CLOSE('AAPL', '1d')[-1]", aapl_50_bars()).unwrap();
        assert_eq!(out.value, Value::Number(149.0));
    }

    #[test]
    fn negative_index_two() {
        let out = run("CLOSE('AAPL', '1d')[-2]", aapl_50_bars()).unwrap();
        assert_eq!(out.value, Value::Number(148.0));
    }

    #[test]
    fn array_index_out_of_bounds() {
        let err = run("CLOSE('AAPL', '1d')[100]", aapl_50_bars()).unwrap_err();
        match err {
            AnalysisError::EvalError(m) => assert!(m.contains("out of bounds")),
            _ => panic!("expected eval error"),
        }
    }

    #[test]
    fn array_access_on_non_array_errors() {
        // SMA returns a scalar; indexing it should error like TS does.
        let err = run("SMA(CLOSE('AAPL', '1d'), 10)[0]", aapl_50_bars()).unwrap_err();
        match err {
            AnalysisError::EvalError(m) => assert!(m.contains("requires an array")),
            _ => panic!("expected eval error"),
        }
    }

    // ---------- Binop on non-numbers ----------

    #[test]
    fn binop_on_array_errors() {
        let err = run("CLOSE('AAPL', '1d') + 1", aapl_50_bars()).unwrap_err();
        match err {
            AnalysisError::EvalError(m) => assert!(m.contains("require numbers")),
            _ => panic!("expected eval error"),
        }
    }

    // ---------- Stat functions through dispatcher ----------

    #[test]
    fn sma_dispatched() {
        let out = run("SMA(CLOSE('AAPL', '1d'), 10)", aapl_50_bars()).unwrap();
        assert_eq!(out.value, Value::Number(144.5));
    }

    #[test]
    fn max_dispatched() {
        let out = run("MAX(CLOSE('AAPL', '1d'))", aapl_50_bars()).unwrap();
        assert_eq!(out.value, Value::Number(149.0));
    }

    #[test]
    fn unknown_function_errors() {
        let err = run("FAKE(CLOSE('AAPL', '1d'))", aapl_50_bars()).unwrap_err();
        match err {
            AnalysisError::UnknownFunction(n) => assert_eq!(n, "FAKE"),
            _ => panic!("expected UnknownFunction"),
        }
    }

    // ---------- Top-level string result ----------

    #[test]
    fn top_level_string_errors() {
        let err = run("'AAPL'", aapl_50_bars()).unwrap_err();
        match err {
            AnalysisError::EvalError(m) => assert!(m.contains("cannot be a string")),
            _ => panic!("expected eval error"),
        }
    }

    // ---------- Complex expressions ----------

    #[test]
    fn arithmetic_on_function_results() {
        let out = run(
            "MAX(CLOSE('AAPL', '1d')) - MIN(CLOSE('AAPL', '1d'))",
            aapl_50_bars(),
        )
        .unwrap();
        assert_eq!(out.value, Value::Number(49.0));
    }
}
