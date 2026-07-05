import { describe, it, expect } from 'vitest'
import { calculateDeltaVolume, calculateVolumeProfile } from './delta-volume.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types'

describe('calculateDeltaVolume', () => {
  it('基本计算：3 根 15m bar，每根有 3 个 1m intrabar，完美覆盖', () => {
    // 目标：3 根 15 分钟 bar，从 2024-01-01 09:00 开始
    const targetBars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 105, low: 99, close: 104, volume: 3000 },
      { date: '2024-01-01 09:15:00', open: 104, high: 106, low: 103, close: 103, volume: 2700 },
      { date: '2024-01-01 09:30:00', open: 103, high: 107, low: 102, close: 106, volume: 3300 },
    ]

    // Intrabars：每根 15m 内 3 个 1m，方向明确
    const intrabars: OhlcvBar[] = [
      // 第 1 根 15m [09:00, 09:15)
      { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: 1000 }, // +1000
      { date: '2024-01-01 09:05:00', open: 101, high: 102, low: 100, close: 102, volume: 1000 }, // +1000
      { date: '2024-01-01 09:10:00', open: 102, high: 105, low: 101, close: 104, volume: 1000 }, // +1000
      // 第 2 根 15m [09:15, 09:30)
      { date: '2024-01-01 09:15:00', open: 104, high: 106, low: 103, close: 105, volume: 900 }, // +900
      { date: '2024-01-01 09:20:00', open: 105, high: 105, low: 104, close: 104, volume: 900 }, // -900
      { date: '2024-01-01 09:25:00', open: 104, high: 104, low: 103, close: 103, volume: 900 }, // -900
      // 第 3 根 15m [09:30, 09:45)
      { date: '2024-01-01 09:30:00', open: 103, high: 104, low: 102, close: 104, volume: 1100 }, // +1100
      { date: '2024-01-01 09:35:00', open: 104, high: 106, low: 103, close: 106, volume: 1100 }, // +1100
      { date: '2024-01-01 09:40:00', open: 106, high: 107, low: 105, close: 106, volume: 1100 }, // doji，prevClose=106 → sign 沿用 +1 → +1100
    ]

    const result = calculateDeltaVolume({
      targetBars,
      intrabars,
      targetInterval: '15m',
    })

    // Delta: 第 1 根 = +3000，第 2 根 = -900，第 3 根 = +3300 (所有都是 +1)
    expect(result.deltas).toEqual([3000, -900, 3300])

    // CVD: 累加
    expect(result.cumulativeDeltas).toEqual([3000, 2100, 5400])

    // 覆盖率：都是 100%
    expect(result.coverage).toEqual([1, 1, 1])
    expect(result.lowConfidenceIndices).toEqual([])
  })

  it('覆盖率不足：部分 intrabar 缺失', () => {
    const targetBars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 105, low: 99, close: 104, volume: 3000 },
    ]

    // 只有 2 个 intrabar，总 volume 1500，覆盖率 50%
    const intrabars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: 750 },
      { date: '2024-01-01 09:05:00', open: 101, high: 102, low: 100, close: 102, volume: 750 },
    ]

    const result = calculateDeltaVolume({
      targetBars,
      intrabars,
      targetInterval: '15m',
    })

    expect(result.deltas).toEqual([1500])
    expect(result.coverage).toEqual([0.5])
    expect(result.lowConfidenceIndices).toEqual([0]) // coverage < 0.9
  })

  it('coverage 裁剪到 1，deltaRatio 基于 intrabar volume 计算', () => {
    const targetBars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 105, low: 99, close: 104, volume: 1000 },
    ]

    const intrabars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: 800 },
      { date: '2024-01-01 09:05:00', open: 101, high: 102, low: 100, close: 100, volume: 700 },
    ]

    const result = calculateDeltaVolume({
      targetBars,
      intrabars,
      targetInterval: '15m',
    })

    expect(result.deltas).toEqual([100])
    expect(result.deltaRatios).toEqual([100 / 1500])
    expect(result.coverage).toEqual([1])
    expect(result.lowConfidenceIndices).toEqual([])
  })

  it('Doji sign carry：close == open，沿用前一根 sign', () => {
    const targetBars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 105, low: 99, close: 104, volume: 3000 },
    ]

    const intrabars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: 1000 }, // +1
      { date: '2024-01-01 09:05:00', open: 101, high: 101, low: 100, close: 101, volume: 1000 }, // doji，沿用 +1
      { date: '2024-01-01 09:10:00', open: 101, high: 102, low: 100, close: 100, volume: 1000 }, // -1
    ]

    const result = calculateDeltaVolume({
      targetBars,
      intrabars,
      targetInterval: '15m',
    })

    // delta = +1000 (第1根) + 1000 (第2根 doji，沿用 +1) - 1000 (第3根) = +1000
    expect(result.deltas).toEqual([1000])
  })

  it('Doji 且 close vs prevClose：根据 prevClose 判断', () => {
    const targetBars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 105, low: 99, close: 104, volume: 2000 },
    ]

    const intrabars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: 1000 }, // +1, prevClose = 101
      { date: '2024-01-01 09:05:00', open: 102, high: 102, low: 101, close: 102, volume: 1000 }, // doji，close 102 > prevClose 101 → +1
    ]

    const result = calculateDeltaVolume({
      targetBars,
      intrabars,
      targetInterval: '15m',
    })

    expect(result.deltas).toEqual([2000]) // 两根都是 +1
  })

  it('跨父 bar 延续 prevSign 和 prevClose', () => {
    const targetBars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 99, volume: 1000 },
      { date: '2024-01-01 09:15:00', open: 99, high: 100, low: 98, close: 99, volume: 1000 },
    ]

    const intrabars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 100, low: 99, close: 99, volume: 1000 }, // -1
      { date: '2024-01-01 09:15:00', open: 99, high: 99, low: 99, close: 99, volume: 1000 }, // doji, prevClose=99, prevSign=-1
    ]

    const result = calculateDeltaVolume({
      targetBars,
      intrabars,
      targetInterval: '15m',
    })

    expect(result.deltas).toEqual([-1000, -1000])
    expect(result.cumulativeDeltas).toEqual([-1000, -2000])
  })

  it('null volume 按 0 处理', () => {
    const targetBars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 105, low: 99, close: 104, volume: null },
    ]

    const intrabars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: null },
      { date: '2024-01-01 09:05:00', open: 101, high: 102, low: 100, close: 100, volume: null },
    ]

    const result = calculateDeltaVolume({
      targetBars,
      intrabars,
      targetInterval: '15m',
    })

    expect(result.deltas).toEqual([0])
    expect(result.coverage).toEqual([0]) // 0/0 按 0 处理（避免 NaN）
  })

  it('空数据返回空结果', () => {
    const result = calculateDeltaVolume({
      targetBars: [],
      intrabars: [],
      targetInterval: '15m',
    })

    expect(result.deltas).toEqual([])
    expect(result.cumulativeDeltas).toEqual([])
    expect(result.coverage).toEqual([])
    expect(result.lowConfidenceIndices).toEqual([])
  })

  it('时间窗口边界：intrabar 刚好在窗口边界外，不计入', () => {
    const targetBars: OhlcvBar[] = [
      { date: '2024-01-01 09:00:00', open: 100, high: 105, low: 99, close: 104, volume: 2000 },
    ]

    const intrabars: OhlcvBar[] = [
      { date: '2024-01-01 08:59:00', open: 99, high: 100, low: 98, close: 100, volume: 500 }, // 窗口外（早）
      { date: '2024-01-01 09:00:00', open: 100, high: 101, low: 99, close: 101, volume: 1000 }, // 窗口内
      { date: '2024-01-01 09:05:00', open: 101, high: 102, low: 100, close: 102, volume: 1000 }, // 窗口内
      { date: '2024-01-01 09:15:00', open: 102, high: 103, low: 101, close: 103, volume: 500 }, // 窗口外（晚）
    ]

    const result = calculateDeltaVolume({
      targetBars,
      intrabars,
      targetInterval: '15m',
    })

    // 只有中间 2 根计入
    expect(result.deltas).toEqual([2000])
    expect(result.coverage).toEqual([1]) // 2000/2000
  })

  it('周线窗口覆盖完整 7 天', () => {
    const targetBars: OhlcvBar[] = [
      { date: '2024-01-01', open: 100, high: 120, low: 95, close: 115, volume: 3000 },
    ]

    const intrabars: OhlcvBar[] = [
      { date: '2024-01-01 00:30:00', open: 100, high: 106, low: 99, close: 105, volume: 1000 },
      { date: '2024-01-04 12:00:00', open: 105, high: 106, low: 100, close: 101, volume: 1000 },
      { date: '2024-01-07 23:00:00', open: 101, high: 116, low: 100, close: 115, volume: 1000 },
      { date: '2024-01-08 00:00:00', open: 115, high: 116, low: 114, close: 116, volume: 1000 },
    ]

    const result = calculateDeltaVolume({
      targetBars,
      intrabars,
      targetInterval: '1w',
    })

    expect(result.deltas).toEqual([1000])
    expect(result.coverage).toEqual([1])
  })
})

