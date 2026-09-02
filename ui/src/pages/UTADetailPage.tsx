import { Fragment, useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, CircleCheck, Clock3, TriangleAlert } from 'lucide-react'
import type { ViewSpec } from '../tabs/types'
import { api } from '../api'
import { getIntlLocale } from '../lib/intl'
import type { UTAConfig, BrokerPreset, AccountInfo, SubAccountRef, Position, BrokerHealthInfo, UTASnapshotSummary, EquityCurvePoint, OrderHistoryEntry, OrderHistoryStatus, TradeHistoryEntry } from '../api/types'
import { useTradingConfig } from '../hooks/useTradingConfig'
import { useAccountHealth } from '../hooks/useAccountHealth'
import { deriveAccountInteractionPolicy, useBrokerPackReadiness } from '../hooks/useBrokerPackReadiness'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, Skeleton } from '../components/StateViews'
import { Button, buttonVariants } from '../components/ui/button'
import { ReconnectButton } from '../components/ReconnectButton'
import { Toggle } from '../components/Toggle'
import { SegmentedControl } from '../components/SegmentedControl'
import { AccountReadinessBadge, BrokerSupportGate } from '../components/uta/BrokerPackGate'
import { EditUTADialog } from '../components/uta/EditUTADialog'
import { OrderEntryDialog, type OrderEntryMode } from '../components/uta/OrderEntryDialog'
import { EquityCurve } from '../components/EquityCurve'
import { Metric, signFromDelta } from '../components/Metric'
import { fmt, fmtPnl, fmtNum, fmtPctSigned, isUnsetDecimal } from '../lib/format'
import { secTypeToClass, assetClassLabel, ASSET_CLASS_ORDER, type AssetClass } from '../lib/asset-class'
import { ContractCell, contractPrimary } from '../lib/contract-display'
import { displayNameForUTA } from '../lib/uta-account-filter'
import { ensureTradingModePolling, useTradingMode } from '../live/trading-mode'

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
  const brokerReadiness = useBrokerPackReadiness()
  const tradingMode = useTradingMode((state) => state.status.mode)
  const tradingModeLoading = useTradingMode((state) => state.loading)
  const [presets, setPresets] = useState<BrokerPreset[]>([])
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [orders, setOrders] = useState<unknown[]>([])
  // Sub-accounts (wallets). Empty/length-1 for ordinary brokers; >1 for
  // separate-wallet venues (Binance: spot / derivatives). `selectedSub`
  // undefined ⇒ the aggregate view across all wallets.
  const [subAccounts, setSubAccounts] = useState<SubAccountRef[]>([])
  const [selectedSub, setSelectedSub] = useState<string | undefined>(undefined)
  const [snapshots, setSnapshots] = useState<UTASnapshotSummary[]>([])
  const [editing, setEditing] = useState(false)
  const [orderMode, setOrderMode] = useState<OrderEntryMode | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [clock, setClock] = useState<MarketClockState>(null)
  const [interactionNotice, setInteractionNotice] = useState<string | null>(null)

  useEffect(() => {
    api.trading.getBrokerPresets().then(r => setPresets(r.presets)).catch(() => {})
  }, [])

  const uta = useMemo<UTAConfig | undefined>(() => tc.utas.find(u => u.id === id), [tc.utas, id])
  const preset = useMemo<BrokerPreset | undefined>(() => presets.find(p => p.id === uta?.presetId), [presets, uta])
  const health: BrokerHealthInfo | undefined = id ? healthMap[id] : undefined
  const readiness = uta ? brokerReadiness.forAccount(uta) : null
  const policy = uta && readiness ? deriveAccountInteractionPolicy({ account: uta, readiness, health, tradingMode }) : null

  useEffect(() => { ensureTradingModePolling() }, [])

  // Sub-account discovery — once per UTA. A failure (or a single-wallet
  // broker) leaves the list empty, so the selector simply never renders.
  useEffect(() => {
    if (!id || !policy?.canRead) {
      setSubAccounts([])
      setSelectedSub(undefined)
      return
    }
    let cancelled = false
    api.trading.utaSubAccounts(id)
      .then(r => { if (!cancelled) setSubAccounts(r.subAccounts ?? []) })
      .catch(() => { if (!cancelled) setSubAccounts([]) })
    setSelectedSub(undefined)  // reset to aggregate when switching UTAs
    return () => { cancelled = true }
  }, [id, policy?.canRead])

  // Live polling — account/positions/orders refresh every 15s. Account +
  // positions scope to the selected wallet (undefined ⇒ aggregate); orders
  // are not wallet-scoped (the venue order list is account-wide).
  //
  // Latest-wins guard: scoped CCXT reads are slow (multi-wallet venues do
  // several round-trips), so switching the sub-account pill twice quickly
  // leaves two fetches in flight. Without this, the slower (older) response
  // can land last and paint the WRONG wallet's data under the selected pill.
  // Each call claims a sequence number; a response only applies if it's still
  // the newest in flight.
  const reqSeq = useRef(0)
  const refreshLive = useCallback(async () => {
    if (!id || !policy?.canRead) {
      setAccount(null)
      setPositions([])
      setOrders([])
      setLastUpdated(null)
      setDataError(null)
      return
    }
    const seq = ++reqSeq.current
    setDataError(null)
    try {
      const [acct, pos, ord] = await Promise.allSettled([
        api.trading.utaAccount(id, selectedSub),
        api.trading.utaPositions(id, selectedSub),
        api.trading.utaOrders(id),
      ])
      if (seq !== reqSeq.current) return  // superseded by a newer refresh — discard
      if (acct.status === 'rejected') {
        setAccount(null)
        setPositions([])
        setOrders([])
        setLastUpdated(null)
        setDataError(acct.reason instanceof Error ? acct.reason.message : String(acct.reason))
        return
      }
      setAccount(acct.value)
      setPositions(pos.status === 'fulfilled' ? pos.value.positions : [])
      setOrders(ord.status === 'fulfilled' ? ord.value.orders : [])
      setDataError(pos.status === 'rejected' || ord.status === 'rejected'
        ? 'Some live account details could not be loaded.'
        : null)
      setLastUpdated(new Date())
    } catch (err) {
      if (seq !== reqSeq.current) return
      setDataError(err instanceof Error ? err.message : String(err))
    }
  }, [id, policy?.canRead, selectedSub])

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
    if (!id || !policy?.canRead) {
      setClock(null)
      return
    }
    let cancelled = false
    const load = () => api.trading.marketClock(id)
      .then(c => { if (!cancelled) setClock(c) })
      .catch(() => { if (!cancelled) setClock('error') })
    load()
    const t = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [id, policy?.canRead])

  // ?aliceId=... auto-opens the place-order form prefilled (e.g. clicked
  // from TradeableContractsPanel on the market workbench).
  useEffect(() => {
    const queryAlice = searchParams.get('aliceId')
    if (queryAlice && !orderMode && policy && readiness?.state !== 'checking' && !tradingModeLoading) {
      if (policy.canTrade) setOrderMode({ kind: 'place', aliceId: queryAlice })
      else setInteractionNotice(policy.reason ?? 'Trading is unavailable for this account.')
      const next = new URLSearchParams(searchParams)
      next.delete('aliceId')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, orderMode, policy, readiness?.state, tradingModeLoading])

  // 24h delta = current NLV − the oldest snapshot still within the trailing
  // 24h window. Labeled "24h" in the UI — it IS a trailing-24h diff, not a
  // market-session "today", and the honest label avoids market-hours /
  // timezone arithmetic.
  const delta24h = useMemo(() => {
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

  if (tc.loading) return <Shell title={id ?? 'UTA'}><UTADetailMainSkeleton /></Shell>
  if (!id) return <Shell title="UTA not specified" />
  if (!uta) {
    return (
      <Shell title={`UTA ${id} not found`}>
        <EmptyState
          title={`No UTA "${id}"`}
          description="It may have been deleted or never configured. Head back to Trading to create one or pick a different UTA."
        />
        <div className="mt-4">
          <Link to="/trading" className={buttonVariants({ variant: 'outline', size: 'sm' })}>← Back to Trading</Link>
        </div>
      </Shell>
    )
  }

  const isDisabled = uta.enabled === false
  const displayName = displayNameForUTA(uta, preset)
  if (!readiness || !policy) return <Shell title={displayName}><UTADetailMainSkeleton /></Shell>

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={displayName}
        live={lastUpdated && policy.canRead ? { lastUpdated } : undefined}
        stackActionsOnNarrow
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link to="/trading" className="text-muted-foreground hover:text-foreground">← Trading</Link>
            <span className="font-mono text-muted-foreground">{uta.id}</span>
            <AccountReadinessBadge readiness={readiness} health={health} size="sm" />
          </span>
        }
        right={
          <div className="flex w-full flex-wrap items-center gap-2">
            <div className="mr-auto flex items-center gap-2">
              <Toggle
                ariaLabel={`${preset?.label ?? uta.id} enabled`}
                size="sm"
                checked={!isDisabled}
                disabled={isDisabled && !readiness.operational}
                title={isDisabled && !readiness.operational ? policy.reason : undefined}
                onChange={async (v) => { await tc.saveUTA({ ...uta, enabled: v }) }}
              />
              <span className="text-[11px] text-muted-foreground">
                {isDisabled ? 'Configured off' : 'Configured on'}
              </span>
            </div>
            <div className="oa-uta-header-divider h-5 w-px bg-border" />
            <div className="flex flex-wrap items-center gap-2">
              <ReconnectButton accountId={uta.id} disabled={!policy.canReconnect} disabledReason={policy.reason} />
              <Button onClick={() => setEditing(true)} variant="outline" size="sm">
                Edit
              </Button>
              <Button
                onClick={() => setOrderMode({ kind: 'place' })}
                disabled={!policy.canTrade}
                title={!policy.canTrade ? policy.reason : undefined}
                size="sm"
              >
                + Place Order
              </Button>
            </div>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[1240px] mx-auto">
          {dataError && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] leading-[18px] text-destructive">
              Failed to load live data: {dataError}
            </div>
          )}

          {interactionNotice && (
            <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[12px] leading-[18px] text-warning" role="status">
              {interactionNotice}
            </div>
          )}

          {!policy.canRead ? (
            <div className="space-y-4">
              <BrokerSupportGate
                readiness={readiness}
                installingEngine={brokerReadiness.installingEngine}
                onInstall={brokerReadiness.install}
                onRetry={brokerReadiness.refresh}
              />
              {curvePoints.length >= 2 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-warning" role="status">
                    Historical snapshot. Broker support is unavailable on this Runtime, so these values are stale.
                  </p>
                  <EquityCurve
                    points={curvePoints}
                    accounts={[{ id, label: displayName }]}
                    selectedAccountId={id}
                    onAccountChange={() => {}}
                  />
                </div>
              )}
            </div>
          ) : !lastUpdated && !dataError ? <UTADetailMainSkeleton /> : !lastUpdated ? (
            <EmptyState title="Live account data is unavailable." description="Retry after checking the broker connection and account health." />
          ) : (
            <div className="space-y-5">
              {/* Keep the visual overview together, then give the operational
                  tables the full content width. The auto-fit grid responds to
                  this pane's real width after both app sidebars, rather than
                  guessing from the browser viewport. */}
              <div
                className="grid items-stretch gap-4"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 26rem), 1fr))' }}
              >
                {curvePoints.length >= 2 && (
                  <div className="min-w-0">
                    <EquityCurve
                      points={curvePoints}
                      accounts={[{ id, label: displayName }]}
                      selectedAccountId={id}
                      onAccountChange={() => { /* single-account mode: switcher hidden */ }}
                    />
                  </div>
                )}

                <div className="min-w-0 space-y-3">
                  {subAccounts.length > 1 && (
                    <SubAccountSelector
                      subAccounts={subAccounts}
                      selected={selectedSub}
                      onSelect={(sub) => {
                        // Drop the previous wallet's numbers immediately so the
                        // panel shows "Loading account info…" during the (slow,
                        // multi-round-trip) scoped read instead of briefly painting
                        // the old scope's net-liquidation under the new pill.
                        setAccount(null)
                        setSelectedSub(sub)
                      }}
                    />
                  )}
                  <AccountPanel account={account} positions={positions} delta24h={delta24h} clock={clock} connecting={health?.connecting ?? false} />
                </div>
              </div>

              <PositionsSection
                positions={positions}
                canClose={policy.canTrade}
                closeDisabledReason={policy.reason}
                onCloseClick={(p) => setOrderMode({
                  kind: 'close',
                  aliceId: p.contract.aliceId ?? p.contract.localSymbol ?? p.contract.symbol ?? '',
                  quantity: p.quantity,
                  symbol: p.contract.symbol,
                })}
              />

              <OrdersArea utaId={id} openOrders={orders} />
            </div>
          )}
        </div>
      </div>

      {editing && (
        <EditUTADialog
          uta={uta}
          preset={preset}
          health={health}
          readiness={readiness}
          policy={policy}
          installingEngine={brokerReadiness.installingEngine}
          onInstallBrokerPack={brokerReadiness.install}
          onRetryBrokerPack={brokerReadiness.refresh}
          onSave={async (next) => { await tc.saveUTA(next) }}
          onDelete={async () => {
            await tc.deleteUTA(uta.id)
            setEditing(false)
            navigate('/trading')
          }}
          onClose={() => setEditing(false)}
        />
      )}

      {orderMode && policy.canTrade && (
        <OrderEntryDialog
          utaId={uta.id}
          mode={orderMode}
          subAccounts={subAccounts}
          defaultSubAccountId={selectedSub}
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
      <PageHeader title={title} description={<Link to="/trading" className="text-muted-foreground hover:text-foreground">← Trading</Link>} />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[720px] mx-auto">{children}</div>
      </div>
    </div>
  )
}

