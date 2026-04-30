// Safe arithmetic evaluator — port of src/domain/thinking/tools/calculate.tool.ts.
//
// Pure arithmetic: `+ - * / ( )`, decimals, whitespace. No identifiers, no strings,
// no function calls, no brackets, no commas. Anything outside the TS whitelist
// `^[\d+\-*/().\s]+$` is rejected up-front with the same error message TS produces.
//
// Quirks preserved:
//   * 4-decimal precision applied **once** at the very end (not per-step). TS does
//     `Math.round(result * 10000) / 10000` after the full eval — we mirror it.
//   * Division by zero → produces `f64::INFINITY`/`NaN`, caught by the non-finite
//     check and mapped to "Invalid calculation result" — matches TS path through
//     `eval('1/0') === Infinity` then `isFinite` false.
//   * Non-finite (NaN, ±Inf) result → "Invalid calculation result" (matches TS).
//   * Errors are wrapped as "Calculation error: <inner>" to match TS try/catch.
//
// Whitelist rejection error: "Invalid expression: only numbers and basic operators allowed".
//
// Implementation: tiny recursive-descent parser-evaluator over a char cursor; no
// AST allocation. Direct f64 arithmetic.

use crate::error::AnalysisError;

/// Hardcoded 4-decimal precision (TS line 21: `Math.round(result * 10000) / 10000`).
const PRECISION_SCALE: f64 = 10_000.0;

const WHITELIST_ERROR: &str =
    "Invalid expression: only numbers and basic operators allowed";
const NON_FINITE_ERROR: &str = "Invalid calculation result";

pub fn safe_calculate(expression: &str) -> Result<f64, AnalysisError> {
    // Step 1 — TS-equivalent whitelist regex.
    if !is_whitelisted(expression) {
        return Err(wrap_calc_err(WHITELIST_ERROR));
    }

    // Step 2 — parse + evaluate as a single pass.
    let raw = match Calc::new(expression).expr_or_empty() {
        Ok(v) => v,
        Err(msg) => return Err(wrap_calc_err(&msg)),
    };

    // Step 3 — non-finite check (TS: `!isFinite(result)`).
    if !raw.is_finite() {
        return Err(wrap_calc_err(NON_FINITE_ERROR));
    }

    // Step 4 — apply precision *once* at the end, never per-step.
    Ok((raw * PRECISION_SCALE).round() / PRECISION_SCALE)
}

fn is_whitelisted(s: &str) -> bool {
    if s.is_empty() {
        // TS regex `^[...]+$` requires at least one char. Empty is rejected.
        return false;
    }
    s.bytes().all(|b| {
        matches!(
            b,
            b'0'..=b'9'
                | b'+'
                | b'-'
                | b'*'
                | b'/'
                | b'('
                | b')'
                | b'.'
                | b' '
                | b'\t'
                | b'\n'
                | b'\r'
                | 0x0b
                | 0x0c
        )
    })
}

fn wrap_calc_err(inner: &str) -> AnalysisError {
    AnalysisError::EvalError(format!("Calculation error: {inner}"))
}

