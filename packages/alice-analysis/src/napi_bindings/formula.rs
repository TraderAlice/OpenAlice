// `evaluateFormula` — async-from-JS NAPI fn that:
//   1. Parses the formula AST (sync, fast).
//   2. Creates a `ThreadsafeFunction` from the JS `fetcher` callback (must be
//      done synchronously on the JS thread because `JsFunction` is not `Send`).
//   3. Walks the AST collecting every `(symbol, interval, field)` triple
//      referenced by a CLOSE/HIGH/LOW/OPEN/VOLUME call.
//   4. Spawns a Tokio future that calls back into JS *once per unique triple*
//      via the TSFn to fetch OHLCV columns.
//   5. Builds an in-memory `DataAccessor` impl from the pre-fetched data and
//      drives the *sync* evaluator. The parser teammate kept the evaluator sync;
//      we honour that and do the async dance once at the boundary.
//   6. Applies precision (TS-equivalent `parseFloat(toFixed(n))`) and produces
//      a tagged-union result + `dataRange`.
//
// Why approach (b) — pre-fetch — over (a) async ThreadsafeFunction inside a
// recursive async evaluator: AST collection is cheap (one tree walk) and the
// formula's source list is small (typically 1–3 distinct columns); paying the
// JS callback cost N times up-front beats interleaving JS and Rust call frames.
// The evaluator stays sync, so we don't need `async-trait` or to fight async
// recursion — the parser teammate's existing sync interface drops in untouched.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use napi::bindgen_prelude::{Float64Array, Promise};
use napi::threadsafe_function::{
    ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode,
};
use napi::{Env, JsFunction, JsObject};
use napi_derive::napi;
use tokio::sync::oneshot;

use crate::error::AnalysisError;
use crate::formula::{
    self,
    ast::{ArrayAccessNode, AstNode, BinaryOpNode, FunctionNode},
    evaluator::{DataAccessor, EvalOutput, Field, FunctionDispatcher},
    value::{DataSourceMeta as RustMeta, TrackedValues, Value},
};
use crate::indicator;

// ---- JS-facing types ----

/// Source metadata for one OHLCV column. Mirrors the TS `DataSourceMeta`.
#[napi(object)]
pub struct DataSourceMetaJs {
    pub symbol: String,
    pub from: String,
    pub to: String,
    pub bars: u32,
}

/// One OHLCV column as returned by the JS fetcher (after Promise resolution).
#[napi(object)]
pub struct FetchedColumnJs {
    pub values: Float64Array,
    pub source: DataSourceMetaJs,
}

/// Tagged-union result of a formula evaluation.
///
/// `kind` is one of:
///   * "number" → `n` set
///   * "array"  → `a` set + `arraySource` for provenance
///   * "object" → `o` set (e.g. BBANDS / MACD records)
#[napi(object)]
pub struct EvalResultJs {
    pub kind: String,
    pub n: Option<f64>,
    pub a: Option<Vec<f64>>,
    pub array_source: Option<DataSourceMetaJs>,
    pub o: Option<HashMap<String, f64>>,
    pub data_range: HashMap<String, DataSourceMetaJs>,
}

// ---- Public NAPI entry point ----