// ==================== Sub-account selector ====================

/** Segmented control for separate-wallet venues (Binance: spot / derivatives).
 *  "All" is the aggregate (selected = undefined); each pill scopes the account
 *  + positions view to one wallet. Only rendered when a UTA spans >1 wallet. */
function SubAccountSelector({ subAccounts, selected, onSelect }: {
  subAccounts: SubAccountRef[]
  selected: string | undefined
  onSelect: (id: string | undefined) => void
}) {
  return (
    <SegmentedControl
      value={selected ?? 'all'}
      options={[
        { value: 'all', label: 'All' },
        ...subAccounts.map(account => ({ value: account.id, label: account.label, ariaLabel: `${account.label}, ${account.kind} wallet` })),
      ]}
      onChange={(value) => onSelect(value === 'all' ? undefined : value)}
      ariaLabel="Trading wallet"
    />
  )
}

// ==================== Account panel (sidebar) ====================

interface Delta24h { delta: number; pct: number; currency: string }

/** Sum a string-decimal field, ignoring non-finite entries. */
function sumFinite(values: number[]): number {
  return values.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0)
}

/**
 * Sidebar account summary. The AccountInfo contract is the IBKR superset:
 * a broker that doesn't report a field gets its row OMITTED — never a
 * fabricated zero. (Live examples: Alpaca has no realizedPnL; CCXT/okx has
 * realizedPnL but no buyingPower.)
 */
