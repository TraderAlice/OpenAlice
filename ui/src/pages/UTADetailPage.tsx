import { Fragment, useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { ViewSpec } from '../tabs/types'
import { api } from '../api'
import { getIntlLocale } from '../lib/intl'
import type { UTAConfig, BrokerPreset, AccountInfo, Position, BrokerHealthInfo, UTASnapshotSummary, EquityCurvePoint, OrderHistoryEntry, OrderHistoryStatus, TradeHistoryEntry } from '../api/types'
import { useTradingConfig } from '../hooks/useTradingConfig'
import { useAccountHealth } from '../hooks/useAccountHealth'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/StateViews'
import { ReconnectButton } from '../components/ReconnectButton'
import { Toggle } from '../components/Toggle'
import { HealthBadge } from '../components/uta/HealthBadge'
import { EditUTADialog } from '../components/uta/EditUTADialog'
import { OrderEntryDialog, type OrderEntryMode } from '../components/uta/OrderEntryDialog'
import { EquityCurve } from '../components/EquityCurve'
import { Metric, signFromDelta } from '../components/Metric'
import { fmt, fmtPnl, fmtNum, fmtPctSigned, isUnsetDecimal } from '../lib/format'
import { secTypeToClass, assetClassLabel, ASSET_CLASS_ORDER, type AssetClass } from '../lib/asset-class'
import { ContractCell } from '../lib/contract-display'

// ==================== Page ====================

interface UTADetailPageProps {
  spec: Extract<ViewSpec, { kind: 'uta-detail' }>
}

export function UTADetailPage({ spec }: UTADetailPageProps) {
  const id = spec.params.id
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const tc = useTradingConfig()
  const healthMap = useAccountHealth()
  const [presets, setPresets] = useState<BrokerPreset[]>([])
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [orders, setOrders] = useState<unknown[]>([])
  const [snapshots, setSnapshots] = useState<UTASnapshotSummary[]>([])
  const [editing, setEditing] = useState(false)
  const [orderMode, setOrderMode] = useState<OrderEntryMode | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [clock, setClock] = useState<MarketClockState>(null)

  useEffect(() => {
    api.trading.getBrokerPresets().then(r => setPresets(r.presets)).catch(() => {})
  }, [])

  const uta = useMemo<UTAConfig | undefined>(() => tc.utas.find(u => u.id === id), [tc.utas, id])
  const preset = useMemo<BrokerPreset | undefined>(() => presets.find(p => p.id === uta?.presetId), [presets, uta])
  const health: BrokerHealthInfo | undefined = id ? healthMap[id] : undefined

  // Live polling — account/positions/orders refresh every 15s.
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
      setLastUpdated(new Date())
    } catch (err) {
      setDataError(err instanceof Error ? err.message : String(err))
    }
  }, [id])

  // Snapshots refresh more slowly (60s); same data feeds the NAV chart and
  // the 24h-delta anchor — no extra fetches needed.
  const refreshSnapshots = useCallback(async () => {
    if (!id) return
    try {
      const r = await api.trading.snapshots(id, { limit: 50 })
      setSnapshots(r.snapshots)
    } catch {
      // non-fatal
    }
  }, [id])

  useEffect(() => {
    refreshLive()
    refreshSnapshots()
    const liveInterval = setInterval(refreshLive, 15_000)
    const snapshotInterval = setInterval(refreshSnapshots, 60_000)
    return () => { clearInterval(liveInterval); clearInterval(snapshotInterval) }
  }, [refreshLive, refreshSnapshots])

  // Market clock — mount + every 60s. The poll itself re-renders the
  // "opens in Xh Ym" countdown, so no separate ticker is needed.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    const load = () => api.trading.marketClock(id)
      .then(c => { if (!cancelled) setClock(c) })
      .catch(() => { if (!cancelled) setClock('error') })
    load()
    const t = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [id])

  // ?aliceId=... auto-opens the place-order form prefilled (e.g. clicked
  // from TradeableContractsPanel on the market workbench).
  useEffect(() => {
    const queryAlice = searchParams.get('aliceId')
    if (queryAlice && !orderMode) {
      setOrderMode({ kind: 'place', aliceId: queryAlice })
      const next = new URLSearchParams(searchParams)
      next.delete('aliceId')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, orderMode])

  // 24h delta = current NLV − the oldest snapshot still within the trailing
  // 24h window. We label this "today" in the UI even though it's strictly
  // 24h-trailing — matches consumer-trading apps' "Day's Change" wording
  // without entangling market-hours / timezone arithmetic.
  const todayDelta = useMemo(() => {
    if (!account || snapshots.length === 0) return null
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    let baseline: number | null = null
    for (let i = snapshots.length - 1; i >= 0; i--) {
      const t = new Date(snapshots[i].timestamp).getTime()
      if (t >= cutoff) {
        baseline = Number(snapshots[i].account.netLiquidation)
        break
      }
    }
    if (baseline == null || !Number.isFinite(baseline)) return null
    const current = Number(account.netLiquidation)
    if (!Number.isFinite(current)) return null
    const delta = current - baseline
    const pct = baseline === 0 ? 0 : (delta / baseline) * 100
    return { delta, pct, currency: account.baseCurrency }
  }, [account, snapshots])

  // Snapshots → EquityCurvePoint[] for the chart. Sorted ascending so the
  // chart renders left-to-right oldest-to-newest (recharts convention).
  const curvePoints = useMemo<EquityCurvePoint[]>(() => {
    if (!id || snapshots.length === 0) return []
    return [...snapshots]
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(s => ({
        timestamp: s.timestamp,
        equity: s.account.netLiquidation,
        accounts: { [id]: s.account.netLiquidation },
      }))
  }, [snapshots, id])

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
      <PageHeader
        title={preset?.label ?? uta.id}
        live={{ lastUpdated }}
        description={
          <>
            <Link to="/trading" className="text-text-muted hover:text-text">← Trading</Link>
            <span className="mx-2 text-text-muted/40">·</span>
            <span className="font-mono text-text-muted">{uta.id}</span>
            <span className="mx-2 text-text-muted/40">·</span>
            <HealthBadge health={health} size="sm" />
            {clock != null && (
              <>
                <span className="mx-2 text-text-muted/40">·</span>
                <MarketClockChip clock={clock} />
              </>
            )}
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
            <button onClick={() => setEditing(true)} className="btn-secondary-sm">
              Edit
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[1080px] mx-auto space-y-5">
          {dataError && (
            <div className="rounded-md border border-red/30 bg-red/5 px-3 py-2 text-[12px] text-red">
              Failed to load live data: {dataError}
            </div>
          )}

          <Hero account={account} todayDelta={todayDelta} />

          {curvePoints.length >= 2 && (
            <EquityCurve
              points={curvePoints}
              accounts={[{ id, label: preset?.label ?? id }]}
              selectedAccountId={id}
              onAccountChange={() => { /* single-account mode: switcher hidden */ }}
            />
          )}

          <PositionsSection
            positions={positions}
            onCloseClick={(p) => setOrderMode({
              kind: 'close',
              aliceId: p.contract.aliceId ?? p.contract.localSymbol ?? p.contract.symbol ?? '',
              quantity: p.quantity,
              symbol: p.contract.symbol,
            })}
          />

          <OrdersArea utaId={id} openOrders={orders} />
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
          onPushComplete={() => { void refreshLive() }}
        />
      )}
    </div>
  )
}

