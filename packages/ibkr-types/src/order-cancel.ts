/**
 * Mirrors: ibapi/order_cancel.py
 */

import { UNSET_INTEGER } from './const.js'

function intMaxString(val: number): string {
  return val === UNSET_INTEGER ? '' : String(val)
}

export class OrderCancel {
  manualOrderCancelTime = ''
  extOperator = ''
  manualOrderIndicator: number = UNSET_INTEGER

  toString(): string {
    return (
      `manualOrderCancelTime: ${this.manualOrderCancelTime}, ` +
      `extOperator: ${this.extOperator}, ` +
      `manualOrderIndicator: ${intMaxString(this.manualOrderIndicator)}`
    )
  }
}
