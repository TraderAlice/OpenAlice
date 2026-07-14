/**
 * Delta Volume / Cumulative Delta / Volume Profile — 纯函数实现
 *
 * 通过 intrabar 聚合估算买卖压力（无 tick 级别数据时的近似方案）。
 * TradingView Volume Delta 官方逻辑：用更低周期 K 线的 close vs open 方向
 * 对成交量分类，累加为目标 bar 的 delta。
 */

import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import { intervalToMinutesOrDefault, parseBarDateUTC } from './interval-time.js'

// ==================== Delta Volume ====================

export interface DeltaVolumeParams {
  /** 目标 K 线数据（需要计算 delta 的周期） */
  targetBars: OhlcvBar[]
  /** 更低周期的 intrabar 数据（用于方向判断） */
  intrabars: OhlcvBar[]
  /** 目标 bar 周期（用于计算 bar 边界，例如 "15m" "1h" "1d"） */
  targetInterval: string
}

export interface DeltaVolumeResult {
  /** 每根目标 bar 的 delta volume */
  deltas: number[]
  /** 每根目标 bar 的 delta / intrabar volume；跨标的、跨周期比较更稳定 */
  deltaRatios: number[]
  /** 累积 delta（CVD） */
  cumulativeDeltas: number[]
  /** 每根目标 bar 的覆盖率（0-1） */
  coverage: number[]
  /** 低置信度 bar 的索引（coverage < 0.9） */
  lowConfidenceIndices: number[]
}

/**
 * 计算 intrabar 的方向 sign（TradingView Volume Delta 规则）。
 *
 * sign =
 *   +1, if close > open
 *   -1, if close < open
 *   +1, if close == open and close > prevClose
 *   -1, if close == open and close < prevClose
 *   prevSign, otherwise (doji 且 close == prevClose，沿用前一根)
 */
function calculateSign(bar: OhlcvBar, prevClose: number | null, prevSign: number): number {
  const { open, close } = bar
  if (close > open) return 1
  if (close < open) return -1
  // Doji (close == open)
  if (prevClose !== null) {
    if (close > prevClose) return 1
    if (close < prevClose) return -1
  }
  // close == open == prevClose，沿用前一根 sign
  return prevSign
}

/**
 * 计算 Delta Volume。
 *
 * 遍历每根 targetBar，找到其时间窗口 [start, end) 内的所有 intrabars，
 * 按方向判断规则对成交量分类，累加为 delta。
 */
export function calculateDeltaVolume(params: DeltaVolumeParams): DeltaVolumeResult {
  const { targetBars, intrabars, targetInterval } = params

  if (targetBars.length === 0) {
    return { deltas: [], deltaRatios: [], cumulativeDeltas: [], coverage: [], lowConfidenceIndices: [] }
  }

  const durationMinutes = intervalToMinutesOrDefault(targetInterval, 60)
  const deltas: number[] = []
  const deltaRatios: number[] = []
  const coverage: number[] = []
  const lowConfidenceIndices: number[] = []

  // 预解析时间戳（避免重复解析）
  const targetBarTimes = targetBars.map((b) => parseBarDateUTC(b.date).getTime())
  const intrabarTimes = intrabars.map((b) => parseBarDateUTC(b.date).getTime())

  let prevSign = 1 // 初始方向为正（首根 intrabar 的 doji fallback）
  let prevClose: number | null = null
  let intrabarIndex = 0

  for (let i = 0; i < targetBars.length; i++) {
    const targetBar = targetBars[i]
    const targetStart = targetBarTimes[i]
    const targetEnd = targetStart + durationMinutes * 60 * 1000

    let delta = 0
    let intraCoveredVolume = 0

    while (intrabarIndex < intrabars.length && intrabarTimes[intrabarIndex] < targetStart) {
      intrabarIndex++
    }

    // 线性扫描：每根 intrabar 只会被消费一次
    let j = intrabarIndex
    while (j < intrabars.length && intrabarTimes[j] < targetEnd) {
      const intraBar = intrabars[j]
      const vol = intraBar.volume ?? 0 // null volume 按 0 处理

      const sign = calculateSign(intraBar, prevClose, prevSign)
      delta += sign * vol
      intraCoveredVolume += vol

      prevClose = intraBar.close
      prevSign = sign
      j++
    }
    intrabarIndex = j

    deltas.push(delta)
    deltaRatios.push(intraCoveredVolume > 0 ? delta / intraCoveredVolume : 0)

    // 计算覆盖率
    const targetVolume = targetBar.volume ?? 0
    const cov = targetVolume > 0 ? Math.min(intraCoveredVolume / targetVolume, 1) : 0
    coverage.push(cov)

    if (cov < 0.9) {
      lowConfidenceIndices.push(i)
    }
  }

  // 计算累积 delta (CVD)
  const cumulativeDeltas: number[] = []
  let cvd = 0
  for (const d of deltas) {
    cvd += d
    cumulativeDeltas.push(cvd)
  }

  return { deltas, deltaRatios, cumulativeDeltas, coverage, lowConfidenceIndices }
}

