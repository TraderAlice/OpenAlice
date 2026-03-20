import { useState, useEffect, useCallback } from 'react'
import { api, type Position, type WalletCommitLog } from '../api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/StateViews'

// ==================== Types ====================

interface AggregatedEquity {
  totalEquity: number
  totalCash: number
  totalUnrealizedPnL: number
  totalRealizedPnL: number
  accounts: Array<{ id: string; label: string; equity: number; cash: number; health?: string }>
}

interface AccountData {
  id: string
  provider: string
  label: string
  positions: Position[]
  walletLog: WalletCommitLog[]
  error?: string
}

interface PortfolioData {
  equity: AggregatedEquity | null
  accounts: AccountData[]
}

const EMPTY: PortfolioData = { equity: null, accounts: [] }

// ==================== Page ====================

export function PortfolioPage() {
  const [data, setData] = useState<PortfolioData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = await fetchPortfolioData()
    setData(result)
    setLastRefresh(new Date())
    setLoading(false)
  }, [])

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

  // Merge equity per-account data with provider info + per-account unrealizedPnL from positions
  const accountSources = (data.equity?.accounts ?? []).map(eq => {
    const acct = data.accounts.find(a => a.id === eq.id)
    const unrealizedPnL = acct?.positions.reduce((sum, p) => sum + p.unrealizedPnL, 0) ?? 0
    return { ...eq, provider: acct?.provider ?? '', unrealizedPnL, error: acct?.error, health: eq.health }
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
        <div className="max-w-[900px] space-y-5">
          <HeroMetrics equity={data.equity} />

          {accountSources.length > 0 && (
            <AccountStrip sources={accountSources} />
          )}

          {allPositions.length > 0 && (
            <PositionsTable positions={allPositions} />
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
      </div>
    </div>
  )
}

// ==================== Data Fetching ====================

async function fetchPortfolioData(): Promise<PortfolioData> {
  try {
    const [equityResult, accountsResult] = await Promise.allSettled([
      api.trading.equity(),
      api.trading.listAccounts(),
    ])

    const equity = equityResult.status === 'fulfilled' ? equityResult.value : null
    const accountsList = accountsResult.status === 'fulfilled' ? accountsResult.value.accounts : []

    const accounts = await Promise.all(
      accountsList.map(async (acct): Promise<AccountData> => {
        try {
          const [posResp, logResp] = await Promise.all([
            api.trading.positions(acct.id),
            api.trading.walletLog(acct.id, 10),
          ])
          return { ...acct, positions: posResp.positions, walletLog: logResp.commits }
        } catch {
          return { ...acct, positions: [], walletLog: [], error: 'Not connected' }
        }
      }),
    )

    return { equity, accounts }
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
        <HeroItem label="Total Equity" value={fmt(equity.totalEquity)} />
        <HeroItem label="Cash" value={fmt(equity.totalCash)} />
        <HeroItem label="Unrealized PnL" value={fmtPnl(equity.totalUnrealizedPnL)} pnl={equity.totalUnrealizedPnL} />
        <HeroItem label="Realized PnL" value={fmtPnl(equity.totalRealizedPnL)} pnl={equity.totalRealizedPnL} />
      </div>
    </div>
  )
}

function HeroItem({ label, value, pnl }: { label: string; value: string; pnl?: number }) {
  const color = pnl == null ? 'text-text' : pnl >= 0 ? 'text-green' : 'text-red'
  return (
    <div>
      <p className="text-[11px] text-text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-[20px] md:text-[24px] font-semibold ${color}`}>{value}</p>
    </div>
  )
}

// ==================== Account Strip ====================

const HEALTH_DOT: Record<string, string> = {
  healthy: 'bg-green',
  degraded: 'bg-yellow-400',
  offline: 'bg-red',
}

function AccountStrip({ sources }: { sources: Array<{ id: string; label: string; provider: string; equity: number; unrealizedPnL: number; error?: string; health?: string }> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map(s => {
        const dotColor = HEALTH_DOT[s.health ?? 'healthy'] ?? 'bg-text-muted'
        const isOffline = s.health === 'offline'
        return (
          <div key={s.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-bg-secondary text-[12px] ${isOffline ? 'opacity-60' : ''}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
            <span className="text-text font-medium">{s.label}</span>
            {isOffline
              ? <span className="text-red text-[11px]">Reconnecting…</span>
              : <>
                  <span className="text-text-muted">{fmt(s.equity)}</span>
                  {s.unrealizedPnL !== 0 && (
                    <span className={s.unrealizedPnL >= 0 ? 'text-green' : 'text-red'}>
                      {fmtPnl(s.unrealizedPnL)}
                    </span>
                  )}
                </>
            }
            {s.error && !isOffline && <span className="text-text-muted/50">{s.error}</span>}
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

/** True when the position carries derivative-specific context worth showing (side/leverage). */
function isDerivative(p: Position): boolean {
  const t = p.contract.secType
  if (t === 'FUT' || t === 'OPT' || t === 'FOP') return true
  if (t === 'CRYPTO' && (p.leverage ?? 1) > 1) return true
  return p.side === 'short'
}

/** Build display fragments for a contract based on its secType. */
function contractDisplay(p: Position): { name: string; tag?: string } {
  const c = p.contract
  const sym = c.symbol ?? '???'
  const t = c.secType

  if (t === 'OPT' || t === 'FOP') {
    // Options: show localSymbol if available, else construct from parts
    const optDesc = c.localSymbol
      ?? [sym, c.lastTradeDateOrContractMonth, c.right, c.strike && fmt(c.strike)].filter(Boolean).join(' ')
    return { name: optDesc, tag: 'opt' }
  }
  if (t === 'FUT') {
    const expiry = c.lastTradeDateOrContractMonth
    return { name: expiry ? `${sym} ${expiry}` : sym, tag: 'fut' }
  }
  if (t === 'CRYPTO') {
    return { name: sym, tag: (p.leverage ?? 1) > 1 ? 'swap' : 'spot' }
  }
  // STK, CASH, BOND, CMDTY, etc. — just the symbol, no tag
  return { name: sym }
}

function PositionsTable({ positions }: { positions: PositionWithAccount[] }) {
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
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium text-right">Avg Cost</th>
              <th className="px-3 py-2 font-medium text-right">Current</th>
              <th className="px-3 py-2 font-medium text-right">Mkt Value</th>
              <th className="px-3 py-2 font-medium text-right">PnL</th>
              <th className="px-3 py-2 font-medium text-right">PnL %</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => {
              const display = contractDisplay(p)
              const deriv = isDerivative(p)
              const hasMarginInfo = p.margin || p.liquidationPrice

              return (
                <tr key={i} className="border-t border-border hover:bg-bg-tertiary/30 transition-colors">
                  <td className="px-3 py-2">
                    {/* Primary: symbol + inline badges */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-text">{display.name}</span>
                      {display.tag && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-bg-tertiary text-text-muted">{display.tag}</span>
                      )}
                      {deriv && (
                        <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${p.side === 'long' ? 'bg-green/15 text-green' : 'bg-red/15 text-red'}`}>
                          {p.side}
                        </span>
                      )}
                      {(p.leverage ?? 1) > 1 && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-accent/15 text-accent font-medium">{p.leverage}x</span>
                      )}
                      <span className="text-[10px] text-text-muted/50">{p.accountLabel}</span>
                    </div>
                    {/* Secondary: margin / liquidation for derivatives */}
                    {hasMarginInfo && (
                      <div className="text-[11px] text-text-muted mt-0.5">
                        {p.margin ? `Margin ${fmt(p.margin)}` : ''}
                        {p.margin && p.liquidationPrice ? ' \u00b7 ' : ''}
                        {p.liquidationPrice ? `Liq ${fmt(p.liquidationPrice)}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-text">{fmtNum(Number(p.quantity))}</td>
                  <td className="px-3 py-2 text-right text-text-muted">{fmt(p.avgCost)}</td>
                  <td className="px-3 py-2 text-right text-text">{fmt(p.marketPrice)}</td>
                  <td className="px-3 py-2 text-right text-text">{fmt(p.marketValue)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${p.unrealizedPnL >= 0 ? 'text-green' : 'text-red'}`}>
                    {fmtPnl(p.unrealizedPnL)}
                  </td>
                  <td className={`px-3 py-2 text-right ${p.unrealizedPnL >= 0 ? 'text-green' : 'text-red'}`}>
                    {(() => {
                      const cost = p.avgCost * Number(p.quantity)
                      const pct = cost > 0 ? (p.unrealizedPnL / cost) * 100 : 0
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

function fmt(n: number | null | undefined): string {
  if (n == null) return '$0.00'
  return n >= 1000 ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${n.toFixed(2)}`
}

function fmtPnl(n: number | null | undefined): string {
  const v = n ?? 0
  const sign = v >= 0 ? '+' : ''
  return `${sign}${fmt(v)}`
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '0'
  return n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 4 })
    : n.toPrecision(4)
}