struct Calc<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Calc<'a> {
    fn new(s: &'a str) -> Self {
        Self {
            bytes: s.as_bytes(),
            pos: 0,
        }
    }

    fn expr_or_empty(&mut self) -> Result<f64, String> {
        self.skip_ws();
        if self.pos >= self.bytes.len() {
            // TS `eval('')` returns `undefined`; the typeof-number check then fails
            // with the same "Invalid calculation result" message.
            return Err(NON_FINITE_ERROR.to_string());
        }
        let v = self.expr()?;
        self.skip_ws();
        if self.pos < self.bytes.len() {
            // Trailing junk that passes the whitelist (e.g. `1 2`) — TS `eval` would
            // throw a SyntaxError. We surface the same shape: a generic "Calculation
            // error" via WHITELIST_ERROR-style propagation. Use a clear inner message.
            return Err(format!("Unexpected character at position {}", self.pos));
        }
        Ok(v)
    }

    fn expr(&mut self) -> Result<f64, String> {
        let mut left = self.term()?;
        loop {
            self.skip_ws();
            match self.peek() {
                Some(b'+') => {
                    self.pos += 1;
                    let right = self.term()?;
                    left += right;
                }
                Some(b'-') => {
                    self.pos += 1;
                    let right = self.term()?;
                    left -= right;
                }
                _ => break,
            }
        }
        Ok(left)
    }

    fn term(&mut self) -> Result<f64, String> {
        let mut left = self.factor()?;
        loop {
            self.skip_ws();
            match self.peek() {
                Some(b'*') => {
                    self.pos += 1;
                    let right = self.factor()?;
                    left *= right;
                }
                Some(b'/') => {
                    self.pos += 1;
                    let right = self.factor()?;
                    // TS `eval` does not pre-check; `1/0` yields Infinity and the
                    // outer non-finite check catches it. Match that.
                    left /= right;
                }
                _ => break,
            }
        }
        Ok(left)
    }

    fn factor(&mut self) -> Result<f64, String> {
        self.skip_ws();
        match self.peek() {
            Some(b'(') => {
                self.pos += 1;
                let v = self.expr()?;
                self.skip_ws();
                if self.peek() != Some(b')') {
                    return Err(format!("Expected ')' at position {}", self.pos));
                }
                self.pos += 1;
                Ok(v)
            }
            // TS allows arbitrary unary `-` / `+` (it's just JS eval). Mirror that.
            Some(b'-') => {
                self.pos += 1;
                Ok(-self.factor()?)
            }
            Some(b'+') => {
                self.pos += 1;
                self.factor()
            }
            Some(b) if b.is_ascii_digit() || b == b'.' => self.number(),
            _ => Err(format!("Unexpected character at position {}", self.pos)),
        }
    }

    fn number(&mut self) -> Result<f64, String> {
        let start = self.pos;
        while self.pos < self.bytes.len()
            && (self.bytes[self.pos].is_ascii_digit() || self.bytes[self.pos] == b'.')
        {
            self.pos += 1;
        }
        let s = std::str::from_utf8(&self.bytes[start..self.pos]).unwrap();
        s.parse::<f64>()
            .map_err(|_| format!("Invalid number literal '{s}' at position {start}"))
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_ws(&mut self) {
        while self.pos < self.bytes.len() {
            match self.bytes[self.pos] {
                b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c => self.pos += 1,
                _ => break,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn calc(s: &str) -> f64 {
        safe_calculate(s).unwrap()
    }

    fn err_msg(s: &str) -> String {
        match safe_calculate(s).unwrap_err() {
            AnalysisError::EvalError(m) => m,
            other => panic!("expected EvalError, got {other:?}"),
        }
    }

    // ---------- basic arithmetic ----------

    #[test]
    fn addition() {
        assert_eq!(calc("1 + 2"), 3.0);
    }

    #[test]
    fn subtraction() {
        assert_eq!(calc("10 - 3"), 7.0);
    }

    #[test]
    fn multiplication() {
        assert_eq!(calc("4 * 5"), 20.0);
    }

    #[test]
    fn division() {
        assert_eq!(calc("15 / 3"), 5.0);
    }

    // ---------- parentheses ----------

    #[test]
    fn parens_basic() {
        assert_eq!(calc("(1 + 2) * 3"), 9.0);
        assert_eq!(calc("10 / (2 + 3)"), 2.0);
    }

    #[test]
    fn deeply_nested_parens() {
        assert_eq!(calc("((1 + 2) * (3 + 4))"), 21.0);
    }

    #[test]
    fn missing_close_paren() {
        let m = err_msg("(1 + 2");
        assert!(m.contains("Calculation error"));
    }

    // ---------- precision ----------

    #[test]
    fn round_to_4_decimals() {
        assert_eq!(calc("10 / 3"), 3.3333);
        assert_eq!(calc("1 / 7"), 0.1429);
    }

    #[test]
    fn decimals_in_input() {
        assert_eq!(calc("0.1 + 0.2"), 0.3);
        assert_eq!(calc("1.5 * 2"), 3.0);
    }

    /// "Precision applied once at end, not per-step" demonstration.
    ///
    /// `1/3 + 1/3 + 1/3` evaluated end-to-end equals exactly 1.0 (after the final
    /// 4-decimal round of 0.9999999999... → 1.0). If we rounded per-step we'd get
    /// `0.3333 + 0.3333 + 0.3333 = 0.9999` instead. This test pins the once-at-end
    /// behaviour mandated by the survey.
    #[test]
    fn precision_applied_once_not_per_step() {
        // 1/3 + 1/3 + 1/3 → end-to-end 0.9999999...; round_to_4 → 1.0
        assert_eq!(calc("1/3 + 1/3 + 1/3"), 1.0);
        // Sanity: per-step rounding would give 0.9999 — confirm we did NOT do that.
        assert_ne!(calc("1/3 + 1/3 + 1/3"), 0.9999);
    }

    // ---------- security / whitelist ----------

    #[test]
    fn rejects_function_calls() {
        let m = err_msg("alert(1)");
        assert!(m.contains("Invalid expression"));
    }

    #[test]
    fn rejects_console_log() {
        let m = err_msg("console.log(1)");
        assert!(m.contains("Invalid expression"));
    }

    #[test]
    fn rejects_variables() {
        let m = err_msg("x + 1");
        assert!(m.contains("Invalid expression"));
        let m2 = err_msg("Math.PI");
        assert!(m2.contains("Invalid expression"));
    }

    #[test]
    fn rejects_semicolons_and_logical_ops() {
        let m = err_msg("1; 2");
        assert!(m.contains("Invalid expression"));
        let m2 = err_msg("1 && 2");
        assert!(m2.contains("Invalid expression"));
    }

    #[test]
    fn rejects_brackets() {
        // [], comma — all outside whitelist.
        let m = err_msg("[1,2]");
        assert!(m.contains("Invalid expression"));
    }

    #[test]
    fn rejects_unicode_or_other() {
        let m = err_msg("1 + ❤");
        assert!(m.contains("Invalid expression"));
    }

    // ---------- edge cases ----------

    #[test]
    fn whitespace_around_operators() {
        assert_eq!(calc("  1  +  2  "), 3.0);
    }

    #[test]
    fn negative_results() {
        assert_eq!(calc("1 - 5"), -4.0);
    }

    #[test]
    fn zero_arithmetic() {
        assert_eq!(calc("0 + 0"), 0.0);
        assert_eq!(calc("5 * 0"), 0.0);
    }

    #[test]
    fn empty_input_errors() {
        let m = err_msg("");
        assert!(m.contains("Invalid expression"));
    }

    #[test]
    fn whitespace_only_errors() {
        let m = err_msg("   ");
        assert!(m.contains("Invalid calculation result"));
    }

    // ---------- div-by-zero / overflow / non-finite ----------

    #[test]
    fn division_by_zero_yields_invalid_result() {
        // TS path: 1/0 → Infinity → !isFinite → "Invalid calculation result".
        let m = err_msg("1 / 0");
        assert!(
            m.contains("Invalid calculation result"),
            "got: {m}"
        );
    }

    #[test]
    fn zero_division_zero_is_nan_invalid() {
        // 0/0 → NaN → caught by non-finite.
        let m = err_msg("0 / 0");
        assert!(m.contains("Invalid calculation result"));
    }

    #[test]
    fn overflow_to_infinity_invalid() {
        // 1e308 * 10 overflows to Infinity. We can only express via long literals
        // since the whitelist forbids 'e'. Use repeated multiplication.
        // 1e154 * 1e154 = 1e308; * 1e308 = overflow. Approximate with mul chain.
        let big = "9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999";
        let expr = format!("{big} * {big}");
        let m = err_msg(&expr);
        assert!(m.contains("Invalid calculation result"));
    }

    #[test]
    fn unary_minus_supported() {
        assert_eq!(calc("-1 + -2"), -3.0);
    }

    #[test]
    fn unary_plus_supported() {
        assert_eq!(calc("+1 + +2"), 3.0);
    }
}
