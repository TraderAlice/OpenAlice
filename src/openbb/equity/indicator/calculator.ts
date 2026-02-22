/**
 * Equity Indicator Calculator — AST 表达式解析与求值
 *
 * 从 archive-analysis 改编，适配 OpenBB equity 数据层。
 * 去掉了 currentTime/playhead 概念，数据按需从 OpenBB API 拉取。
 *
 * 支持类 Excel 公式语法：
 * - SMA(CLOSE('AAPL', 252), 50)
 * - RSI(CLOSE('TSLA', 50), 14)
 * - (CLOSE('AAPL', 1)[0] - SMA(CLOSE('AAPL', 252), 50)) / SMA(CLOSE('AAPL', 252), 50) * 100
 */

import type {
  ASTNode,
  CalculationResult,
  EquityIndicatorContext,
  FunctionNode,
  BinaryOpNode,
  ArrayAccessNode,
} from './types'
import * as DataAccess from './functions/data-access'
import * as Statistics from './functions/statistics'
import * as Technical from './functions/technical'

export class EquityIndicatorCalculator {
  constructor(private context: EquityIndicatorContext) {}

  async calculate(
    formula: string,
    precision: number = 4,
  ): Promise<number | number[] | Record<string, number>> {
    const ast = this.parse(formula)
    const result = await this.evaluate(ast)

    if (typeof result === 'string') {
      throw new Error(`Invalid formula: result cannot be a string. Got: "${result}"`)
    }

    return this.applyPrecision(result, precision)
  }

  private applyPrecision(
    result: number | number[] | Record<string, number>,
    precision: number,
  ): number | number[] | Record<string, number> {
    if (typeof result === 'number') {
      return parseFloat(result.toFixed(precision))
    }
    if (Array.isArray(result)) {
      return result.map((v) => parseFloat(v.toFixed(precision)))
    }
    const rounded: Record<string, number> = {}
    for (const [key, value] of Object.entries(result)) {
      rounded[key] = parseFloat(value.toFixed(precision))
    }
    return rounded
  }

  // ==================== Parser ====================

  private parse(formula: string): ASTNode {
    let pos = 0

    const parseExpression = (): ASTNode => {
      let left = parseTerm()
      skipWhitespace()
      while (pos < formula.length && (peek() === '+' || peek() === '-')) {
        const operator = consume() as '+' | '-'
        skipWhitespace()
        const right = parseTerm()
        skipWhitespace()
        left = { type: 'binaryOp', operator, left, right } as BinaryOpNode
      }
      return left
    }

    const parseTerm = (): ASTNode => {
      let left = parseFactor()
      skipWhitespace()
      while (pos < formula.length && (peek() === '*' || peek() === '/')) {
        const operator = consume() as '*' | '/'
        skipWhitespace()
        const right = parseFactor()
        skipWhitespace()
        left = { type: 'binaryOp', operator, left, right } as BinaryOpNode
      }
      return left
    }

    const parseFactor = (): ASTNode => {
      skipWhitespace()

      if (peek() === '(') {
        consume()
        const expr = parseExpression()
        skipWhitespace()
        if (peek() !== ')') throw new Error(`Expected ')' at position ${pos}`)
        consume()
        return expr
      }

      if (peek() === "'" || peek() === '"') return parseString()

      if (isDigit(peek())) return parseNumber()

      if (peek() === '-') {
        const nextPos = pos + 1
        if (nextPos < formula.length) {
          const nextChar = formula[nextPos]
          if (isDigit(nextChar) || nextChar === '.') return parseNumber()
        }
        throw new Error(`Unexpected character '${peek()}' at position ${pos}`)
      }

      if (isAlpha(peek())) return parseFunctionOrIdentifier()

      throw new Error(`Unexpected character '${peek()}' at position ${pos}`)
    }

    const parseFunctionOrIdentifier = (): ASTNode => {
      const name = parseIdentifier()
      skipWhitespace()

      if (peek() === '(') {
        consume()
        skipWhitespace()
        const args: ASTNode[] = []
        if (peek() !== ')') {
          args.push(parseArgument())
          skipWhitespace()
          while (peek() === ',') {
            consume()
            skipWhitespace()
            args.push(parseArgument())
            skipWhitespace()
          }
        }
        if (peek() !== ')') throw new Error(`Expected ')' at position ${pos}`)
        consume()

        const node: FunctionNode = { type: 'function', name, args }

        skipWhitespace()
        if (peek() === '[') return parseArrayAccess(node)
        return node
      }

      throw new Error(`Unknown identifier '${name}' at position ${pos}`)
    }

    const parseArgument = (): ASTNode => {
      skipWhitespace()
      if (peek() === "'" || peek() === '"') return parseString()
      return parseExpression()
    }

    const parseString = (): ASTNode => {
      const quote = consume()
      let value = ''
      while (pos < formula.length && peek() !== quote) {
        value += consume()
      }
      if (peek() !== quote) throw new Error(`Unterminated string at position ${pos}`)
      consume()
      return { type: 'string', value }
    }

    const parseNumber = (): ASTNode => {
      let numStr = ''
      if (peek() === '-') numStr += consume()
      while (pos < formula.length && (isDigit(peek()) || peek() === '.')) {
        numStr += consume()
      }
      return { type: 'number', value: parseFloat(numStr) }
    }

    const parseIdentifier = (): string => {
      let name = ''
      while (pos < formula.length && (isAlpha(peek()) || isDigit(peek()))) {
        name += consume()
      }
      return name
    }

    const parseArrayAccess = (array: ASTNode): ASTNode => {
      consume() // [
      skipWhitespace()
      const index = parseExpression()
      skipWhitespace()
      if (peek() !== ']') throw new Error(`Expected ']' at position ${pos}`)
      consume() // ]
      return { type: 'arrayAccess', array, index }
    }

    const peek = (): string => formula[pos] || ''
    const consume = (): string => formula[pos++] || ''
    const isDigit = (ch: string): boolean => /[0-9]/.test(ch)
    const isAlpha = (ch: string): boolean => /[a-zA-Z_]/.test(ch)
    const skipWhitespace = () => {
      while (pos < formula.length && /\s/.test(peek())) consume()
    }

    skipWhitespace()
    const result = parseExpression()
    skipWhitespace()

    if (pos < formula.length) {
      throw new Error(
        `Unexpected character '${peek()}' at position ${pos}. Expected end of expression.`,
      )
    }

    return result
  }

