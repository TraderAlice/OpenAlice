import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock3,
  LoaderCircle,
  Minus,
  TriangleAlert,
} from 'lucide-react'
import { api, type Position, type WalletCommitLog, type EquityCurvePoint, type UTASnapshotSummary } from '../api'
import { useAutoSave } from '../hooks/useAutoSave'
import { useAccountHealth } from '../hooks/useAccountHealth'
import { useTradingConfig } from '../hooks/useTradingConfig'
import { useBrokerPackReadiness } from '../hooks/useBrokerPackReadiness'
import { useWorkspace } from '../tabs/store'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, Skeleton } from '../components/StateViews'
import { Button } from '../components/ui/button'
import { EquityCurve } from '../components/EquityCurve'
import { SnapshotDetail } from '../components/SnapshotDetail'
import { Toggle } from '../components/Toggle'
import { SegmentedControl } from '../components/SegmentedControl'
import { Metric, signFromDelta } from '../components/Metric'
import { Sparkline } from '../components/Sparkline'
import { fmt, fmtPnl, fmtNum, fmtPctSigned } from '../lib/format'
import { contractPrimary } from '../lib/contract-display'
import { displayProviderForUTA } from '../lib/uta-account-filter'
import { TradingModeGate } from '../components/TradingModeGate'
import { AccountReadinessBadge, BrokerSupportGate } from '../components/uta/BrokerPackGate'
import { ensureTradingModePolling, useTradingMode } from '../live/trading-mode'
import { computeTodayDelta, type CurvePointSummary } from './portfolio-metrics'

// ==================== Types ====================

interface AggregatedEquity {
  totalEquity: string
  totalCash: string
  totalUnrealizedPnL: string
  totalRealizedPnL: string
  fxWarnings?: string[]
  accounts: Array<{ id: string; label: string; baseCurrency?: string; equity: string; cash: string; unrealizedPnL?: string; health?: string }>
}

interface AccountData {
  id: string
  provider: string
  label: string
  positions: Position[]
  walletLog: WalletCommitLog[]
  error?: string
}

interface FxRateInfo {
  currency: string
  rate: number
  source: string
  updatedAt: string
}

interface PortfolioData {
  equity: AggregatedEquity | null
  accounts: AccountData[]
  fxRates: FxRateInfo[]
}

const EMPTY: PortfolioData = { equity: null, accounts: [], fxRates: [] }

const CUTOFF_24H_MS = 24 * 60 * 60 * 1000

interface CurveSummary {
  total: CurvePointSummary
  perAccount: Record<string, CurvePointSummary>
}

/** Trailing-24h baseline + sparkline values, both at the aggregate level
 *  and per-account. Drives the today-PnL delta in the hero plus the
 *  per-account mini sparklines in AccountStrip. */
function summarizeAggregateCurve(points: EquityCurvePoint[]): CurveSummary {
  const sorted = [...points].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const cutoff = Date.now() - CUTOFF_24H_MS

  const totalValues: number[] = []
  let totalFirstAtCutoff: number | null = null
  let totalLatest: number | null = null
  const perAccountValues = new Map<string, number[]>()
  const perAccountFirst = new Map<string, number>()
  const perAccountLatest = new Map<string, number>()

  for (const p of sorted) {
    const t = new Date(p.timestamp).getTime()
    const totalN = Number(p.equity)
    if (Number.isFinite(totalN)) {
      totalValues.push(totalN)
      totalLatest = totalN
      if (t >= cutoff && totalFirstAtCutoff == null) totalFirstAtCutoff = totalN
    }
    for (const [id, raw] of Object.entries(p.accounts ?? {})) {
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      let arr = perAccountValues.get(id)
      if (!arr) { arr = []; perAccountValues.set(id, arr) }
      arr.push(n)
      perAccountLatest.set(id, n)
      if (t >= cutoff && !perAccountFirst.has(id)) perAccountFirst.set(id, n)
    }
  }

  const perAccount: CurveSummary['perAccount'] = {}
  for (const [id, values] of perAccountValues) {
    perAccount[id] = {
      values,
      firstAtCutoff: perAccountFirst.get(id) ?? null,
      latest: perAccountLatest.get(id) ?? null,
    }
  }
  return {
    total: { values: totalValues, firstAtCutoff: totalFirstAtCutoff, latest: totalLatest },
    perAccount,
  }
}

// ==================== Page ====================

