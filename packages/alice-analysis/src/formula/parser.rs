// Recursive-descent parser for the OpenAlice formula language.
//
// Mirrors `IndicatorCalculator.parse()` in src/domain/analysis/indicator/calculator.ts:79-234.
// Grammar (per survey §2):
//
//   Expression  → Term (('+' | '-') Term)*
//   Term        → Factor (('*' | '/') Factor)*
//   Factor      → '(' Expression ')'
//               | String
//               | Number
//               | '-' Number          (unary minus, only before digit/'.')
//               | FunctionOrIdentifier
//   FunctionOrIdentifier → Identifier '(' Arguments? ')' ('[' Index ']')?
//   Arguments   → Argument (',' Argument)*
//   Argument    → String | Expression
//
// Precedence (high→low): array-access [], */, +- (left-associative throughout).
// Unary minus is *only* recognised when followed by a digit or `.` — exactly matches TS
// (calculator.ts:126-133); it is not treated as a real prefix operator over expressions.

use crate::error::AnalysisError;
use crate::formula::ast::{ArrayAccessNode, AstNode, BinaryOp, BinaryOpNode, FunctionNode};
use crate::formula::lexer::{tokenize, Token, TokenKind};

pub fn parse(src: &str) -> Result<AstNode, AnalysisError> {
    let tokens = tokenize(src)?;
    let mut p = Parser {
        tokens: &tokens,
        pos: 0,
        src_len: src.len(),
    };
    let node = p.parse_expression()?;
    if p.pos < p.tokens.len() {
        let tok = &p.tokens[p.pos];
        return Err(AnalysisError::ParseError {
            position: tok.pos,
            message: format!(
                "Unexpected token at position {}. Expected end of expression.",
                tok.pos
            ),
        });
    }
    Ok(node)
}

