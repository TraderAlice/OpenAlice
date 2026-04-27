//! Formula tokenizer and parser - Phase 2 first parity slice.
//!
//! This module is a faithful port of the recursive-descent parser inside
//! `IndicatorCalculator.parse` (see `src/domain/analysis/indicator/calculator.ts`).
//! It accepts the same legacy formula grammar and emits a JSON-compatible
//! AST whose tagged-enum `type` discriminator matches the TypeScript
//! `ASTNode` shape exactly:
//!
//! ```text
//! { "type": "number",      "value": <f64> }
//! { "type": "string",      "value": <string> }
//! { "type": "function",    "name": <string>, "args": [<AstNode>...] }
//! { "type": "binaryOp",    "operator": "+|-|*|/", "left": <AstNode>, "right": <AstNode> }
//! { "type": "arrayAccess", "array": <AstNode>, "index": <AstNode> }
//! ```
//!
//! Error messages and `position` semantics are preserved 1:1 with the
//! legacy parser for the cases its acceptance suite locks today
//! (`Expected ')' at position N`, `Expected ']' at position N`,
//! `Unterminated string at position N`, `Unexpected character 'X' at
//! position N` with and without the `Expected end of expression.`
//! suffix, and `Unknown identifier 'X' at position N`).

use serde::Serialize;

/// Parser AST node. The `serde` tagged representation matches the legacy
/// TypeScript `ASTNode` discriminator exactly.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type")]
pub enum AstNode {
    #[serde(rename = "number")]
    Number { value: f64 },
    #[serde(rename = "string")]
    Str { value: String },
    #[serde(rename = "function")]
    Function { name: String, args: Vec<AstNode> },
    #[serde(rename = "binaryOp")]
    BinaryOp {
        operator: String,
        left: Box<AstNode>,
        right: Box<AstNode>,
    },
    #[serde(rename = "arrayAccess")]
    ArrayAccess {
        array: Box<AstNode>,
        index: Box<AstNode>,
    },
}

/// Parse error with the legacy-format human-readable message.
#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub message: String,
    pub position: usize,
}