// ==================== Volume Profile ====================

export interface VolumeProfileParams {
  bars: OhlcvBar[]
  /** 价格区间数量（默认 20） */
  numBins?: number
}

export interface VolumeProfileBin {
  /** 价格区间下界 */
  priceLow: number
  /** 价格区间上界 */
  priceHigh: number
  /** 该区间总成交量 */
  volume: number
  /** 该区间 bar 数量 */
  count: number
}

export interface VolumeProfileResult {
  bins: VolumeProfileBin[]
  /** Point of Control — 成交量最大的价格区间 */
  poc: VolumeProfileBin
  /** Value Area High — 70% 成交量集中区间的上界 */
  valueAreaHigh: number
  /** Value Area Low — 70% 成交量集中区间的下界 */
  valueAreaLow: number
}

/**
 * 计算 Volume Profile。
 *
 * 1. 价格范围 [min(bars.low), max(bars.high)]
 * 2. 均匀分成 numBins 个区间
 * 3. 每根 bar 的 volume 在其 [low, high] 覆盖的 bins 上均匀分配
 * 4. Doji (high == low) 只落到所在 bin
 * 5. POC = volume 最大的 bin
 * 6. Value Area = 从 POC 向两侧扩展，直到累积 volume ≥ 70% 总量
 */
export function calculateVolumeProfile(params: VolumeProfileParams): VolumeProfileResult {
  const { bars, numBins = 20 } = params

  if (bars.length === 0 || numBins <= 0) {
    const emptyBin = { priceLow: 0, priceHigh: 0, volume: 0, count: 0 }
    return { bins: [], poc: emptyBin, valueAreaHigh: 0, valueAreaLow: 0 }
  }

  // 1. 确定价格范围
  let minPrice = Infinity
  let maxPrice = -Infinity
  for (const bar of bars) {
    if (bar.low < minPrice) minPrice = bar.low
    if (bar.high > maxPrice) maxPrice = bar.high
  }

  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || maxPrice <= minPrice) {
    // 数据异常，返回空
    const emptyBin = { priceLow: 0, priceHigh: 0, volume: 0, count: 0 }
    return { bins: [], poc: emptyBin, valueAreaHigh: 0, valueAreaLow: 0 }
  }

  // 2. 分箱：均匀切分
  const binSize = (maxPrice - minPrice) / numBins
  const bins: VolumeProfileBin[] = []
  for (let i = 0; i < numBins; i++) {
    bins.push({
      priceLow: minPrice + i * binSize,
      priceHigh: minPrice + (i + 1) * binSize,
      volume: 0,
      count: 0,
    })
  }

  // 3. 分配 volume
  let totalVolume = 0
  for (const bar of bars) {
    const vol = bar.volume ?? 0
    totalVolume += vol

    const { low, high } = bar
    if (high === low) {
      // Doji：只落到所在 bin
      const binIdx = Math.min(Math.floor((low - minPrice) / binSize), numBins - 1)
      if (binIdx >= 0) {
        bins[binIdx].volume += vol
        bins[binIdx].count += 1
      }
    } else {
      // 跨越多个 bin：均匀分配
      const startBin = Math.max(0, Math.floor((low - minPrice) / binSize))
      const endBin = Math.min(numBins - 1, Math.floor((high - minPrice) / binSize))
      const numCovered = endBin - startBin + 1
      const volPerBin = vol / numCovered

      for (let i = startBin; i <= endBin; i++) {
        bins[i].volume += volPerBin
        bins[i].count += 1
      }
    }
  }

  // 4. POC — volume 最大的 bin（平手时取第一个）
  let pocIdx = 0
  for (let i = 1; i < bins.length; i++) {
    if (bins[i].volume > bins[pocIdx].volume) {
      pocIdx = i
    }
  }
  const poc = bins[pocIdx]

  // 5. Value Area — 从 POC 向两侧扩展，直到累积 volume ≥ 70% 总量
  const targetVolume = totalVolume * 0.7
  let accVolume = poc.volume
  let leftIdx = pocIdx
  let rightIdx = pocIdx

  while (accVolume < targetVolume && (leftIdx > 0 || rightIdx < bins.length - 1)) {
    const leftVol = leftIdx > 0 ? bins[leftIdx - 1].volume : 0
    const rightVol = rightIdx < bins.length - 1 ? bins[rightIdx + 1].volume : 0

    if (leftVol >= rightVol && leftIdx > 0) {
      leftIdx -= 1
      accVolume += bins[leftIdx].volume
    } else if (rightIdx < bins.length - 1) {
      rightIdx += 1
      accVolume += bins[rightIdx].volume
    } else {
      break
    }
  }

  const valueAreaLow = bins[leftIdx].priceLow
  const valueAreaHigh = bins[rightIdx].priceHigh

  return { bins, poc, valueAreaHigh, valueAreaLow }
}