/** Cold-start placeholder for the UTA-detail main column (curve + positions +
 *  orders), shown until the first live read lands — instead of a blank pane or
 *  a misleading "No open positions" while the (sometimes slow) broker read runs. */
function UTADetailMainSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <Skeleton className="h-[220px] w-full rounded-lg" />
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-secondary">
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-16 ml-auto" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AccountPanel({ account, positions, delta24h, clock, connecting }: {
  account: AccountInfo | null
  positions: Position[]
  delta24h: Delta24h | null
  clock: MarketClockState
  connecting?: boolean
}) {
  if (!account) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        {clock != null && (
          <div className="text-[12px] mb-3"><MarketClockChip clock={clock} /></div>
        )}
        {/* During the initial broker connect, say so explicitly — "connecting"
            reads as progress, where a bare "Loading…" that lingers 30s reads
            as a stall. Skeleton rows below stand in for the metric list so the
            panel has shape instead of a single line of text. */}
        <p className={`text-[12px] mb-3.5 ${connecting ? 'text-primary' : 'text-muted-foreground'}`}>
          {connecting ? 'Connecting to broker…' : 'Loading account info…'}
        </p>
        <div className="space-y-3.5" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const ccy = account.baseCurrency || 'USD'
  const netLiq = Number(account.netLiquidation)
  const unrealized = Number(account.unrealizedPnL)

  // Positions value = non-cash equity = netLiq − cash, so Cash + Positions
  // Value ≡ Net Liquidation by construction. netLiq is now the sum of every
  // wallet asset (stablecoins + priced holdings across spot/futures wallets,
  // ANG-111); cash is the stablecoin slice, so the remainder is exactly the
  // value of non-stablecoin holdings. Summing positions[].marketValue does NOT
  // reconcile — it counts perp NOTIONAL (not equity) and omits non-stablecoin
  // futures-wallet collateral. Fall back to the row sum only if netLiq/cash are
  // unavailable.
  const cashVal = Number(account.totalCashValue)
  const positionsValue = Number.isFinite(netLiq) && Number.isFinite(cashVal)
    ? netLiq - cashVal
    : sumFinite(positions.map(p => Number(p.marketValue)))
  const utilizationPct = Number.isFinite(netLiq) && netLiq > 0
    ? (positionsValue / netLiq) * 100
    : null

  // Unrealized % vs cost basis, when a positive cost basis is computable.
  const costBasis = sumFinite(positions.map(p =>
    Math.abs(Number(p.quantity)) * Number(p.avgCost) * (p.contract.multiplier ?? 1)
  ))
  const unrealizedPct = costBasis > 0 && Number.isFinite(unrealized)
    ? (unrealized / costBasis) * 100
    : null

  const realized = account.realizedPnL != null ? Number(account.realizedPnL) : null
  const marginUsed = account.initMarginReq != null && !isUnsetDecimal(account.initMarginReq)
    ? Number(account.initMarginReq)
    : null

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {clock != null && (
        <div className="text-[12px] mb-3"><MarketClockChip clock={clock} /></div>
      )}

      <Metric
        size="lg"
        label="Net Liquidation"
        value={fmt(account.netLiquidation, ccy)}
        delta={delta24h ? {
          value: `${fmtPnl(delta24h.delta, ccy)} (${fmtPctSigned(delta24h.pct)}) 24h`,
          sign: signFromDelta(delta24h.delta),
        } : { value: '— 24h', sign: 'flat' }}
      />

      <div className="mt-4 border-t border-border divide-y divide-border">
        <AccountRow label="Cash" value={fmt(account.totalCashValue, ccy)} />

        <AccountRow label="Positions Value" value={fmt(positionsValue, ccy)} />

        {utilizationPct != null && (
          <div className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-medium text-muted-foreground">Utilization</span>
              <span className="text-[13px] leading-[18px] font-medium tabular-nums text-foreground">{utilizationPct.toFixed(1)}%</span>
            </div>
            <div className="mt-1.5 h-[2px] rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, utilizationPct))}%` }}
              />
            </div>
          </div>
        )}

        <AccountRow
          label="Unrealized P&L"
          value={unrealizedPct != null
            ? `${fmtPnl(account.unrealizedPnL, ccy)} (${fmtPctSigned(unrealizedPct, 1)})`
            : fmtPnl(account.unrealizedPnL, ccy)}
          sign={signFromDelta(unrealized)}
        />

        {realized != null && (
          <AccountRow
            label="Realized P&L"
            value={fmtPnl(account.realizedPnL, ccy)}
            sign={signFromDelta(realized)}
          />
        )}

        {account.buyingPower != null && !isUnsetDecimal(account.buyingPower) && (
          <AccountRow label="Buying Power" value={fmt(account.buyingPower, ccy)} />
        )}

        {marginUsed != null && marginUsed > 0 && (
          <AccountRow label="Margin Used" value={fmt(account.initMarginReq, ccy)} />
        )}

        {account.dayTradesRemaining != null && (
          <AccountRow label="Day Trades Left" value={fmtNum(account.dayTradesRemaining)} />
        )}
      </div>
    </div>
  )
}

