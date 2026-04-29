import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import type { UTAConfig, BrokerPreset, AccountInfo, Position, BrokerHealthInfo, UTASnapshotSummary } from '../api/types'
import { useTradingConfig } from '../hooks/useTradingConfig'
import { useAccountHealth } from '../hooks/useAccountHealth'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/StateViews'
import { ReconnectButton } from '../components/ReconnectButton'
import { Toggle } from '../components/Toggle'
import { HealthBadge } from '../components/uta/HealthBadge'
import { EditUTADialog } from '../components/uta/EditUTADialog'
import { OrderEntryDialog, type OrderEntryMode } from '../components/uta/OrderEntryDialog'
import { SnapshotDetail } from '../components/SnapshotDetail'

// ==================== Page ====================

export function UTADetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const tc = useTradingConfig()
  const healthMap = useAccountHealth()
  const [presets, setPresets] = useState<BrokerPreset[]>([])
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [orders, setOrders] = useState<unknown[]>([])
  const [snapshots, setSnapshots] = useState<UTASnapshotSummary[]>([])
  const [selectedSnapshot, setSelectedSnapshot] = useState<UTASnapshotSummary | null>(null)
  const [editing, setEditing] = useState(false)
  const [orderMode, setOrderMode] = useState<OrderEntryMode | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)

  // Preset metadata (stable across renders)
  useEffect(() => {
    api.trading.getBrokerPresets().then(r => setPresets(r.presets)).catch(() => {})
  }, [])

  const uta = useMemo<UTAConfig | undefined>(() => tc.utas.find(u => u.id === id), [tc.utas, id])
  const preset = useMemo<BrokerPreset | undefined>(() => presets.find(p => p.id === uta?.presetId), [presets, uta])
  const health: BrokerHealthInfo | undefined = id ? healthMap[id] : undefined

  // Active polling — account/positions/orders refresh every 15s
  const refreshLive = useCallback(async () => {
    if (!id) return
    setDataError(null)
    try {
      const [acct, pos, ord] = await Promise.all([
        api.trading.utaAccount(id).catch(() => null),
        api.trading.utaPositions(id).catch(() => ({ positions: [] as Position[] })),
        api.trading.utaOrders(id).catch(() => ({ orders: [] as unknown[] })),
      ])
      setAccount(acct)
      setPositions(pos.positions)
      setOrders(ord.orders)
    } catch (err) {
      setDataError(err instanceof Error ? err.message : String(err))
    }
  }, [id])

  // Snapshots refresh more slowly (60s)
  const refreshSnapshots = useCallback(async () => {
    if (!id) return
    try {
      const r = await api.trading.snapshots(id, { limit: 20 })
      setSnapshots(r.snapshots)
    } catch {
      // non-fatal — snapshots are secondary content
    }
  }, [id])

  useEffect(() => {
    refreshLive()
    refreshSnapshots()
    const liveInterval = setInterval(refreshLive, 15_000)
    const snapshotInterval = setInterval(refreshSnapshots, 60_000)
    return () => { clearInterval(liveInterval); clearInterval(snapshotInterval) }
  }, [refreshLive, refreshSnapshots])

  // URL query param `?aliceId=...` (e.g. clicked from
  // TradeableContractsPanel) auto-opens the place-order form prefilled.
  useEffect(() => {
    const queryAlice = searchParams.get('aliceId')
    if (queryAlice && !orderMode) {
      setOrderMode({ kind: 'place', aliceId: queryAlice })
      // Clear the param so back/forward + reopen behave sensibly.
      const next = new URLSearchParams(searchParams)
      next.delete('aliceId')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, orderMode])

  if (tc.loading) return <Shell title="Loading…" />

  if (!id) return <Shell title="UTA not specified" />
  if (!uta) {
    return (
      <Shell title={`UTA ${id} not found`}>
        <EmptyState
          title={`No UTA "${id}"`}
          description="It may have been deleted or never configured. Head back to Trading to create one or pick a different UTA."
        />
        <div className="mt-4">
          <Link to="/trading" className="btn-secondary">← Back to Trading</Link>
        </div>
      </Shell>
    )
  }

  const isDisabled = uta.enabled === false

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <PageHeader
        title={preset?.label ?? uta.id}
        description={
          <>
            <Link to="/trading" className="text-text-muted hover:text-text">← Trading</Link>
            <span className="mx-2 text-text-muted/40">·</span>
            <span className="font-mono text-text-muted">{uta.id}</span>
            <span className="mx-2 text-text-muted/40">·</span>
            <HealthBadge health={health} size="sm" />
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <Toggle
              checked={!isDisabled}
              onChange={async (v) => { await tc.saveUTA({ ...uta, enabled: v }) }}
            />
            <ReconnectButton accountId={uta.id} />
            <button
              onClick={() => setOrderMode({ kind: 'place' })}
              disabled={isDisabled}
              className="px-3 py-1.5 text-[13px] font-medium rounded-md bg-accent text-bg hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              + Place Order
            </button>
            <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-[13px] font-medium rounded-md border border-border hover:bg-bg-tertiary transition-colors">
              Edit
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[960px] mx-auto space-y-5">
          {dataError && (
            <div className="rounded-md border border-red/30 bg-red/5 px-3 py-2 text-[12px] text-red">
              Failed to load live data: {dataError}
            </div>
          )}

          <HeroMetrics account={account} />

          {positions.length > 0 ? (
            <PositionsTable
              positions={positions}
              onCloseClick={(p) => setOrderMode({
                kind: 'close',
                aliceId: p.contract.aliceId ?? p.contract.localSymbol ?? p.contract.symbol ?? '',
                quantity: p.quantity,
                symbol: p.contract.symbol,
              })}
            />
          ) : (
            <EmptyState title="No open positions." />
          )}

          <OrdersSection orders={orders} />

          <SnapshotsSection
            snapshots={snapshots}
            selected={selectedSnapshot}
            onSelect={setSelectedSnapshot}
          />
        </div>
      </div>

      {editing && (
        <EditUTADialog
          uta={uta}
          preset={preset}
          health={health}
          onSave={async (next) => { await tc.saveUTA(next) }}
          onDelete={async () => {
            await tc.deleteUTA(uta.id)
            setEditing(false)
            navigate('/trading')
          }}
          onClose={() => setEditing(false)}
        />
      )}

      {orderMode && (
        <OrderEntryDialog
          utaId={uta.id}
          mode={orderMode}
          onClose={() => setOrderMode(null)}
          // Trigger an immediate refresh so the new order/position
          // shows up without waiting for the 15s polling tick.
          onPushComplete={() => { void refreshLive() }}
        />
      )}
    </div>
  )
}