struct Parser<'a> {
    tokens: &'a [Token],
    pos: usize,
    src_len: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<&'a TokenKind> {
        self.tokens.get(self.pos).map(|t| &t.kind)
    }

    fn peek_pos(&self) -> usize {
        self.tokens
            .get(self.pos)
            .map(|t| t.pos)
            .unwrap_or(self.src_len)
    }

    fn advance(&mut self) -> &'a Token {
        let t = &self.tokens[self.pos];
        self.pos += 1;
        t
    }

    fn parse_expression(&mut self) -> Result<AstNode, AnalysisError> {
        let mut left = self.parse_term()?;
        loop {
            let op = match self.peek() {
                Some(TokenKind::Plus) => BinaryOp::Add,
                Some(TokenKind::Minus) => BinaryOp::Sub,
                _ => break,
            };
            self.advance();
            let right = self.parse_term()?;
            left = AstNode::BinaryOp(BinaryOpNode {
                op,
                left: Box::new(left),
                right: Box::new(right),
            });
        }
        Ok(left)
    }

    fn parse_term(&mut self) -> Result<AstNode, AnalysisError> {
        let mut left = self.parse_factor()?;
        loop {
            let op = match self.peek() {
                Some(TokenKind::Star) => BinaryOp::Mul,
                Some(TokenKind::Slash) => BinaryOp::Div,
                _ => break,
            };
            self.advance();
            let right = self.parse_factor()?;
            left = AstNode::BinaryOp(BinaryOpNode {
                op,
                left: Box::new(left),
                right: Box::new(right),
            });
        }
        Ok(left)
    }

    fn parse_factor(&mut self) -> Result<AstNode, AnalysisError> {
        match self.peek() {
            Some(TokenKind::LParen) => {
                self.advance();
                let expr = self.parse_expression()?;
                match self.peek() {
                    Some(TokenKind::RParen) => {
                        self.advance();
                        Ok(expr)
                    }
                    _ => Err(AnalysisError::ParseError {
                        position: self.peek_pos(),
                        message: format!("Expected ')' at position {}", self.peek_pos()),
                    }),
                }
            }
            Some(TokenKind::String(_)) => {
                if let TokenKind::String(s) = &self.advance().kind {
                    Ok(AstNode::String(s.clone()))
                } else {
                    unreachable!()
                }
            }
            Some(TokenKind::Number(_)) => {
                if let TokenKind::Number(n) = &self.advance().kind {
                    Ok(AstNode::Number(*n))
                } else {
                    unreachable!()
                }
            }
            Some(TokenKind::Minus) => {
                // Unary minus: TS only allows it when next char is digit or '.'.
                // At token level: only allow if next token is a Number.
                let pos = self.peek_pos();
                self.advance();
                match self.peek() {
                    Some(TokenKind::Number(n)) => {
                        let n = *n;
                        self.advance();
                        Ok(AstNode::Number(-n))
                    }
                    _ => Err(AnalysisError::ParseError {
                        position: pos,
                        message: format!("Unexpected character '-' at position {pos}"),
                    }),
                }
            }
            Some(TokenKind::Ident(_)) => self.parse_function_or_identifier(),
            _ => {
                let pos = self.peek_pos();
                Err(AnalysisError::ParseError {
                    position: pos,
                    message: format!("Unexpected character at position {pos}"),
                })
            }
        }
    }

    fn parse_function_or_identifier(&mut self) -> Result<AstNode, AnalysisError> {
        let (name, name_pos) = match self.peek() {
            Some(TokenKind::Ident(_)) => {
                let tok = self.advance();
                if let TokenKind::Ident(n) = &tok.kind {
                    (n.clone(), tok.pos)
                } else {
                    unreachable!()
                }
            }
            _ => unreachable!(),
        };

        // TS requires '(' after an identifier or it throws.
        if !matches!(self.peek(), Some(TokenKind::LParen)) {
            return Err(AnalysisError::ParseError {
                position: name_pos,
                message: format!("Unknown identifier '{name}' at position {name_pos}"),
            });
        }
        self.advance(); // (

        let mut args = Vec::new();
        if !matches!(self.peek(), Some(TokenKind::RParen)) {
            args.push(self.parse_argument()?);
            while matches!(self.peek(), Some(TokenKind::Comma)) {
                self.advance();
                args.push(self.parse_argument()?);
            }
        }
        match self.peek() {
            Some(TokenKind::RParen) => {
                self.advance();
            }
            _ => {
                let pos = self.peek_pos();
                return Err(AnalysisError::ParseError {
                    position: pos,
                    message: format!("Expected ')' at position {pos}"),
                });
            }
        }

        let mut node = AstNode::Function(FunctionNode { name, args });

        if matches!(self.peek(), Some(TokenKind::LBracket)) {
            self.advance();
            let index = self.parse_expression()?;
            match self.peek() {
                Some(TokenKind::RBracket) => {
                    self.advance();
                }
                _ => {
                    let pos = self.peek_pos();
                    return Err(AnalysisError::ParseError {
                        position: pos,
                        message: format!("Expected ']' at position {pos}"),
                    });
                }
            }
            node = AstNode::ArrayAccess(ArrayAccessNode {
                array: Box::new(node),
                index: Box::new(index),
            });
        }
        Ok(node)
    }

    fn parse_argument(&mut self) -> Result<AstNode, AnalysisError> {
        // TS treats strings specially at the argument level so they can be plain
        // string literals (e.g. CLOSE('AAPL', '1d')) rather than only appearing
        // inside expressions. Numbers and any other expression follow Expression.
        match self.peek() {
            Some(TokenKind::String(_)) => {
                if let TokenKind::String(s) = &self.advance().kind {
                    Ok(AstNode::String(s.clone()))
                } else {
                    unreachable!()
                }
            }
            _ => self.parse_expression(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(v: f64) -> AstNode {
        AstNode::Number(v)
    }

    fn binop(op: BinaryOp, l: AstNode, r: AstNode) -> AstNode {
        AstNode::BinaryOp(BinaryOpNode {
            op,
            left: Box::new(l),
            right: Box::new(r),
        })
    }

    #[test]
    fn single_number() {
        assert_eq!(parse("42").unwrap(), n(42.0));
    }

    #[test]
    fn addition_left_associative() {
        // 1 - 2 - 3 → ((1 - 2) - 3)
        let got = parse("1 - 2 - 3").unwrap();
        let expected = binop(
            BinaryOp::Sub,
            binop(BinaryOp::Sub, n(1.0), n(2.0)),
            n(3.0),
        );
        assert_eq!(got, expected);
    }

    #[test]
    fn precedence_mul_over_add() {
        // 2 + 3 * 4 → (2 + (3 * 4))
        let got = parse("2 + 3 * 4").unwrap();
        let expected = binop(BinaryOp::Add, n(2.0), binop(BinaryOp::Mul, n(3.0), n(4.0)));
        assert_eq!(got, expected);
    }

    #[test]
    fn precedence_div_over_sub() {
        // 10 - 6 / 2 → (10 - (6 / 2))
        let got = parse("10 - 6 / 2").unwrap();
        let expected = binop(BinaryOp::Sub, n(10.0), binop(BinaryOp::Div, n(6.0), n(2.0)));
        assert_eq!(got, expected);
    }

    #[test]
    fn parens_override_precedence() {
        let got = parse("(2 + 3) * 4").unwrap();
        let expected = binop(BinaryOp::Mul, binop(BinaryOp::Add, n(2.0), n(3.0)), n(4.0));
        assert_eq!(got, expected);
    }

    #[test]
    fn unary_minus_on_literal() {
        // -5 + 3 — leading minus is folded into the literal
        let got = parse("-5 + 3").unwrap();
        let expected = binop(BinaryOp::Add, n(-5.0), n(3.0));
        assert_eq!(got, expected);
    }

    #[test]
    fn unary_minus_only_before_digit() {
        // TS rejects `-(...)` because the next char isn't a digit/`.`.
        let err = parse("-(2 + 3)").unwrap_err();
        match err {
            AnalysisError::ParseError { .. } => {}
            _ => panic!("expected ParseError"),
        }
    }

    #[test]
    fn function_no_args() {
        // not actually valid for any of our 13 functions, but the parser allows it
        assert_eq!(
            parse("FOO()").unwrap(),
            AstNode::Function(FunctionNode {
                name: "FOO".to_string(),
                args: vec![]
            })
        );
    }

    #[test]
    fn function_with_string_and_number_args() {
        let got = parse("CLOSE('AAPL', '1d')").unwrap();
        assert_eq!(
            got,
            AstNode::Function(FunctionNode {
                name: "CLOSE".to_string(),
                args: vec![
                    AstNode::String("AAPL".to_string()),
                    AstNode::String("1d".to_string()),
                ]
            })
        );
    }

    #[test]
    fn nested_function_call() {
        let got = parse("SMA(CLOSE('AAPL', '1d'), 50)").unwrap();
        match got {
            AstNode::Function(FunctionNode { name, args }) => {
                assert_eq!(name, "SMA");
                assert_eq!(args.len(), 2);
                assert!(matches!(args[0], AstNode::Function(_)));
                assert_eq!(args[1], AstNode::Number(50.0));
            }
            _ => panic!("expected function"),
        }
    }

    #[test]
    fn array_access_postfix() {
        let got = parse("CLOSE('AAPL', '1d')[-1]").unwrap();
        match got {
            AstNode::ArrayAccess(ArrayAccessNode { array, index }) => {
                assert!(matches!(*array, AstNode::Function(_)));
                assert_eq!(*index, AstNode::Number(-1.0));
            }
            _ => panic!("expected array access"),
        }
    }

    #[test]
    fn missing_close_paren_errors() {
        let err = parse("SMA(CLOSE('AAPL', '1d'), 5").unwrap_err();
        match err {
            AnalysisError::ParseError { message, .. } => assert!(message.contains("Expected ')'")),
            _ => panic!("expected ParseError"),
        }
    }

    #[test]
    fn missing_close_bracket_errors() {
        let err = parse("CLOSE('AAPL', '1d')[0").unwrap_err();
        match err {
            AnalysisError::ParseError { message, .. } => assert!(message.contains("Expected ']'")),
            _ => panic!("expected ParseError"),
        }
    }

    #[test]
    fn unterminated_string_errors() {
        let err = parse("CLOSE('AAPL, 10)").unwrap_err();
        match err {
            AnalysisError::ParseError { message, .. } => {
                assert!(message.contains("Unterminated"))
            }
            _ => panic!("expected ParseError"),
        }
    }

    #[test]
    fn unknown_bare_identifier_errors() {
        // foo (no '(' after) is rejected by TS as well.
        let err = parse("foo + 1").unwrap_err();
        match err {
            AnalysisError::ParseError { message, .. } => {
                assert!(message.contains("Unknown identifier"))
            }
            _ => panic!("expected ParseError"),
        }
    }

    #[test]
    fn trailing_garbage_errors() {
        let err = parse("1 + 2 3").unwrap_err();
        match err {
            AnalysisError::ParseError { .. } => {}
            _ => panic!("expected ParseError"),
        }
    }

    #[test]
    fn nested_parens_preserve_value() {
        // ((1 + 2) * (3 + 4)) — confirms inner parens fold cleanly.
        let got = parse("((1 + 2) * (3 + 4))").unwrap();
        let expected = binop(
            BinaryOp::Mul,
            binop(BinaryOp::Add, n(1.0), n(2.0)),
            binop(BinaryOp::Add, n(3.0), n(4.0)),
        );
        assert_eq!(got, expected);
    }

    #[test]
    fn empty_input_errors() {
        // No tokens at all → ParseError when expression expects a Factor.
        assert!(parse("").is_err());
    }

    #[test]
    fn whitespace_only_errors() {
        assert!(parse("   ").is_err());
    }

    #[test]
    fn double_quoted_strings() {
        let got = parse("CLOSE(\"AAPL\", \"1d\")").unwrap();
        match got {
            AstNode::Function(FunctionNode { args, .. }) => {
                assert_eq!(args[0], AstNode::String("AAPL".to_string()));
                assert_eq!(args[1], AstNode::String("1d".to_string()));
            }
            _ => panic!("expected function"),
        }
    }

    #[test]
    fn array_access_with_expression_index() {
        // CLOSE('A','1d')[1+2] — the index can be any expression.
        let got = parse("CLOSE('A', '1d')[1 + 2]").unwrap();
        if let AstNode::ArrayAccess(ArrayAccessNode { index, .. }) = got {
            assert_eq!(
                *index,
                binop(BinaryOp::Add, AstNode::Number(1.0), AstNode::Number(2.0))
            );
        } else {
            panic!("expected array access");
        }
    }
}