describe('calculateVolumeProfile', () => {
  it('基本计算：3 根 bar，20 个 bins', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01', open: 100, high: 110, low: 100, close: 105, volume: 1000 },
      { date: '2024-01-02', open: 105, high: 120, low: 105, close: 115, volume: 1500 },
      { date: '2024-01-03', open: 115, high: 130, low: 110, close: 125, volume: 2000 },
    ]

    const result = calculateVolumeProfile({ bars, numBins: 10 })

    expect(result.bins.length).toBe(10)
    // 价格范围 [100, 130]，bin size = 3
    expect(result.bins[0].priceLow).toBe(100)
    expect(result.bins[0].priceHigh).toBe(103)
    expect(result.bins[9].priceHigh).toBe(130)

    // POC 应该在成交量最集中的区间
    expect(result.poc).toBeDefined()
    expect(result.poc.volume).toBeGreaterThan(0)

    // Value Area
    expect(result.valueAreaLow).toBeLessThanOrEqual(result.valueAreaHigh)
  })

  it('Doji (high == low) 只落到所在 bin', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01', open: 105, high: 105, low: 105, close: 105, volume: 1000 },
    ]

    const result = calculateVolumeProfile({ bars, numBins: 10 })

    // 价格完全一致，range = 0，无法分箱 → 返回空结果
    expect(result.bins).toEqual([])
    expect(result.poc.volume).toBe(0)
  })

  it('Value Area 从 POC 扩展到 70% volume', () => {
    // 构造一个集中分布：中间高，两侧低
    const bars: OhlcvBar[] = [
      { date: '2024-01-01', open: 100, high: 110, low: 100, close: 105, volume: 100 },
      { date: '2024-01-02', open: 108, high: 112, low: 108, close: 110, volume: 1000 }, // 主力区间
      { date: '2024-01-03', open: 118, high: 120, low: 118, close: 119, volume: 100 },
    ]

    const result = calculateVolumeProfile({ bars, numBins: 10 })

    // 总 volume = 1200，70% = 840
    // POC 应该在 108-112 附近
    expect(result.poc.priceLow).toBeGreaterThanOrEqual(108)
    expect(result.poc.priceHigh).toBeLessThanOrEqual(112)

    // Value Area 应该覆盖 POC
    expect(result.valueAreaLow).toBeLessThanOrEqual(result.poc.priceLow)
    expect(result.valueAreaHigh).toBeGreaterThanOrEqual(result.poc.priceHigh)
  })

  it('空数据返回空结果', () => {
    const result = calculateVolumeProfile({ bars: [], numBins: 10 })

    expect(result.bins).toEqual([])
    expect(result.poc.volume).toBe(0)
    expect(result.valueAreaHigh).toBe(0)
    expect(result.valueAreaLow).toBe(0)
  })

  it('numBins = 0 返回空结果', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01', open: 100, high: 110, low: 100, close: 105, volume: 1000 },
    ]

    const result = calculateVolumeProfile({ bars, numBins: 0 })

    expect(result.bins).toEqual([])
  })

  it('null volume 按 0 处理', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01', open: 100, high: 110, low: 100, close: 105, volume: null },
      { date: '2024-01-02', open: 105, high: 120, low: 105, close: 115, volume: 1000 },
    ]

    const result = calculateVolumeProfile({ bars, numBins: 10 })

    // 总 volume = 1000（第一根不计入）
    const totalVolume = result.bins.reduce((acc, b) => acc + b.volume, 0)
    expect(totalVolume).toBeCloseTo(1000, 1)
  })

  it('价格范围异常（maxPrice <= minPrice）返回空结果', () => {
    const bars: OhlcvBar[] = [
      { date: '2024-01-01', open: 100, high: 100, low: 100, close: 100, volume: 1000 },
      { date: '2024-01-02', open: 100, high: 100, low: 100, close: 100, volume: 1000 },
    ]

    const result = calculateVolumeProfile({ bars, numBins: 10 })

    // 价格完全一致，range = 0，无法分箱
    expect(result.bins).toEqual([])
  })

  it('跨多个 bin 的 bar 均匀分配 volume', () => {
    // 一根 bar 从 100 到 120，跨越 2 个 bin（每 bin 10）
    const bars: OhlcvBar[] = [
      { date: '2024-01-01', open: 100, high: 120, low: 100, close: 110, volume: 1000 },
    ]

    const result = calculateVolumeProfile({ bars, numBins: 2 })

    // bin 0: [100, 110], bin 1: [110, 120]
    // bar 跨越 2 个 bin，每个分 500
    expect(result.bins[0].volume).toBeCloseTo(500, 1)
    expect(result.bins[1].volume).toBeCloseTo(500, 1)
  })
})
