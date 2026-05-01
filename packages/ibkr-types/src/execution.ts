/**
 * Mirrors: ibapi/execution.py
 */

import Decimal from 'decimal.js'
import { UNSET_DECIMAL, UNSET_INTEGER } from './const.js'

function floatMaxString(val: number): string {
  return val === Number.MAX_VALUE ? '' : String(val)
}

function decimalMaxString(val: Decimal): string {
  return val.eq(UNSET_DECIMAL) ? '' : val.toString()
}

function intMaxString(val: number): string {
  return val === UNSET_INTEGER ? '' : String(val)
}

function longMaxString(val: number): string {
  return val === UNSET_INTEGER ? '' : String(val)
}

export const OptionExerciseType = {
  NoneItem: { value: -1, label: 'None' },
  Exercise: { value: 1, label: 'Exercise' },
  Lapse: { value: 2, label: 'Lapse' },
  DoNothing: { value: 3, label: 'DoNothing' },
  Assigned: { value: 100, label: 'Assigned ' },
  AutoexerciseClearing: { value: 101, label: 'AutoexerciseClearing' },
  Expired: { value: 102, label: 'Expired' },
  Netting: { value: 103, label: 'Netting' },
  AutoexerciseTrading: { value: 200, label: 'AutoexerciseTrading' },
} as const

export type OptionExerciseTypeEntry = (typeof OptionExerciseType)[keyof typeof OptionExerciseType]

function getOptionExerciseTypeName(entry: OptionExerciseTypeEntry): string {
  for (const [key, val] of Object.entries(OptionExerciseType)) {
    if (val === entry) return key
  }
  return 'Unknown'
}

export class Execution {
  execId = ''
  time = ''
  acctNumber = ''
  exchange = ''
  side = ''
  shares: Decimal = UNSET_DECIMAL
  price = 0.0
  permId = 0
  clientId = 0
  orderId = 0
  liquidation = 0
  cumQty: Decimal = UNSET_DECIMAL
  avgPrice = 0.0
  orderRef = ''
  evRule = ''
  evMultiplier = 0.0
  modelCode = ''
  lastLiquidity = 0
  pendingPriceRevision = false
  submitter = ''
  optExerciseOrLapseType: OptionExerciseTypeEntry = OptionExerciseType.NoneItem

  toString(): string {
    return (
      `ExecId: ${this.execId}, Time: ${this.time}, Account: ${this.acctNumber}, ` +
      `Exchange: ${this.exchange}, Side: ${this.side}, Shares: ${decimalMaxString(this.shares)}, ` +
      `Price: ${floatMaxString(this.price)}, PermId: ${longMaxString(this.permId)}, ` +
      `ClientId: ${intMaxString(this.clientId)}, OrderId: ${intMaxString(this.orderId)}, ` +
      `Liquidation: ${intMaxString(this.liquidation)}, CumQty: ${decimalMaxString(this.cumQty)}, ` +
      `AvgPrice: ${floatMaxString(this.avgPrice)}, OrderRef: ${this.orderRef}, ` +
      `EvRule: ${this.evRule}, EvMultiplier: ${floatMaxString(this.evMultiplier)}, ` +
      `ModelCode: ${this.modelCode}, LastLiquidity: ${intMaxString(this.lastLiquidity)}, ` +
      `PendingPriceRevision: ${this.pendingPriceRevision}, Submitter: ${this.submitter}, ` +
      `OptExerciseOrLapseType: ${getOptionExerciseTypeName(this.optExerciseOrLapseType)}`
    )
  }
}

export class ExecutionFilter {
  clientId = 0
  acctCode = ''
  time = ''
  symbol = ''
  secType = ''
  exchange = ''
  side = ''
  lastNDays: number = UNSET_INTEGER
  specificDates: string[] | null = null
}
