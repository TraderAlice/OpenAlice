/**
 * Backtester DSL — Safe expression parser and evaluator
 *
 * Parses expressions like "RSI_14 < 30 && close > EMA_20" into an AST
 * and evaluates them against a context object. No eval() used.
 */

import type { IndicatorSpec } from './types.js'

// ==================== Token types ====================

type TokenType =
  | 'NUMBER' | 'IDENTIFIER' | 'LPAREN' | 'RPAREN'
  | 'LT' | 'GT' | 'LTE' | 'GTE' | 'EQ' | 'NEQ'
  | 'AND' | 'OR' | 'NOT'
  | 'PLUS' | 'MINUS' | 'MUL' | 'DIV'
  | 'EOF'

interface Token {
  type: TokenType
  value: string | number
}

// ==================== AST nodes ====================

export type ASTNode =
  | { type: 'literal'; value: number }
  | { type: 'identifier'; name: string }
  | { type: 'unary'; op: '!' | '-'; operand: ASTNode }
  | { type: 'binary'; op: string; left: ASTNode; right: ASTNode }

// ==================== Tokenizer ====================

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < expr.length) {
    if (expr[i] === ' ' || expr[i] === '\t') { i++; continue }

    if (expr[i] === '(' ) { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue }
    if (expr[i] === ')' ) { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue }
    if (expr[i] === '+' ) { tokens.push({ type: 'PLUS', value: '+' }); i++; continue }
    if (expr[i] === '-' ) { tokens.push({ type: 'MINUS', value: '-' }); i++; continue }
    if (expr[i] === '*' ) { tokens.push({ type: 'MUL', value: '*' }); i++; continue }
    if (expr[i] === '/' ) { tokens.push({ type: 'DIV', value: '/' }); i++; continue }

    if (expr[i] === '&' && expr[i + 1] === '&') { tokens.push({ type: 'AND', value: '&&' }); i += 2; continue }
    if (expr[i] === '|' && expr[i + 1] === '|') { tokens.push({ type: 'OR', value: '||' }); i += 2; continue }
    if (expr[i] === '!' && expr[i + 1] === '=') { tokens.push({ type: 'NEQ', value: '!=' }); i += 2; continue }
    if (expr[i] === '!' ) { tokens.push({ type: 'NOT', value: '!' }); i++; continue }
    if (expr[i] === '=' && expr[i + 1] === '=') { tokens.push({ type: 'EQ', value: '==' }); i += 2; continue }
    if (expr[i] === '<' && expr[i + 1] === '=') { tokens.push({ type: 'LTE', value: '<=' }); i += 2; continue }
    if (expr[i] === '>' && expr[i + 1] === '=') { tokens.push({ type: 'GTE', value: '>=' }); i += 2; continue }
    if (expr[i] === '<' ) { tokens.push({ type: 'LT', value: '<' }); i++; continue }
    if (expr[i] === '>' ) { tokens.push({ type: 'GT', value: '>' }); i++; continue }

    // Number literal
    if (/[0-9.]/.test(expr[i])) {
      let num = ''
      while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i]; i++ }
      const parsed = parseFloat(num)
      if (isNaN(parsed)) throw new Error(`Invalid number: ${num}`)
      tokens.push({ type: 'NUMBER', value: parsed })
      continue
    }

    // Identifier (letters, digits, underscores)
    if (/[a-zA-Z_]/.test(expr[i])) {
      let ident = ''
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) { ident += expr[i]; i++ }
      tokens.push({ type: 'IDENTIFIER', value: ident })
      continue
    }

    throw new Error(`Unexpected character '${expr[i]}' at position ${i}`)
  }

  tokens.push({ type: 'EOF', value: '' })
  return tokens
}

// ==================== Parser (recursive descent) ====================

