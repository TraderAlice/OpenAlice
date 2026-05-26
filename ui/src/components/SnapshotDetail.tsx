import { useTranslation } from 'react-i18next'
import { fmt, fmtPnl, fmtDate, fmtTime } from '../lib/i18n-format'
import type { UTASnapshotSummary } from '../api'

// ==================== Props ====================

interface SnapshotDetailProps {
  snapshot: UTASnapshotSummary
  onClose: () => void
}

// ==================== Component ====================

export function SnapshotDetail({ snapshot, onClose }: SnapshotDetailProps) {
  const { t } = useTranslation()
  const a = snapshot.account

  return (
    <div className="border border-accent/30 rounded-lg bg-bg-secondary overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-accent/5 border-b border-border">
        <div className="flex items-center gap-2">
          <HealthDot health={snapshot.health} />
          <span className="text-[13px] text-text font-medium">
            {(() => { const d = new Date(snapshot.timestamp); return `${fmtDate(d)} ${fmtTime(d)}` })()}
          </span>
          <TriggerBadge trigger={snapshot.trigger} />
          <span className="text-[11px] text-text-muted">{snapshot.accountId}</span>
        </div>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text text-[13px] px-1.5 transition-colors"
        >
          &times;
        </button>
      </div>

      {/* Account Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3">
        <MetricItem label={t('utaDetail.netLiquidation')} value={fmtStr(a.netLiquidation)} />
        <MetricItem label={t('common.cash', 'Cash')} value={fmtStr(a.totalCashValue)} />
        <MetricItem label={t('utaDetail.unrealizedPnl', 'Unrealized PnL')} value={fmtPnlStr(a.unrealizedPnL)} pnl={Number(a.unrealizedPnL)} />
        <MetricItem label={t('utaDetail.realizedPnl')} value={fmtPnlStr(a.realizedPnL)} pnl={Number(a.realizedPnL)} />
      </div>

      {/* Positions */}
      {snapshot.positions.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-text-muted uppercase tracking-wide mb-1.5">
            {t('utaDetail.positionsCount', { count: snapshot.positions.length })}
          </p>
          <div className="border border-border rounded overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-bg text-text-muted text-left">
                  <th className="px-2.5 py-1.5 font-medium">{t('simulator.symbol')}</th>
                  <th className="px-2.5 py-1.5 font-medium text-center">Ccy</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">{t('dev.qty')}</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">{t('dev.avgCost')}</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">{t('simulator.mark')}</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">{t('utaDetail.mktValue')}</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">{t('trading.pnl')}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.positions.map((p, i) => {
                  const pnl = Number(p.unrealizedPnL)
                  return (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2.5 py-1.5">
                        <span className="font-medium text-text">{symbolFromAliceId(p.aliceId)}</span>
                        <span className={`ml-1.5 text-[10px] px-1 py-0.5 rounded font-medium ${p.side === 'long' ? 'bg-green/15 text-green' : 'bg-red/15 text-red'}`}>
                          {p.side}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 text-right text-text tabular-nums">{p.quantity}</td>
                      <td className="px-2.5 py-1.5 text-center text-text-muted text-[10px] tabular-nums">{p.currency}</td>
                      <td className="px-2.5 py-1.5 text-right text-text-muted tabular-nums">{fmtStr(p.avgCost, p.currency)}</td>
                      <td className="px-2.5 py-1.5 text-right text-text tabular-nums">{fmtStr(p.marketPrice, p.currency)}</td>
                      <td className="px-2.5 py-1.5 text-right text-text tabular-nums">{fmtStr(p.marketValue, p.currency)}</td>
                      <td className={`px-2.5 py-1.5 text-right font-medium tabular-nums ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
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
          <p className="text-[11px] text-text-muted uppercase tracking-wide mb-1.5">
            {t('utaDetail.openOrdersCount', { count: snapshot.openOrders.length })}
          </p>
          <div className="space-y-1">
            {snapshot.openOrders.map((o, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px] px-2.5 py-1.5 border border-border rounded bg-bg">
                <span className={`font-medium ${o.action === 'BUY' ? 'text-green' : 'text-red'}`}>{o.action}</span>
                <span className="text-text">{symbolFromAliceId(o.aliceId)}</span>
                <span className="text-text-muted">{o.totalQuantity} @ {o.orderType}</span>
                <span className="text-accent text-[10px]">{o.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {snapshot.positions.length === 0 && snapshot.openOrders.length === 0 && (
        <div className="px-4 pb-3">
          <p className="text-[12px] text-text-muted">{t('snapshot.noPositionsOrOrders', 'No positions or orders at this time.')}</p>
        </div>
      )}
    </div>
  )
}

// ==================== Sub-components ====================

function HealthDot({ health }: { health: string }) {
  const color = health === 'healthy' ? 'bg-green'
    : health === 'degraded' ? 'bg-yellow-400'
    : health === 'disabled' ? 'bg-text-muted/40'
    : 'bg-red'
  return <div className={`w-1.5 h-1.5 rounded-full ${color}`} />
}

function TriggerBadge({ trigger }: { trigger: string }) {
  const label = trigger === 'post-push' ? 'push'
    : trigger === 'post-reject' ? 'reject'
    : trigger
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted">
      {label}
    </span>
  )
}

function MetricItem({ label, value, pnl }: { label: string; value: string; pnl?: number }) {
  const color = pnl == null ? 'text-text' : pnl >= 0 ? 'text-green' : 'text-red'
  return (
    <div>
      <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
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
  return fmt(n, currency ?? 'USD')
}

function fmtPnlStr(s: string, currency?: string): string {
  const n = Number(s)
  if (isNaN(n)) return s
  return fmtPnl(n, currency ?? 'USD')
}
