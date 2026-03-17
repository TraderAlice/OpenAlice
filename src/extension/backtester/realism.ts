/**
 * Backtester — Volume Realism
 *
 * Flags trades where position notional exceeds a configurable fraction
 * of candle volume. Warnings only — does not reject trades.
 */

import type { Candle, TradeEntry, VolumeWarning } from './types.js'

const DEFAULT_MAX_VOLUME_FRACTION = 0.1

export function checkVolumeWarning(
  tradeValue: number,
  candle: Candle,
  maxVolumeFraction: number = DEFAULT_MAX_VOLUME_FRACTION,
): VolumeWarning | null {
  const candleVolumeValue = candle.volume * candle.close
  if (candleVolumeValue <= 0) return null

  const pctOfVolume = tradeValue / candleVolumeValue
  if (pctOfVolume > maxVolumeFraction) {
    return {
      trade_index: 0,
      trade_value: tradeValue,
      candle_volume: candleVolumeValue,
      pct_of_volume: pctOfVolume,
    }
  }
  return null
}

export interface VolumeWarningSummary {
  volume_warnings: number
  volume_warning_pct: number
  warnings: VolumeWarning[]
}

export function summarizeVolumeWarnings(
  trades: TradeEntry[],
  candles: Candle[],
  maxVolumeFraction: number = DEFAULT_MAX_VOLUME_FRACTION,
): VolumeWarningSummary {
  const candleByTs = new Map<number, Candle>()
  for (const c of candles) candleByTs.set(c.timestamp, c)

  const warnings: VolumeWarning[] = []

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i]
    const entryCandle = candleByTs.get(trade.entry_time)
    if (!entryCandle) continue

    const tradeValue = trade.entry_price * trade.size
    const warning = checkVolumeWarning(tradeValue, entryCandle, maxVolumeFraction)
    if (warning) {
      warning.trade_index = i
      warnings.push(warning)
    }
  }

  return {
    volume_warnings: warnings.length,
    volume_warning_pct: trades.length > 0 ? warnings.length / trades.length : 0,
    warnings,
  }
}
