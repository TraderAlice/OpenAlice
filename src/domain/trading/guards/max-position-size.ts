import Decimal from 'decimal.js'
import { UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'
import type { OperationGuard, GuardContext } from './types.js'

const DEFAULT_MAX_PERCENT = 25

export class MaxPositionSizeGuard implements OperationGuard {
  readonly name = 'max-position-size'
  private maxPercent: number

  constructor(options: Record<string, unknown>) {
    this.maxPercent = Number(options.maxPercentOfEquity ?? DEFAULT_MAX_PERCENT)
  }

  check(ctx: GuardContext): string | null {
    if (ctx.operation.action !== 'placeOrder') return null

    const { positions, account, operation } = ctx
    const symbol = operation.contract.symbol

    const existing = positions.find(p => p.contract.symbol === symbol)
    const currentValue = new Decimal(existing?.marketValue ?? '0')

    // Estimate added value from IBKR Order fields
    const { order } = operation
    const cashQty = order.cashQty !== UNSET_DOUBLE ? order.cashQty : undefined
    const qty = !order.totalQuantity.equals(UNSET_DECIMAL) ? order.totalQuantity : undefined

    let addedValue = new Decimal(0)
    if (cashQty && cashQty > 0) {
      addedValue = new Decimal(cashQty)
    } else if (qty && existing) {
      addedValue = qty.mul(existing.marketPrice)
    }
    // If we can't estimate (new symbol + qty-based without existing position), allow — broker will validate

    if (addedValue.isZero()) return null

    const projectedValue = currentValue.plus(addedValue)
    const netLiq = new Decimal(account.netLiquidation)
    const percent = netLiq.gt(0) ? projectedValue.div(netLiq).mul(100) : new Decimal(0)

    if (percent.gt(this.maxPercent)) {
      return `Position for ${symbol} would be ${percent.toFixed(1)}% of equity (limit: ${this.maxPercent}%)`
    }

    return null
  }
}
