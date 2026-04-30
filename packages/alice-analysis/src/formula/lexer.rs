// Tokenizer for the OpenAlice formula language.
//
// Mirrors the inline lexing inside TS `IndicatorCalculator.parse()` (calculator.ts:79-234).
// Whitespace is dropped; comments are not part of the language. Strings support both
// single and double quotes with no escape sequences (matching TS).
//
// Unary minus is *not* resolved at lex time — `-` is always emitted as Minus and the
// parser disambiguates inside `parseFactor` (matches TS behaviour at calculator.ts:126-133).

use crate::error::AnalysisError;

#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    Number(f64),
    String(String),
    Ident(String),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
    LBracket,
    RBracket,
    Comma,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    /// Byte offset in the original (UTF-8) source where this token starts.
    pub pos: usize,
}

pub fn tokenize(src: &str) -> Result<Vec<Token>, AnalysisError> {
    let bytes = src.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        // Whitespace
        if is_ws(b) {
            i += 1;
            continue;
        }
        let start = i;
        match b {
            b'+' => {
                out.push(tok(TokenKind::Plus, start));
                i += 1;
            }
            b'-' => {
                out.push(tok(TokenKind::Minus, start));
                i += 1;
            }
            b'*' => {
                out.push(tok(TokenKind::Star, start));
                i += 1;
            }
            b'/' => {
                out.push(tok(TokenKind::Slash, start));
                i += 1;
            }
            b'(' => {
                out.push(tok(TokenKind::LParen, start));
                i += 1;
            }
            b')' => {
                out.push(tok(TokenKind::RParen, start));
                i += 1;
            }
            b'[' => {
                out.push(tok(TokenKind::LBracket, start));
                i += 1;
            }
            b']' => {
                out.push(tok(TokenKind::RBracket, start));
                i += 1;
            }
            b',' => {
                out.push(tok(TokenKind::Comma, start));
                i += 1;
            }
            b'\'' | b'"' => {
                let quote = b;
                i += 1;
                let str_start = i;
                while i < bytes.len() && bytes[i] != quote {
                    i += 1;
                }
                if i >= bytes.len() {
                    return Err(AnalysisError::ParseError {
                        position: i,
                        message: format!("Unterminated string at position {i}"),
                    });
                }
                let s = std::str::from_utf8(&bytes[str_start..i])
                    .map_err(|e| AnalysisError::ParseError {
                        position: str_start,
                        message: format!("Invalid UTF-8 in string: {e}"),
                    })?
                    .to_string();
                i += 1; // consume closing quote
                out.push(tok(TokenKind::String(s), start));
            }
            _ if is_digit(b) || b == b'.' => {
                let num_start = i;
                while i < bytes.len() && (is_digit(bytes[i]) || bytes[i] == b'.') {
                    i += 1;
                }
                let lit = std::str::from_utf8(&bytes[num_start..i]).unwrap();
                let value: f64 = lit.parse().map_err(|_| AnalysisError::ParseError {
                    position: num_start,
                    message: format!("Invalid number literal '{lit}' at position {num_start}"),
                })?;
                out.push(tok(TokenKind::Number(value), start));
            }
            _ if is_alpha(b) => {
                let id_start = i;
                while i < bytes.len() && (is_alpha(bytes[i]) || is_digit(bytes[i])) {
                    i += 1;
                }
                let name = std::str::from_utf8(&bytes[id_start..i]).unwrap().to_string();
                out.push(tok(TokenKind::Ident(name), start));
            }
            _ => {
                let ch = src[start..].chars().next().unwrap_or('?');
                return Err(AnalysisError::ParseError {
                    position: start,
                    message: format!("Unexpected character '{ch}' at position {start}"),
                });
            }
        }
    }
    Ok(out)
}

fn tok(kind: TokenKind, pos: usize) -> Token {
    Token { kind, pos }
}

fn is_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c)
}

fn is_digit(b: u8) -> bool {
    b.is_ascii_digit()
}

