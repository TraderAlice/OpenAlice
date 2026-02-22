/**
 * Technical indicator calculation module - Type definitions
 */

import { MarketData } from '../../data/interfaces';

/**
 * Function execution context
 */
export interface FunctionContext {
  /**
   * Method to fetch historical OHLCV data
   * @param symbol - Trading pair
   * @param lookback - Number of candlesticks to look back
   * @param currentTime - Current sandbox time
   */
  getHistoricalData: (
    symbol: string,
    lookback: number,
    currentTime: Date,
  ) => Promise<MarketData[]>;
}

/**
 * Calculation result type
 */
export type CalculationResult =
  | number
  | number[]
  | string
  | Record<string, number>;

/**
 * AST node types
 */
export type ASTNode =
  | NumberNode
  | StringNode
  | ArrayNode
  | FunctionNode
  | BinaryOpNode
  | ArrayAccessNode;

export interface NumberNode {
  type: 'number';
  value: number;
}

export interface StringNode {
  type: 'string';
  value: string;
}

export interface ArrayNode {
  type: 'array';
  value: number[];
}

export interface FunctionNode {
  type: 'function';
  name: string;
  args: ASTNode[];
}

export interface BinaryOpNode {
  type: 'binaryOp';
  operator: '+' | '-' | '*' | '/';
  left: ASTNode;
  right: ASTNode;
}

export interface ArrayAccessNode {
  type: 'arrayAccess';
  array: ASTNode;
  index: ASTNode;
}