impl ParseError {
    pub fn new(message: impl Into<String>, position: usize) -> Self {
        Self {
            message: message.into(),
            position,
        }
    }
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ParseError {}

/// Parse a formula string into an [`AstNode`].
pub fn parse(formula: &str) -> Result<AstNode, ParseError> {
    let chars: Vec<char> = formula.chars().collect();
    let mut p = Parser {
        chars: &chars,
        pos: 0,
    };
    p.skip_whitespace();
    let result = p.parse_expression()?;
    p.skip_whitespace();
    if p.pos < p.chars.len() {
        let ch = p.chars[p.pos];
        return Err(ParseError::new(
            format!(
                "Unexpected character '{}' at position {}. Expected end of expression.",
                ch, p.pos
            ),
            p.pos,
        ));
    }
    Ok(result)
}

struct Parser<'a> {
    chars: &'a [char],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn consume(&mut self) -> Option<char> {
        let ch = self.peek();
        if ch.is_some() {
            self.pos += 1;
        }
        ch
    }

    fn skip_whitespace(&mut self) {
        while let Some(ch) = self.peek() {
            if ch.is_whitespace() {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn is_digit(ch: char) -> bool {
        ch.is_ascii_digit()
    }

    fn is_alpha(ch: char) -> bool {
        ch.is_ascii_alphabetic() || ch == '_'
    }

    fn parse_expression(&mut self) -> Result<AstNode, ParseError> {
        let mut left = self.parse_term()?;
        self.skip_whitespace();
        while matches!(self.peek(), Some('+') | Some('-')) {
            let op = self.consume().unwrap();
            self.skip_whitespace();
            let right = self.parse_term()?;
            self.skip_whitespace();
            left = AstNode::BinaryOp {
                operator: op.to_string(),
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    fn parse_term(&mut self) -> Result<AstNode, ParseError> {
        let mut left = self.parse_factor()?;
        self.skip_whitespace();
        while matches!(self.peek(), Some('*') | Some('/')) {
            let op = self.consume().unwrap();
            self.skip_whitespace();
            let right = self.parse_factor()?;
            self.skip_whitespace();
            left = AstNode::BinaryOp {
                operator: op.to_string(),
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    fn parse_factor(&mut self) -> Result<AstNode, ParseError> {
        self.skip_whitespace();

        match self.peek() {
            Some('(') => {
                self.consume();
                let expr = self.parse_expression()?;
                self.skip_whitespace();
                if self.peek() != Some(')') {
                    return Err(ParseError::new(
                        format!("Expected ')' at position {}", self.pos),
                        self.pos,
                    ));
                }
                self.consume();
                Ok(expr)
            }
            Some('\'') | Some('"') => self.parse_string(),
            Some(ch) if Self::is_digit(ch) => self.parse_number(),
            Some('-') => {
                let next = self.chars.get(self.pos + 1).copied();
                if let Some(nc) = next {
                    if Self::is_digit(nc) || nc == '.' {
                        return self.parse_number();
                    }
                }
                Err(ParseError::new(
                    format!("Unexpected character '-' at position {}", self.pos),
                    self.pos,
                ))
            }
            Some(ch) if Self::is_alpha(ch) => self.parse_function_or_identifier(),
            Some(ch) => Err(ParseError::new(
                format!("Unexpected character '{}' at position {}", ch, self.pos),
                self.pos,
            )),
            None => Err(ParseError::new(
                format!("Unexpected character '' at position {}", self.pos),
                self.pos,
            )),
        }
    }

    fn parse_function_or_identifier(&mut self) -> Result<AstNode, ParseError> {
        let name = self.parse_identifier();
        self.skip_whitespace();

        if self.peek() != Some('(') {
            return Err(ParseError::new(
                format!("Unknown identifier '{}' at position {}", name, self.pos),
                self.pos,
            ));
        }

        self.consume();
        self.skip_whitespace();
        let mut args: Vec<AstNode> = Vec::new();
        if self.peek() != Some(')') {
            args.push(self.parse_argument()?);
            self.skip_whitespace();
            while self.peek() == Some(',') {
                self.consume();
                self.skip_whitespace();
                args.push(self.parse_argument()?);
                self.skip_whitespace();
            }
        }
        if self.peek() != Some(')') {
            return Err(ParseError::new(
                format!("Expected ')' at position {}", self.pos),
                self.pos,
            ));
        }
        self.consume();

        let node = AstNode::Function { name, args };

        self.skip_whitespace();
        if self.peek() == Some('[') {
            return self.parse_array_access(node);
        }
        Ok(node)
    }

    fn parse_argument(&mut self) -> Result<AstNode, ParseError> {
        self.skip_whitespace();
        match self.peek() {
            Some('\'') | Some('"') => self.parse_string(),
            _ => self.parse_expression(),
        }
    }

    fn parse_string(&mut self) -> Result<AstNode, ParseError> {
        let quote = self.consume().expect("parse_string requires a quote head");
        let mut value = String::new();
        while let Some(ch) = self.peek() {
            if ch == quote {
                break;
            }
            value.push(ch);
            self.pos += 1;
        }
        if self.peek() != Some(quote) {
            return Err(ParseError::new(
                format!("Unterminated string at position {}", self.pos),
                self.pos,
            ));
        }
        self.consume();
        Ok(AstNode::Str { value })
    }

    fn parse_number(&mut self) -> Result<AstNode, ParseError> {
        let start = self.pos;
        let mut num_str = String::new();
        if self.peek() == Some('-') {
            num_str.push('-');
            self.pos += 1;
        }
        while let Some(ch) = self.peek() {
            if Self::is_digit(ch) || ch == '.' {
                num_str.push(ch);
                self.pos += 1;
            } else {
                break;
            }
        }
        match num_str.parse::<f64>() {
            Ok(value) => Ok(AstNode::Number { value }),
            Err(_) => Err(ParseError::new(
                format!("Unexpected character '{}' at position {}", num_str, start),
                start,
            )),
        }
    }

    fn parse_identifier(&mut self) -> String {
        let mut name = String::new();
        while let Some(ch) = self.peek() {
            if Self::is_alpha(ch) || Self::is_digit(ch) {
                name.push(ch);
                self.pos += 1;
            } else {
                break;
            }
        }
        name
    }

    fn parse_array_access(&mut self, array: AstNode) -> Result<AstNode, ParseError> {
        self.consume(); // '['
        self.skip_whitespace();
        let index = self.parse_expression()?;
        self.skip_whitespace();
        if self.peek() != Some(']') {
            return Err(ParseError::new(
                format!("Expected ']' at position {}", self.pos),
                self.pos,
            ));
        }
        self.consume();
        Ok(AstNode::ArrayAccess {
            array: Box::new(array),
            index: Box::new(index),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse_json(formula: &str) -> serde_json::Value {
        let ast = parse(formula).expect("parse should succeed");
        serde_json::to_value(&ast).unwrap()
    }

    #[test]
    fn parses_integer_literal() {
        assert_eq!(parse_json("42"), json!({ "type": "number", "value": 42.0 }));
    }

    #[test]
    fn parses_decimal_literal() {
        assert_eq!(
            parse_json("3.14"),
            json!({ "type": "number", "value": 3.14 })
        );
    }

    #[test]
    fn parses_negative_numeric_literal() {
        assert_eq!(parse_json("-5"), json!({ "type": "number", "value": -5.0 }));
    }

    #[test]
    fn parses_negative_decimal_with_dot_prefix() {
        assert_eq!(
            parse_json("-.5"),
            json!({ "type": "number", "value": -0.5 })
        );
    }

    #[test]
    fn parses_single_quoted_string_argument() {
        assert_eq!(
            parse_json("'AAPL'"),
            json!({ "type": "string", "value": "AAPL" })
        );
    }

    #[test]
    fn parses_double_quoted_string_argument() {
        assert_eq!(
            parse_json("\"AAPL\""),
            json!({ "type": "string", "value": "AAPL" })
        );
    }

    #[test]
    fn parses_arithmetic_left_to_right_with_precedence() {
        assert_eq!(
            parse_json("2 + 3 * 4"),
            json!({
                "type": "binaryOp",
                "operator": "+",
                "left": { "type": "number", "value": 2.0 },
                "right": {
                    "type": "binaryOp",
                    "operator": "*",
                    "left": { "type": "number", "value": 3.0 },
                    "right": { "type": "number", "value": 4.0 }
                }
            })
        );
    }

    #[test]
    fn parens_override_precedence() {
        assert_eq!(
            parse_json("(2 + 3) * 4"),
            json!({
                "type": "binaryOp",
                "operator": "*",
                "left": {
                    "type": "binaryOp",
                    "operator": "+",
                    "left": { "type": "number", "value": 2.0 },
                    "right": { "type": "number", "value": 3.0 }
                },
                "right": { "type": "number", "value": 4.0 }
            })
        );
    }

    #[test]
    fn nested_parens_collapse_to_inner_expression() {
        assert_eq!(
            parse_json("((1 + 2) * (3 + 4))"),
            json!({
                "type": "binaryOp",
                "operator": "*",
                "left": {
                    "type": "binaryOp",
                    "operator": "+",
                    "left": { "type": "number", "value": 1.0 },
                    "right": { "type": "number", "value": 2.0 }
                },
                "right": {
                    "type": "binaryOp",
                    "operator": "+",
                    "left": { "type": "number", "value": 3.0 },
                    "right": { "type": "number", "value": 4.0 }
                }
            })
        );
    }

    #[test]
    fn function_call_with_string_args() {
        assert_eq!(
            parse_json("CLOSE('AAPL', '1d')"),
            json!({
                "type": "function",
                "name": "CLOSE",
                "args": [
                    { "type": "string", "value": "AAPL" },
                    { "type": "string", "value": "1d" }
                ]
            })
        );
    }

    #[test]
    fn function_call_no_args() {
        assert_eq!(
            parse_json("NOOP()"),
            json!({ "type": "function", "name": "NOOP", "args": [] })
        );
    }

    #[test]
    fn nested_function_calls() {
        assert_eq!(
            parse_json("SMA(CLOSE('AAPL', '1d'), 10)"),
            json!({
                "type": "function",
                "name": "SMA",
                "args": [
                    {
                        "type": "function",
                        "name": "CLOSE",
                        "args": [
                            { "type": "string", "value": "AAPL" },
                            { "type": "string", "value": "1d" }
                        ]
                    },
                    { "type": "number", "value": 10.0 }
                ]
            })
        );
    }

    #[test]
    fn array_access_negative_index() {
        assert_eq!(
            parse_json("CLOSE('AAPL', '1d')[-1]"),
            json!({
                "type": "arrayAccess",
                "array": {
                    "type": "function",
                    "name": "CLOSE",
                    "args": [
                        { "type": "string", "value": "AAPL" },
                        { "type": "string", "value": "1d" }
                    ]
                },
                "index": { "type": "number", "value": -1.0 }
            })
        );
    }

    #[test]
    fn array_access_with_expression_index() {
        let ast = parse_json("CLOSE('AAPL', '1d')[5 + 1]");
        assert_eq!(
            ast["index"],
            json!({
                "type": "binaryOp",
                "operator": "+",
                "left": { "type": "number", "value": 5.0 },
                "right": { "type": "number", "value": 1.0 }
            })
        );
    }

    #[test]
    fn complex_price_deviation_percent_formula_parses() {
        let ast = parse(
            "(CLOSE('AAPL', '1d')[-1] - SMA(CLOSE('AAPL', '1d'), 50)) / SMA(CLOSE('AAPL', '1d'), 50) * 100",
        );
        assert!(ast.is_ok(), "expected parse to succeed: {:?}", ast.err());
        let value = serde_json::to_value(&ast.unwrap()).unwrap();
        assert_eq!(value["type"], "binaryOp");
        assert_eq!(value["operator"], "*");
        assert_eq!(value["right"], json!({ "type": "number", "value": 100.0 }));
    }

    #[test]
    fn whitespace_around_operators_is_ignored() {
        assert_eq!(parse_json("  2   +  3  "), parse_json("2+3"));
    }

    #[test]
    fn chained_subtraction_associates_left() {
        assert_eq!(
            parse_json("10 - 3 - 2"),
            json!({
                "type": "binaryOp",
                "operator": "-",
                "left": {
                    "type": "binaryOp",
                    "operator": "-",
                    "left": { "type": "number", "value": 10.0 },
                    "right": { "type": "number", "value": 3.0 }
                },
                "right": { "type": "number", "value": 2.0 }
            })
        );
    }

    #[test]
    fn error_missing_close_paren() {
        let err = parse("SMA(CLOSE('AAPL', '1d'), 5").unwrap_err();
        assert_eq!(err.message, "Expected ')' at position 26");
    }

    #[test]
    fn error_missing_close_bracket() {
        let err = parse("CLOSE('AAPL', '1d')[0").unwrap_err();
        assert_eq!(err.message, "Expected ']' at position 21");
    }

    #[test]
    fn error_unterminated_string() {
        let err = parse("CLOSE('AAPL, 10)").unwrap_err();
        assert!(
            err.message.starts_with("Unterminated string at position "),
            "unexpected message: {}",
            err.message
        );
    }

    #[test]
    fn error_unknown_identifier_without_call() {
        let err = parse("AAPL").unwrap_err();
        assert_eq!(err.message, "Unknown identifier 'AAPL' at position 4");
    }

    #[test]
    fn error_unexpected_trailing_token() {
        let err = parse("1 + 2 )").unwrap_err();
        assert_eq!(
            err.message,
            "Unexpected character ')' at position 6. Expected end of expression."
        );
    }

    #[test]
    fn error_unexpected_dash_without_number() {
        let err = parse("- ").unwrap_err();
        assert_eq!(err.message, "Unexpected character '-' at position 0");
    }

    #[test]
    fn error_unexpected_at_symbol() {
        let err = parse("@").unwrap_err();
        assert_eq!(err.message, "Unexpected character '@' at position 0");
    }

    #[test]
    fn json_uses_camel_case_tags_for_compound_nodes() {
        // Locks the discriminator string so the TS shim can hand the AST
        // directly to the legacy evaluator without remapping `type`.
        let ast = parse("CLOSE('AAPL', '1d')[-1]").unwrap();
        let v = serde_json::to_value(&ast).unwrap();
        assert_eq!(v["type"], "arrayAccess");
        assert_eq!(v["array"]["type"], "function");
        assert_eq!(v["index"]["type"], "number");
    }
}
