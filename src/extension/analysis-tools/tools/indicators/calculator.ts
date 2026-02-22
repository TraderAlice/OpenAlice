/**
 * Indicator calculator - Expression parsing and execution
 *
 * Supports Excel-like formula syntax:
 * - SMA(CLOSE('BTC/USD', 100), 20)
 * - RSI(CLOSE('BTC/USD', 50), 14)
 * - (CLOSE('BTC/USD', 1)[0] - SMA(CLOSE('BTC/USD', 100), 50)) / SMA(CLOSE('BTC/USD', 100), 50) * 100
 */

import {
  ASTNode,
  CalculationResult,
  FunctionContext,
  NumberNode,
  StringNode,
  ArrayNode,
  FunctionNode,
  BinaryOpNode,
  ArrayAccessNode,
} from './types';
import * as DataAccess from './functions/data-access';
import * as Statistics from './functions/statistics';
import * as Technical from './functions/technical';

export class IndicatorCalculator {
  constructor(
    private context: FunctionContext,
    private currentTime: Date,
  ) {}

  /**
   * Evaluate expression
   * @param formula - Formula string
   * @param precision - Optional precision limit (decimal places), defaults to 4
   */
  async calculate(
    formula: string,
    precision: number = 4,
  ): Promise<number | number[] | Record<string, number>> {
    const ast = this.parse(formula);
    const result = await this.evaluate(ast);

    // Ensure final result is not a string (strings should only be intermediate arguments)
    if (typeof result === 'string') {
      throw new Error(
        `Invalid formula: result cannot be a string. Got: "${result}"`,
      );
    }

    // Apply precision limit
    return this.applyPrecision(result, precision);
  }

  /**
   * Apply precision limit to the result
   */
  private applyPrecision(
    result: number | number[] | Record<string, number>,
    precision: number,
  ): number | number[] | Record<string, number> {
    if (typeof result === 'number') {
      return parseFloat(result.toFixed(precision));
    }

    if (Array.isArray(result)) {
      return result.map((v) => parseFloat(v.toFixed(precision)));
    }

    // Record<string, number>
    const rounded: Record<string, number> = {};
    for (const [key, value] of Object.entries(result)) {
      rounded[key] = parseFloat(value.toFixed(precision));
    }
    return rounded;
  }

