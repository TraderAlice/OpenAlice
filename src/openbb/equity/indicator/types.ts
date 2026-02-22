/**
 * Equity Indicator Calculator — 类型定义
 *
 * 从 archive-analysis 迁移，适配 OpenBB equity 数据层。
 * 去掉了 currentTime/playhead 概念，数据类型以 OpenBB EquityHistoricalData 为准。
 */

import type { EquityHistoricalData } from '@/openbb/equity/types'

// ==================== Context ====================

/** Equity 指标计算上下文 — 提供历史 OHLCV 数据获取能力 */
export interface EquityIndicatorContext {
  /**
   * 获取历史 OHLCV 数据
   * @param symbol - Equity ticker，如 "AAPL"
   * @param lookback - K 线根数
   * @param interval - K 线周期，如 "1d", "1w", "1h"
   */
  getHistoricalData: (symbol: string, lookback: number, interval: string) => Promise<EquityHistoricalData[]>
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