// ==================== Shell ====================

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

// ==================== Hero ====================

interface TodayDelta { delta: number; pct: number; currency: string }

function Hero({ account, todayDelta }: { account: AccountInfo | null; todayDelta: TodayDelta | null }) {
  if (!account) {
    return (
      <div className="border border-border rounded-lg bg-bg-secondary px-5 py-6">
        <p className="text-[13px] text-text-muted">Loading account info…</p>
      </div>
    )
  }
  const ccy = account.baseCurrency || 'USD'
  const unrealized = Number(account.unrealizedPnL)
  const realized = Number(account.realizedPnL ?? '0')

  return (
    <div className="border border-border rounded-lg bg-bg-secondary px-5 py-5 space-y-4">
      <Metric
        size="lg"
        label="Net Liquidation"
        value={fmt(account.netLiquidation, ccy)}
        delta={todayDelta ? {
          value: `${fmtPnl(todayDelta.delta, ccy)} (${fmtPctSigned(todayDelta.pct)}) today`,
          sign: signFromDelta(todayDelta.delta),
        } : { value: '— today', sign: 'flat' }}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-border">
        <Metric size="sm" label="Cash" value={fmt(account.totalCashValue, ccy)} />
        <Metric
          size="sm"
          label="Unrealized P&L"
          value={fmtPnl(account.unrealizedPnL, ccy)}
          valueSign={signFromDelta(unrealized)}
        />
        <Metric
          size="sm"
          label="Realized P&L"
          value={fmtPnl(account.realizedPnL ?? '0', ccy)}
          valueSign={signFromDelta(realized)}
        />
        <Metric
          size="sm"
          label="Buying Power"
          value={account.buyingPower != null ? fmt(account.buyingPower, ccy) : '—'}
        />
      </div>
    </div>
  )
}

