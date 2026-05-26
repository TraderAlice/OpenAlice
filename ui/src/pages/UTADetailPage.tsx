import { Fragment, useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ViewSpec } from '../tabs/types'
import { api } from '../api'
import type { UTAConfig, BrokerPreset, AccountInfo, Position, BrokerHealthInfo, UTASnapshotSummary, EquityCurvePoint } from '../api/types'
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
import { EquityCurve } from '../components/EquityCurve'
import { Metric, signFromDelta } from '../components/Metric'
import { fmt, fmtPnl, fmtNum, fmtPctSigned, fmtDateShort, fmtTime, isUnsetDecimal } from '../lib/i18n-format'
import { secTypeToClass, assetClassLabel, ASSET_CLASS_ORDER, type AssetClass } from '../lib/asset-class'
import i18n from '../i18n'

// ==================== Page ====================

interface UTADetailPageProps {
  spec: Extract<ViewSpec, { kind: 'uta-detail' }>
}

export function UTADetailPage({ spec }: UTADetailPageProps) {
  const { t } = useTranslation()
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
  const [expandedSnapshot, setExpandedSnapshot] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

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

  if (tc.loading) return <Shell title={t('common.loading')} />
  if (!id) return <Shell title={t('utaDetail.utaNotSpecified', 'UTA not specified')} />
  if (!uta) {
    return (
      <Shell title={t('utaDetail.utaNotFound', 'UTA {{id}} not found', { id })}>
        <EmptyState
          title={t('utaDetail.noUta', 'No UTA "{{id}}"', { id })}
          description={t('utaDetail.noUtaDescription', 'It may have been deleted or never configured. Head back to Trading to create one or pick a different UTA.')}
        />
        <div className="mt-4">
          <Link to="/trading" className="btn-secondary">{t('utaDetail.backToTrading', '← Back to Trading')}</Link>
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
            <Link to="/trading" className="text-text-muted hover:text-text">{t('utaDetail.backToTrading', '← Trading')}</Link>
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
              + {t('utaDetail.placeOrder', 'Place Order')}
            </button>
            <button onClick={() => setEditing(true)} className="btn-secondary-sm">
              {t('common.edit')}
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[1080px] mx-auto space-y-5">
          {dataError && (
            <div className="rounded-md border border-red/30 bg-red/5 px-3 py-2 text-[12px] text-red">
              {t('utaDetail.failedToLoadLiveData', 'Failed to load live data')}: {dataError}
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

          <OrdersSection orders={orders} />

          <SnapshotsTimeline
            snapshots={snapshots}
            expandedTimestamp={expandedSnapshot}
            onToggle={(ts) => setExpandedSnapshot(prev => prev === ts ? null : ts)}
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
          onPushComplete={() => { void refreshLive() }}
        />
      )}
    </div>
  )
}

// ==================== Shell ====================

function Shell({ title, children }: { title: string; children?: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={title} description={<Link to="/trading" className="text-text-muted hover:text-text">{t('utaDetail.backToTrading', '← Trading')}</Link>} />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[720px] mx-auto">{children}</div>
      </div>
    </div>
  )
}

// ==================== Hero ====================

interface TodayDelta { delta: number; pct: number; currency: string }

function Hero({ account, todayDelta }: { account: AccountInfo | null; todayDelta: TodayDelta | null }) {
  const { t } = useTranslation()
  if (!account) {
    return (
      <div className="border border-border rounded-lg bg-bg-secondary px-5 py-6">
        <p className="text-[13px] text-text-muted">{t('utaDetail.loadingAccountInfo', 'Loading account info…')}</p>
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
        label={t('utaDetail.netLiquidation', 'Net Liquidation')}
        value={fmt(account.netLiquidation, ccy)}
        delta={todayDelta ? {
          value: `${fmtPnl(todayDelta.delta, ccy)} (${fmtPctSigned(todayDelta.pct)}) ${t('common.today')}`,
          sign: signFromDelta(todayDelta.delta),
        } : { value: `\u2014 ${t('common.today')}`, sign: 'flat' }}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-border">
        <Metric size="sm" label={t('common.cash')} value={fmt(account.totalCashValue, ccy)} />
        <Metric
          size="sm"
          label={t('trading.unrealizedPnl')}
          value={fmtPnl(account.unrealizedPnL, ccy)}
          valueSign={signFromDelta(unrealized)}
        />
        <Metric
          size="sm"
          label={t('utaDetail.realizedPnl', 'Realized P&L')}
          value={fmtPnl(account.realizedPnL ?? '0', ccy)}
          valueSign={signFromDelta(realized)}
        />
        <Metric
          size="sm"
          label={t('utaDetail.buyingPower', 'Buying Power')}
          value={account.buyingPower != null ? fmt(account.buyingPower, ccy) : '\u2014'}
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
  const { t } = useTranslation()
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
      <Section title={t('utaDetail.positionsCount', 'Positions ({{count}})', { count: 0 })}>
        <div className="border border-border rounded-lg px-4 py-3 text-[12px] text-text-muted">
          {t('utaDetail.noOpenPositions', 'No open positions.')}
        </div>
      </Section>
    )
  }

  const cols = 7

  return (
    <Section title={t('utaDetail.positionsCount', 'Positions ({{count}})', { count: positions.length })}>
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-bg-secondary text-text-muted text-left">
              <th className="px-3 py-2 font-medium">{t('utaDetail.contract', 'Contract')}</th>
              <th className="px-3 py-2 font-medium">{t('utaDetail.side', 'Side')}</th>
              <th className="px-3 py-2 font-medium text-right">{t('dev.qty', 'Qty')}</th>
              <th className="px-3 py-2 font-medium text-right">{t('utaDetail.avgToMark', 'Avg → Mark')}</th>
              <th className="px-3 py-2 font-medium text-right">{t('utaDetail.mktValue', 'Mkt Value')}</th>
              <th className="px-3 py-2 font-medium text-right">{t('trading.pnl', 'PnL')}</th>
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
                          <span className="text-text-muted">{g.positions.length} {t('utaDetail.position', { count: g.positions.length })}</span>
                          {!groupCcy && (
                            <span className="text-text-muted/60 text-[11px]">{t('utaDetail.mixedCcy', 'mixed ccy')}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 tabular-nums">
                          <span className="text-text">{groupCcy ? fmt(sumValue, groupCcy) : fmt(sumValue, 'USD')}</span>
                          <span className={sumPnl >= 0 ? 'text-green' : 'text-red'}>
                            {groupCcy ? fmtPnl(sumPnl, groupCcy) : fmtPnl(sumPnl, 'USD')}
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
  const { t } = useTranslation()
  const ccy = p.currency ?? 'USD'
  const cost = Number(p.avgCost) * Number(p.quantity)
  const pnl = Number(p.unrealizedPnL)
  const pct = cost > 0 ? (pnl / cost) * 100 : 0
  const display = p.contract.aliceId ?? p.contract.localSymbol ?? p.contract.symbol ?? '?'

  return (
    <tr className="border-t border-border hover:bg-bg-tertiary/30 transition-colors">
      <td className="px-3 py-2">
        <span className="font-mono text-text">{display}</span>
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
          {t('utaDetail.close', 'Close')}
        </button>
      </td>
    </tr>
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
  const { t } = useTranslation()
  const rows = orders as OpenOrderRow[]
  if (rows.length === 0) {
    return (
      <Section title={t('utaDetail.openOrdersCount', 'Open Orders ({{count}})', { count: 0 })}>
        <div className="border border-border rounded-lg px-4 py-3 text-[12px] text-text-muted">
          {t('utaDetail.noOpenOrders', 'No open orders.')}
        </div>
      </Section>
    )
  }
  return (
    <Section title={t('utaDetail.openOrdersCount', 'Open Orders ({{count}})', { count: rows.length })}>
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-bg-secondary text-text-muted text-left">
              <th className="px-3 py-2 font-medium">{t('utaDetail.orderId', 'Order ID')}</th>
              <th className="px-3 py-2 font-medium">{t('utaDetail.contract', 'Contract')}</th>
              <th className="px-3 py-2 font-medium">{t('common.actions', 'Action')}</th>
              <th className="px-3 py-2 font-medium">{t('common.type', 'Type')}</th>
              <th className="px-3 py-2 font-medium text-right">{t('dev.qty', 'Qty')}</th>
              <th className="px-3 py-2 font-medium text-right">{t('utaDetail.limit', 'Limit')}</th>
              <th className="px-3 py-2 font-medium">{t('common.status', 'Status')}</th>
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
                  <span className="text-[11px] text-text-muted">{o.orderState?.status ?? t('utaDetail.unknown', 'Unknown')}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

// ==================== Snapshots — vertical timeline ====================

interface SnapshotsTimelineProps {
  snapshots: UTASnapshotSummary[]
  expandedTimestamp: string | null
  onToggle: (ts: string) => void
}

function SnapshotsTimeline({ snapshots, expandedTimestamp, onToggle }: SnapshotsTimelineProps) {
  const { t } = useTranslation()
  const groups = useMemo(() => {
    const map = new Map<string, UTASnapshotSummary[]>()
    for (const s of snapshots) {
      const day = new Date(s.timestamp).toDateString()
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(s)
    }
    return Array.from(map.entries())
  }, [snapshots])

  if (snapshots.length === 0) {
    return (
      <Section title={t('common.snapshots')}>
        <div className="border border-border rounded-lg px-4 py-3 text-[12px] text-text-muted">
          {t('utaDetail.noSnapshotsYet', 'No snapshots yet. They are captured periodically (Portfolio → Snapshot Settings) or after each push.')}
        </div>
      </Section>
    )
  }

  return (
    <Section title={t('utaDetail.snapshotsCount', 'Snapshots ({{count}})', { count: snapshots.length })}>
      <div className="relative pl-4">
        {/* Vertical guide line tucked behind the dots */}
        <div className="absolute left-[7px] top-0 bottom-0 w-px bg-border" aria-hidden />
        {groups.map(([day, items]) => (
          <div key={day} className="relative">
            <div className="sticky top-0 z-10 -mx-4 px-4 py-1 bg-bg/95 backdrop-blur-sm text-[11px] text-text-muted uppercase tracking-wide">
              {formatDayLabel(day)}
            </div>
            <ul>
              {items.map((s) => {
                const idxAll = snapshots.indexOf(s)
                const prev = snapshots[idxAll + 1]   // older snapshot
                const delta = prev ? Number(s.account.netLiquidation) - Number(prev.account.netLiquidation) : null
                const isExpanded = expandedTimestamp === s.timestamp
                return (
                  <li key={s.timestamp} className="relative">
                    <button
                      onClick={() => onToggle(s.timestamp)}
                      className="w-full flex items-center gap-3 py-2 pr-2 text-left hover:bg-bg-secondary/40 transition-colors rounded"
                    >
                      <span className={`absolute left-[-13px] top-3 w-2 h-2 rounded-full ring-2 ring-bg ${isExpanded ? 'bg-accent' : 'bg-text-muted/60'}`} aria-hidden />
                      <span className="text-[12px] text-text-muted tabular-nums w-[58px] shrink-0">
                        {formatTime(s.timestamp)}
                      </span>
                      <TriggerBadge trigger={s.trigger} />
                      <span className="flex-1 text-[12px] text-text font-mono tabular-nums truncate">
                        {fmt(s.account.netLiquidation, s.account.baseCurrency)}
                      </span>
                      {delta != null && Number.isFinite(delta) && (
                        <span className={`text-[12px] tabular-nums ${delta >= 0 ? 'text-green' : 'text-red'}`}>
                          {fmtPnl(delta, s.account.baseCurrency)}
                        </span>
                      )}
                    </button>
                    {isExpanded && (
                      <div className="mb-3 mt-1">
                        <SnapshotDetail
                          snapshot={s}
                          onClose={() => onToggle(s.timestamp)}
                        />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  )
}

function TriggerBadge({ trigger }: { trigger: string }) {
  const label = trigger === 'post-push' ? 'push'
    : trigger === 'post-reject' ? 'reject'
    : trigger
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted shrink-0">
      {label}
    </span>
  )
}

// ==================== Date helpers ====================

function formatDayLabel(dayString: string): string {
  const d = new Date(dayString)
  const todayStr = new Date().toDateString()
  const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString()
  const formatted = fmtDateShort(d)
  if (dayString === todayStr) return `${formatted} · ${i18n.t('common.today')}`
  if (dayString === yesterdayStr) return `${formatted} · ${i18n.t('utaDetail.yesterday', 'yesterday')}`
  return formatted
}

function formatTime(timestamp: string): string {
  return fmtTime(new Date(timestamp))
}
