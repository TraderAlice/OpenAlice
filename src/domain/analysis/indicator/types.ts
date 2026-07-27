/**
 * Indicator Calculator — 类型定义
 *
 * 通用 OHLCV 量化因子计算器，支持 equity / crypto / currency / commodity。
 */

// ==================== Data ====================

/** 通用 OHLCV 数据，equity/crypto/currency/commodity 共用 */
export interface OhlcvData {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  [key: string]: unknown
}

/** 数据来源元数据 — 从实际 bar 数据提取，不人造。
 *  新增字段(全可选,向后兼容)由联邦 bar 层填充,告诉请求方这根 K 线来自
 *  UTA(broker)还是 vendor。结构上与 market-data `BarMeta` 一致。 */
export interface DataSourceMeta {
  symbol: string
  from: string   // 第一根 bar 的 date
  to: string     // 最后一根 bar 的 date
  bars: number
  /** 'uta'(broker) | 'vendor' — bar 的来源种类。 */
  source?: 'uta' | 'vendor'
  /** 具体源 id:vendor provider 名(yfinance)或 UTA 账户 id(alpaca-paper)。 */
  sourceId?: string
  /** "{sourceId}|{nativeSymbol}" — 操作命名空间的唯一句柄。 */
  barId?: string
  /** 本次序列的 K 线周期；quant 多周期溯源用它区分相同 barId。 */
  interval?: string
  /** vendor 路径报的是请求 provider(SDK 执行器不回传响应 provider)。 */
  provider?: string
  /** 数据档位:free|delayed|subscription|iex|realtime。 */
  barCapability?: 'free' | 'delayed' | 'subscription' | 'iex' | 'realtime'
}

/** getHistoricalData 的返回值 — OHLCV + 元数据 */
export interface HistoricalDataResult {
  data: OhlcvData[]
  meta: DataSourceMeta
}

/** 带数据来源元数据的数值数组 — 从 data-access 函数一路冒泡 */
export interface TrackedValues {
  values: number[]
  source: DataSourceMeta
}

/** 从 number[] 或 TrackedValues 提取纯数组 */
export function toValues(input: number[] | TrackedValues): number[] {
  return Array.isArray(input) ? input : input.values
}

// ==================== Context ====================

/** 指标计算上下文 — 提供历史 OHLCV 数据获取能力 */
export interface IndicatorContext {
  /**
   * 获取历史 OHLCV 数据
   * @param symbol - 资产 symbol，如 "AAPL"、"BTCUSD"、"EURUSD"
   * @param interval - K 线周期，如 "1d", "1w", "1h"
   */
  getHistoricalData: (symbol: string, interval: string) => Promise<HistoricalDataResult>
}

// ==================== AST ====================

export type CalculationResult = number | number[] | string | Record<string, number> | TrackedValues

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