// ==================== Section helper ====================

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

// ==================== Positions (grouped by asset class) ====================

interface PositionGroup { class: AssetClass; positions: Position[] }

function PositionsSection({ positions, onCloseClick }: {
  positions: Position[]
  onCloseClick: (p: Position) => void
}) {
  const groups = useMemo<PositionGroup[]>(() => {
    const buckets = new Map<AssetClass, Position[]>()
    for (const p of positions) {
      const c = secTypeToClass(p.contract.secType)
      if (!buckets.has(c)) buckets.set(c, [])
      buckets.get(c)!.push(p)
    }
    return ASSET_CLASS_ORDER
      .filter(c => buckets.has(c))
      .map(c => ({ class: c, positions: buckets.get(c)! }))
  }, [positions])

  if (positions.length === 0) {
    return (
      <Section title="Positions (0)">
        <div className="border border-border rounded-lg px-4 py-3 text-[12px] text-text-muted">
          No open positions.
        </div>
      </Section>
    )
  }

  const cols = 7  // contract, side, qty, avg→mark, value, pnl, action

  return (
    <Section title={`Positions (${positions.length})`}>
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-bg-secondary text-text-muted text-left">
              <th className="px-3 py-2 font-medium">Contract</th>
              <th className="px-3 py-2 font-medium">Side</th>
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium text-right">Avg → Mark</th>
              <th className="px-3 py-2 font-medium text-right">Mkt Value</th>
              <th className="px-3 py-2 font-medium text-right">PnL</th>
              <th className="px-3 py-2 font-medium text-right" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const sumValue = g.positions.reduce((s, p) => s + Number(p.marketValue), 0)
              const sumPnl = g.positions.reduce((s, p) => s + Number(p.unrealizedPnL), 0)
              const currencies = new Set(g.positions.map(p => p.currency))
              const groupCcy = currencies.size === 1 ? [...currencies][0] : undefined

              return (
                <Fragment key={g.class}>
                  <tr className="bg-bg-tertiary/40 border-t border-border">
                    <td colSpan={cols} className="px-3 py-1.5">
                      <div className="flex items-center justify-between text-[12px]">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-text">{assetClassLabel(g.class)}</span>
                          <span className="text-text-muted/60">·</span>
                          <span className="text-text-muted">{g.positions.length} position{g.positions.length > 1 ? 's' : ''}</span>
                          {!groupCcy && (
                            <span className="text-text-muted/60 text-[11px]">mixed ccy</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 tabular-nums">
                          <span className="text-text">{groupCcy ? fmt(sumValue, groupCcy) : `$${sumValue.toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
                          <span className={sumPnl >= 0 ? 'text-green' : 'text-red'}>
                            {groupCcy ? fmtPnl(sumPnl, groupCcy) : `${sumPnl >= 0 ? '+' : ''}${sumPnl.toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </span>
                        </div>
                      </div>
                    </td>
                  </tr>
                  {g.positions.map((p, i) => (
                    <PositionRow key={`${g.class}-${i}`} position={p} onClose={() => onCloseClick(p)} />
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function PositionRow({ position: p, onClose }: { position: Position; onClose: () => void }) {
  const ccy = p.currency ?? 'USD'
  const cost = Number(p.avgCost) * Number(p.quantity)
  const pnl = Number(p.unrealizedPnL)
  const pct = cost > 0 ? (pnl / cost) * 100 : 0

  return (
    <tr className="border-t border-border hover:bg-bg-tertiary/30 transition-colors">
      <td className="px-3 py-2">
        <ContractCell contract={p.contract} />
      </td>
      <td className="px-3 py-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${p.side === 'long' ? 'bg-green/15 text-green' : 'bg-red/15 text-red'}`}>
          {p.side}
        </span>
      </td>
      <td className="px-3 py-2 text-right text-text tabular-nums">{fmtNum(p.quantity)}</td>
      <td className="px-3 py-2 text-right text-text-muted tabular-nums">
        {fmt(p.avgCost, ccy)} <span className="text-text-muted/40">→</span> <span className="text-text">{fmt(p.marketPrice, ccy)}</span>
      </td>
      <td className="px-3 py-2 text-right text-text tabular-nums">{fmt(p.marketValue, ccy)}</td>
      <td className={`px-3 py-2 text-right font-medium tabular-nums ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
        <div>{fmtPnl(pnl, ccy)}</div>
        <div className="text-[11px] font-normal opacity-80">{fmtPctSigned(pct)}</div>
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={onClose}
          className="text-[11px] text-text-muted hover:text-red transition-colors"
        >
          Close
        </button>
      </td>
    </tr>
  )
}

// ==================== Market clock chip ====================

type MarketClockState = { isOpen: boolean; nextOpen?: string; nextClose?: string } | 'error' | null

function MarketClockChip({ clock }: { clock: NonNullable<MarketClockState> }) {
  let dotClass = 'bg-green'
  let label = '24/7'

  if (clock !== 'error') {
    if (clock.isOpen) {
      const closes = clock.nextClose ? new Date(clock.nextClose) : null
      if (closes && !Number.isNaN(closes.getTime())) {
        const at = closes.toLocaleTimeString(getIntlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })
        label = `Market Open · closes ${at}`
      } else if (!clock.nextOpen && !clock.nextClose) {
        label = '24/7'  // crypto venues report open with no schedule
      } else {
        label = 'Market Open'
      }
    } else {
      dotClass = 'bg-text-muted/50'
      const opens = clock.nextOpen ? new Date(clock.nextOpen) : null
      if (opens && !Number.isNaN(opens.getTime())) {
        const mins = Math.max(0, Math.round((opens.getTime() - Date.now()) / 60_000))
        const h = Math.floor(mins / 60)
        const m = mins % 60
        label = `Market Closed · opens in ${h > 0 ? `${h}h ` : ''}${m}m`
      } else {
        label = 'Market Closed'
      }
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text-muted">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} aria-hidden />
      {label}
    </span>
  )
}

// ==================== Orders — tabbed: Open / History / Trades ====================

interface OpenOrderRow {
  orderId?: number | string
  contract?: { aliceId?: string; symbol?: string; localSymbol?: string }
  order?: { action?: string; orderType?: string; totalQuantity?: string | number; lmtPrice?: string | number }
  orderState?: { status?: string }
}

type OrdersTab = 'open' | 'history' | 'trades'

function OrdersArea({ utaId, openOrders }: { utaId: string; openOrders: unknown[] }) {
  const [tab, setTab] = useState<OrdersTab>('open')
  const [history, setHistory] = useState<OrderHistoryEntry[] | null>(null)
  const [trades, setTrades] = useState<TradeHistoryEntry[] | null>(null)

  // Lazy-fetch per tab on first open; refresh on the same 15s cadence as the
  // live poll while the tab stays active.
  useEffect(() => {
    if (tab !== 'history') return
    let cancelled = false
    const load = () => api.trading.orderHistory(utaId, 50)
      .then(r => { if (!cancelled) setHistory(r.orders) })
      .catch(() => {})
    load()
    const t = setInterval(load, 15_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [tab, utaId])

  useEffect(() => {
    if (tab !== 'trades') return
    let cancelled = false
    const load = () => api.trading.tradeHistory(utaId, 50)
      .then(r => { if (!cancelled) setTrades(r.trades) })
      .catch(() => {})
    load()
    const t = setInterval(load, 15_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [tab, utaId])

  const tabs: Array<{ id: OrdersTab; label: string }> = [
    { id: 'open', label: `Open (${openOrders.length})` },
    { id: 'history', label: 'History' },
    { id: 'trades', label: 'Trades' },
  ]

  return (
    <Section
      title="Orders"
      action={
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                tab === t.id
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-text-muted hover:text-text hover:bg-bg-tertiary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'open' && <OpenOrdersTable orders={openOrders} />}
      {tab === 'history' && <OrderHistoryTable orders={history} />}
      {tab === 'trades' && <TradeHistoryTable trades={trades} />}
    </Section>
  )
}

function OpenOrdersTable({ orders }: { orders: unknown[] }) {
  const rows = orders as OpenOrderRow[]
  if (rows.length === 0) {
    return (
      <div className="border border-border rounded-lg px-4 py-3 text-[12px] text-text-muted">
        No open orders.
      </div>
    )
  }
  return (
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
              <td className={`px-3 py-2 font-medium ${o.order?.action === 'BUY' ? 'text-green' : o.order?.action === 'SELL' ? 'text-red' : 'text-text'}`}>{o.order?.action ?? '—'}</td>
              <td className="px-3 py-2 text-text-muted">{o.order?.orderType ?? '—'}</td>
              <td className="px-3 py-2 text-right text-text tabular-nums">{String(o.order?.totalQuantity ?? '')}</td>
              <td className="px-3 py-2 text-right text-text-muted tabular-nums">{o.order?.lmtPrice != null && !isUnsetDecimal(o.order.lmtPrice) ? String(o.order.lmtPrice) : '—'}</td>
              <td className="px-3 py-2">
                <span className="text-[11px] text-text-muted">{o.orderState?.status ?? 'Unknown'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ==================== Order History tab ====================

const ORDER_STATUS_STYLES: Record<OrderHistoryStatus, string> = {
  filled: 'bg-green/15 text-green',
  cancelled: 'bg-bg-tertiary text-text-muted',
  rejected: 'bg-red/15 text-red',
  'user-rejected': 'bg-red/15 text-red',
  submitted: 'bg-accent/15 text-accent',
}

function OrderStatusBadge({ status }: { status: OrderHistoryStatus }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ORDER_STATUS_STYLES[status] ?? 'bg-bg-tertiary text-text-muted'}`}>
      {status}
    </span>
  )
}

function SideBadge({ side }: { side: 'BUY' | 'SELL' }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${side === 'BUY' ? 'bg-green/15 text-green' : 'bg-red/15 text-red'}`}>
      {side}
    </span>
  )
}

function SourceChip({ label }: { label: string }) {
  return (
    <span className="text-[10px] px-1.5 rounded bg-bg-tertiary text-text-muted">
      {label}
    </span>
  )
}

function OrderHistoryTable({ orders }: { orders: OrderHistoryEntry[] | null }) {
  const [expanded, setExpanded] = useState<number | null>(null)

  if (orders == null) {
    return (
      <div className="border border-border rounded-lg px-4 py-3 text-[12px] text-text-muted">
        Loading order history…
      </div>
    )
  }
  if (orders.length === 0) {
    return (
      <div className="border border-border rounded-lg px-4 py-3 text-[12px] text-text-muted">
        No order history yet.
      </div>
    )
  }
  return (
    <div className="border border-border rounded-lg overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-bg-secondary text-text-muted text-left">
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Contract</th>
            <th className="px-3 py-2 font-medium">Side</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium text-right">Qty</th>
            <th className="px-3 py-2 font-medium text-right">Limit</th>
            <th className="px-3 py-2 font-medium text-right">Fill</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o, i) => (
            <Fragment key={`${o.commitHash}-${i}`}>
              <tr
                className="border-t border-border hover:bg-bg-tertiary/30 transition-colors cursor-pointer"
                onClick={() => setExpanded(prev => prev === i ? null : i)}
              >
                <td className="px-3 py-2 text-text-muted tabular-nums whitespace-nowrap">{formatHistoryTime(o.timestamp)}</td>
                <td className="px-3 py-2"><ContractCell contract={o.contract} /></td>
                <td className="px-3 py-2"><SideBadge side={o.side} /></td>
                <td className="px-3 py-2 text-text-muted">{o.orderType ?? '—'}</td>
                <td className="px-3 py-2 text-right text-text tabular-nums">{o.quantity != null ? fmtNum(o.quantity) : '—'}</td>
                <td className="px-3 py-2 text-right text-text-muted tabular-nums">{o.limitPrice ?? '—'}</td>
                <td className="px-3 py-2 text-right text-text tabular-nums">
                  {o.avgFillPrice ? `${o.avgFillPrice}${o.filledQty ? ` × ${o.filledQty}` : ''}` : '—'}
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <OrderStatusBadge status={o.status} />
                    {o.source === 'external' && <SourceChip label="External" />}
                  </span>
                </td>
              </tr>
              {expanded === i && (
                <tr className="border-t border-border bg-bg-tertiary/20">
                  <td colSpan={8} className="px-3 py-2 text-[11px] text-text-muted">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="font-mono">{o.commitHash}</span>
                      <span>{o.message}</span>
                      {o.error && <span className="text-red">{o.error}</span>}
                      {o.resolvedAt && <span>resolved {formatHistoryTime(o.resolvedAt)}</span>}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ==================== Trade History tab ====================

function TradeHistoryTable({ trades }: { trades: TradeHistoryEntry[] | null }) {
  if (trades == null) {
    return (
      <div className="border border-border rounded-lg px-4 py-3 text-[12px] text-text-muted">
        Loading trade history…
      </div>
    )
  }
  if (trades.length === 0) {
    return (
      <div className="border border-border rounded-lg px-4 py-3 text-[12px] text-text-muted">
        No trades yet.
      </div>
    )
  }
  return (
    <div className="border border-border rounded-lg overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-bg-secondary text-text-muted text-left">
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Contract</th>
            <th className="px-3 py-2 font-medium">Side</th>
            <th className="px-3 py-2 font-medium text-right">Qty</th>
            <th className="px-3 py-2 font-medium text-right">Price</th>
            <th className="px-3 py-2 font-medium text-right">Value</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={`${t.commitHash}-${i}`} className="border-t border-border hover:bg-bg-tertiary/30 transition-colors">
              <td className="px-3 py-2 text-text-muted tabular-nums whitespace-nowrap">{formatHistoryTime(t.timestamp)}</td>
              <td className="px-3 py-2"><ContractCell contract={t.contract} /></td>
              <td className="px-3 py-2"><SideBadge side={t.side} /></td>
              <td className="px-3 py-2 text-right text-text tabular-nums">{fmtNum(t.quantity)}</td>
              <td className="px-3 py-2 text-right text-text tabular-nums">{t.price}</td>
              <td className="px-3 py-2 text-right text-text tabular-nums">{fmt(t.value, t.contract.currency)}</td>
              <td className="px-3 py-2 text-right">
                {t.source !== 'order' && (
                  <SourceChip label={t.source === 'external' ? 'External' : 'Reconcile'} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ==================== Date helpers ====================

/** "14:32" for today; "Jun 11 14:32" otherwise. */
function formatHistoryTime(timestamp: string): string {
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return timestamp
  const time = d.toLocaleTimeString(getIntlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })
  if (d.toDateString() === new Date().toDateString()) return time
  return `${d.toLocaleDateString(getIntlLocale(), { month: 'short', day: 'numeric' })} ${time}`
}
