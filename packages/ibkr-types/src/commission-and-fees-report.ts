/**
 * Mirrors: ibapi/commission_and_fees_report.py
 */

function floatMaxString(val: number): string {
  return val === Number.MAX_VALUE ? '' : String(val)
}

function intMaxString(val: number): string {
  return val === 2 ** 31 - 1 ? '' : String(val)
}

export class CommissionAndFeesReport {
  execId = ''
  commissionAndFees = 0.0
  currency = ''
  realizedPNL = 0.0
  yield_ = 0.0
  yieldRedemptionDate = 0 // YYYYMMDD format

  toString(): string {
    return (
      `ExecId: ${this.execId}, CommissionAndFees: ${floatMaxString(this.commissionAndFees)}, ` +
      `Currency: ${this.currency}, RealizedPnL: ${floatMaxString(this.realizedPNL)}, ` +
      `Yield: ${floatMaxString(this.yield_)}, ` +
      `YieldRedemptionDate: ${intMaxString(this.yieldRedemptionDate)}`
    )
  }
}
