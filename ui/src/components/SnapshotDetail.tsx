import type { UTASnapshotSummary } from '../api'
import { fmt, fmtPnl } from '../lib/format'
import { Metric, signFromDelta } from './Metric'
import { Button } from './ui/button'
import { CircleCheck, CircleAlert, CircleMinus, X } from 'lucide-react'

// ==================== Props ====================

interface SnapshotDetailProps {
  snapshot: UTASnapshotSummary
  onClose: () => void
}

// ==================== Component ====================

export function SnapshotDetail({ snapshot, onClose }: SnapshotDetailProps) {
  const a = snapshot.account

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl bg-popover">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SnapshotHealth health={snapshot.health} />
          <span className="text-sm text-foreground font-medium">
            {new Date(snapshot.timestamp).toLocaleString()}
          </span>
          <TriggerBadge trigger={snapshot.trigger} />
          <span className="text-sm text-muted-foreground">{snapshot.accountId}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={onClose}
          aria-label="Close snapshot"
          className="-mr-2 -mt-1 text-muted-foreground"
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>

      {/* Account Summary */}
      <div className="grid grid-cols-2 gap-5 px-4 py-5 sm:px-6 md:grid-cols-4">
        <Metric size="sm" label="Net Liquidation" value={fmt(a.netLiquidation, a.baseCurrency)} />
        <Metric size="sm" label="Cash" value={fmt(a.totalCashValue, a.baseCurrency)} />
        <Metric size="sm" label="Unrealized PnL" value={fmtPnl(a.unrealizedPnL, a.baseCurrency)} valueSign={signFromDelta(Number(a.unrealizedPnL))} />
        <Metric size="sm" label="Realized PnL" value={fmtPnl(a.realizedPnL, a.baseCurrency)} valueSign={signFromDelta(Number(a.realizedPnL))} />
      </div>

      {/* Positions */}
      {snapshot.positions.length > 0 && (
        <div className="px-4 pb-5 sm:px-6">
          <p className="mb-1.5 text-sm font-medium leading-5 text-muted-foreground">
            Positions ({snapshot.positions.length})
          </p>
          <div className="border border-border rounded overflow-x-auto">
            <table className="w-full text-sm tabular-nums [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <thead>
                <tr className="bg-background text-muted-foreground text-left">
                  <th className="px-2.5 py-1.5 font-medium">Symbol</th>
                  <th className="px-2.5 py-1.5 font-medium text-center">Ccy</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">Qty</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">Avg Cost</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">Mkt Price</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">Mkt Value</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">PnL</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.positions.map((p, i) => {
                  const pnl = Number(p.unrealizedPnL)
                  return (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2.5 py-1.5">
                        <span className="font-medium text-foreground">{symbolFromAliceId(p.aliceId)}</span>
                        <span className={`ml-1.5 text-sm px-1 py-0.5 rounded font-medium ${p.side === 'long' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}>
                          {p.side}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 text-center text-sm leading-5 text-muted-foreground tabular-nums">{p.currency}</td>
                      <td className="px-2.5 py-1.5 text-right text-foreground tabular-nums">{p.quantity}</td>
                      <td className="px-2.5 py-1.5 text-right text-muted-foreground tabular-nums">{fmt(p.avgCost, p.currency)}</td>
                      <td className="px-2.5 py-1.5 text-right text-foreground tabular-nums">{fmt(p.marketPrice, p.currency)}</td>
                      <td className="px-2.5 py-1.5 text-right text-foreground tabular-nums">{fmt(p.marketValue, p.currency)}</td>
                      <td className={`px-2.5 py-1.5 text-right font-medium tabular-nums ${pnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {fmtPnl(p.unrealizedPnL, p.currency)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Open Orders */}
      {snapshot.openOrders.length > 0 && (
        <div className="px-4 pb-5 sm:px-6">
          <p className="mb-1.5 text-sm font-medium leading-5 text-muted-foreground">
            Open Orders ({snapshot.openOrders.length})
          </p>
          <div className="space-y-1">
            {snapshot.openOrders.map((o, i) => (
              <div key={i} className="flex items-center gap-2 text-sm leading-5 px-2.5 py-1.5 border border-border rounded bg-background">
                <span className={`font-medium ${o.action === 'BUY' ? 'text-success' : 'text-destructive'}`}>{o.action}</span>
                <span className="text-foreground">{symbolFromAliceId(o.aliceId)}</span>
                <span className="text-muted-foreground">{o.totalQuantity} @ {o.orderType}</span>
                <span className="text-primary text-sm">{o.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {snapshot.positions.length === 0 && snapshot.openOrders.length === 0 && (
        <div className="px-4 pb-5 sm:px-6">
          <p className="text-sm text-muted-foreground">No positions or orders at this time.</p>
        </div>
      )}
    </div>
  )
}

// ==================== Sub-components ====================

function SnapshotHealth({ health }: { health: string }) {
  const Icon = health === 'healthy' ? CircleCheck : health === 'disabled' ? CircleMinus : CircleAlert
  const color = health === 'healthy' ? 'text-success' : health === 'degraded' ? 'text-warning' : health === 'disabled' ? 'text-muted-foreground' : 'text-destructive'
  return <Icon aria-label={health} className={`size-4 shrink-0 ${color}`} />
}

function TriggerBadge({ trigger }: { trigger: string }) {
  const label = trigger === 'post-push' ? 'push'
    : trigger === 'post-reject' ? 'reject'
    : trigger
  return (
    <span className="text-sm px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
      {label}
    </span>
  )
}

function symbolFromAliceId(aliceId: string): string {
  const parts = aliceId.split('|')
  return parts[parts.length - 1]
}