/// Evaluate a formula. The `fetcher` callback receives `(symbol, interval, field)`
/// where `field` is one of `"close" | "open" | "high" | "low" | "volume"` and
/// must resolve to `{ values: Float64Array, source: { symbol, from, to, bars } }`.
///
/// `precision` is the TS-equivalent `parseFloat(value.toFixed(precision))` round
/// applied once at the end. Default 4. Range [0, 10] enforced by the TS adapter.
#[napi(ts_args_type = "formula: string, fetcher: (symbol: string, interval: string, field: string) => Promise<{ values: Float64Array, source: { symbol: string, from: string, to: string, bars: number } }>, precision?: number | undefined | null")]
pub fn evaluate_formula(
    env: Env,
    formula: String,
    fetcher: JsFunction,
    precision: Option<u32>,
) -> napi::Result<JsObject> {
    // Create the threadsafe function on the JS thread (sync). The TSFn is `Send`
    // and can be moved into the async block; `JsFunction` is not.
    let tsfn: ThreadsafeFunction<FetchRequest, ErrorStrategy::Fatal> = fetcher
        .create_threadsafe_function(0, |ctx| {
            let req: FetchRequest = ctx.value;
            let env = ctx.env;
            let s = env.create_string(&req.symbol)?;
            let i = env.create_string(&req.interval)?;
            let f = env.create_string(req.field.as_str())?;
            Ok(vec![
                s.into_unknown(),
                i.into_unknown(),
                f.into_unknown(),
            ])
        })?;
    let tsfn = Arc::new(tsfn);

    let ast = formula::parse(&formula).map_err(napi::Error::from)?;
    let triples = collect_data_refs(&ast);
    let precision = precision.unwrap_or(4);

    // Move into Tokio. `execute_tokio_future` returns a JS Promise that
    // resolves with the converted result.
    env.execute_tokio_future(
        async move {
            let mut prefetched: HashMap<(String, String, Field), TrackedValues> =
                HashMap::new();
            for t in triples {
                if prefetched.contains_key(&t) {
                    continue;
                }
                let fetched = call_fetcher(&tsfn, t.clone()).await?;
                prefetched.insert(t, fetched);
            }
            let mut accessor = PrefetchedData { data: prefetched };
            let mut dispatcher = KernelDispatcher;
            let out = formula::evaluate(&ast, &mut accessor, &mut dispatcher)
                .map_err(napi::Error::from)?;
            Ok(EvalResultRust::from_eval_output(out, precision))
        },
        |&mut env, result: EvalResultRust| {
            // Convert the Send-friendly Rust result into napi-friendly types
            // back on the JS thread, then box up as napi::Result<JsObject> via
            // ToNapiValue.
            result.to_js_object(&env)
        },
    )
}

// ---- Pre-fetch machinery ----

/// One pending JS fetch.
#[derive(Debug, Clone)]
struct FetchRequest {
    symbol: String,
    interval: String,
    field: Field,
}

/// One JS callback round-trip. Calls the JS fetcher, gets the returned Promise,
/// then `.await`s it to drain the resolved value into a Rust `TrackedValues`.
async fn call_fetcher(
    tsfn: &Arc<ThreadsafeFunction<FetchRequest, ErrorStrategy::Fatal>>,
    triple: (String, String, Field),
) -> Result<TrackedValues, napi::Error> {
    let (tx, rx) = oneshot::channel::<napi::Result<Promise<FetchedColumnJs>>>();
    let tx = std::sync::Mutex::new(Some(tx));
    let req = FetchRequest {
        symbol: triple.0.clone(),
        interval: triple.1.clone(),
        field: triple.2,
    };
    let interval_for_meta = triple.1.clone();

    // The JS function returns a Promise. We capture it via Promise<T>'s
    // FromNapiValue impl (which attaches .then/.catch under the hood) and ship
    // it back through the oneshot. Then await it from this async fn.
    tsfn.call_with_return_value(
        req,
        ThreadsafeFunctionCallMode::Blocking,
        move |promise: Promise<FetchedColumnJs>| -> napi::Result<()> {
            if let Some(sender) = tx.lock().unwrap().take() {
                let _ = sender.send(Ok(promise));
            }
            Ok(())
        },
    );

    let promise = match rx.await {
        Ok(Ok(p)) => p,
        Ok(Err(e)) => return Err(e),
        Err(_) => {
            return Err(napi::Error::from(AnalysisError::DataFetch(
                "data fetcher channel dropped".to_string(),
            )));
        }
    };
    let fetched: FetchedColumnJs = promise.await?;
    let values: Vec<f64> = fetched.values.as_ref().to_vec();
    Ok(TrackedValues {
        values,
        source: RustMeta {
            symbol: fetched.source.symbol,
            interval: interval_for_meta,
            from: fetched.source.from,
            to: fetched.source.to,
            bars: fetched.source.bars as usize,
        },
    })
}