// ==================== Shell (loading / error states) ====================

function Shell({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={title} description={<Link to="/trading" className="text-text-muted hover:text-text">← Trading</Link>} />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[720px] mx-auto">{children}</div>
      </div>
    </div>
  )
}

// ==================== Hero Metrics ====================

function HeroMetrics({ account }: { account: AccountInfo | null }) {
  if (!account) {
    return (
      <div className="border border-border rounded-lg bg-bg-secondary p-5 text-center">
        <p className="text-[13px] text-text-muted">Loading account info…</p>
      </div>
    )
  }
  const ccy = account.baseCurrency || 'USD'
  return (
    <div className="border border-border rounded-lg bg-bg-secondary p-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric label="Net Liquidation" value={fmt(Number(account.netLiquidation), ccy)} />
        <Metric label="Cash" value={fmt(Number(account.totalCashValue), ccy)} />
        <Metric label="Unrealized P&L" value={fmtPnl(Number(account.unrealizedPnL), ccy)} pnl={Number(account.unrealizedPnL)} />
        <Metric label="Realized P&L" value={fmtPnl(Number(account.realizedPnL ?? '0'), ccy)} pnl={Number(account.realizedPnL ?? '0')} />
      </div>
    </div>
  )
}

function Metric({ label, value, pnl }: { label: string; value: string; pnl?: number }) {
  const color = pnl == null ? 'text-text' : pnl >= 0 ? 'text-green' : 'text-red'
  return (
    <div>
      <p className="text-[11px] text-text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-[22px] md:text-[28px] font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

// ==================== Positions Table ====================

function PositionsTable({ positions, onCloseClick }: {
  positions: Position[]
  onCloseClick: (p: Position) => void
}) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-3">
        Positions ({positions.length})
      </h3>
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-bg-secondary text-text-muted text-left">
              <th className="px-3 py-2 font-medium">Contract</th>
              <th className="px-3 py-2 font-medium text-center">Ccy</th>
              <th className="px-3 py-2 font-medium">Side</th>
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium text-right">Avg Cost</th>
              <th className="px-3 py-2 font-medium text-right">Mark</th>
              <th className="px-3 py-2 font-medium text-right">Mkt Value</th>
              <th className="px-3 py-2 font-medium text-right">PnL</th>
              <th className="px-3 py-2 font-medium text-right">PnL %</th>
              <th className="px-3 py-2 font-medium text-right" />
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => {
              const ccy = p.currency ?? 'USD'
              const cost = Number(p.avgCost) * Number(p.quantity)
              const pnl = Number(p.unrealizedPnL)
              const pct = cost > 0 ? (pnl / cost) * 100 : 0
              const display = p.contract.aliceId ?? p.contract.localSymbol ?? p.contract.symbol ?? '?'
              return (
                <tr key={i} className="border-t border-border hover:bg-bg-tertiary/30 transition-colors">
                  <td className="px-3 py-2">
                    <span className="font-mono text-text">{display}</span>
                  </td>
                  <td className="px-3 py-2 text-center text-text-muted text-[11px]">{ccy}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${p.side === 'long' ? 'bg-green/15 text-green' : 'bg-red/15 text-red'}`}>
                      {p.side}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-text">{fmtNum(Number(p.quantity))}</td>
                  <td className="px-3 py-2 text-right text-text-muted">{fmt(Number(p.avgCost), ccy)}</td>
                  <td className="px-3 py-2 text-right text-text">{fmt(Number(p.marketPrice), ccy)}</td>
                  <td className="px-3 py-2 text-right text-text">{fmt(Number(p.marketValue), ccy)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
                    {fmtPnl(pnl, ccy)}
                  </td>
                  <td className={`px-3 py-2 text-right ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
                    {`${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => onCloseClick(p)}
                      className="text-[11px] text-text-muted hover:text-red transition-colors"
                    >
                      Close
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ==================== Open Orders ====================

interface OpenOrderRow {
  orderId?: number | string
  contract?: { aliceId?: string; symbol?: string; localSymbol?: string }
  order?: { action?: string; orderType?: string; totalQuantity?: string | number; lmtPrice?: string | number }
  orderState?: { status?: string }
}

function OrdersSection({ orders }: { orders: unknown[] }) {
  const rows = orders as OpenOrderRow[]
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-3">
        Open Orders ({rows.length})
      </h3>
      {rows.length === 0 ? (
        <div className="border border-border rounded-lg px-4 py-3 text-[12px] text-text-muted">
          No open orders.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-bg-secondary text-text-muted text-left">
                <th className="px-3 py-2 font-medium">Order ID</th>
                <th className="px-3 py-2 font-medium">Contract</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium text-right">Limit</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-text-muted text-[11px]">{String(o.orderId ?? '—')}</td>
                  <td className="px-3 py-2 font-mono text-text">
                    {o.contract?.aliceId ?? o.contract?.localSymbol ?? o.contract?.symbol ?? '?'}
                  </td>
                  <td className="px-3 py-2 text-text">{o.order?.action ?? '—'}</td>
                  <td className="px-3 py-2 text-text-muted">{o.order?.orderType ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-text">{String(o.order?.totalQuantity ?? '')}</td>
                  <td className="px-3 py-2 text-right text-text-muted">{o.order?.lmtPrice != null ? String(o.order.lmtPrice) : '—'}</td>
                  <td className="px-3 py-2">
                    <span className="text-[11px] text-text-muted">{o.orderState?.status ?? 'Unknown'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ==================== Snapshots ====================

function SnapshotsSection({ snapshots, selected, onSelect }: {
  snapshots: UTASnapshotSummary[]
  selected: UTASnapshotSummary | null
  onSelect: (s: UTASnapshotSummary | null) => void
}) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-3">
        Recent Snapshots ({snapshots.length})
      </h3>

      {selected && (
        <div className="mb-3">
          <SnapshotDetail snapshot={selected} onClose={() => onSelect(null)} />
        </div>
      )}

      {snapshots.length === 0 ? (
        <div className="border border-border rounded-lg px-4 py-3 text-[12px] text-text-muted">
          No snapshots yet. Snapshots are captured periodically (see Portfolio settings) or after each push.
        </div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {snapshots.map(s => (
            <button
              key={s.timestamp}
              onClick={() => onSelect(selected?.timestamp === s.timestamp ? null : s)}
              className={`w-full text-left px-3 py-2 hover:bg-bg-tertiary/30 transition-colors flex items-center justify-between ${selected?.timestamp === s.timestamp ? 'bg-bg-tertiary/40' : ''}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[12px] text-text-muted">{new Date(s.timestamp).toLocaleString()}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted">{s.trigger}</span>
                <span className="text-[11px] text-text-muted/60">{s.positions.length} pos</span>
              </div>
              <span className="text-[12px] tabular-nums text-text">
                {s.account.baseCurrency} {fmtNum(Number(s.account.netLiquidation))}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== Formatting ====================

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', HKD: 'HK$', EUR: '€', GBP: '£', JPY: '¥',
  CNY: '¥', CNH: '¥', CAD: 'C$', AUD: 'A$', CHF: 'CHF ',
  SGD: 'S$', KRW: '₩', INR: '₹', TWD: 'NT$', BRL: 'R$',
}

function currencySymbol(currency?: string): string {
  if (!currency) return '$'
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `
}

function fmt(n: number, currency?: string): string {
  const sym = currencySymbol(currency)
  return n >= 1000
    ? `${sym}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${sym}${n.toFixed(2)}`
}

function fmtPnl(n: number, currency?: string): string {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${fmt(n, currency)}`
}

function fmtNum(n: number): string {
  return n >= 1
    ? n.toLocaleString('en-US', { maximumFractionDigits: 4 })
    : n.toPrecision(4)
}
