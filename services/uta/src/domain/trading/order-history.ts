/**
 * Order/Trade history — the exchange-frontend projection of the git log.
 *
 * Same join discipline as cost-basis.ts: orders are introduced by
 * placeOrder / observeExternalOrder / closePosition operations and
 * resolved by either their own push result (immediate fills/rejects),
 * a cancelOrder result, or a later syncOrders result carrying the same
 * orderId. One row per order, lifecycle collapsed.
 *
 * Domain-level on purpose (route-thinness rule): the UI route, MCP tools
 * and the CLI all read the same translation.
 */

import Decimal from 'decimal.js'
import { Contract, Order, UNSET_DECIMAL, UNSET_DOUBLE } from '@traderalice/ibkr'
import type {
  GitCommit,
  HistoryContract,
  OrderHistoryEntry,
  OrderHistoryStatus,
  TradeHistoryEntry,
} from '@traderalice/uta-protocol'

function toHistoryContract(contract: Contract | undefined): HistoryContract {
  if (!contract) return {}
  const strike = contract.strike != null && contract.strike !== UNSET_DOUBLE && contract.strike > 0
    ? String(contract.strike)
    : undefined
  const right = contract.right === 'C' || contract.right === 'CALL' ? 'C'
    : contract.right === 'P' || contract.right === 'PUT' ? 'P'
    : undefined
  return {
    ...(contract.aliceId && { aliceId: contract.aliceId }),
    ...(contract.symbol && { symbol: contract.symbol }),
    ...(contract.localSymbol && { localSymbol: contract.localSymbol }),
    ...(contract.secType && { secType: contract.secType }),
    ...(contract.currency && { currency: contract.currency }),
    ...(contract.exchange && { exchange: contract.exchange }),
    ...(contract.lastTradeDateOrContractMonth && { expiry: contract.lastTradeDateOrContractMonth }),
    ...(strike && { strike }),
    ...(right && { right }),
    ...(contract.multiplier && { multiplier: String(contract.multiplier) }),
  }
}

function decStr(value: Decimal | undefined | null): string | undefined {
  if (value == null) return undefined
  const d = value instanceof Decimal ? value : new Decimal(String(value))
  if (d.equals(UNSET_DECIMAL)) return undefined
  return d.toFixed()
}

