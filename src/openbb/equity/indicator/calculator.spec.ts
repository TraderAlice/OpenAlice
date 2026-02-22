/**
 * Equity Indicator Calculator unit tests
 *
 * 覆盖：四则运算、运算符优先级、数据访问、统计函数、技术指标、
 * 数组索引、嵌套表达式、精度控制、错误处理。
 */
import { describe, it, expect } from 'vitest'
import { EquityIndicatorCalculator } from './calculator'
import type { EquityIndicatorContext } from './types'
import type { EquityHistoricalData } from '@/openbb/equity/types'

// Mock: 50 根日线，收盘价 100~149，volume 第 48 根为 null 测边界
const mockData: EquityHistoricalData[] = Array.from({ length: 50 }, (_, i) => ({
  date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
  open: 100 + i,
  high: 102 + i,
  low: 99 + i,
  close: 100 + i,
  volume: i === 48 ? null : 1000 + i * 10,
  vwap: null,
}))

const mockContext: EquityIndicatorContext = {
  getHistoricalData: async (_symbol: string, lookback: number, _interval: string) => {
    return mockData.slice(-lookback)
  },
}

function calc(formula: string, precision?: number) {
  const calculator = new EquityIndicatorCalculator(mockContext)
  return calculator.calculate(formula, precision)
}

// ==================== 四则运算 ====================

describe('arithmetic', () => {
  it('addition', async () => {
    expect(await calc('2 + 3')).toBe(5)
  })

  it('subtraction', async () => {
    expect(await calc('10 - 4')).toBe(6)
  })

  it('multiplication', async () => {
    expect(await calc('3 * 7')).toBe(21)
  })

  it('division', async () => {
    expect(await calc('15 / 4')).toBe(3.75)
  })

  it('operator precedence: * before +', async () => {
    expect(await calc('2 + 3 * 4')).toBe(14)
  })

  it('operator precedence: / before -', async () => {
    expect(await calc('10 - 6 / 2')).toBe(7)
  })

  it('parentheses override precedence', async () => {
    expect(await calc('(2 + 3) * 4')).toBe(20)
  })

  it('nested parentheses', async () => {
    expect(await calc('((1 + 2) * (3 + 4))')).toBe(21)
  })

  it('negative numbers', async () => {
    expect(await calc('-5 + 3')).toBe(-2)
  })

  it('decimal numbers', async () => {
    expect(await calc('1.5 * 2.0')).toBe(3)
  })

  it('chained operations left to right', async () => {
    // 10 - 3 - 2 = 5 (left-associative)
    expect(await calc('10 - 3 - 2')).toBe(5)
  })

  it('division by zero throws', async () => {
    await expect(calc('10 / 0')).rejects.toThrow('Division by zero')
  })
})

// ==================== 数据访问 ====================

describe('data access', () => {
  it('CLOSE returns correct array', async () => {
    const result = await calc("CLOSE('AAPL', 10, '1d')")
    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual([140, 141, 142, 143, 144, 145, 146, 147, 148, 149])
  })

  it('HIGH returns correct array', async () => {
    const result = await calc("HIGH('AAPL', 5, '1d')")
    expect(result).toEqual([147, 148, 149, 150, 151])
  })

  it('LOW returns correct array', async () => {
    const result = await calc("LOW('AAPL', 3, '1d')")
    expect(result).toEqual([146, 147, 148])
  })

  it('OPEN returns correct array', async () => {
    const result = await calc("OPEN('AAPL', 3, '1d')")
    expect(result).toEqual([147, 148, 149])
  })

  it('VOLUME handles null as 0', async () => {
    // mockData[48].volume = null, mockData[49].volume = 1490
    const result = await calc("VOLUME('AAPL', 2, '1d')")
    expect(result).toEqual([0, 1490])
  })
})

// ==================== 数组索引 ====================

describe('array access', () => {
  it('positive index', async () => {
    expect(await calc("CLOSE('AAPL', 10, '1d')[0]")).toBe(140)
  })

  it('negative index (-1 = last)', async () => {
    expect(await calc("CLOSE('AAPL', 10, '1d')[-1]")).toBe(149)
  })

  it('negative index (-2 = second to last)', async () => {
    expect(await calc("CLOSE('AAPL', 10, '1d')[-2]")).toBe(148)
  })

  it('out of bounds throws', async () => {
    await expect(calc("CLOSE('AAPL', 10, '1d')[100]")).rejects.toThrow('out of bounds')
  })
})

// ==================== 统计函数 ====================

describe('statistics', () => {
  it('SMA', async () => {
    // last 10 closes: 140..149, SMA(10) = 144.5
    expect(await calc("SMA(CLOSE('AAPL', 20, '1d'), 10)")).toBe(144.5)
  })

  it('EMA', async () => {
    const result = await calc("EMA(CLOSE('AAPL', 20, '1d'), 10)")
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(140)
  })

  it('STDEV', async () => {
    // stdev of 140..149 ≈ 2.87
    const result = await calc("STDEV(CLOSE('AAPL', 10, '1d'))")
    expect(result).toBeCloseTo(2.87, 1)
  })

  it('MAX', async () => {
    expect(await calc("MAX(CLOSE('AAPL', 10, '1d'))")).toBe(149)
  })

  it('MIN', async () => {
    expect(await calc("MIN(CLOSE('AAPL', 10, '1d'))")).toBe(140)
  })

  it('SUM', async () => {
    // 140+141+...+149 = 1445
    expect(await calc("SUM(CLOSE('AAPL', 10, '1d'))")).toBe(1445)
  })

  it('AVERAGE', async () => {
    expect(await calc("AVERAGE(CLOSE('AAPL', 10, '1d'))")).toBe(144.5)
  })

  it('SMA insufficient data throws', async () => {
    await expect(calc("SMA(CLOSE('AAPL', 5, '1d'), 10)")).rejects.toThrow('at least 10')
  })
})

