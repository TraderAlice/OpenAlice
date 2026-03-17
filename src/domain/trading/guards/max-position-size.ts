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
    const currentValue = existing?.marketValue ?? 0

    // Estimate added value from IBKR Order fields
    const { order } = operation
    const cashQty = order.cashQty !== UNSET_DOUBLE ? order.cashQty : undefined
    const qty = !order.totalQuantity.equals(UNSET_DECIMAL) ? order.totalQuantity.toNumber() : undefined

    let addedValue = 0
    if (cashQty && cashQty > 0) {
      addedValue = cashQty
    } else if (qty && existing) {
      addedValue = qty * existing.marketPrice
    }
    // If we can't estimate (new symbol + qty-based without existing position), allow — broker will validate

    if (addedValue === 0) return null

    const projectedValue = currentValue + addedValue
    const percent = account.netLiquidation > 0 ? (projectedValue / account.netLiquidation) * 100 : 0

    if (percent > this.maxPercent) {
      return `Position for ${symbol} would be ${percent.toFixed(1)}% of equity (limit: ${this.maxPercent}%)`
    }

    return null
  }
}