function orderFields(order: Order | undefined): {
  side: 'BUY' | 'SELL'
  orderType?: string
  quantity?: string
  limitPrice?: string
  stopPrice?: string
} {
  const side = (order?.action ?? 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY'
  return {
    side,
    ...(order?.orderType && { orderType: order.orderType }),
    ...(decStr(order?.totalQuantity) && { quantity: decStr(order?.totalQuantity) }),
    ...(decStr(order?.lmtPrice) && { limitPrice: decStr(order?.lmtPrice) }),
    ...(decStr(order?.auxPrice) && { stopPrice: decStr(order?.auxPrice) }),
  }
}

/** Project the commit log into one-row-per-order history, newest first. */
export function projectOrderHistory(commits: GitCommit[], opts: { limit?: number } = {}): OrderHistoryEntry[] {
  const byOrderId = new Map<string, OrderHistoryEntry>()
  const anonymous: OrderHistoryEntry[] = [] // rejected-before-submit rows have no orderId

  for (const commit of commits) {
    for (let i = 0; i < commit.operations.length; i++) {
      const op = commit.operations[i]
      const result = commit.results[i]

      if (op.action === 'placeOrder' || op.action === 'observeExternalOrder' || op.action === 'closePosition') {
        const entry: OrderHistoryEntry = {
          ...(result?.orderId && { orderId: result.orderId }),
          timestamp: commit.timestamp,
          contract: toHistoryContract(op.contract),
          ...(op.action === 'closePosition'
            ? { side: 'SELL' as const, orderType: 'MKT', ...(op.quantity != null && { quantity: String(op.quantity) }) }
            : orderFields(op.order)),
          status: (result?.status ?? 'rejected') as OrderHistoryStatus,
          ...(result?.filledQty && { filledQty: result.filledQty }),
          ...(result?.filledPrice && { avgFillPrice: result.filledPrice }),
          source: op.action === 'observeExternalOrder' ? 'external' : 'alice',
          commitHash: commit.hash,
          message: commit.message,
          ...(result?.error && { error: result.error }),
        }
        if (result?.orderId) byOrderId.set(result.orderId, entry)
        else anonymous.push(entry)
        continue
      }

      // cancelOrder: resolve the referenced order; a cancel of an unknown
      // order still deserves a row? No — without the originating op there's
      // no contract/side context; the commit log keeps the raw record.
      if (op.action === 'cancelOrder' && result?.success) {
        const target = byOrderId.get(op.orderId)
        if (target) {
          target.status = 'cancelled'
          target.resolvedAt = commit.timestamp
        }
        continue
      }
    }

    // Sync commits: one op, one result PER ORDER — resolve terminal states.
    if (commit.operations.some((op) => op.action === 'syncOrders')) {
      for (const result of commit.results) {
        if (!result.orderId || !result.success) continue
        const target = byOrderId.get(result.orderId)
        if (!target) continue
        target.status = result.status as OrderHistoryStatus
        target.resolvedAt = commit.timestamp
        if (result.filledQty) target.filledQty = result.filledQty
        if (result.filledPrice) target.avgFillPrice = result.filledPrice
      }
    }
  }

  const all = [...byOrderId.values(), ...anonymous]
  all.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  return opts.limit ? all.slice(0, opts.limit) : all
}

/** Project fills only (real executions + reconcile foldings), newest first. */
export function projectTradeHistory(commits: GitCommit[], opts: { limit?: number } = {}): TradeHistoryEntry[] {
  // First pass: orderId → originating op (contract + side), cost-basis style.
  const orderMeta = new Map<string, { contract: HistoryContract; side: 'BUY' | 'SELL'; multiplier: string }>()
  for (const commit of commits) {
    for (let i = 0; i < commit.operations.length; i++) {
      const op = commit.operations[i]
      const result = commit.results[i]
      if (!result?.orderId) continue
      if (op.action === 'placeOrder' || op.action === 'observeExternalOrder') {
        orderMeta.set(result.orderId, {
          contract: toHistoryContract(op.contract),
          side: orderFields(op.order).side,
          multiplier: op.contract?.multiplier ? String(op.contract.multiplier) : '1',
        })
      } else if (op.action === 'closePosition') {
        orderMeta.set(result.orderId, {
          contract: toHistoryContract(op.contract),
          side: 'SELL',
          multiplier: op.contract?.multiplier ? String(op.contract.multiplier) : '1',
        })
      }
    }
  }

  const trades: TradeHistoryEntry[] = []
  const counted = new Set<string>() // orderId fills already recorded (origin vs sync)

  const push = (params: {
    timestamp: string
    orderId?: string
    contract: HistoryContract
    side: 'BUY' | 'SELL'
    qty: string
    price: string
    multiplier?: string
    source: TradeHistoryEntry['source']
    commitHash: string
  }): void => {
    const value = new Decimal(params.qty).mul(params.price).mul(params.multiplier || '1')
    trades.push({
      timestamp: params.timestamp,
      ...(params.orderId && { orderId: params.orderId }),
      contract: params.contract,
      side: params.side,
      quantity: params.qty,
      price: params.price,
      value: value.toFixed(),
      source: params.source,
      commitHash: params.commitHash,
    })
  }

  for (const commit of commits) {
    const isSync = commit.operations.some((op) => op.action === 'syncOrders')
    if (isSync) {
      for (const result of commit.results) {
        if (!result.orderId || result.status !== 'filled') continue
        if (!result.filledQty || !result.filledPrice || counted.has(result.orderId)) continue
        const meta = orderMeta.get(result.orderId)
        if (!meta) continue
        push({
          timestamp: commit.timestamp,
          orderId: result.orderId,
          contract: meta.contract,
          side: meta.side,
          qty: result.filledQty,
          price: result.filledPrice,
          multiplier: meta.multiplier,
          source: commitSourceIsExternal(commits, result.orderId) ? 'external' : 'order',
          commitHash: commit.hash,
        })
        counted.add(result.orderId)
      }
      continue
    }

    for (let i = 0; i < commit.operations.length; i++) {
      const op = commit.operations[i]
      const result = commit.results[i]
      if (!result?.success) continue

      if (op.action === 'reconcileBalance') {
        if (!result.filledQty || !result.filledPrice) continue
        const delta = new Decimal(op.quantityDelta)
        push({
          timestamp: commit.timestamp,
          contract: { aliceId: op.aliceId },
          side: delta.gte(0) ? 'BUY' : 'SELL',
          qty: result.filledQty,
          price: result.filledPrice,
          source: 'reconcile',
          commitHash: commit.hash,
        })
        continue
      }

      if (op.action === 'placeOrder' || op.action === 'closePosition' || op.action === 'observeExternalOrder') {
        if (result.status !== 'filled' || !result.filledQty || !result.filledPrice) continue
        if (result.orderId && counted.has(result.orderId)) continue
        push({
          timestamp: commit.timestamp,
          ...(result.orderId && { orderId: result.orderId }),
          contract: toHistoryContract(op.contract),
          side: op.action === 'closePosition' ? 'SELL' : orderFields(op.action === 'placeOrder' || op.action === 'observeExternalOrder' ? op.order : undefined).side,
          qty: result.filledQty,
          price: result.filledPrice,
          multiplier: op.contract?.multiplier ? String(op.contract.multiplier) : '1',
          source: op.action === 'observeExternalOrder' ? 'external' : 'order',
          commitHash: commit.hash,
        })
        if (result.orderId) counted.add(result.orderId)
      }
    }
  }

  trades.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  return opts.limit ? trades.slice(0, opts.limit) : trades
}

/** Whether an orderId originated from an observeExternalOrder operation. */
function commitSourceIsExternal(commits: GitCommit[], orderId: string): boolean {
  for (const commit of commits) {
    for (let i = 0; i < commit.operations.length; i++) {
      if (commit.results[i]?.orderId === orderId) {
        return commit.operations[i].action === 'observeExternalOrder'
      }
    }
  }
  return false
}
