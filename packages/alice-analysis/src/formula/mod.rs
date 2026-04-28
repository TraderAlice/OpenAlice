// Formula language: tokenizer, parser, AST, and evaluator.
//
// Public surface mirrors the TS IndicatorCalculator (see _rust-port/01-survey.md §2).
// The evaluator is generic over a `DataAccessor` (TS callback shim — bound at the
// NAPI boundary) and a `FunctionDispatcher` (kernel calls — bound at the NAPI
// boundary so this module does not depend on `crate::indicator`).
//
// Precision is applied once at the public NAPI entry point, not inside the
// evaluator (per design §2 quirk #4). The evaluator returns raw `Value`s.

pub mod ast;
pub mod evaluator;
pub mod lexer;
pub mod parser;
pub mod value;

pub use ast::{ArrayAccessNode, AstNode, BinaryOp, BinaryOpNode, FunctionNode};
pub use evaluator::{evaluate, DataAccessor, EvalOutput, Field, FunctionDispatcher};
pub use lexer::{tokenize, Token, TokenKind};
pub use parser::parse;
pub use value::{DataSourceMeta, TrackedValues, Value};
