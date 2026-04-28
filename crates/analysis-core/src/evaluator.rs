//! Arithmetic-only evaluator slice (OPE-18).
//!
//! This module ports the smallest useful piece of the legacy
//! `IndicatorCalculator.evaluate` from
//! `src/domain/analysis/indicator/calculator.ts`: numeric literals and
//! `+ - * /` between numbers. Anything else (strings, function calls,
//! array access, future array literals) is intentionally classified as
//! `Unsupported` rather than rejected. The TypeScript evaluator remains
//! authoritative for those cases via the OPE-16/OPE-17 Rust-parser +
//! TS-evaluator route.
//!
//! The legacy parity contract this slice locks:
//!
//! - integer/decimal literal evaluation matches `node.value` directly
//! - binary operators behave like JavaScript double-precision arithmetic
//!   (`+`, `-`, `*`, `/` produce the same `f64` results)
//! - `right == 0.0` for `/` produces `EvalError { message: "Division by
//!   zero" }`, identical to the TS evaluator's
//!   `throw new Error('Division by zero')`
//!
//! Unsupported is decided as a *whole-tree* property: if any node
//! anywhere in the AST is non-arithmetic, the outcome is
//! [`EvalOutcome::Unsupported`] *before* any arithmetic is run. That
//! avoids producing a Rust runtime error (e.g. division by zero in one
//! subtree) for a tree whose authoritative evaluation belongs to the
//! TypeScript evaluator anyway.

use crate::parser::AstNode;

/// Outcome of an arithmetic-only evaluation attempt.
#[derive(Debug, Clone, PartialEq)]
pub enum EvalOutcome {
    /// The AST was fully arithmetic-only and evaluated successfully.
    Value(f64),
    /// The AST was fully arithmetic-only but raised a runtime error
    /// (e.g. division by zero) whose message is parity-locked with the
    /// legacy TypeScript evaluator.
    Error(EvalError),
    /// The AST contains at least one node the arithmetic-only evaluator
    /// is not authorized to handle in this slice. Callers must hand the
    /// AST back to the legacy TypeScript evaluator unchanged.
    Unsupported,
}

/// Runtime evaluation error with the legacy-format human-readable
/// message.
#[derive(Debug, Clone, PartialEq)]
pub struct EvalError {
    pub message: String,
}

impl EvalError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for EvalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for EvalError {}

/// Evaluate the AST as an arithmetic-only expression.
///
/// Returns [`EvalOutcome::Unsupported`] up-front if any node is
/// non-arithmetic. Only after the AST is proven arithmetic-only does
/// the evaluator run; that ordering means a tree like `(10/0) +
/// CLOSE(...)[-1]` falls back to the TS evaluator (which owns full
/// evaluation semantics for non-arithmetic trees) instead of being
/// half-evaluated by Rust.
pub fn evaluate_arithmetic_only(node: &AstNode) -> EvalOutcome {
    if !is_arithmetic_only(node) {
        return EvalOutcome::Unsupported;
    }
    match eval_pure_arithmetic(node) {
        Ok(value) => EvalOutcome::Value(value),
        Err(err) => EvalOutcome::Error(err),
    }
}

/// Recursively check that every node in the AST is one this slice
/// claims authority over.
fn is_arithmetic_only(node: &AstNode) -> bool {
    match node {
        AstNode::Number { .. } => true,
        AstNode::BinaryOp {
            operator,
            left,
            right,
        } => {
            matches!(operator.as_str(), "+" | "-" | "*" | "/")
                && is_arithmetic_only(left)
                && is_arithmetic_only(right)
        }
        AstNode::Str { .. } | AstNode::Function { .. } | AstNode::ArrayAccess { .. } => false,
    }
}