class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) { this.tokens = tokens }

  private peek(): Token { return this.tokens[this.pos] }

  private advance(): Token { return this.tokens[this.pos++] }

  private expect(type: TokenType): Token {
    const tok = this.advance()
    if (tok.type !== type) throw new Error(`Expected ${type}, got ${tok.type} (${tok.value})`)
    return tok
  }

  parse(): ASTNode {
    const node = this.parseOr()
    if (this.peek().type !== 'EOF') {
      throw new Error(`Unexpected token: ${this.peek().value}`)
    }
    return node
  }

  private parseOr(): ASTNode {
    let left = this.parseAnd()
    while (this.peek().type === 'OR') {
      this.advance()
      const right = this.parseAnd()
      left = { type: 'binary', op: '||', left, right }
    }
    return left
  }

  private parseAnd(): ASTNode {
    let left = this.parseComparison()
    while (this.peek().type === 'AND') {
      this.advance()
      const right = this.parseComparison()
      left = { type: 'binary', op: '&&', left, right }
    }
    return left
  }

  private parseComparison(): ASTNode {
    let left = this.parseAddSub()
    const compOps: TokenType[] = ['LT', 'GT', 'LTE', 'GTE', 'EQ', 'NEQ']
    while (compOps.includes(this.peek().type)) {
      const op = this.advance().value as string
      const right = this.parseAddSub()
      left = { type: 'binary', op, left, right }
    }
    return left
  }

  private parseAddSub(): ASTNode {
    let left = this.parseMulDiv()
    while (this.peek().type === 'PLUS' || this.peek().type === 'MINUS') {
      const op = this.advance().value as string
      const right = this.parseMulDiv()
      left = { type: 'binary', op, left, right }
    }
    return left
  }

  private parseMulDiv(): ASTNode {
    let left = this.parseUnary()
    while (this.peek().type === 'MUL' || this.peek().type === 'DIV') {
      const op = this.advance().value as string
      const right = this.parseUnary()
      left = { type: 'binary', op, left, right }
    }
    return left
  }

  private parseUnary(): ASTNode {
    if (this.peek().type === 'NOT') {
      this.advance()
      return { type: 'unary', op: '!', operand: this.parseUnary() }
    }
    if (this.peek().type === 'MINUS') {
      this.advance()
      return { type: 'unary', op: '-', operand: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): ASTNode {
    const tok = this.peek()

    if (tok.type === 'NUMBER') {
      this.advance()
      return { type: 'literal', value: tok.value as number }
    }

    if (tok.type === 'IDENTIFIER') {
      this.advance()
      return { type: 'identifier', name: tok.value as string }
    }

    if (tok.type === 'LPAREN') {
      this.advance()
      const node = this.parseOr()
      this.expect('RPAREN')
      return node
    }

    throw new Error(`Unexpected token: ${tok.type} (${tok.value})`)
  }
}

// ==================== Evaluator ====================

export function evaluate(ast: ASTNode, context: Record<string, number | boolean>): number | boolean {
  switch (ast.type) {
    case 'literal':
      return ast.value

    case 'identifier': {
      const val = context[ast.name]
      if (val === undefined || (typeof val === 'number' && isNaN(val))) return NaN
      return val
    }

    case 'unary': {
      const operand = evaluate(ast.operand, context)
      if (ast.op === '!') return !operand
      if (ast.op === '-') return -(operand as number)
      return NaN
    }

    case 'binary': {
      const left = evaluate(ast.left, context)
      const right = evaluate(ast.right, context)

      // Any NaN in comparison/arithmetic → false
      if (typeof left === 'number' && isNaN(left)) return false
      if (typeof right === 'number' && isNaN(right)) return false

      switch (ast.op) {
        case '&&': return Boolean(left) && Boolean(right)
        case '||': return Boolean(left) || Boolean(right)
        case '<':  return (left as number) < (right as number)
        case '>':  return (left as number) > (right as number)
        case '<=': return (left as number) <= (right as number)
        case '>=': return (left as number) >= (right as number)
        case '==': return left === right
        case '!=': return left !== right
        case '+':  return (left as number) + (right as number)
        case '-':  return (left as number) - (right as number)
        case '*':  return (left as number) * (right as number)
        case '/':  return (right as number) === 0 ? NaN : (left as number) / (right as number)
        default:   return NaN
      }
    }
  }
}

// ==================== Public API ====================

export function parseExpression(expr: string): ASTNode {
  const tokens = tokenize(expr)
  const parser = new Parser(tokens)
  return parser.parse()
}

export function evaluateExpression(expr: string, context: Record<string, number | boolean>): boolean {
  const ast = parseExpression(expr)
  const result = evaluate(ast, context)
  if (typeof result === 'number' && isNaN(result)) return false
  return Boolean(result)
}

// ==================== Indicator variable extraction ====================

const KNOWN_INDICATORS = ['RSI', 'EMA', 'SMA', 'BBANDS', 'MACD', 'ATR']
const BBANDS_COMPONENTS = ['upper', 'lower', 'middle']
const MACD_COMPONENTS = ['value', 'signal', 'histogram']

export function parseIndicatorName(name: string): IndicatorSpec | null {
  const upper = name.toUpperCase()

  for (const ind of KNOWN_INDICATORS) {
    if (!upper.startsWith(ind + '_')) continue

    const suffix = name.slice(ind.length + 1)

    if (ind === 'BBANDS' && BBANDS_COMPONENTS.includes(suffix)) {
      return { type: 'BBANDS', component: suffix }
    }
    if (ind === 'MACD' && MACD_COMPONENTS.includes(suffix)) {
      return { type: 'MACD', component: suffix }
    }

    const period = parseInt(suffix)
    if (!isNaN(period) && period > 0) {
      return { type: ind as IndicatorSpec['type'], period }
    }
  }

  return null
}

/** Extract all indicator variable names from entry_logic and exit_logic expressions. */
export function extractIndicatorNames(expressions: string[]): string[] {
  const names = new Set<string>()
  for (const expr of expressions) {
    const tokens = tokenize(expr)
    for (const tok of tokens) {
      if (tok.type === 'IDENTIFIER' && typeof tok.value === 'string') {
        if (parseIndicatorName(tok.value)) names.add(tok.value)
      }
    }
  }
  return [...names]
}
