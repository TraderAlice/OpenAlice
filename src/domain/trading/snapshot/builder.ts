/**
 * Snapshot builder — assembles a UTASnapshot from a live UTA.
 *
 * Only returns a snapshot when real data is successfully fetched.
 * Returns null when data cannot be obtained (offline, disabled, network error).
 * Never fabricates zero-value placeholders.
 */

import type { UnifiedTradingAccount } from '../UnifiedTradingAccount.js'
import type { UTASnapshot, SnapshotTrigger } from './types.js'

export async function buildSnapshot(
  uta: UnifiedTradingAccount,
  trigger: SnapshotTrigger,
): Promise<UTASnapshot | null> {
  // Can't get real data from offline/disabled accounts
  if (uta.disabled || uta.health === 'offline') return null

  try {
    const pendingOrderIds = uta.git.getPendingOrderIds().map(p => p.orderId)
    const [accountInfo, positions, orders] = await Promise.all([
      uta.getAccount(),
      uta.getPositions(),
      uta.getOrders(pendingOrderIds),
    ])

    const gitStatus = uta.git.status()

    return {
      accountId: uta.id,
      timestamp: new Date().toISOString(),
      trigger,
      account: {
        baseCurrency: accountInfo.baseCurrency,
        netLiquidation: accountInfo.netLiquidation,
        totalCashValue: accountInfo.totalCashValue,
        unrealizedPnL: accountInfo.unrealizedPnL,
        realizedPnL: accountInfo.realizedPnL ?? '0',
        buyingPower: accountInfo.buyingPower,
        initMarginReq: accountInfo.initMarginReq,
        maintMarginReq: accountInfo.maintMarginReq,
      },
      positions: positions.map(p => ({
        aliceId: p.contract.aliceId ?? uta.broker.getNativeKey(p.contract),
        currency: p.currency,
        side: p.side,
        quantity: p.quantity.toString(),
        avgCost: p.avgCost,
        marketPrice: p.marketPrice,
        marketValue: p.marketValue,
        unrealizedPnL: p.unrealizedPnL,
        realizedPnL: p.realizedPnL,
      })),
      openOrders: orders
        .filter(o => o.orderState.status === 'Submitted' || o.orderState.status === 'PreSubmitted')
        .map(o => ({
          orderId: String(o.order.orderId),
          aliceId: o.contract.aliceId ?? uta.broker.getNativeKey(o.contract),
          action: o.order.action,
          orderType: o.order.orderType,
          totalQuantity: o.order.totalQuantity.toString(),
          limitPrice: o.order.lmtPrice != null ? String(o.order.lmtPrice) : undefined,
          status: o.orderState.status,
          avgFillPrice: o.avgFillPrice != null ? String(o.avgFillPrice) : undefined,
        })),
      health: uta.disabled ? 'disabled' : uta.health,
      headCommit: gitStatus.head,
      pendingCommits: gitStatus.pendingHash ? [gitStatus.pendingHash] : [],
    }
  } catch (err) {
    console.warn(`snapshot: build failed for ${uta.id}:`, err instanceof Error ? err.message : err)
    return null
  }
}