fn is_alpha(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &str) -> Vec<TokenKind> {
        tokenize(src).unwrap().into_iter().map(|t| t.kind).collect()
    }

    #[test]
    fn empty_input() {
        assert!(tokenize("").unwrap().is_empty());
    }

    #[test]
    fn whitespace_only() {
        assert!(tokenize("   \t\n  ").unwrap().is_empty());
    }

    #[test]
    fn simple_arithmetic_tokens() {
        assert_eq!(
            kinds("2 + 3"),
            vec![TokenKind::Number(2.0), TokenKind::Plus, TokenKind::Number(3.0)]
        );
    }

    #[test]
    fn all_operators() {
        assert_eq!(
            kinds("+ - * / ( ) [ ] ,"),
            vec![
                TokenKind::Plus,
                TokenKind::Minus,
                TokenKind::Star,
                TokenKind::Slash,
                TokenKind::LParen,
                TokenKind::RParen,
                TokenKind::LBracket,
                TokenKind::RBracket,
                TokenKind::Comma,
            ]
        );
    }

    #[test]
    fn ident_and_numbers() {
        assert_eq!(
            kinds("SMA(close, 50)"),
            vec![
                TokenKind::Ident("SMA".to_string()),
                TokenKind::LParen,
                TokenKind::Ident("close".to_string()),
                TokenKind::Comma,
                TokenKind::Number(50.0),
                TokenKind::RParen,
            ]
        );
    }

    #[test]
    fn double_and_single_quoted_strings() {
        assert_eq!(
            kinds("'AAPL' \"BTC\""),
            vec![
                TokenKind::String("AAPL".to_string()),
                TokenKind::String("BTC".to_string())
            ]
        );
    }

    #[test]
    fn empty_string_literal() {
        assert_eq!(kinds("''"), vec![TokenKind::String(String::new())]);
    }

    #[test]
    fn decimal_literal() {
        assert_eq!(kinds("2.75"), vec![TokenKind::Number(2.75)]);
    }

    #[test]
    fn leading_dot_literal() {
        // TS uses `parseFloat` which accepts ".5" → 0.5.
        assert_eq!(kinds(".5"), vec![TokenKind::Number(0.5)]);
    }

    #[test]
    fn unary_minus_emitted_as_op_token() {
        // Lexer never folds `-` into a number; parser handles unary minus.
        assert_eq!(
            kinds("-1"),
            vec![TokenKind::Minus, TokenKind::Number(1.0)]
        );
    }

    #[test]
    fn unterminated_string_errors() {
        let err = tokenize("'AAPL").unwrap_err();
        match err {
            AnalysisError::ParseError { message, .. } => {
                assert!(message.contains("Unterminated"))
            }
            _ => panic!("expected ParseError"),
        }
    }

    #[test]
    fn invalid_character_errors() {
        let err = tokenize("1 @ 2").unwrap_err();
        match err {
            AnalysisError::ParseError { position, message } => {
                assert_eq!(position, 2);
                assert!(message.contains("@"));
            }
            _ => panic!("expected ParseError"),
        }
    }

    #[test]
    fn position_is_byte_offset() {
        let tokens = tokenize("  +").unwrap();
        assert_eq!(tokens[0].pos, 2);
    }

    #[test]
    fn malformed_double_dot_number_is_caught() {
        // "1.2.3" greedily lexes as one token then fails to parse as f64.
        let err = tokenize("1.2.3").unwrap_err();
        match err {
            AnalysisError::ParseError { message, .. } => {
                assert!(message.contains("Invalid number"))
            }
            _ => panic!("expected ParseError"),
        }
    }

    #[test]
    fn newlines_and_tabs_are_whitespace() {
        assert_eq!(
            kinds("1\n+\t2"),
            vec![TokenKind::Number(1.0), TokenKind::Plus, TokenKind::Number(2.0)]
        );
    }

    #[test]
    fn identifier_with_underscore_and_digits() {
        assert_eq!(
            kinds("foo_bar2"),
            vec![TokenKind::Ident("foo_bar2".to_string())]
        );
    }
}