  // ==================== Evaluator ====================

  private async evaluate(node: ASTNode): Promise<CalculationResult> {
    switch (node.type) {
      case 'number':
        return node.value
      case 'string':
        return node.value
      case 'array':
        return node.value
      case 'function':
        return await this.executeFunction(node)
      case 'binaryOp':
        return await this.executeBinaryOp(node)
      case 'arrayAccess':
        return await this.executeArrayAccess(node)
      default:
        throw new Error(`Unknown node type: ${(node as { type: string }).type}`)
    }
  }

  private async executeFunction(node: FunctionNode): Promise<CalculationResult> {
    const { name, args } = node
    const evaluatedArgs = await Promise.all(args.map((arg) => this.evaluate(arg)))

    // Data access functions: FUNC('symbol', lookback, 'interval')
    if (name === 'CLOSE')
      return await DataAccess.CLOSE(evaluatedArgs[0] as string, evaluatedArgs[1] as number, evaluatedArgs[2] as string, this.context)
    if (name === 'HIGH')
      return await DataAccess.HIGH(evaluatedArgs[0] as string, evaluatedArgs[1] as number, evaluatedArgs[2] as string, this.context)
    if (name === 'LOW')
      return await DataAccess.LOW(evaluatedArgs[0] as string, evaluatedArgs[1] as number, evaluatedArgs[2] as string, this.context)
    if (name === 'OPEN')
      return await DataAccess.OPEN(evaluatedArgs[0] as string, evaluatedArgs[1] as number, evaluatedArgs[2] as string, this.context)
    if (name === 'VOLUME')
      return await DataAccess.VOLUME(evaluatedArgs[0] as string, evaluatedArgs[1] as number, evaluatedArgs[2] as string, this.context)

    // Statistics functions
    if (name === 'SMA') return Statistics.SMA(evaluatedArgs[0] as number[], evaluatedArgs[1] as number)
    if (name === 'EMA') return Statistics.EMA(evaluatedArgs[0] as number[], evaluatedArgs[1] as number)
    if (name === 'STDEV') return Statistics.STDEV(evaluatedArgs[0] as number[])
    if (name === 'MAX') return Statistics.MAX(evaluatedArgs[0] as number[])
    if (name === 'MIN') return Statistics.MIN(evaluatedArgs[0] as number[])
    if (name === 'SUM') return Statistics.SUM(evaluatedArgs[0] as number[])
    if (name === 'AVERAGE') return Statistics.AVERAGE(evaluatedArgs[0] as number[])

    // Technical indicator functions
    if (name === 'RSI') return Technical.RSI(evaluatedArgs[0] as number[], evaluatedArgs[1] as number)
    if (name === 'BBANDS')
      return Technical.BBANDS(evaluatedArgs[0] as number[], evaluatedArgs[1] as number, evaluatedArgs[2] as number)
    if (name === 'MACD')
      return Technical.MACD(
        evaluatedArgs[0] as number[],
        evaluatedArgs[1] as number,
        evaluatedArgs[2] as number,
        evaluatedArgs[3] as number,
      )
    if (name === 'ATR')
      return Technical.ATR(
        evaluatedArgs[0] as number[],
        evaluatedArgs[1] as number[],
        evaluatedArgs[2] as number[],
        evaluatedArgs[3] as number,
      )

    throw new Error(`Unknown function: ${name}`)
  }

  private async executeBinaryOp(node: BinaryOpNode): Promise<number> {
    const left = await this.evaluate(node.left)
    const right = await this.evaluate(node.right)

    if (typeof left !== 'number' || typeof right !== 'number') {
      throw new Error(`Binary operations require numbers, got ${typeof left} and ${typeof right}`)
    }

    switch (node.operator) {
      case '+': return left + right
      case '-': return left - right
      case '*': return left * right
      case '/':
        if (right === 0) throw new Error('Division by zero')
        return left / right
      default:
        throw new Error(`Unknown operator: ${String(node.operator)}`)
    }
  }

  private async executeArrayAccess(node: ArrayAccessNode): Promise<number> {
    const array = await this.evaluate(node.array)
    const index = await this.evaluate(node.index)

    if (!Array.isArray(array)) {
      throw new Error(`Array access requires an array, got ${typeof array}`)
    }
    if (typeof index !== 'number') {
      throw new Error(`Array index must be a number, got ${typeof index}`)
    }

    const actualIndex = index < 0 ? array.length + index : index
    if (actualIndex < 0 || actualIndex >= array.length) {
      throw new Error(`Array index out of bounds: ${index}`)
    }

    return array[actualIndex]
  }
}
