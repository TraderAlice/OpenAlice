/**
 * Mirrors: ibapi/order_state.py
 */

import Decimal from 'decimal.js'
import { UNSET_DOUBLE, UNSET_DECIMAL } from './const.js'

function floatMaxString(val: number): string {
  return val === UNSET_DOUBLE ? '' : String(val)
}

function decimalMaxString(val: Decimal): string {
  return val.eq(UNSET_DECIMAL) ? '' : val.toString()
}

export class OrderAllocation {
  account = ''
  position: Decimal = UNSET_DECIMAL
  positionDesired: Decimal = UNSET_DECIMAL
  positionAfter: Decimal = UNSET_DECIMAL
  desiredAllocQty: Decimal = UNSET_DECIMAL
  allowedAllocQty: Decimal = UNSET_DECIMAL
  isMonetary = false

  toString(): string {
    return (
      `Account: ${this.account}, Position: ${decimalMaxString(this.position)}, ` +
      `PositionDesired: ${decimalMaxString(this.positionDesired)}, ` +
      `PositionAfter: ${decimalMaxString(this.positionAfter)}, ` +
      `DesiredAllocQty: ${decimalMaxString(this.desiredAllocQty)}, ` +
      `AllowedAllocQty: ${decimalMaxString(this.allowedAllocQty)}, ` +
      `IsMonetary: ${this.isMonetary}`
    )
  }
}

export class OrderState {
  status = ''

  initMarginBefore = ''
  maintMarginBefore = ''
  equityWithLoanBefore = ''
  initMarginChange = ''
  maintMarginChange = ''
  equityWithLoanChange = ''
  initMarginAfter = ''
  maintMarginAfter = ''
  equityWithLoanAfter = ''

  commissionAndFees: number = UNSET_DOUBLE
  minCommissionAndFees: number = UNSET_DOUBLE
  maxCommissionAndFees: number = UNSET_DOUBLE
  commissionAndFeesCurrency = ''
  marginCurrency = ''
  initMarginBeforeOutsideRTH: number = UNSET_DOUBLE
  maintMarginBeforeOutsideRTH: number = UNSET_DOUBLE
  equityWithLoanBeforeOutsideRTH: number = UNSET_DOUBLE
  initMarginChangeOutsideRTH: number = UNSET_DOUBLE
  maintMarginChangeOutsideRTH: number = UNSET_DOUBLE
  equityWithLoanChangeOutsideRTH: number = UNSET_DOUBLE
  initMarginAfterOutsideRTH: number = UNSET_DOUBLE
  maintMarginAfterOutsideRTH: number = UNSET_DOUBLE
  equityWithLoanAfterOutsideRTH: number = UNSET_DOUBLE
  suggestedSize: Decimal = UNSET_DECIMAL
  rejectReason = ''
  orderAllocations: OrderAllocation[] | null = null
  warningText = ''
  completedTime = ''
  completedStatus = ''

  toString(): string {
    let s =
      `Status: ${this.status}, ` +
      `InitMarginBefore: ${this.initMarginBefore}, ` +
      `MaintMarginBefore: ${this.maintMarginBefore}, ` +
      `EquityWithLoanBefore: ${this.equityWithLoanBefore}, ` +
      `InitMarginChange: ${this.initMarginChange}, ` +
      `MaintMarginChange: ${this.maintMarginChange}, ` +
      `EquityWithLoanChange: ${this.equityWithLoanChange}, ` +
      `InitMarginAfter: ${this.initMarginAfter}, ` +
      `MaintMarginAfter: ${this.maintMarginAfter}, ` +
      `EquityWithLoanAfter: ${this.equityWithLoanAfter}, ` +
      `CommissionAndFees: ${floatMaxString(this.commissionAndFees)}, ` +
      `MinCommissionAndFees: ${floatMaxString(this.minCommissionAndFees)}, ` +
      `MaxCommissionAndFees: ${floatMaxString(this.maxCommissionAndFees)}, ` +
      `CommissionAndFeesCurrency: ${this.commissionAndFeesCurrency}, ` +
      `MarginCurrency: ${this.marginCurrency}, ` +
      `InitMarginBeforeOutsideRTH: ${floatMaxString(this.initMarginBeforeOutsideRTH)}, ` +
      `MaintMarginBeforeOutsideRTH: ${floatMaxString(this.maintMarginBeforeOutsideRTH)}, ` +
      `EquityWithLoanBeforeOutsideRTH: ${floatMaxString(this.equityWithLoanBeforeOutsideRTH)}, ` +
      `InitMarginChangeOutsideRTH: ${floatMaxString(this.initMarginChangeOutsideRTH)}, ` +
      `MaintMarginChangeOutsideRTH: ${floatMaxString(this.maintMarginChangeOutsideRTH)}, ` +
      `equityWithLoanChangeOutsideRTH: ${floatMaxString(this.equityWithLoanChangeOutsideRTH)}, ` +
      `InitMarginAfterOutsideRTH: ${floatMaxString(this.initMarginAfterOutsideRTH)}, ` +
      `MaintMarginAfterOutsideRTH: ${floatMaxString(this.maintMarginAfterOutsideRTH)}, ` +
      `equityWithLoanAfterOutsideRTH: ${floatMaxString(this.equityWithLoanAfterOutsideRTH)}, ` +
      `SuggestedSize: ${decimalMaxString(this.suggestedSize)}, ` +
      `RejectReason: ${this.rejectReason}, ` +
      `WarningText: ${this.warningText}, ` +
      `CompletedTime: ${this.completedTime}, ` +
      `CompletedStatus: ${this.completedStatus}`

    if (this.orderAllocations) {
      s += ' OrderAllocations('
      for (const orderAllocation of this.orderAllocations) {
        s += orderAllocation.toString() + '; '
      }
      s += ')'
    }

    return s
  }
}