// ==================== 技术指标 ====================

describe('technical indicators', () => {
  it('RSI returns 0-100, trending up → high RSI', async () => {
    const result = (await calc("RSI(CLOSE('AAPL', 30, '1d'), 14)")) as number
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(100)
    // 连续上涨，RSI 应接近 100
    expect(result).toBeGreaterThan(90)
  })

  it('BBANDS returns { upper, middle, lower }', async () => {
    const result = (await calc("BBANDS(CLOSE('AAPL', 30, '1d'), 20, 2)")) as Record<string, number>
    expect(result).toHaveProperty('upper')
    expect(result).toHaveProperty('middle')
    expect(result).toHaveProperty('lower')
    expect(result.upper).toBeGreaterThan(result.middle)
    expect(result.middle).toBeGreaterThan(result.lower)
  })

  it('MACD returns { macd, signal, histogram }', async () => {
    const result = (await calc("MACD(CLOSE('AAPL', 50, '1d'), 12, 26, 9)")) as Record<string, number>
    expect(result).toHaveProperty('macd')
    expect(result).toHaveProperty('signal')
    expect(result).toHaveProperty('histogram')
    expect(typeof result.macd).toBe('number')
  })

  it('ATR returns positive number', async () => {
    const result = (await calc("ATR(HIGH('AAPL', 30, '1d'), LOW('AAPL', 30, '1d'), CLOSE('AAPL', 30, '1d'), 14)")) as number
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(0)
  })
})

// ==================== 复合表达式 ====================

describe('complex expressions', () => {
  it('price deviation from MA (%)', async () => {
    // (149 - 144.5) / 144.5 * 100 ≈ 3.11%
    const result = await calc(
      "(CLOSE('AAPL', 1, '1d')[0] - SMA(CLOSE('AAPL', 10, '1d'), 10)) / SMA(CLOSE('AAPL', 10, '1d'), 10) * 100",
    )
    expect(result).toBeCloseTo(3.11, 1)
  })

  it('arithmetic on function results', async () => {
    // MAX - MIN of last 10 closes = 149 - 140 = 9
    const result = await calc("MAX(CLOSE('AAPL', 10, '1d')) - MIN(CLOSE('AAPL', 10, '1d'))")
    expect(result).toBe(9)
  })

  it('double-quoted strings work', async () => {
    const result = await calc('CLOSE("AAPL", 3, "1d")')
    expect(Array.isArray(result)).toBe(true)
    expect((result as number[]).length).toBe(3)
  })
})

// ==================== 精度控制 ====================

describe('precision', () => {
  it('default precision = 4', async () => {
    const result = (await calc('10 / 3')) as number
    expect(result).toBe(3.3333)
  })

  it('custom precision = 2', async () => {
    const result = (await calc('10 / 3', 2)) as number
    expect(result).toBe(3.33)
  })

  it('precision = 0 rounds to integer', async () => {
    const result = (await calc('10 / 3', 0)) as number
    expect(result).toBe(3)
  })

  it('precision applies to arrays', async () => {
    const result = (await calc("STDEV(CLOSE('AAPL', 10, '1d'))", 1)) as number
    // 2.87... → 2.9
    expect(result).toBe(2.9)
  })

  it('precision applies to record values', async () => {
    const result = (await calc("BBANDS(CLOSE('AAPL', 30, '1d'), 20, 2)", 2)) as Record<string, number>
    // 所有值应只有 2 位小数
    for (const v of Object.values(result)) {
      const decimals = v.toString().split('.')[1]?.length ?? 0
      expect(decimals).toBeLessThanOrEqual(2)
    }
  })
})

// ==================== 错误处理 ====================

describe('errors', () => {
  it('string result throws', async () => {
    await expect(calc("'AAPL'")).rejects.toThrow('result cannot be a string')
  })

  it('unknown function throws', async () => {
    await expect(calc("FAKE('AAPL', 10, '1d')")).rejects.toThrow('Unknown function: FAKE')
  })

  it('missing closing paren throws', async () => {
    await expect(calc("SMA(CLOSE('AAPL', 10, '1d'), 5")).rejects.toThrow()
  })

  it('missing closing bracket throws', async () => {
    await expect(calc("CLOSE('AAPL', 10, '1d')[0")).rejects.toThrow()
  })

  it('unterminated string throws', async () => {
    await expect(calc("CLOSE('AAPL, 10)")).rejects.toThrow()
  })

  it('binary op on non-numbers throws', async () => {
    await expect(calc("CLOSE('AAPL', 10, '1d') + 1")).rejects.toThrow('require numbers')
  })

  it('array access on non-array throws', async () => {
    await expect(calc("SMA(CLOSE('AAPL', 20, '1d'), 10)[0]")).rejects.toThrow('requires an array')
  })
})
