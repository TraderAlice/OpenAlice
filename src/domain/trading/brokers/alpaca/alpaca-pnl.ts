/**
 * Realized PnL calculation via FIFO lot matching.
 */

import type { AlpacaFillActivityRaw } from './alpaca-types.js'

/**
 * FIFO lot matching: track buy lots per symbol, realize PnL on sells.
 * Handles both long-only and short-selling (sell before buy → short lots).
 */
export function computeRealizedPnL(fills: AlpacaFillActivityRaw[]): number {
  // Per-symbol FIFO queue: { qty, price }[]
  // Positive qty = long lot, negative qty = short lot
  const lots = new Map<string, Array<{ qty: number; price: number }>>()
  let totalRealized = 0

  for (const fill of fills) {
    const symbol = fill.symbol
    const price = parseFloat(fill.price)
    const qty = parseFloat(fill.qty)
    const isBuy = fill.side === 'buy'

    if (!lots.has(symbol)) lots.set(symbol, [])
    const queue = lots.get(symbol)!

    // Determine if this fill opens or closes
    // Opening: buy when no short lots (or queue empty), sell when no long lots
    // Closing: buy against short lots, sell against long lots
    let remaining = qty

    while (remaining > 0 && queue.length > 0) {
      const front = queue[0]
      const isClosing = isBuy ? front.qty < 0 : front.qty > 0

      if (!isClosing) break // Same direction → this fill opens new lots

      const matchQty = Math.min(remaining, Math.abs(front.qty))

      if (front.qty > 0) {
        // Closing long: sell at `price`, entry was `front.price`
        totalRealized += matchQty * (price - front.price)
      } else {
        // Closing short: buy at `price`, entry was `front.price`
        totalRealized += matchQty * (front.price - price)
      }

      remaining -= matchQty
      front.qty += isBuy ? matchQty : -matchQty // shrink lot toward 0

      if (Math.abs(front.qty) < 1e-10) queue.shift() // lot fully consumed
    }

    // Remaining qty opens new lots
    if (remaining > 0) {
      queue.push({ qty: isBuy ? remaining : -remaining, price })
    }
  }

  return Math.round(totalRealized * 100) / 100 // round to cents
}