  /**
   * Parse formula into AST
   */
  private parse(formula: string): ASTNode {
    let pos = 0;

    const parseExpression = (): ASTNode => {
      let left = parseTerm();
      skipWhitespace();

      while (pos < formula.length && (peek() === '+' || peek() === '-')) {
        const operator = consume() as '+' | '-';
        skipWhitespace();
        const right = parseTerm();
        skipWhitespace();
        left = {
          type: 'binaryOp',
          operator,
          left,
          right,
        } as BinaryOpNode;
      }

      return left;
    };

    const parseTerm = (): ASTNode => {
      let left = parseFactor();
      skipWhitespace();

      while (pos < formula.length && (peek() === '*' || peek() === '/')) {
        const operator = consume() as '*' | '/';
        skipWhitespace();
        const right = parseFactor();
        skipWhitespace();
        left = {
          type: 'binaryOp',
          operator,
          left,
          right,
        } as BinaryOpNode;
      }

      return left;
    };

    const parseFactor = (): ASTNode => {
      skipWhitespace();

      // Parentheses
      if (peek() === '(') {
        consume(); // (
        const expr = parseExpression();
        skipWhitespace();
        if (peek() !== ')') {
          throw new Error(`Expected ')' at position ${pos}`);
        }
        consume(); // )
        return expr;
      }

      // String literal
      if (peek() === "'" || peek() === '"') {
        return parseString();
      }

      // Number (including negative numbers)
      if (isDigit(peek())) {
        return parseNumber();
      }

      // Negative number: - must be immediately followed by a digit or parenthesis
      if (peek() === '-') {
        const nextPos = pos + 1;
        if (nextPos < formula.length) {
          const nextChar = formula[nextPos];
          if (isDigit(nextChar) || nextChar === '.') {
            return parseNumber();
          }
        }
        // Otherwise it's a subtraction operator, not handled here
        throw new Error(`Unexpected character '${peek()}' at position ${pos}`);
      }

      // Function or identifier
      if (isAlpha(peek())) {
        return parseFunctionOrIdentifier();
      }

      throw new Error(`Unexpected character '${peek()}' at position ${pos}`);
    };

    const parseFunctionOrIdentifier = (): ASTNode => {
      const name = parseIdentifier();
      skipWhitespace();

      // Function call
      if (peek() === '(') {
        consume(); // (
        skipWhitespace();

        const args: ASTNode[] = [];
        if (peek() !== ')') {
          args.push(parseArgument());
          skipWhitespace();

          while (peek() === ',') {
            consume(); // ,
            skipWhitespace();
            args.push(parseArgument());
            skipWhitespace();
          }
        }

        if (peek() !== ')') {
          throw new Error(`Expected ')' at position ${pos}`);
        }
        consume(); // )

        const node: FunctionNode = {
          type: 'function',
          name,
          args,
        };

        // Check for array access [index]
        skipWhitespace();
        if (peek() === '[') {
          return parseArrayAccess(node);
        }

        return node;
      }

      throw new Error(`Unknown identifier '${name}' at position ${pos}`);
    };

    const parseArgument = (): ASTNode => {
      skipWhitespace();

      // String argument 'symbol'
      if (peek() === "'" || peek() === '"') {
        return parseString();
      }

      // Expression argument
      return parseExpression();
    };

    const parseString = (): StringNode => {
      const quote = consume(); // ' or "
      let value = '';

      while (pos < formula.length && peek() !== quote) {
        value += consume();
      }

      if (peek() !== quote) {
        throw new Error(`Unterminated string at position ${pos}`);
      }
      consume(); // closing quote

      return { type: 'string', value };
    };

    const parseNumber = (): NumberNode => {
      let numStr = '';

      if (peek() === '-') {
        numStr += consume();
      }

      while (pos < formula.length && (isDigit(peek()) || peek() === '.')) {
        numStr += consume();
      }

      return { type: 'number', value: parseFloat(numStr) };
    };

    const parseIdentifier = (): string => {
      let name = '';
      while (pos < formula.length && (isAlpha(peek()) || isDigit(peek()))) {
        name += consume();
      }
      return name;
    };

    const parseArrayAccess = (array: ASTNode): ArrayAccessNode => {
      consume(); // [
      skipWhitespace();
      const index = parseExpression();
      skipWhitespace();
      if (peek() !== ']') {
        throw new Error(`Expected ']' at position ${pos}`);
      }
      consume(); // ]

      return {
        type: 'arrayAccess',
        array,
        index,
      };
    };

    const peek = (): string => formula[pos] || '';
    const consume = (): string => formula[pos++] || '';
    const isDigit = (ch: string): boolean => /[0-9]/.test(ch);
    const isAlpha = (ch: string): boolean => /[a-zA-Z_]/.test(ch);
    const skipWhitespace = () => {
      while (pos < formula.length && /\s/.test(peek())) {
        consume();
      }
    };

    skipWhitespace();
    const result = parseExpression();
    skipWhitespace();

    // Ensure the entire formula has been consumed
    if (pos < formula.length) {
      throw new Error(
        `Unexpected character '${peek()}' at position ${pos}. Expected end of expression.`,
      );
    }

    return result;
  }

  /**
   * Execute AST node
   */
  private async evaluate(node: ASTNode): Promise<CalculationResult> {
    switch (node.type) {
      case 'number':
        return node.value;

      case 'string':
        return node.value;

      case 'array':
        return node.value;

      case 'function':
        return await this.executeFunction(node);

      case 'binaryOp':
        return await this.executeBinaryOp(node);

      case 'arrayAccess':
        return await this.executeArrayAccess(node);

      default:
        throw new Error(
          `Unknown node type: ${(node as { type: string }).type}`,
        );
    }
  }