function AccountRow({ label, value, sign }: {
  label: string
  value: React.ReactNode
  sign?: 'up' | 'down' | 'flat'
}) {
  const valueColor = sign === 'up' ? 'text-success' : sign === 'down' ? 'text-destructive' : 'text-foreground'
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className={`text-[13px] leading-[18px] font-medium tabular-nums text-right ${valueColor}`}>{value}</span>
    </div>
  )
}

// ==================== Section helper ====================

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[13px] leading-[18px] font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

// ==================== Positions (grouped by asset class) ====================

interface PositionGroup { class: AssetClass; positions: Position[] }

export function PositionsSection({ positions, onCloseClick, canClose = true, closeDisabledReason }: {
  positions: Position[]
  onCloseClick: (p: Position) => void
  canClose?: boolean
  closeDisabledReason?: string
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
        <p className="py-3 text-caption text-muted-foreground">No open positions.</p>
      </Section>
    )
  }

  const cols = 7  // contract, side, qty, avg→mark, value, pnl, action

  return (
    <Section title={`Positions (${positions.length})`}>
      <div
        data-testid="uta-positions-mobile"
        className="overflow-hidden rounded-lg border border-border md:hidden"
      >
        {groups.map((g) => {
          const sumValue = g.positions.reduce((sum, position) => sum + Number(position.marketValue), 0)
          const sumPnl = g.positions.reduce((sum, position) => sum + Number(position.unrealizedPnL), 0)
          const currencies = new Set(g.positions.map(position => position.currency))
          const groupCcy = currencies.size === 1 ? [...currencies][0] : undefined
          return (
            <div key={g.class} className="border-t border-border first:border-t-0">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-muted/40 px-3 py-2 text-[11px] leading-[15px]">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-foreground">{assetClassLabel(g.class)}</span>
                  <span className="text-muted-foreground">
                    {g.positions.length} position{g.positions.length > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 tabular-nums">
                  <span className="text-foreground">
                    {groupCcy ? fmt(sumValue, groupCcy) : `$${sumValue.toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </span>
                  <span className={sumPnl >= 0 ? 'text-success' : 'text-destructive'}>
                    {groupCcy ? fmtPnl(sumPnl, groupCcy) : `${sumPnl >= 0 ? '+' : ''}${sumPnl.toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </span>
                </div>
              </div>
              {g.positions.map((position, index) => (
                <PositionMobileRow
                  key={`${g.class}-${index}`}
                  position={position}
                  onClose={() => onCloseClick(position)}
                  canClose={canClose}
                  closeDisabledReason={closeDisabledReason}
                />
              ))}
            </div>
          )
        })}
      </div>

      <div
        data-testid="uta-positions-desktop"
        className="hidden overflow-x-auto rounded-lg border border-border md:block"
      >
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-secondary text-muted-foreground text-left">
              <th className="px-3 py-2 font-medium">Contract</th>
              <th className="px-3 py-2 font-medium">Side</th>
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium text-right">Avg → Mark</th>
              <th className="px-3 py-2 font-medium text-right">Mkt Value</th>
              <th className="px-3 py-2 font-medium text-right">PnL</th>
              <th className="px-3 py-2 font-medium text-right">
                <span className="sr-only">Actions</span>
              </th>
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
                  <tr className="bg-muted/40 border-t border-border">
                    <td colSpan={cols} className="px-3 py-1.5">
                      <div className="flex items-center justify-between text-[12px] leading-[18px]">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{assetClassLabel(g.class)}</span>
                          <span className="text-muted-foreground">{g.positions.length} position{g.positions.length > 1 ? 's' : ''}</span>
                          {!groupCcy && (
                            <span className="text-muted-foreground/60 text-[11px]">mixed ccy</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 tabular-nums">
                          <span className="text-foreground">{groupCcy ? fmt(sumValue, groupCcy) : `$${sumValue.toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
                          <span className={sumPnl >= 0 ? 'text-success' : 'text-destructive'}>
                            {groupCcy ? fmtPnl(sumPnl, groupCcy) : `${sumPnl >= 0 ? '+' : ''}${sumPnl.toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </span>
                        </div>
                      </div>
                    </td>
                  </tr>
                  {g.positions.map((p, i) => (
                    <PositionRow key={`${g.class}-${i}`} position={p} onClose={() => onCloseClick(p)} canClose={canClose} closeDisabledReason={closeDisabledReason} />
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

function PositionMetric({
  label,
  value,
  valueClassName = 'text-foreground',
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 truncate text-caption tabular-nums ${valueClassName}`} title={value}>{value}</dd>
    </div>
  )
}

function PositionMobileRow({ position: p, onClose, canClose, closeDisabledReason }: { position: Position; onClose: () => void; canClose: boolean; closeDisabledReason?: string }) {
  const ccy = p.currency ?? 'USD'
  const cost = Number(p.avgCost) * Number(p.quantity)
  const pnl = Number(p.unrealizedPnL)
  const pct = cost > 0 ? (pnl / cost) * 100 : 0
  const pnlTone = pnl >= 0 ? 'text-success' : 'text-destructive'
  const name = contractPrimary(p.contract)

  return (
    <details className="group border-t border-border">
      <summary
        aria-label={`${name} ${p.side} position, market value ${fmt(p.marketValue, ccy)}, PnL ${fmtPnl(pnl, ccy)}, ${fmtPctSigned(pct)}. Expand for position details.`}
        className="list-none px-3 py-3 outline-none hover:bg-muted/30 focus-visible:[box-shadow:inset_0_0_0_1px_var(--oa-focus-ring)] [&::-webkit-details-marker]:hidden"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto_16px] items-start gap-2">
          <div className="min-w-0">
            <ContractCell contract={p.contract} />
            <span className={`mt-1 inline-flex rounded-sm px-1.5 py-0.5 text-[10px] leading-[14px] font-medium ${p.side === 'long' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}>
              {p.side}
            </span>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[13px] leading-[18px] font-semibold tabular-nums text-foreground">{fmt(p.marketValue, ccy)}</div>
            <div className={`mt-1 flex justify-end gap-2 text-[11px] leading-[15px] tabular-nums ${pnlTone}`}>
              <span>{fmtPnl(pnl, ccy)}</span>
              <span>{fmtPctSigned(pct)}</span>
            </div>
          </div>
          <ChevronDown
            size={14}
            aria-hidden
            className="mt-1 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </div>
      </summary>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border bg-secondary/35 px-3 py-3">
        <PositionMetric label="Quantity" value={fmtNum(p.quantity)} />
        <PositionMetric label="Average cost" value={fmt(p.avgCost, ccy)} />
        <PositionMetric label="Current price" value={fmt(p.marketPrice, ccy)} />
        <PositionMetric
          label="Unrealized PnL"
          value={fmtPnl(pnl, ccy)}
          valueClassName={pnlTone}
        />
      </dl>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-secondary/20 px-3 py-2">
        <span className="text-[11px] text-muted-foreground">Position action</span>
        <Button
          type="button"
          onClick={onClose}
          disabled={!canClose}
          title={!canClose ? closeDisabledReason : undefined}
          aria-label={`Close ${name} position`}
          className="min-h-10"
          variant="destructive"
          size="sm"
        >
          Close position
        </Button>
      </div>
    </details>
  )
}

function PositionRow({ position: p, onClose, canClose, closeDisabledReason }: { position: Position; onClose: () => void; canClose: boolean; closeDisabledReason?: string }) {
  const ccy = p.currency ?? 'USD'
  const cost = Number(p.avgCost) * Number(p.quantity)
  const pnl = Number(p.unrealizedPnL)
  const pct = cost > 0 ? (pnl / cost) * 100 : 0

  return (
    <tr className="border-t border-border hover:bg-muted/30">
      <td className="px-3 py-2">
        <ContractCell contract={p.contract} />
      </td>
      <td className="px-3 py-2">
        <span className={`rounded-sm px-1.5 py-0.5 text-[10px] leading-[14px] font-medium ${p.side === 'long' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}>
          {p.side}
        </span>
      </td>
      <td className="px-3 py-2 text-right text-foreground tabular-nums">{fmtNum(p.quantity)}</td>
      <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
        {fmt(p.avgCost, ccy)} <span className="text-muted-foreground/40">→</span> <span className="text-foreground">{fmt(p.marketPrice, ccy)}</span>
      </td>
      <td className="px-3 py-2 text-right text-foreground tabular-nums">{fmt(p.marketValue, ccy)}</td>
      <td className={`px-3 py-2 text-right font-medium tabular-nums ${pnl >= 0 ? 'text-success' : 'text-destructive'}`}>
        <div>{fmtPnl(pnl, ccy)}</div>
        <div className="text-[11px] font-normal opacity-80">{fmtPctSigned(pct)}</div>
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          type="button"
          onClick={onClose}
          disabled={!canClose}
          title={!canClose ? closeDisabledReason : undefined}
          aria-label={`Close ${contractPrimary(p.contract)} position`}
          variant="ghost"
          size="xs"
          className="text-muted-foreground hover:text-destructive"
        >
          Close
        </Button>
      </td>
    </tr>
  )
}

// ==================== Market clock chip ====================

type MarketClockState = { isOpen: boolean; nextOpen?: string; nextClose?: string } | 'error' | null

function MarketClockChip({ clock }: { clock: NonNullable<MarketClockState> }) {
  let Icon = CircleCheck
  let iconClass = 'text-success'
  let label = '24/7'

  if (clock === 'error') {
    Icon = TriangleAlert
    iconClass = 'text-warning'
    label = 'Schedule unavailable'
  } else {
    if (clock.isOpen) {
      const closes = clock.nextClose ? new Date(clock.nextClose) : null
      if (closes && !Number.isNaN(closes.getTime())) {
        const at = closes.toLocaleTimeString(getIntlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })
        label = `Market open, closes ${at}`
      } else if (!clock.nextOpen && !clock.nextClose) {
        label = '24/7'  // crypto venues report open with no schedule
      } else {
        label = 'Market Open'
      }
    } else {
      Icon = Clock3
      iconClass = 'text-muted-foreground/70'
      const opens = clock.nextOpen ? new Date(clock.nextOpen) : null
      if (opens && !Number.isNaN(opens.getTime())) {
        const mins = Math.max(0, Math.round((opens.getTime() - Date.now()) / 60_000))
        const h = Math.floor(mins / 60)
        const m = mins % 60
        label = `Market closed, opens in ${h > 0 ? `${h}h ` : ''}${m}m`
      } else {
        label = 'Market Closed'
      }
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
      <Icon aria-hidden className={`size-3 shrink-0 ${iconClass}`} />
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

export function OrdersArea({ utaId, openOrders }: { utaId: string; openOrders: unknown[] }) {
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

  const tabs: Array<{ id: OrdersTab; label: string; panelLabel: string }> = [
    { id: 'open', label: `Open (${openOrders.length})`, panelLabel: 'Open orders' },
    { id: 'history', label: 'History', panelLabel: 'Order history' },
    { id: 'trades', label: 'Trades', panelLabel: 'Trade history' },
  ]
  const activeTab = tabs.find(candidate => candidate.id === tab)!

  return (
    <Section
      title="Orders"
      action={
        <SegmentedControl
          value={tab}
          options={tabs.map(candidate => ({
            value: candidate.id,
            label: candidate.label,
            ariaControls: `orders-${candidate.id}-panel`,
          }))}
          onChange={setTab}
          ariaLabel="Order views"
          compact
        />
      }
    >
      <div
        id={`orders-${tab}-panel`}
        role="region"
        aria-label={activeTab.panelLabel}
      >
        {tab === 'open' && <OpenOrdersTable orders={openOrders} />}
        {tab === 'history' && <OrderHistoryTable orders={history} />}
        {tab === 'trades' && <TradeHistoryTable trades={trades} />}
      </div>
    </Section>
  )
}

function OpenOrdersTable({ orders }: { orders: unknown[] }) {
  const rows = orders as OpenOrderRow[]
  if (rows.length === 0) {
    return (
      <p className="py-3 text-caption text-muted-foreground">No open orders.</p>
    )
  }
  return (
    <div className="border border-border rounded-lg overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-secondary text-muted-foreground text-left">
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
              <td className="px-3 py-2 font-mono text-muted-foreground text-[11px] leading-[15px]">{String(o.orderId ?? '—')}</td>
              <td className="px-3 py-2 font-mono text-foreground" title={o.contract?.aliceId}>
                {o.contract?.symbol ?? o.contract?.localSymbol ?? o.contract?.aliceId ?? '?'}
              </td>
              <td className={`px-3 py-2 font-medium ${o.order?.action === 'BUY' ? 'text-success' : o.order?.action === 'SELL' ? 'text-destructive' : 'text-foreground'}`}>{o.order?.action ?? '—'}</td>
              <td className="px-3 py-2 text-muted-foreground">{o.order?.orderType ?? '—'}</td>
              <td className="px-3 py-2 text-right text-foreground tabular-nums">{String(o.order?.totalQuantity ?? '')}</td>
              <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{o.order?.lmtPrice != null && !isUnsetDecimal(o.order.lmtPrice) ? String(o.order.lmtPrice) : '—'}</td>
              <td className="px-3 py-2">
                <span className="text-[11px] text-muted-foreground">{o.orderState?.status ?? 'Unknown'}</span>
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
  filled: 'bg-success/15 text-success',
  cancelled: 'bg-muted text-muted-foreground',
  rejected: 'bg-destructive/15 text-destructive',
  'user-rejected': 'bg-destructive/15 text-destructive',
  submitted: 'bg-primary/15 text-primary',
}

const ORDER_HISTORY_COMPACT_WIDTH = 760

function OrderStatusBadge({ status }: { status: OrderHistoryStatus }) {
  return (
    <span className={`rounded-sm px-1.5 py-0.5 text-[10px] leading-[14px] font-medium ${ORDER_STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  )
}

function SideBadge({ side }: { side: 'BUY' | 'SELL' }) {
  return (
    <span className={`rounded-sm px-1.5 py-0.5 text-[10px] leading-[14px] font-medium ${side === 'BUY' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}>
      {side}
    </span>
  )
}

function SourceChip({ label }: { label: string }) {
  return (
    <span className="rounded-sm bg-muted px-1.5 text-[10px] leading-[14px] text-muted-foreground">
      {label}
    </span>
  )
}

export function OrderHistoryTable({ orders }: { orders: OrderHistoryEntry[] | null }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [compact, setCompact] = useState(false)

  useLayoutEffect(() => {
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < ORDER_HISTORY_COMPACT_WIDTH)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [container])

  if (orders == null) {
    return (
      <p className="py-3 text-caption text-muted-foreground">Loading order history…</p>
    )
  }
  if (orders.length === 0) {
    return (
      <p className="py-3 text-caption text-muted-foreground">No order history yet.</p>
    )
  }

  if (compact) {
    return (
      <div ref={setContainer}>
        <ul className="grid gap-2" aria-label="Order history">
          {orders.map((o, i) => {
            const detailsId = `order-history-card-details-${i}`
            const isExpanded = expanded === i
            return (
              <li key={`${o.commitHash}-${i}`} className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <ContractCell contract={o.contract} />
                    <span className="inline-flex shrink-0 items-center gap-1.5">
                      <OrderStatusBadge status={o.status} />
                      {o.source === 'external' && <SourceChip label="External" />}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-[15px] text-muted-foreground">
                    <span className="tabular-nums">{formatHistoryTime(o.timestamp)}</span>
                    <SideBadge side={o.side} />
                    <span>{o.orderType ?? '—'}</span>
                  </div>

                  <dl className="mt-3 grid grid-cols-3 gap-2">
                    <div className="min-w-0 border-l border-border pl-2.5">
                      <dt className="text-[11px] font-medium text-muted-foreground">Qty</dt>
                      <dd className="mt-0.5 truncate text-[12px] leading-[18px] text-foreground tabular-nums">
                        {o.quantity != null ? fmtNum(o.quantity) : '—'}
                      </dd>
                    </div>
                    <div className="min-w-0 border-l border-border pl-2.5">
                      <dt className="text-[11px] font-medium text-muted-foreground">Limit</dt>
                      <dd className="mt-0.5 truncate text-[12px] leading-[18px] text-foreground tabular-nums">{o.limitPrice ?? '—'}</dd>
                    </div>
                    <div className="min-w-0 border-l border-border pl-2.5">
                      <dt className="text-[11px] font-medium text-muted-foreground">Fill</dt>
                      <dd className="mt-0.5 truncate text-[12px] leading-[18px] text-foreground tabular-nums">
                        {o.avgFillPrice ? `${o.avgFillPrice}${o.filledQty ? ` × ${o.filledQty}` : ''}` : '—'}
                      </dd>
                    </div>
                  </dl>

                  <Button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={detailsId}
                    aria-label={`${isExpanded ? 'Hide' : 'Show'} details for ${contractPrimary(o.contract)} order`}
                    onClick={() => setExpanded(prev => prev === i ? null : i)}
                    className="mt-3 w-full justify-between text-[11px]"
                    variant="outline"
                    size="sm"
                  >
                    <span>Order details</span>
                    <span>{isExpanded ? 'Hide' : 'Show'}</span>
                  </Button>
                </div>

                {isExpanded && (
                  <div id={detailsId} className="border-t border-border bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground">
                    <div className="font-mono text-foreground">{o.commitHash}</div>
                    <p className="mt-1 break-words leading-5">{o.message}</p>
                    {o.error && <p className="mt-1 break-words text-destructive">{o.error}</p>}
                    {o.resolvedAt && <p className="mt-1">resolved {formatHistoryTime(o.resolvedAt)}</p>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <div ref={setContainer} className="border border-border rounded-lg overflow-x-auto">
      <table className="w-full min-w-[760px] text-[13px]">
        <thead>
          <tr className="bg-secondary text-muted-foreground text-left">
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Contract</th>
            <th className="px-3 py-2 font-medium">Side</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium text-right">Qty</th>
            <th className="px-3 py-2 font-medium text-right">Limit</th>
            <th className="px-3 py-2 font-medium text-right">Fill</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium text-right">Details</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o, i) => (
            <Fragment key={`${o.commitHash}-${i}`}>
              <tr
                className="cursor-pointer border-t border-border hover:bg-muted/30"
                onClick={() => setExpanded(prev => prev === i ? null : i)}
              >
                <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap">{formatHistoryTime(o.timestamp)}</td>
                <td className="px-3 py-2"><ContractCell contract={o.contract} /></td>
                <td className="px-3 py-2"><SideBadge side={o.side} /></td>
                <td className="px-3 py-2 text-muted-foreground">{o.orderType ?? '—'}</td>
                <td className="px-3 py-2 text-right text-foreground tabular-nums">{o.quantity != null ? fmtNum(o.quantity) : '—'}</td>
                <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{o.limitPrice ?? '—'}</td>
                <td className="px-3 py-2 text-right text-foreground tabular-nums">
                  {o.avgFillPrice ? `${o.avgFillPrice}${o.filledQty ? ` × ${o.filledQty}` : ''}` : '—'}
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <OrderStatusBadge status={o.status} />
                    {o.source === 'external' && <SourceChip label="External" />}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    type="button"
                    aria-expanded={expanded === i}
                    aria-controls={`order-history-details-${i}`}
                    aria-label={`${expanded === i ? 'Hide' : 'Show'} details for ${contractPrimary(o.contract)} order`}
                    onClick={(event) => {
                      event.stopPropagation()
                      setExpanded(prev => prev === i ? null : i)
                    }}
                    className="text-muted-foreground"
                    variant="ghost"
                    size="xs"
                  >
                    {expanded === i ? 'Hide' : 'Details'}
                  </Button>
                </td>
              </tr>
              {expanded === i && (
                <tr id={`order-history-details-${i}`} className="border-t border-border bg-muted/20">
                  <td colSpan={9} className="px-3 py-2 text-[11px] text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="font-mono">{o.commitHash}</span>
                      <span>{o.message}</span>
                      {o.error && <span className="text-destructive">{o.error}</span>}
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
      <p className="py-3 text-caption text-muted-foreground">Loading trade history…</p>
    )
  }
  if (trades.length === 0) {
    return (
      <p className="py-3 text-caption text-muted-foreground">No trades yet.</p>
    )
  }
  return (
    <div className="border border-border rounded-lg overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-secondary text-muted-foreground text-left">
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
            <tr key={`${t.commitHash}-${i}`} className="border-t border-border hover:bg-muted/30">
              <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap">{formatHistoryTime(t.timestamp)}</td>
              <td className="px-3 py-2"><ContractCell contract={t.contract} /></td>
              <td className="px-3 py-2"><SideBadge side={t.side} /></td>
              <td className="px-3 py-2 text-right text-foreground tabular-nums">{fmtNum(t.quantity)}</td>
              <td className="px-3 py-2 text-right text-foreground tabular-nums">{t.price}</td>
              <td className="px-3 py-2 text-right text-foreground tabular-nums">{fmt(t.value, t.contract.currency)}</td>
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
