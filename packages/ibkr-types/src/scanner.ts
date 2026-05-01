/**
 * Mirrors: ibapi/scanner.py
 */

import { UNSET_INTEGER, UNSET_DOUBLE } from './const.js'
import type { Contract } from './contract.js'

export class ScanData {
  contract: Contract | null
  rank: number
  distance: string
  benchmark: string
  projection: string
  legsStr: string
  marketName: string

  constructor(
    contract: Contract | null = null,
    rank = 0,
    distance = '',
    benchmark = '',
    projection = '',
    legsStr = '',
    marketName = '',
  ) {
    this.contract = contract
    this.rank = rank
    this.distance = distance
    this.benchmark = benchmark
    this.projection = projection
    this.legsStr = legsStr
    this.marketName = marketName
  }

  toString(): string {
    return (
      `Rank: ${this.rank}, Symbol: ${this.contract?.symbol}, ` +
      `SecType: ${this.contract?.secType}, Currency: ${this.contract?.currency}, ` +
      `Distance: ${this.distance}, Benchmark: ${this.benchmark}, ` +
      `Projection: ${this.projection}, Legs String: ${this.legsStr}, ` +
      `MarketName: ${this.marketName}`
    )
  }
}

export const NO_ROW_NUMBER_SPECIFIED = -1

export class ScannerSubscription {
  numberOfRows: number = NO_ROW_NUMBER_SPECIFIED
  instrument = ''
  locationCode = ''
  scanCode = ''
  abovePrice: number = UNSET_DOUBLE
  belowPrice: number = UNSET_DOUBLE
  aboveVolume: number = UNSET_INTEGER
  marketCapAbove: number = UNSET_DOUBLE
  marketCapBelow: number = UNSET_DOUBLE
  moodyRatingAbove = ''
  moodyRatingBelow = ''
  spRatingAbove = ''
  spRatingBelow = ''
  maturityDateAbove = ''
  maturityDateBelow = ''
  couponRateAbove: number = UNSET_DOUBLE
  couponRateBelow: number = UNSET_DOUBLE
  excludeConvertible = false
  averageOptionVolumeAbove: number = UNSET_INTEGER
  scannerSettingPairs = ''
  stockTypeFilter = ''

  toString(): string {
    return (
      `Instrument: ${this.instrument}, LocationCode: ${this.locationCode}, ScanCode: ${this.scanCode}`
    )
  }
}