  /**
   * Execute function call
   */
  private async executeFunction(
    node: FunctionNode,
  ): Promise<CalculationResult> {
    const { name, args } = node;

    // Evaluate arguments
    const evaluatedArgs = await Promise.all(
      args.map((arg) => this.evaluate(arg)),
    );

    // Data access functions
    if (name === 'CLOSE') {
      return await DataAccess.CLOSE(
        evaluatedArgs[0] as string,
        evaluatedArgs[1] as number,
        this.context,
        this.currentTime,
      );
    }
    if (name === 'HIGH') {
      return await DataAccess.HIGH(
        evaluatedArgs[0] as string,
        evaluatedArgs[1] as number,
        this.context,
        this.currentTime,
      );
    }
    if (name === 'LOW') {
      return await DataAccess.LOW(
        evaluatedArgs[0] as string,
        evaluatedArgs[1] as number,
        this.context,
        this.currentTime,
      );
    }
    if (name === 'OPEN') {
      return await DataAccess.OPEN(
        evaluatedArgs[0] as string,
        evaluatedArgs[1] as number,
        this.context,
        this.currentTime,
      );
    }
    if (name === 'VOLUME') {
      return await DataAccess.VOLUME(
        evaluatedArgs[0] as string,
        evaluatedArgs[1] as number,
        this.context,
        this.currentTime,
      );
    }

    // Statistics functions
    if (name === 'SMA') {
      return Statistics.SMA(
        evaluatedArgs[0] as number[],
        evaluatedArgs[1] as number,
      );
    }
    if (name === 'EMA') {
      return Statistics.EMA(
        evaluatedArgs[0] as number[],
        evaluatedArgs[1] as number,
      );
    }
    if (name === 'STDEV') {
      return Statistics.STDEV(evaluatedArgs[0] as number[]);
    }
    if (name === 'MAX') {
      return Statistics.MAX(evaluatedArgs[0] as number[]);
    }
    if (name === 'MIN') {
      return Statistics.MIN(evaluatedArgs[0] as number[]);
    }
    if (name === 'SUM') {
      return Statistics.SUM(evaluatedArgs[0] as number[]);
    }
    if (name === 'AVERAGE') {
      return Statistics.AVERAGE(evaluatedArgs[0] as number[]);
    }

    // Technical indicator functions
    if (name === 'RSI') {
      return Technical.RSI(
        evaluatedArgs[0] as number[],
        evaluatedArgs[1] as number,
      );
    }
    if (name === 'BBANDS') {
      return Technical.BBANDS(
        evaluatedArgs[0] as number[],
        evaluatedArgs[1] as number,
        evaluatedArgs[2] as number,
      );
    }
    if (name === 'MACD') {
      return Technical.MACD(
        evaluatedArgs[0] as number[],
        evaluatedArgs[1] as number,
        evaluatedArgs[2] as number,
        evaluatedArgs[3] as number,
      );
    }
    if (name === 'ATR') {
      return Technical.ATR(
        evaluatedArgs[0] as number[],
        evaluatedArgs[1] as number[],
        evaluatedArgs[2] as number[],
        evaluatedArgs[3] as number,
      );
    }

    throw new Error(`Unknown function: ${name}`);
  }

  /**
   * Execute binary operation
   */
  private async executeBinaryOp(node: BinaryOpNode): Promise<number> {
    const left = await this.evaluate(node.left);
    const right = await this.evaluate(node.right);

    if (typeof left !== 'number' || typeof right !== 'number') {
      throw new Error(
        `Binary operations require numbers, got ${typeof left} and ${typeof right}`,
      );
    }

    switch (node.operator) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        if (right === 0) {
          throw new Error('Division by zero');
        }
        return left / right;
      default:
        throw new Error(`Unknown operator: ${String(node.operator)}`);
    }
  }

  /**
   * Execute array access
   */
  private async executeArrayAccess(node: ArrayAccessNode): Promise<number> {
    const array = await this.evaluate(node.array);
    const index = await this.evaluate(node.index);

    if (!Array.isArray(array)) {
      throw new Error(`Array access requires an array, got ${typeof array}`);
    }

    if (typeof index !== 'number') {
      throw new Error(`Array index must be a number, got ${typeof index}`);
    }

    // Support negative indices
    const actualIndex = index < 0 ? array.length + index : index;

    if (actualIndex < 0 || actualIndex >= array.length) {
      throw new Error(`Array index out of bounds: ${index}`);
    }

    return array[actualIndex];
  }
}