/// Evaluate a tree that has already passed [`is_arithmetic_only`]. The
/// match is exhaustive over the arithmetic subset; any unreachable
/// branch is mapped through `unreachable!` since hitting it would imply
/// the gating function disagreed with this one.
fn eval_pure_arithmetic(node: &AstNode) -> Result<f64, EvalError> {
    match node {
        AstNode::Number { value } => Ok(*value),
        AstNode::BinaryOp {
            operator,
            left,
            right,
        } => {
            let left_val = eval_pure_arithmetic(left)?;
            let right_val = eval_pure_arithmetic(right)?;
            match operator.as_str() {
                "+" => Ok(left_val + right_val),
                "-" => Ok(left_val - right_val),
                "*" => Ok(left_val * right_val),
                "/" => {
                    if right_val == 0.0 {
                        Err(EvalError::new("Division by zero"))
                    } else {
                        Ok(left_val / right_val)
                    }
                }
                op => unreachable!(
                    "is_arithmetic_only must reject non-arithmetic operator '{op}' before reaching the evaluator",
                ),
            }
        }
        AstNode::Str { .. } | AstNode::Function { .. } | AstNode::ArrayAccess { .. } => {
            unreachable!(
                "is_arithmetic_only must reject non-arithmetic nodes before reaching the evaluator",
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse;

    fn eval_formula(formula: &str) -> EvalOutcome {
        let ast = parse(formula).expect("parse should succeed");
        evaluate_arithmetic_only(&ast)
    }

    #[test]
    fn literal_integer() {
        assert_eq!(eval_formula("42"), EvalOutcome::Value(42.0));
    }

    #[test]
    fn literal_decimal() {
        assert_eq!(eval_formula("3.14"), EvalOutcome::Value(3.14));
    }

    #[test]
    fn negative_literal() {
        assert_eq!(eval_formula("-5"), EvalOutcome::Value(-5.0));
    }

    #[test]
    fn arithmetic_precedence_matches_js() {
        // 2 + 3*4 = 14 (left-to-right with * binding tighter)
        assert_eq!(eval_formula("2 + 3 * 4"), EvalOutcome::Value(14.0));
    }

    #[test]
    fn parens_override_precedence() {
        assert_eq!(eval_formula("(2 + 3) * 4"), EvalOutcome::Value(20.0));
    }

    #[test]
    fn nested_with_negative_numbers() {
        // ((1 - -2) * 3) + (-4 / -2) = 9 + 2 = 11
        assert_eq!(
            eval_formula("((1 - -2) * 3) + (-4 / -2)"),
            EvalOutcome::Value(11.0),
        );
    }

    #[test]
    fn division_by_zero_is_legacy_error() {
        match eval_formula("10 / 0") {
            EvalOutcome::Error(err) => assert_eq!(err.message, "Division by zero"),
            other => panic!("expected division-by-zero error, got {:?}", other),
        }
    }

    #[test]
    fn float_division_matches_double_precision() {
        match eval_formula("10 / 3") {
            EvalOutcome::Value(v) => assert_eq!(v, 10.0_f64 / 3.0_f64),
            other => panic!("expected value, got {:?}", other),
        }
    }

    #[test]
    fn function_call_is_unsupported() {
        assert_eq!(
            eval_formula("CLOSE('AAPL', '1d')"),
            EvalOutcome::Unsupported,
        );
    }

    #[test]
    fn function_inside_arithmetic_is_unsupported() {
        // The non-arithmetic node lives several levels deep; we still
        // fall back rather than producing a partial Rust result.
        assert_eq!(
            eval_formula("(1 + 2) * SMA(CLOSE('AAPL', '1d'), 10)"),
            EvalOutcome::Unsupported,
        );
    }

    #[test]
    fn array_access_is_unsupported() {
        assert_eq!(
            eval_formula("CLOSE('AAPL', '1d')[-1]"),
            EvalOutcome::Unsupported,
        );
    }

    #[test]
    fn bare_string_is_unsupported() {
        assert_eq!(eval_formula("'AAPL'"), EvalOutcome::Unsupported);
    }

    #[test]
    fn unsupported_takes_priority_over_eval_error() {
        // The TS evaluator owns full evaluation semantics for trees
        // that touch any non-arithmetic node, including the order in
        // which a runtime error like Division by zero would surface.
        assert_eq!(
            eval_formula("(10 / 0) + CLOSE('AAPL', '1d')[-1]"),
            EvalOutcome::Unsupported,
        );
    }
}