fn collect_data_refs(ast: &AstNode) -> Vec<(String, String, Field)> {
    fn walk(node: &AstNode, out: &mut Vec<(String, String, Field)>) {
        match node {
            AstNode::Number(_) | AstNode::String(_) => {}
            AstNode::Function(FunctionNode { name, args }) => {
                if let Some(field) = field_from_name(name) {
                    if args.len() >= 2 {
                        if let (AstNode::String(sym), AstNode::String(itv)) =
                            (&args[0], &args[1])
                        {
                            out.push((sym.clone(), itv.clone(), field));
                        }
                    }
                }
                for a in args {
                    walk(a, out);
                }
            }
            AstNode::BinaryOp(BinaryOpNode { left, right, .. }) => {
                walk(left, out);
                walk(right, out);
            }
            AstNode::ArrayAccess(ArrayAccessNode { array, index }) => {
                walk(array, out);
                walk(index, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(ast, &mut out);
    out
}

fn field_from_name(name: &str) -> Option<Field> {
    match name {
        "CLOSE" => Some(Field::Close),
        "OPEN" => Some(Field::Open),
        "HIGH" => Some(Field::High),
        "LOW" => Some(Field::Low),
        "VOLUME" => Some(Field::Volume),
        _ => None,
    }
}

// ---- DataAccessor + FunctionDispatcher impls used by the evaluator ----

struct PrefetchedData {
    data: HashMap<(String, String, Field), TrackedValues>,
}

impl DataAccessor for PrefetchedData {
    fn fetch(
        &mut self,
        symbol: &str,
        interval: &str,
        field: Field,
    ) -> Result<TrackedValues, AnalysisError> {
        // The AST walker covered every literal-string call; if we hit this and
        // there's no entry, the formula used non-literal args (e.g.
        // `CLOSE('A','1'+'d')`). TS handles that path by failing with a
        // type-mismatch on the concatenation; we surface a DataFetch error.
        self.data
            .get(&(symbol.to_string(), interval.to_string(), field))
            .cloned()
            .ok_or_else(|| {
                AnalysisError::DataFetch(format!(
                    "data not pre-fetched for ({symbol}, {interval}, {})",
                    field.as_str()
                ))
            })
    }
}

struct KernelDispatcher;

impl FunctionDispatcher for KernelDispatcher {
    fn call(&mut self, name: &str, args: &[Value]) -> Result<Value, AnalysisError> {
        fn arr<'a>(v: &'a Value) -> Result<&'a [f64], AnalysisError> {
            match v {
                Value::Array(t) => Ok(&t.values[..]),
                other => Err(AnalysisError::TypeMismatch {
                    expected: "array",
                    got: other.type_name(),
                }),
            }
        }
        fn num(v: &Value) -> Result<f64, AnalysisError> {
            match v {
                Value::Number(n) => Ok(*n),
                other => Err(AnalysisError::TypeMismatch {
                    expected: "number",
                    got: other.type_name(),
                }),
            }
        }
        fn period(v: Option<&Value>, default: usize) -> Result<usize, AnalysisError> {
            match v {
                None => Ok(default),
                Some(x) => Ok(num(x)? as usize),
            }
        }
        fn obj_for_bbands(r: indicator::BbandsOutput) -> Value {
            let mut m = BTreeMap::new();
            m.insert("upper".to_string(), r.upper);
            m.insert("middle".to_string(), r.middle);
            m.insert("lower".to_string(), r.lower);
            Value::Object(m)
        }
        fn obj_for_macd(r: indicator::MacdOutput) -> Value {
            let mut m = BTreeMap::new();
            m.insert("macd".to_string(), r.macd);
            m.insert("signal".to_string(), r.signal);
            m.insert("histogram".to_string(), r.histogram);
            Value::Object(m)
        }

        match name {
            "SMA" => {
                let p = num(args.get(1).ok_or_else(|| {
                    AnalysisError::EvalError("SMA(data, period) requires 2 args".to_string())
                })?)? as usize;
                Ok(Value::Number(indicator::sma(arr(&args[0])?, p)?))
            }
            "EMA" => {
                let p = num(args.get(1).ok_or_else(|| {
                    AnalysisError::EvalError("EMA(data, period) requires 2 args".to_string())
                })?)? as usize;
                Ok(Value::Number(indicator::ema(arr(&args[0])?, p)?))
            }
            "STDEV" => Ok(Value::Number(indicator::stdev(arr(&args[0])?)?)),
            "MAX" => Ok(Value::Number(indicator::max(arr(&args[0])?)?)),
            "MIN" => Ok(Value::Number(indicator::min(arr(&args[0])?)?)),
            "SUM" => Ok(Value::Number(indicator::sum(arr(&args[0])?)?)),
            "AVERAGE" => Ok(Value::Number(indicator::average(arr(&args[0])?)?)),
            "RSI" => {
                let p = period(args.get(1), 14)?;
                Ok(Value::Number(indicator::rsi(arr(&args[0])?, p)?))
            }
            "BBANDS" => {
                let p = period(args.get(1), 20)?;
                let m = match args.get(2) {
                    None => 2.0,
                    Some(v) => num(v)?,
                };
                Ok(obj_for_bbands(indicator::bbands(arr(&args[0])?, p, m)?))
            }
            "MACD" => {
                let f = period(args.get(1), 12)?;
                let s = period(args.get(2), 26)?;
                let sig = period(args.get(3), 9)?;
                Ok(obj_for_macd(indicator::macd(arr(&args[0])?, f, s, sig)?))
            }
            "ATR" => {
                let p = period(args.get(3), 14)?;
                Ok(Value::Number(indicator::atr(
                    arr(&args[0])?,
                    arr(&args[1])?,
                    arr(&args[2])?,
                    p,
                )?))
            }
            other => Err(AnalysisError::UnknownFunction(other.to_string())),
        }
    }
}

// ---- Send-friendly intermediate result + JS lowering ----

/// Send-safe representation of an evaluation result. Built on the Tokio side,
/// converted to JS objects on the env-thread side.
struct EvalResultRust {
    kind: ResultKind,
    data_range: BTreeMap<String, RustMeta>,
}

enum ResultKind {
    Number(f64),
    Array { values: Vec<f64>, source: RustMeta },
    Object(BTreeMap<String, f64>),
}

impl EvalResultRust {
    fn from_eval_output(out: EvalOutput, precision: u32) -> Self {
        let kind = match out.value {
            Value::Number(n) => ResultKind::Number(js_to_fixed(n, precision)),
            Value::Array(t) => ResultKind::Array {
                values: t
                    .values
                    .into_iter()
                    .map(|v| js_to_fixed(v, precision))
                    .collect(),
                source: t.source,
            },
            Value::Object(m) => {
                let mut out = BTreeMap::new();
                for (k, v) in m {
                    out.insert(k, js_to_fixed(v, precision));
                }
                ResultKind::Object(out)
            }
            // Top-level string is rejected by the evaluator already; if we got
            // here something invariant-broke. Surface as empty object.
            Value::String(_) => ResultKind::Object(BTreeMap::new()),
        };
        EvalResultRust {
            kind,
            data_range: out.data_range,
        }
    }

    fn to_js_object(self, env: &Env) -> napi::Result<JsObject> {
        let mut obj = env.create_object()?;
        let mut data_range = env.create_object()?;
        for (sym, meta) in &self.data_range {
            data_range.set_named_property(sym, meta_to_js_object(env, meta)?)?;
        }
        match self.kind {
            ResultKind::Number(n) => {
                obj.set_named_property("kind", env.create_string("number")?)?;
                obj.set_named_property("n", env.create_double(n)?)?;
            }
            ResultKind::Array { values, source } => {
                obj.set_named_property("kind", env.create_string("array")?)?;
                let mut arr = env.create_array_with_length(values.len())?;
                for (i, v) in values.iter().enumerate() {
                    arr.set_element(i as u32, env.create_double(*v)?)?;
                }
                obj.set_named_property("a", arr)?;
                obj.set_named_property("arraySource", meta_to_js_object(env, &source)?)?;
            }
            ResultKind::Object(map) => {
                obj.set_named_property("kind", env.create_string("object")?)?;
                let mut o = env.create_object()?;
                for (k, v) in &map {
                    o.set_named_property(k, env.create_double(*v)?)?;
                }
                obj.set_named_property("o", o)?;
            }
        }
        obj.set_named_property("dataRange", data_range)?;
        Ok(obj)
    }
}

fn meta_to_js_object(env: &Env, m: &RustMeta) -> napi::Result<JsObject> {
    let mut o = env.create_object()?;
    o.set_named_property("symbol", env.create_string(&m.symbol)?)?;
    o.set_named_property("from", env.create_string(&m.from)?)?;
    o.set_named_property("to", env.create_string(&m.to)?)?;
    o.set_named_property("bars", env.create_uint32(m.bars as u32)?)?;
    Ok(o)
}

/// TS-equivalent precision: `parseFloat(value.toFixed(n))`. JS `toFixed`
/// rounds half-away-from-zero per ECMA-262; Rust's `(x * scale).round() /
/// scale` does the same. None of the indicator outputs sit on a `xxxx.xxxx5`
/// boundary on the test fixture (verified by the survey §5.5). This is a JS-
/// compatible quantizer for finite f64.
fn js_to_fixed(x: f64, precision: u32) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let scale = 10f64.powi(precision as i32);
    (x * scale).round() / scale
}
