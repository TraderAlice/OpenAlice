import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, type Position, type WalletCommitLog, type EquityCurvePoint, type UTASnapshotSummary } from '../api'
import { useAutoSave } from '../hooks/useAutoSave'
import { useAccountHealth } from '../hooks/useAccountHealth'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/StateViews'
import { EquityCurve } from '../components/EquityCurve'
import { SnapshotDetail } from '../components/SnapshotDetail'
import { Toggle } from '../components/Toggle'

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

// ==================== Page ====================

export function PortfolioPage() {
  const healthMap = useAccountHealth()
  const [data, setData] = useState<PortfolioData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [curvePoints, setCurvePoints] = useState<EquityCurvePoint[]>([])
  const [curveAccountId, setCurveAccountId] = useState<string | 'all'>('') // '' = not yet initialized
  const [selectedTimestamp, setSelectedTimestamp] = useState<string | null>(null)
  const [selectedSnapshot, setSelectedSnapshot] = useState<UTASnapshotSummary | null>(null)
  const [snapshotEnabled, setSnapshotEnabled] = useState(true)
  const [snapshotEvery, setSnapshotEvery] = useState('15m')

  const snapshotConfig = useMemo(() => ({ enabled: snapshotEnabled, every: snapshotEvery }), [snapshotEnabled, snapshotEvery])
  const saveSnapshotConfig = useCallback(async (d: Record<string, unknown>) => {
    await api.config.updateSection('snapshot', d)
  }, [])
  const { status: snapshotSaveStatus } = useAutoSave({ data: snapshotConfig, save: saveSnapshotConfig })

  // Fetch curve data for a specific account or all
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
    setLoading(true)
    const [result, configResult] = await Promise.all([
      fetchPortfolioData(),
      api.config.load().catch(() => null),
    ])
    setData(result)
    if (configResult?.snapshot) {
      setSnapshotEnabled(configResult.snapshot.enabled)
      setSnapshotEvery(configResult.snapshot.every)
    }

    // Default to first account on initial load
    const effectiveId = curveAccountId || result.accounts[0]?.id || 'all'
    if (!curveAccountId && effectiveId) setCurveAccountId(effectiveId)
    const points = await fetchCurveData(effectiveId)
    setCurvePoints(points)

    setLastRefresh(new Date())
    setLoading(false)
  }, [curveAccountId, fetchCurveData])

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
  const chartAccounts = data.accounts.map(a => ({ id: a.id, label: a.label }))

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
    return { ...eq, provider: acct?.provider ?? '', unrealizedPnL, error: acct?.error, health: eq.health, disabled: hInfo?.disabled ?? false }
  })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Portfolio"
        description={<>Live portfolio overview across all trading accounts.{lastRefresh && <span className="ml-2 text-text-muted/50">Updated {lastRefresh.toLocaleTimeString()}</span>}</>}
        right={
          <button
            onClick={refresh}
            disabled={loading}
            className="px-3 py-1.5 text-[13px] font-medium rounded-md border border-border hover:bg-bg-tertiary disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        }
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="flex gap-6 items-start">
          {/* Main column */}
          <div className="flex-1 min-w-0 space-y-5">
            <HeroMetrics equity={data.equity} />

            {curvePoints.length > 0 && (
              <EquityCurve
                points={curvePoints}
                accounts={chartAccounts}
                selectedAccountId={curveAccountId}
                onAccountChange={handleAccountChange}
                onPointClick={handlePointClick}
                selectedTimestamp={selectedTimestamp}
              />
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
              <AccountStrip sources={accountSources} />
            )}

            {allPositions.length > 0 && (
              <PositionsTable positions={allPositions} fxRates={data.fxRates} />
            )}

            {/* Empty states */}
            {data.accounts.length === 0 && !loading && (
              <EmptyState title="No trading accounts connected." description="Configure connections in the Trading page." />
            )}
            {data.accounts.length > 0 && allPositions.length === 0 && !loading && (
              <EmptyState title="No open positions." />
            )}

            {allWalletLogs.length > 0 && (
              <TradeLog commits={allWalletLogs} />
            )}
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

async function fetchPortfolioData(): Promise<PortfolioData> {
  try {
    const [equityResult, utasResult, fxResult] = await Promise.allSettled([
      api.trading.equity(),
      api.trading.listUTAs(),
      api.trading.fxRates(),
    ])

    const equity = equityResult.status === 'fulfilled' ? equityResult.value : null
    const utasList = utasResult.status === 'fulfilled' ? utasResult.value.utas : []
    const fxRates = fxResult.status === 'fulfilled' ? fxResult.value.rates : []

    const accounts = await Promise.all(
      utasList.map(async (acct): Promise<AccountData> => {
        try {
          const [posResp, logResp] = await Promise.all([
            api.trading.utaPositions(acct.id),
            api.trading.walletLog(acct.id, 10),
          ])
          return { ...acct, positions: posResp.positions, walletLog: logResp.commits }
        } catch {
          return { ...acct, positions: [], walletLog: [], error: 'Not connected' }
        }
      }),
    )

    return { equity, accounts, fxRates }
  } catch {
    return EMPTY
  }
}

// ==================== Hero Metrics ====================

function HeroMetrics({ equity }: { equity: AggregatedEquity | null }) {
  if (!equity) {
    return (
      <div className="border border-border rounded-lg bg-bg-secondary p-5 text-center">
        <p className="text-[13px] text-text-muted">Unable to load portfolio data.</p>
      </div>
    )
  }

  return (
    <div className="border border-border rounded-lg bg-bg-secondary p-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <HeroItem label="Total Equity" value={fmt(Number(equity.totalEquity))} />
        <HeroItem label="Cash" value={fmt(Number(equity.totalCash))} />
        <HeroItem label="Unrealized PnL" value={fmtPnl(Number(equity.totalUnrealizedPnL))} pnl={Number(equity.totalUnrealizedPnL)} />
        <HeroItem label="Realized PnL" value={fmtPnl(Number(equity.totalRealizedPnL))} pnl={Number(equity.totalRealizedPnL)} />
      </div>
    </div>
  )
}

function HeroItem({ label, value, pnl }: { label: string; value: string; pnl?: number }) {
  const color = pnl == null ? 'text-text' : pnl >= 0 ? 'text-green' : 'text-red'
  return (
    <div>
      <p className="text-[11px] text-text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-[22px] md:text-[28px] font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

// ==================== Account Strip ====================

const HEALTH_DOT: Record<string, string> = {
  healthy: 'bg-green',
  degraded: 'bg-yellow-400',
  offline: 'bg-red',
}

function AccountStrip({ sources }: { sources: Array<{ id: string; label: string; provider: string; equity: string; unrealizedPnL: number; error?: string; health?: string; disabled?: boolean }> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map(s => {
        const isDisabled = s.disabled
        const isOffline = s.health === 'offline' && !isDisabled
        const dotColor = isDisabled
          ? 'bg-text-muted/40'
          : (HEALTH_DOT[s.health ?? 'healthy'] ?? 'bg-text-muted')
        return (
          <div key={s.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-bg-secondary text-[12px] ${isOffline || isDisabled ? 'opacity-60' : ''}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
            <span className="text-text font-medium">{s.label}</span>
            {isDisabled
              ? <span className="text-text-muted text-[11px]">Disabled</span>
              : isOffline
                ? <span className="text-red text-[11px]">Reconnecting...</span>
                : <>
                    <span className="text-text-muted">{fmt(Number(s.equity))}</span>
                    {s.unrealizedPnL !== 0 && (
                      <span className={s.unrealizedPnL >= 0 ? 'text-green' : 'text-red'}>
                        {fmtPnl(s.unrealizedPnL)}
                      </span>
                    )}
                  </>
            }
            {s.error && !isOffline && !isDisabled && <span className="text-text-muted/50">{s.error}</span>}
          </div>
        )
      })}
    </div>
  )
}

// ==================== Positions Table ====================

interface PositionWithAccount extends Position {
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
 * `name` defaults to the symbol; for OPT/FOP we build a longer descriptor
 * (expiry/right/strike) so two option positions on the same underlying
 * are distinguishable in the table.
 */
function contractDisplay(p: Position): { name: string; tag: string } {
  const c = p.contract
  const sym = c.symbol ?? '???'
  const t = c.secType || 'UNK'

  if (t === 'OPT' || t === 'FOP') {
    const optDesc = c.localSymbol
      ?? [sym, c.lastTradeDateOrContractMonth, c.right, c.strike && fmt(c.strike)].filter(Boolean).join(' ')
    return { name: optDesc, tag: t }
  }
  if (t === 'FUT') {
    const expiry = c.lastTradeDateOrContractMonth
    return { name: expiry ? `${sym} ${expiry}` : sym, tag: t }
  }
  return { name: sym, tag: t }
}

function PositionsTable({ positions, fxRates }: { positions: PositionWithAccount[]; fxRates: FxRateInfo[] }) {
  const rateMap = Object.fromEntries(fxRates.map(r => [r.currency, r.rate]))
  const hasNonUsd = positions.some(p => p.currency && p.currency !== 'USD')

  return (
    <div>
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-3">
        Positions
      </h3>
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-bg-secondary text-text-muted text-left">
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
            {positions.map((p, i) => {
              const display = contractDisplay(p)
              const ccy = p.currency ?? 'USD'
              const fxRate = ccy === 'USD' ? 1 : (rateMap[ccy] ?? 1)
              const usdValue = Number(p.marketValue) * fxRate
              const isShort = p.side === 'short'

              return (
                <tr key={i} className="border-t border-border hover:bg-bg-tertiary/30 transition-colors">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-text">{display.name}</span>
                      <span className="text-[10px] px-1 py-0.5 rounded bg-bg-tertiary text-text-muted font-mono tracking-tight">{display.tag}</span>
                      {isShort && (
                        <span className="text-[10px] px-1 py-0.5 rounded font-medium bg-red/15 text-red">SHORT</span>
                      )}
                      <span className="text-[10px] text-text-muted/70">{p.accountLabel}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center text-text-muted text-[11px]">{ccy}</td>
                  <td className="px-3 py-2 text-right text-text">{fmtNum(Number(p.quantity))}</td>
                  <td className="px-3 py-2 text-right text-text-muted">{fmt(Number(p.avgCost), p.currency)}</td>
                  <td className="px-3 py-2 text-right text-text">{fmt(Number(p.marketPrice), p.currency)}</td>
                  <td className="px-3 py-2 text-right text-text">{fmt(Number(p.marketValue), p.currency)}</td>
                  {hasNonUsd && (
                    <td className="px-3 py-2 text-right text-text-muted">
                      {ccy === 'USD' ? '—' : fmt(usdValue)}
                    </td>
                  )}
                  <td className={`px-3 py-2 text-right font-medium ${Number(p.unrealizedPnL) >= 0 ? 'text-green' : 'text-red'}`}>
                    {fmtPnl(Number(p.unrealizedPnL), p.currency)}
                  </td>
                  <td className={`px-3 py-2 text-right ${Number(p.unrealizedPnL) >= 0 ? 'text-green' : 'text-red'}`}>
                    {(() => {
                      const cost = Number(p.avgCost) * Number(p.quantity)
                      const pct = cost > 0 ? (Number(p.unrealizedPnL) / cost) * 100 : 0
                      return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
                    })()}
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
      <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">
        FX Rates
      </h3>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-[12px]">
          <tbody>
            {rates.map(r => (
              <tr key={r.currency} className="border-t border-border first:border-t-0">
                <td className="px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.source === 'live' ? 'bg-green' : r.source === 'cached' ? 'bg-yellow-400' : 'bg-text-muted/40'}`} />
                    <span className="font-medium text-text">{r.currency}</span>
                  </div>
                </td>
                <td className="px-2.5 py-1.5 text-right text-text tabular-nums">{r.rate.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-text-muted/50 mt-1.5 text-right">per 1 unit → USD</p>
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
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-3">
        Recent Trades
      </h3>
      <div className="space-y-2">
        {sorted.map((commit) => {
          const badgeColor = commit.accountProvider === 'ccxt'
            ? 'bg-accent/15 text-accent'
            : commit.accountProvider === 'alpaca'
              ? 'bg-green/15 text-green'
              : 'bg-bg-tertiary text-text-muted'
          return (
            <div key={commit.hash} className="border border-border rounded-lg bg-bg-secondary px-3 py-2.5">
              <div className="flex items-start gap-2">
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${badgeColor}`}>
                  {commit.accountLabel}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-text truncate">{commit.message}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] text-text-muted font-mono">{commit.hash}</span>
                    <span className="text-[11px] text-text-muted/50">
                      {new Date(commit.timestamp).toLocaleString()}
                    </span>
                  </div>
                  {commit.operations.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {commit.operations.map((op, i) => (
                        <span key={i} className="text-[11px] text-text-muted bg-bg px-1.5 py-0.5 rounded">
                          {op.symbol} {op.change}
                          <span className={`ml-1 ${op.status === 'filled' ? 'text-green' : op.status === 'rejected' ? 'text-red' : op.status === 'submitted' ? 'text-accent' : 'text-text-muted/50'}`}>
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

// ==================== Formatting Helpers ====================

// ==================== Snapshot Settings ====================

const INTERVAL_PRESETS = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
]

function SnapshotSettings({ enabled, every, onEnabledChange, onEveryChange, saveStatus }: {
  enabled: boolean
  every: string
  onEnabledChange: (v: boolean) => void
  onEveryChange: (v: string) => void
  saveStatus: string
}) {
  const isPreset = INTERVAL_PRESETS.some(p => p.value === every)
  const [showCustom, setShowCustom] = useState(!isPreset)

  return (
    <div className="flex items-center gap-3 text-[12px] text-text-muted">
      <span className="font-medium uppercase tracking-wide">Snapshots</span>
      <Toggle checked={enabled} onChange={onEnabledChange} size="sm" />
      <div className="flex gap-0.5">
        {INTERVAL_PRESETS.map(p => (
          <button
            key={p.value}
            onClick={() => { onEveryChange(p.value); setShowCustom(false) }}
            className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
              every === p.value && !showCustom
                ? 'bg-accent/20 text-accent font-medium'
                : 'hover:text-text hover:bg-bg-tertiary'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(true)}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
            showCustom
              ? 'bg-accent/20 text-accent font-medium'
              : 'hover:text-text hover:bg-bg-tertiary'
          }`}
        >
          Custom
        </button>
      </div>
      {showCustom && (
        <input
          className="w-16 px-1.5 py-0.5 rounded border border-border bg-bg text-text text-[12px] text-center"
          value={every}
          onChange={(e) => onEveryChange(e.target.value)}
          placeholder="e.g. 2h"
        />
      )}
      {saveStatus === 'saving' && <span className="text-accent text-[10px]">saving...</span>}
      {saveStatus === 'error' && <span className="text-red text-[10px]">save failed</span>}
    </div>
  )
}

// ==================== Formatting Helpers ====================

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
  return n >= 1000 ? `${sym}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${sym}${n.toFixed(2)}`
}

function fmtPnl(n: number, currency?: string): string {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${fmt(n, currency)}`
}

function fmtNum(n: number): string {
  return n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 4 })
    : n.toPrecision(4)
}