export function PortfolioPage() {
  const tradingMode = useTradingMode((s) => s.status.mode)
  const tradingModeLoading = useTradingMode((s) => s.loading)
  const healthMap = useAccountHealth()
  const tradingConfig = useTradingConfig()
  const brokerReadiness = useBrokerPackReadiness()
  const [data, setData] = useState<PortfolioData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [curvePoints, setCurvePoints] = useState<EquityCurvePoint[]>([])
  const [curveAccountId, setCurveAccountId] = useState<string | 'all'>('') // '' = not yet initialized
  const [selectedTimestamp, setSelectedTimestamp] = useState<string | null>(null)
  const [selectedSnapshot, setSelectedSnapshot] = useState<UTASnapshotSummary | null>(null)
  const [snapshotEnabled, setSnapshotEnabled] = useState(true)
  const [snapshotEvery, setSnapshotEvery] = useState('15m')
  const [snapshotConfigLoaded, setSnapshotConfigLoaded] = useState(false)
  // Aggregate curve (all UTAs, full per-account breakdown) — shared between
  // hero today-PnL delta and per-account sparklines. Distinct from
  // curvePoints which follows the user's chart-account selection.
  const [aggregateCurve, setAggregateCurve] = useState<CurveSummary | null>(null)
  const portfolioConfigs = useMemo(() => tradingConfig.utas.filter((uta) => uta.keyless !== true), [tradingConfig.utas])

  const accountReadiness = useMemo(() => new Map(
    portfolioConfigs.map((uta) => [uta.id, brokerReadiness.forAccount(uta)]),
  ), [portfolioConfigs, brokerReadiness.forAccount])
  const operationalAccounts = useMemo(() => portfolioConfigs.filter((uta) => (
    uta.enabled !== false && accountReadiness.get(uta.id)?.operational
  )), [accountReadiness, portfolioConfigs])
  const blockedAccounts = useMemo(() => portfolioConfigs.filter((uta) => (
    uta.enabled !== false && !accountReadiness.get(uta.id)?.operational
  )), [accountReadiness, portfolioConfigs])

  const snapshotConfig = useMemo(() => ({ enabled: snapshotEnabled, every: snapshotEvery }), [snapshotEnabled, snapshotEvery])
  const saveSnapshotConfig = useCallback(async (d: Record<string, unknown>) => {
    await api.config.updateSection('snapshot', d)
  }, [])
  const { status: snapshotSaveStatus } = useAutoSave({
    data: snapshotConfig,
    save: saveSnapshotConfig,
    enabled: snapshotConfigLoaded,
  })

  // Fetch curve data for the user's chart-pane selection (single account
  // or 'all'). Distinct from aggregate-curve — that one is always fetched
  // 'all' so per-account derivations stay consistent regardless of the
  // chart pane state.
  const fetchCurveData = useCallback(async (accountId: string | 'all') => {
    if (accountId === 'all') {
      const result = await api.trading.equityCurve({ limit: 200 }).catch(() => ({ points: [] }))
      return result.points
    }
    // Single account — fetch its snapshots and convert to EquityCurvePoint format
    const { snapshots } = await api.trading.snapshots(accountId, { limit: 200 }).catch(() => ({ snapshots: [] as UTASnapshotSummary[] }))
    return snapshots
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(s => ({
        timestamp: s.timestamp,
        equity: s.account.netLiquidation,
        accounts: { [accountId]: s.account.netLiquidation },
      }))
  }, [])

  const refresh = useCallback(async () => {
    if (tradingModeLoading || tradingConfig.loading || brokerReadiness.loading) return
    if (tradingMode === 'lite') {
      setData(EMPTY)
      setAggregateCurve(null)
      setCurvePoints([])
      setSelectedSnapshot(null)
      setSelectedTimestamp(null)
      setLoading(false)
      setLastRefresh(null)
      setRefreshError(null)
      return
    }
    setLoading(true)
    const [portfolioResult, configResult, aggregateResult] = await Promise.all([
      fetchPortfolioData(operationalAccounts),
      api.config.load().catch(() => null),
      operationalAccounts.length > 0
        ? api.trading.equityCurve({ limit: 1500 }).catch(() => ({ points: [] as EquityCurvePoint[] }))
        : Promise.resolve({ points: [] as EquityCurvePoint[] }),
    ])
    setData(portfolioResult.data)
    setAggregateCurve(summarizeAggregateCurve(aggregateResult.points))
    if (configResult?.snapshot) {
      setSnapshotEnabled(configResult.snapshot.enabled)
      setSnapshotEvery(configResult.snapshot.every)
    }
    setSnapshotConfigLoaded(true)

    // Default to first account on initial load
    const effectiveId = curveAccountId || portfolioConfigs[0]?.id || 'all'
    if (!curveAccountId && effectiveId) setCurveAccountId(effectiveId)
    const points = await fetchCurveData(effectiveId)
    setCurvePoints(points)

    setLastRefresh(portfolioResult.liveSucceeded ? new Date() : null)
    setRefreshError(portfolioResult.error)
    setLoading(false)
  }, [brokerReadiness.loading, curveAccountId, fetchCurveData, operationalAccounts, portfolioConfigs, tradingConfig.loading, tradingMode, tradingModeLoading])

  useEffect(() => { ensureTradingModePolling() }, [])
  useEffect(() => { refresh() }, [refresh])

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(refresh, 30_000)
    return () => clearInterval(interval)
  }, [refresh])

  const allPositions = data.accounts.flatMap(a =>
    a.positions.map(p => ({ ...p, accountLabel: a.label, accountProvider: a.provider })),
  )
  const allWalletLogs = data.accounts.flatMap(a =>
    a.walletLog.map(c => ({ ...c, accountLabel: a.label, accountProvider: a.provider })),
  )

  // Account list for the chart switcher
  const chartAccounts = portfolioConfigs.map(a => ({ id: a.id, label: a.label ?? a.id }))

  const handleAccountChange = useCallback(async (id: string | 'all') => {
    setCurveAccountId(id)
    setSelectedSnapshot(null)
    setSelectedTimestamp(null)
    const points = await fetchCurveData(id)
    setCurvePoints(points)
  }, [fetchCurveData])

  const handlePointClick = useCallback(async (point: EquityCurvePoint) => {
    setSelectedTimestamp(point.timestamp)
    const accountId = curveAccountId !== 'all' ? curveAccountId : Object.keys(point.accounts)[0]
    if (!accountId) return
    try {
      const { snapshots } = await api.trading.snapshots(accountId, { limit: 1 })
      if (snapshots.length > 0) setSelectedSnapshot(snapshots[0])
    } catch {
      // Ignore — snapshot fetch failed
    }
  }, [curveAccountId])

  // Merge equity per-account data with provider info + per-account unrealizedPnL from positions
  const accountSources = (data.equity?.accounts ?? []).map(eq => {
    const acct = data.accounts.find(a => a.id === eq.id)
    const unrealizedPnL = acct?.positions.reduce((sum, p) => sum + Number(p.unrealizedPnL), 0) ?? 0
    const hInfo = healthMap[eq.id]
    return { ...eq, provider: acct?.provider ?? '', unrealizedPnL, error: acct?.error, health: eq.health, disabled: hInfo?.disabled ?? false, connecting: hInfo?.connecting ?? false }
  })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Portfolio"
        description="Live portfolio overview across all trading accounts."
        live={lastRefresh ? { lastUpdated: lastRefresh } : undefined}
        right={
          <Button
            onClick={refresh}
            disabled={loading}
            variant="outline"
            size="sm"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        }
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="flex gap-6 items-start">
          {/* Main column */}
          <div className="flex-1 min-w-0 space-y-5">
            {loading && data === EMPTY ? <PortfolioSkeleton /> : <>
            {!tradingModeLoading && tradingMode === 'lite' ? (
              <TradingModeGate
                title="Portfolio is unavailable in Lite mode."
                description="Lite mode keeps UTA disconnected, so there are no broker accounts, positions, or equity snapshots to show. Change the trading mode in Agent Permissions to connect UTA."
              />
            ) : <>
            {refreshError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[12px] leading-[18px] text-destructive" role="alert">
                Live portfolio data is unavailable: {refreshError}
              </div>
            )}

            {blockedAccounts.map((uta) => {
              const readiness = accountReadiness.get(uta.id)!
              return (
                <div key={uta.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 px-1">
                    <span className="text-[12px] font-medium text-foreground">{uta.label ?? uta.id}</span>
                    <AccountReadinessBadge readiness={readiness} health={healthMap[uta.id]} />
                  </div>
                  <BrokerSupportGate
                    readiness={readiness}
                    installingEngine={brokerReadiness.installingEngine}
                    onInstall={brokerReadiness.install}
                    onRetry={brokerReadiness.refresh}
                    compact
                  />
                </div>
              )
            })}
            {operationalAccounts.length > 0 && (
              <HeroMetrics equity={data.equity} curve={aggregateCurve?.total ?? null} />
            )}

            {curvePoints.length > 0 && (
              <div className="space-y-2">
                {curveAccountId !== 'all' && !accountReadiness.get(curveAccountId)?.operational && (
                  <p className="text-[11px] text-warning" role="status">
                    Historical snapshot. Broker support is unavailable on this Runtime, so this chart is not live.
                  </p>
                )}
                <EquityCurve
                  points={curvePoints}
                  accounts={chartAccounts}
                  selectedAccountId={curveAccountId}
                  onAccountChange={handleAccountChange}
                  onPointClick={handlePointClick}
                  selectedTimestamp={selectedTimestamp}
                />
              </div>
            )}

            <SnapshotSettings
              enabled={snapshotEnabled}
              every={snapshotEvery}
              onEnabledChange={setSnapshotEnabled}
              onEveryChange={setSnapshotEvery}
              saveStatus={snapshotSaveStatus}
            />

            {selectedSnapshot && (
              <SnapshotDetail
                snapshot={selectedSnapshot}
                onClose={() => { setSelectedSnapshot(null); setSelectedTimestamp(null) }}
              />
            )}

            {accountSources.length > 0 && (
              <AccountStrip
                sources={accountSources}
                perAccountCurve={aggregateCurve?.perAccount ?? {}}
              />
            )}

            {allPositions.length > 0 && (
              <PositionsTable positions={allPositions} fxRates={data.fxRates} />
            )}

            {/* Empty states */}
            {portfolioConfigs.length === 0 && !loading && (
              <NoAccountsEmpty />
            )}
            {data.accounts.length > 0 && allPositions.length === 0 && !loading && (
              <EmptyState title="No open positions." />
            )}

            {allWalletLogs.length > 0 && (
              <TradeLog commits={allWalletLogs} />
            )}
            </>}
            </>}
          </div>

          {/* Right sidebar — FX rates */}
          {data.fxRates.length > 0 && (
            <div className="hidden lg:block w-[200px] shrink-0 sticky top-5">
              <FxRatesPanel rates={data.fxRates} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== Data Fetching ====================

async function fetchPortfolioData(configuredAccounts: Array<{ id: string; label?: string }>): Promise<{
  data: PortfolioData
  liveSucceeded: boolean
  error: string | null
}> {
  if (configuredAccounts.length === 0) return { data: EMPTY, liveSucceeded: false, error: null }

  const [equityResult, fxResult, accountResults] = await Promise.all([
    api.trading.equity().then((value) => ({ value })).catch((error: unknown) => ({ error })),
    api.trading.fxRates().then((value) => ({ value })).catch(() => ({ value: { rates: [] as FxRateInfo[] } })),
    Promise.all(configuredAccounts.map(async (configured): Promise<{ account: AccountData; live: boolean }> => {
      const [accountResult, positionResult, logResult] = await Promise.allSettled([
        api.trading.utaAccount(configured.id),
        api.trading.utaPositions(configured.id),
        api.trading.walletLog(configured.id, 10),
      ])
      const live = accountResult.status === 'fulfilled'
      return {
        live,
        account: {
          id: configured.id,
          label: configured.label ?? configured.id,
          provider: displayProviderForUTA(configured),
          positions: positionResult.status === 'fulfilled' ? positionResult.value.positions : [],
          walletLog: logResult.status === 'fulfilled' ? logResult.value.commits : [],
          ...(!live ? { error: 'Live account data is unavailable' } : {}),
        },
      }
    })),
  ])

  const equity = 'value' in equityResult ? equityResult.value : null
  const fxRates = fxResult.value.rates
  const liveSucceeded = equity !== null || accountResults.some((result) => result.live)
  const error = liveSucceeded
    ? null
    : ('error' in equityResult && equityResult.error instanceof Error
        ? equityResult.error.message
        : 'No configured account returned live data.')
  return {
    data: { equity, accounts: accountResults.map((result) => result.account), fxRates },
    liveSucceeded,
    error,
  }
}

// ==================== Empty: no trading accounts ====================

function NoAccountsEmpty() {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const goToTradingSettings = () => {
    setSidebar('settings')
    openOrFocus({ kind: 'settings', params: { category: 'trading' } })
  }
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <EmptyState
        title="No trading accounts connected."
        description="Add a broker connection to see account equity and positions."
      />
      <Button
        onClick={goToTradingSettings}
        size="sm"
      >
        Add broker in Settings → Trading
      </Button>
    </div>
  )
}

// ==================== Hero Metrics ====================

function HeroMetrics({ equity, curve }: {
  equity: AggregatedEquity | null
  curve: CurvePointSummary | null
}) {
  if (!equity) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 text-center">
        <p className="text-[13px] text-muted-foreground">Unable to load portfolio data.</p>
      </div>
    )
  }

  const total = Number(equity.totalEquity)
  const cash = Number(equity.totalCash)
  const unrealized = Number(equity.totalUnrealizedPnL)
  const realized = Number(equity.totalRealizedPnL)

  // Today PnL — same shape as TradingPage hero. Suppress when no baseline
  // is available yet (fresh portfolio with no 24h history).
  let todayDelta: { value: string; sign: 'up' | 'down' | 'flat' } | undefined
  const computedTodayDelta = computeTodayDelta(curve)
  if (computedTodayDelta) {
    todayDelta = {
      value: `${fmtPnl(computedTodayDelta.delta, 'USD')} (${fmtPctSigned(computedTodayDelta.pct)}) today`,
      sign: computedTodayDelta.sign,
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card px-5 py-5">
      <Metric
        size="lg"
        label="Total Equity (USD)"
        value={fmt(total, 'USD')}
        delta={todayDelta ?? { value: '— today', sign: 'flat' }}
      />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-border">
        <Metric size="sm" label="Cash" value={fmt(cash, 'USD')} />
        <Metric
          size="sm"
          label="Unrealized PnL"
          value={fmtPnl(unrealized, 'USD')}
          valueSign={signFromDelta(unrealized)}
        />
        <Metric
          size="sm"
          label="Realized PnL"
          value={fmtPnl(realized, 'USD')}
          valueSign={signFromDelta(realized)}
        />
      </div>
    </div>
  )
}

