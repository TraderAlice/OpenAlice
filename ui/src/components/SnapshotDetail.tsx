import type { UTASnapshotSummary } from '../api'
import { getIntlLocale } from '../lib/intl'

// ==================== Props ====================

interface SnapshotDetailProps {
  snapshot: UTASnapshotSummary
  onClose: () => void
}

// ==================== Component ====================

export function SnapshotDetail({ snapshot, onClose }: SnapshotDetailProps) {
  const a = snapshot.account

  return (
    <div className="border border-primary/30 rounded-lg bg-secondary overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-primary/5 border-b border-border">
        <div className="flex items-center gap-2">
          <HealthDot health={snapshot.health} />
          <span className="text-[13px] text-foreground font-medium">
            {new Date(snapshot.timestamp).toLocaleString()}
          </span>
          <TriggerBadge trigger={snapshot.trigger} />
          <span className="text-[11px] text-muted-foreground">{snapshot.accountId}</span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-[13px] px-1.5 transition-colors"
        >
          &times;
        </button>
      </div>

      {/* Account Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3">
        <MetricItem label="Net Liquidation" value={fmtStr(a.netLiquidation)} />
        <MetricItem label="Cash" value={fmtStr(a.totalCashValue)} />
        <MetricItem label="Unrealized PnL" value={fmtPnlStr(a.unrealizedPnL)} pnl={Number(a.unrealizedPnL)} />
        <MetricItem label="Realized PnL" value={fmtPnlStr(a.realizedPnL)} pnl={Number(a.realizedPnL)} />
      </div>

      {/* Positions */}
      {snapshot.positions.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1.5">
            Positions ({snapshot.positions.length})
          </p>
          <div className="border border-border rounded overflow-x-auto">
            <table className="w-full text-[12px]">
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
                        <span className={`ml-1.5 text-[10px] px-1 py-0.5 rounded font-medium ${p.side === 'long' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}>
                          {p.side}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 text-right text-foreground tabular-nums">{p.quantity}</td>
                      <td className="px-2.5 py-1.5 text-center text-muted-foreground text-[10px] tabular-nums">{p.currency}</td>
                      <td className="px-2.5 py-1.5 text-right text-muted-foreground tabular-nums">{fmtStr(p.avgCost, p.currency)}</td>
                      <td className="px-2.5 py-1.5 text-right text-foreground tabular-nums">{fmtStr(p.marketPrice, p.currency)}</td>
                      <td className="px-2.5 py-1.5 text-right text-foreground tabular-nums">{fmtStr(p.marketValue, p.currency)}</td>
                      <td className={`px-2.5 py-1.5 text-right font-medium tabular-nums ${pnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {fmtPnlStr(p.unrealizedPnL, p.currency)}
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
        <div className="px-4 pb-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1.5">
            Open Orders ({snapshot.openOrders.length})
          </p>
          <div className="space-y-1">
            {snapshot.openOrders.map((o, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px] px-2.5 py-1.5 border border-border rounded bg-background">
                <span className={`font-medium ${o.action === 'BUY' ? 'text-success' : 'text-destructive'}`}>{o.action}</span>
                <span className="text-foreground">{symbolFromAliceId(o.aliceId)}</span>
                <span className="text-muted-foreground">{o.totalQuantity} @ {o.orderType}</span>
                <span className="text-primary text-[10px]">{o.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {snapshot.positions.length === 0 && snapshot.openOrders.length === 0 && (
        <div className="px-4 pb-3">
          <p className="text-[12px] text-muted-foreground">No positions or orders at this time.</p>
        </div>
      )}
    </div>
  )
}

// ==================== Sub-components ====================

function HealthDot({ health }: { health: string }) {
  const color = health === 'healthy' ? 'bg-success'
    : health === 'degraded' ? 'bg-warning'
    : health === 'disabled' ? 'bg-muted-foreground/40'
    : 'bg-destructive'
  return <div className={`w-1.5 h-1.5 rounded-full ${color}`} />
}

function TriggerBadge({ trigger }: { trigger: string }) {
  const label = trigger === 'post-push' ? 'push'
    : trigger === 'post-reject' ? 'reject'
    : trigger
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
      {label}
    </span>
  )
}

function MetricItem({ label, value, pnl }: { label: string; value: string; pnl?: number }) {
  const color = pnl == null ? 'text-foreground' : pnl >= 0 ? 'text-success' : 'text-destructive'
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-[16px] font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

// ==================== Helpers ====================

/** Extract symbol from aliceId like "mock-paper|AAPL" → "AAPL" */
function symbolFromAliceId(aliceId: string): string {
  const parts = aliceId.split('|')
  return parts[parts.length - 1]
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', HKD: 'HK$', EUR: '€', GBP: '£', JPY: '¥',
  CNY: '¥', CNH: '¥', CAD: 'C$', AUD: 'A$', CHF: 'CHF ',
  SGD: 'S$', KRW: '₩', INR: '₹', TWD: 'NT$', BRL: 'R$',
}

function currencySymbol(currency?: string): string {
  if (!currency) return '$'
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `
}

function fmtStr(s: string, currency?: string): string {
  const n = Number(s)
  if (isNaN(n)) return s
  const sym = currencySymbol(currency)
  return `${sym}${n.toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPnlStr(s: string, currency?: string): string {
  const n = Number(s)
  if (isNaN(n)) return s
  const sym = currencySymbol(currency)
  const sign = n >= 0 ? '+' : ''
  return `${sign}${sym}${n.toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
