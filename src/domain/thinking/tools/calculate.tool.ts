/**
 * Safe mathematical expression evaluation using a recursive-descent parser.
 *
 * Supports: +, -, *, /, parentheses, decimal numbers, unary minus.
 * No eval(), no dynamic code execution.
 */

// ==================== Tokeniser ====================

type Token =
  | { type: 'number'; value: number }
  | { type: 'op'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }

function tokenise(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]!
    if (ch === ' ' || ch === '\t') { i++; continue }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i++; continue }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i++; continue }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch }); i++; continue
    }
    if (ch >= '0' && ch <= '9' || ch === '.') {
      let num = ''
      while (i < expr.length && ((expr[i]! >= '0' && expr[i]! <= '9') || expr[i] === '.')) {
        num += expr[i]!
        i++
      }
      const parsed = Number(num)
      if (!isFinite(parsed)) throw new Error('Invalid number: ' + num)
      tokens.push({ type: 'number', value: parsed })
      continue
    }
    throw new Error('Invalid expression: only numbers and basic operators allowed')
  }
  return tokens
}

// ==================== Parser ====================
// Grammar:
//   expr   → term (('+' | '-') term)*
//   term   → unary (('*' | '/') unary)*
//   unary  → ('-')* primary
//   primary → NUMBER | '(' expr ')'

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  parse(): number {
    const result = this.expr()
    if (this.pos < this.tokens.length) {
      throw new Error('Unexpected token after expression')
    }
    return result
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private consume(): Token {
    const tok = this.tokens[this.pos]
    if (!tok) throw new Error('Unexpected end of expression')
    this.pos++
    return tok
  }

  private expr(): number {
    let left = this.term()
    while (this.peek()?.type === 'op' && (this.peek() as { value: string }).value === '+' || this.peek()?.type === 'op' && (this.peek() as { value: string }).value === '-') {
      const op = (this.consume() as { value: string }).value
      const right = this.term()
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  private term(): number {
    let left = this.unary()
    while (this.peek()?.type === 'op' && ((this.peek() as { value: string }).value === '*' || (this.peek() as { value: string }).value === '/')) {
      const op = (this.consume() as { value: string }).value
      const right = this.unary()
      left = op === '*' ? left * right : left / right
    }
    return left
  }

  private unary(): number {
    if (this.peek()?.type === 'op' && (this.peek() as { value: string }).value === '-') {
      this.consume()
      return -this.unary()
    }
    return this.primary()
  }

  private primary(): number {
    const tok = this.peek()
    if (!tok) throw new Error('Unexpected end of expression')

    if (tok.type === 'number') {
      this.consume()
      return tok.value
    }

    if (tok.type === 'lparen') {
      this.consume()
      const value = this.expr()
      const close = this.peek()
      if (!close || close.type !== 'rparen') {
        throw new Error('Missing closing parenthesis')
      }
      this.consume()
      return value
    }

    throw new Error('Invalid expression: only numbers and basic operators allowed')
  }
}

// ==================== Public API ====================

export function calculate(expression: string): number {
  try {
    const tokens = tokenise(expression)
    if (tokens.length === 0) throw new Error('Empty expression')
    const result = new Parser(tokens).parse()
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Invalid calculation result')
    }
    // Precision control: round to 4 decimal places
    return Math.round(result * 10000) / 10000
  } catch (error) {
    throw new Error(
      `Calculation error: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