// ==================== Cold-start skeleton ====================

/** First-load placeholder for the portfolio main column. Mirrors the real
 *  layout's shapes (hero metrics → curve → account strip → positions) so the
 *  page reads as "loading this" rather than a blank white pane while the broker
 *  reads (which can be slow on a cold connect) come back. */
function PortfolioSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      {/* Hero metrics */}
      <div className="rounded-lg border border-border bg-card p-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-48 mt-3" />
        <div className="flex flex-wrap gap-5 sm:gap-8 mt-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
      {/* Equity curve */}
      <Skeleton className="h-[220px] w-full rounded-lg" />
      {/* Account strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3">
            <Skeleton className="size-3 rounded-sm" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-2.5 w-16" />
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
      {/* Positions table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-secondary">
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="hidden sm:block h-4 w-12" />
              <Skeleton className="h-4 w-16 ml-auto" />
              <Skeleton className="hidden md:block h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ==================== Account Strip ====================

function AccountStrip({ sources, perAccountCurve }: {
  sources: Array<{ id: string; label: string; provider: string; equity: string; unrealizedPnL: number; error?: string; health?: string; disabled?: boolean; connecting?: boolean }>
  perAccountCurve: Record<string, CurvePointSummary>
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {sources.map(s => {
        const isDisabled = s.disabled
        // Initial connect in flight — distinct from offline. `health` is
        // optimistically 'healthy' here, so this can only come from the flag.
        const isConnecting = !!s.connecting && !isDisabled
        const isOffline = s.health === 'offline' && !isDisabled && !isConnecting
        const StatusIcon = isDisabled
          ? CircleMinus
          : isConnecting
            ? LoaderCircle
            : isOffline
              ? CircleX
              : s.health === 'degraded'
                ? TriangleAlert
                : CircleCheck
        const statusColor = isDisabled
          ? 'text-muted-foreground/50'
          : isConnecting
            ? 'text-primary'
            : isOffline
              ? 'text-destructive'
              : s.health === 'degraded'
                ? 'text-warning'
                : 'text-success'

        const curve = perAccountCurve[s.id]
        const todayDelta = computeTodayDelta(curve ?? null)
        const TodayDeltaIcon = !todayDelta || todayDelta.delta === 0
          ? Minus
          : todayDelta.delta > 0
            ? ArrowUpRight
            : ArrowDownRight
        const todayDeltaTone = !todayDelta || todayDelta.delta === 0
          ? 'text-muted-foreground'
          : todayDelta.delta > 0
            ? 'text-success'
            : 'text-destructive'
        const showSpark = !isDisabled && !isOffline && !isConnecting && curve && curve.values.length >= 2

        return (
          <div key={s.id} className={`flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3 ${isOffline || isDisabled ? 'opacity-60' : ''}`}>
            <StatusIcon
              aria-hidden
              className={`size-3.5 shrink-0 ${statusColor} ${isConnecting ? 'animate-spin motion-reduce:animate-none' : ''}`}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-foreground font-medium text-[13px] truncate">{s.label}</span>
                {!isDisabled && !isOffline && !isConnecting && (
                  <span className="text-muted-foreground tabular-nums text-[13px] leading-[18px]">{fmt(Number(s.equity))}</span>
                )}
              </div>
              <div className="flex items-baseline justify-between gap-2 mt-0.5">
                {isDisabled
                  ? <span className="text-muted-foreground text-[11px]">Disabled</span>
                  : isConnecting
                    ? <span className="text-primary text-[11px]">Connecting…</span>
                  : isOffline
                    ? <span className="text-destructive text-[11px]">Reconnecting…</span>
                    : (
                      <span className="text-[11px] leading-[15px] tabular-nums">
                        {todayDelta ? (
                          <span className={`inline-flex items-center gap-1 ${todayDeltaTone}`}>
                            <TodayDeltaIcon aria-hidden className="size-3 shrink-0" />
                            {fmtPnl(todayDelta.delta)} today
                          </span>
                        ) : s.unrealizedPnL !== 0 ? (
                          <span className={s.unrealizedPnL >= 0 ? 'text-success' : 'text-destructive'}>
                            {fmtPnl(s.unrealizedPnL)} unrealized
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
                    )
                }
                {s.error && !isOffline && !isDisabled && <span className="text-[11px] text-muted-foreground">{s.error}</span>}
              </div>
            </div>
            {showSpark && (
              <div className="hidden md:block shrink-0">
                <Sparkline values={curve!.values} width={88} height={36} color="auto" />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ==================== Positions Table ====================

export interface PositionWithAccount extends Position {
  accountLabel: string
  accountProvider: string
}

/**
 * Build display fragments for a contract.
 *
 * The `tag` is the canonical SecType string (STK / CRYPTO / CRYPTO_PERP /
 * OPT / FUT / ...) — no vernacular translation. UI mirrors the taxonomy
 * directly so a `[CRYPTO_PERP]` pill is unambiguously the same thing as
 * `Position.contract.secType === 'CRYPTO_PERP'` everywhere else in the
 * stack.
 *
 * `name` comes from the shared IBKR-superset formatter (lib/contract-display)
 * so this table renders identically to the UTA detail page.
 */
function contractDisplay(p: Position): { name: string; tag: string } {
  return { name: contractPrimary(p.contract), tag: p.contract.secType || 'UNK' }
}

function PositionDetail({
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

export function PositionsTable({ positions, fxRates }: { positions: PositionWithAccount[]; fxRates: FxRateInfo[] }) {
  const rateMap = Object.fromEntries(fxRates.map(r => [r.currency, r.rate]))
  const hasNonUsd = positions.some(p => p.currency && p.currency !== 'USD')
  const rows = positions.map((position, index) => {
    const display = contractDisplay(position)
    const currency = position.currency ?? 'USD'
    const fxRate = currency === 'USD' ? 1 : (rateMap[currency] ?? 1)
    const unrealizedPnl = Number(position.unrealizedPnL)
    const cost = Number(position.avgCost) * Number(position.quantity)
    const pnlPercent = cost > 0 ? (unrealizedPnl / cost) * 100 : 0

    return {
      key: `${position.accountProvider}:${position.accountLabel}:${position.contract.aliceId ?? display.name}:${index}`,
      position,
      display,
      currency,
      usdValue: Number(position.marketValue) * fxRate,
      unrealizedPnl,
      pnlPercent,
      isShort: position.side === 'short',
    }
  })

  return (
    <div>
      <h3 className="mb-3 text-[13px] leading-[18px] font-semibold text-foreground">
        Positions
      </h3>
      <div
        data-testid="portfolio-positions-mobile"
        className="overflow-hidden rounded-lg border border-border md:hidden"
      >
        {rows.map(({ key, position, display, currency, usdValue, unrealizedPnl, pnlPercent, isShort }) => {
          const pnlTone = unrealizedPnl >= 0 ? 'text-success' : 'text-destructive'
          return (
            <details key={key} className="group border-t border-border first:border-t-0">
              <summary
                aria-label={`${display.name} in ${position.accountLabel}, market value ${fmt(Number(position.marketValue), position.currency)}, PnL ${fmtPctSigned(pnlPercent)}, ${fmtPnl(unrealizedPnl, position.currency)}. Expand for position details.`}
                className="list-none px-3 py-3 outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium text-foreground" title={display.name}>{display.name}</span>
                      <span className="shrink-0 rounded-sm bg-muted px-1 py-0.5 font-mono text-[10px] leading-[14px] tracking-tight text-muted-foreground">
                        {display.tag}
                      </span>
                      {isShort && (
                        <span className="shrink-0 rounded-sm bg-destructive/15 px-1 py-0.5 text-[10px] leading-[14px] font-medium text-destructive">
                          Short
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] leading-[14px] text-muted-foreground">
                      <span className="truncate">{position.accountLabel}</span>
                      <span className="shrink-0 font-mono">{currency}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold tabular-nums text-foreground">
                      {fmt(Number(position.marketValue), position.currency)}
                    </div>
                    <div className={`mt-0.5 flex justify-end gap-2 text-[11px] leading-[15px] tabular-nums ${pnlTone}`}>
                      <span>{fmtPctSigned(pnlPercent)}</span>
                      <span>{fmtPnl(unrealizedPnl, position.currency)}</span>
                    </div>
                  </div>
                  <ChevronDown
                    size={14}
                    aria-hidden="true"
                    className="mt-1 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  />
                </div>
              </summary>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border bg-secondary/35 px-3 py-3">
                <PositionDetail label="Quantity" value={fmtNum(Number(position.quantity))} />
                <PositionDetail label="Average cost" value={fmt(Number(position.avgCost), position.currency)} />
                <PositionDetail label="Current price" value={fmt(Number(position.marketPrice), position.currency)} />
                <PositionDetail
                  label="Unrealized PnL"
                  value={fmtPnl(unrealizedPnl, position.currency)}
                  valueClassName={pnlTone}
                />
                {hasNonUsd && currency !== 'USD' && (
                  <PositionDetail label="USD value" value={fmt(usdValue)} />
                )}
              </dl>
            </details>
          )
        })}
      </div>
      <div
        data-testid="portfolio-positions-desktop"
        className="hidden overflow-x-auto rounded-lg border border-border md:block"
      >
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-secondary text-muted-foreground text-left">
              <th className="px-3 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium text-center">Ccy</th>
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium text-right">Avg Cost</th>
              <th className="px-3 py-2 font-medium text-right">Current</th>
              <th className="px-3 py-2 font-medium text-right">Mkt Value</th>
              {hasNonUsd && <th className="px-3 py-2 font-medium text-right">USD Value</th>}
              <th className="px-3 py-2 font-medium text-right">PnL</th>
              <th className="px-3 py-2 font-medium text-right">PnL %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, position: p, display, currency: ccy, usdValue, unrealizedPnl, pnlPercent, isShort }) => {
              return (
                <tr key={key} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-foreground">{display.name}</span>
                      <span className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[10px] leading-[14px] tracking-tight text-muted-foreground">{display.tag}</span>
                      {isShort && (
                        <span className="rounded-sm bg-destructive/15 px-1 py-0.5 text-[10px] leading-[14px] font-medium text-destructive">Short</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{p.accountLabel}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center text-muted-foreground text-[11px]">{ccy}</td>
                  <td className="px-3 py-2 text-right text-foreground">{fmtNum(Number(p.quantity))}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{fmt(Number(p.avgCost), p.currency)}</td>
                  <td className="px-3 py-2 text-right text-foreground">{fmt(Number(p.marketPrice), p.currency)}</td>
                  <td className="px-3 py-2 text-right text-foreground">{fmt(Number(p.marketValue), p.currency)}</td>
                  {hasNonUsd && (
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {ccy === 'USD' ? '—' : fmt(usdValue)}
                    </td>
                  )}
                  <td className={`px-3 py-2 text-right font-medium ${unrealizedPnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {fmtPnl(unrealizedPnl, p.currency)}
                  </td>
                  <td className={`px-3 py-2 text-right ${unrealizedPnl >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {fmtPctSigned(pnlPercent)}
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

// ==================== FX Rates Panel ====================

function FxRatesPanel({ rates }: { rates: FxRateInfo[] }) {
  return (
    <div>
      <h3 className="mb-2 text-[13px] leading-[18px] font-semibold text-foreground">
        FX Rates
      </h3>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-[12px]">
          <tbody>
            {rates.map(r => (
              <tr key={r.currency} className="border-t border-border first:border-t-0">
                <td className="px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    {r.source === 'live'
                      ? <CircleCheck aria-hidden className="size-3 shrink-0 text-success" />
                      : r.source === 'cached'
                        ? <Clock3 aria-hidden className="size-3 shrink-0 text-warning" />
                        : <CircleMinus aria-hidden className="size-3 shrink-0 text-muted-foreground/50" />}
                    <span className="font-medium text-foreground">{r.currency}</span>
                  </div>
                </td>
                <td className="px-2.5 py-1.5 text-right text-foreground tabular-nums">{r.rate.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-right text-[10px] text-muted-foreground">per 1 unit → USD</p>
    </div>
  )
}

// ==================== Trade Log ====================

interface CommitWithAccount extends WalletCommitLog {
  accountLabel: string
  accountProvider: string
}

function TradeLog({ commits }: { commits: CommitWithAccount[] }) {
  const sorted = [...commits]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)

  if (sorted.length === 0) return null

  return (
    <div>
      <h3 className="mb-3 text-[13px] leading-[18px] font-semibold text-foreground">
        Recent Trades
      </h3>
      <div className="space-y-2">
        {sorted.map((commit) => {
          const badgeColor = commit.accountProvider === 'ccxt'
            ? 'bg-primary/15 text-primary'
            : commit.accountProvider === 'alpaca'
              ? 'bg-success/15 text-success'
              : 'bg-muted text-muted-foreground'
          return (
            <div key={commit.hash} className="rounded-lg border border-border bg-card px-3 py-2.5">
              <div className="flex items-start gap-2">
                <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] leading-[14px] ${badgeColor}`}>
                  {commit.accountLabel}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-foreground truncate">{commit.message}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] leading-[15px] text-muted-foreground font-mono">{commit.hash}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(commit.timestamp).toLocaleString()}
                    </span>
                  </div>
                  {commit.operations.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {commit.operations.map((op, i) => (
                        <span key={i} className="rounded-sm border border-border/60 px-1.5 py-0.5 text-[11px] leading-[15px] text-muted-foreground">
                          {op.symbol} {op.change}
                          <span className={`ml-1 ${op.status === 'filled' ? 'text-success' : op.status === 'rejected' ? 'text-destructive' : op.status === 'submitted' ? 'text-primary' : 'text-muted-foreground'}`}>
                            {op.status}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ==================== Snapshot Settings ====================

const INTERVAL_PRESETS = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
]

export function isValidSnapshotInterval(value: string): boolean {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value.trim())
  if (!match) return false
  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2] ?? 0)
  const seconds = Number(match[3] ?? 0)
  return hours > 0 || minutes > 0 || seconds > 0
}

export function SnapshotSettings({ enabled, every, onEnabledChange, onEveryChange, saveStatus }: {
  enabled: boolean
  every: string
  onEnabledChange: (v: boolean) => void
  onEveryChange: (v: string) => void
  saveStatus: string
}) {
  const isPreset = INTERVAL_PRESETS.some(p => p.value === every)
  const [showCustom, setShowCustom] = useState(!isPreset)
  const [customEvery, setCustomEvery] = useState(every)
  const customEveryValid = isValidSnapshotInterval(customEvery)

  useEffect(() => {
    setCustomEvery(every)
    if (!isPreset) setShowCustom(true)
  }, [every, isPreset])

  return (
    <div className="flex min-h-12 flex-col gap-2 rounded-lg border border-border/70 bg-card px-3 py-2.5 text-[12px] leading-[18px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-foreground">Snapshots</span>
        <Toggle checked={enabled} onChange={onEnabledChange} size="sm" ariaLabel="Enable portfolio snapshots" />
        {saveStatus === 'saving' && <span className="text-[10px] text-primary">Saving…</span>}
        {saveStatus === 'error' && <span className="text-[10px] text-destructive">Save failed</span>}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Every</span>
        <SegmentedControl
          value={showCustom ? 'custom' : every}
          options={[
            ...INTERVAL_PRESETS.map((preset) => ({ value: preset.value, label: preset.label })),
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={(next) => {
            if (next === 'custom') {
              setShowCustom(true)
              return
            }
            onEveryChange(next)
            setShowCustom(false)
          }}
          ariaLabel="Portfolio snapshot interval"
          compact
        />
        {showCustom && (
          <div className="relative">
            <input
              aria-label="Custom portfolio snapshot interval"
              aria-invalid={!customEveryValid}
              aria-describedby={!customEveryValid ? 'snapshot-interval-error' : undefined}
              className="w-20 rounded-md border border-border bg-background px-1.5 py-1 text-center text-[12px] leading-[18px] text-foreground outline-none focus:border-primary"
              value={customEvery}
              onChange={(e) => {
                const next = e.target.value
                setCustomEvery(next)
                if (isValidSnapshotInterval(next)) onEveryChange(next.trim())
              }}
              placeholder="e.g. 2h"
            />
            {!customEveryValid && (
              <p
                id="snapshot-interval-error"
                role="alert"
                className="absolute right-0 top-full z-10 mt-1 w-max max-w-64 rounded-xl border border-destructive/30 bg-popover px-2 py-1 text-[11px] leading-[15px] text-destructive shadow-md"
              >
                Use a positive duration such as 15m, 1h, or 2h15m.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
