/**
 * Indicator Calculator — 类型定义
 *
 * 通用 OHLCV 量化因子计算器，支持 equity / crypto / currency。
 */

// ==================== Data ====================

/** 通用 OHLCV 数据，equity/crypto/currency 共用 */
export interface OhlcvData {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  [key: string]: unknown
}

// ==================== Context ====================

/** 指标计算上下文 — 提供历史 OHLCV 数据获取能力 */
export interface IndicatorContext {
  /**
   * 获取历史 OHLCV 数据
   * @param symbol - 资产 symbol，如 "AAPL"、"BTCUSD"、"EURUSD"
   * @param interval - K 线周期，如 "1d", "1w", "1h"
   */
  getHistoricalData: (symbol: string, interval: string) => Promise<OhlcvData[]>
}

// ==================== AST ====================

export type CalculationResult = number | number[] | string | Record<string, number>

export type ASTNode =
  | NumberNode
  | StringNode
  | ArrayNode
  | FunctionNode
  | BinaryOpNode
  | ArrayAccessNode

export interface NumberNode {
  type: 'number'
  value: number
}

export interface StringNode {
  type: 'string'
  value: string
}

export interface ArrayNode {
  type: 'array'
  value: number[]
}

export interface FunctionNode {
  type: 'function'
  name: string
  args: ASTNode[]
}

export interface BinaryOpNode {
  type: 'binaryOp'
  operator: '+' | '-' | '*' | '/'
  left: ASTNode
  right: ASTNode
}

export interface ArrayAccessNode {
  type: 'arrayAccess'
  array: ASTNode
  index: ASTNode
}
