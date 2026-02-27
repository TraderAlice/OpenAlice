import { useState, useEffect, useCallback } from 'react'
import { api, type CryptoAccount, type CryptoPosition, type SecAccount, type SecHolding, type WalletCommitLog } from '../api'

// ==================== Types ====================

interface PortfolioData {
  crypto: {
    account: CryptoAccount | null
    positions: CryptoPosition[]
    walletLog: WalletCommitLog[]
    error?: string
  }
  securities: {
    account: SecAccount | null
    holdings: SecHolding[]
    walletLog: WalletCommitLog[]
    error?: string
  }
}

const EMPTY: PortfolioData = {
  crypto: { account: null, positions: [], walletLog: [] },
  securities: { account: null, holdings: [], walletLog: [] },
}

// ==================== Page ====================

export function PortfolioPage() {
  const [data, setData] = useState<PortfolioData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)

    // Fetch crypto and securities data in parallel
    const [cryptoResult, secResult] = await Promise.all([
      fetchCryptoData(),
      fetchSecuritiesData(),
    ])

    setData({ crypto: cryptoResult, securities: secResult })
    setLastRefresh(new Date())
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(refresh, 30_000)
    return () => clearInterval(interval)
  }, [refresh])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Portfolio</h2>
            <p className="text-[12px] text-text-muted mt-1">
              Live portfolio overview across crypto and securities.
              {lastRefresh && (
                <span className="ml-2 text-text-muted/50">
                  Updated {lastRefresh.toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="px-3 py-1.5 text-[13px] font-medium rounded-md border border-border hover:bg-bg-tertiary disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[900px] space-y-6">
          {/* Account Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CryptoAccountCard account={data.crypto.account} error={data.crypto.error} />
            <SecAccountCard account={data.securities.account} error={data.securities.error} />
          </div>

          {/* Positions / Holdings */}
          {data.crypto.positions.length > 0 && (
            <PositionsTable positions={data.crypto.positions} />
          )}
          {data.securities.holdings.length > 0 && (
            <HoldingsTable holdings={data.securities.holdings} />
          )}

          {/* Empty state */}
          {!data.crypto.account && !data.securities.account && !loading && (
            <div className="text-center py-12 text-text-muted">
              <p className="text-sm">No trading engines connected.</p>
              <p className="text-[12px] mt-1">Configure exchange connections in the Crypto or Securities pages.</p>
            </div>
          )}

          {/* Wallet Logs (trade history) */}
          {(data.crypto.walletLog.length > 0 || data.securities.walletLog.length > 0) && (
            <TradeLog crypto={data.crypto.walletLog} securities={data.securities.walletLog} />
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== Data Fetching ====================

async function fetchCryptoData(): Promise<PortfolioData['crypto']> {
  try {
    const [account, positionsResp, walletResp] = await Promise.all([
      api.trading.cryptoAccount(),
      api.trading.cryptoPositions(),
      api.trading.cryptoWalletLog(10),
    ])
    return { account, positions: positionsResp.positions, walletLog: walletResp.commits }
  } catch {
    return { account: null, positions: [], walletLog: [], error: 'Not connected' }
  }
}

async function fetchSecuritiesData(): Promise<PortfolioData['securities']> {
  try {
    const [account, portfolioResp, walletResp] = await Promise.all([
      api.trading.secAccount(),
      api.trading.secPortfolio(),
      api.trading.secWalletLog(10),
    ])
    return { account, holdings: portfolioResp.holdings, walletLog: walletResp.commits }
  } catch {
    return { account: null, holdings: [], walletLog: [], error: 'Not connected' }
  }
}

// ==================== Account Cards ====================

function CryptoAccountCard({ account, error }: { account: CryptoAccount | null; error?: string }) {
  return (
    <div className="border border-border rounded-lg bg-bg-secondary p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-accent" />
        <h3 className="text-[13px] font-semibold text-text">Crypto</h3>
        {error && <span className="text-[11px] text-text-muted ml-auto">{error}</span>}
      </div>
      {account ? (
        <div className="grid grid-cols-2 gap-3">
          <MetricItem label="Equity" value={fmt(account.equity)} />
          <MetricItem label="Balance" value={fmt(account.balance)} />
          <MetricItem label="Unrealized PnL" value={fmtPnl(account.unrealizedPnL)} pnl={account.unrealizedPnL} />
          <MetricItem label="Total PnL" value={fmtPnl(account.totalPnL)} pnl={account.totalPnL} />
        </div>
      ) : (
        <p className="text-[12px] text-text-muted/60">No data available</p>
      )}
    </div>
  )
}

function SecAccountCard({ account, error }: { account: SecAccount | null; error?: string }) {
  return (
    <div className="border border-border rounded-lg bg-bg-secondary p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-green" />
        <h3 className="text-[13px] font-semibold text-text">Securities</h3>
        {error && <span className="text-[11px] text-text-muted ml-auto">{error}</span>}
      </div>
      {account ? (
        <div className="grid grid-cols-2 gap-3">
          <MetricItem label="Equity" value={fmt(account.equity)} />
          <MetricItem label="Cash" value={fmt(account.cash)} />
          <MetricItem label="Portfolio Value" value={fmt(account.portfolioValue)} />
          <MetricItem label="Unrealized PnL" value={fmtPnl(account.unrealizedPnL)} pnl={account.unrealizedPnL} />
        </div>
      ) : (
        <p className="text-[12px] text-text-muted/60">No data available</p>
      )}
    </div>
  )
}

function MetricItem({ label, value, pnl }: { label: string; value: string; pnl?: number }) {
  const color = pnl == null ? 'text-text' : pnl >= 0 ? 'text-green' : 'text-red'
  return (
    <div>
      <p className="text-[11px] text-text-muted">{label}</p>
      <p className={`text-[14px] font-medium ${color}`}>{value}</p>
    </div>
  )
}

// ==================== Positions Table ====================

function PositionsTable({ positions }: { positions: CryptoPosition[] }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-3">
        Crypto Positions
      </h3>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-bg-secondary text-text-muted text-left">
              <th className="px-3 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium">Side</th>
              <th className="px-3 py-2 font-medium text-right">Size</th>
              <th className="px-3 py-2 font-medium text-right">Entry</th>
              <th className="px-3 py-2 font-medium text-right">Mark</th>
              <th className="px-3 py-2 font-medium text-right">Lev</th>
              <th className="px-3 py-2 font-medium text-right">PnL</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2 font-medium text-text">{p.symbol}</td>
                <td className="px-3 py-2">
                  <span className={p.side === 'long' ? 'text-green' : 'text-red'}>{p.side}</span>
                </td>
                <td className="px-3 py-2 text-right text-text">{fmtNum(p.size)}</td>
                <td className="px-3 py-2 text-right text-text-muted">{fmt(p.entryPrice)}</td>
                <td className="px-3 py-2 text-right text-text">{fmt(p.markPrice)}</td>
                <td className="px-3 py-2 text-right text-text-muted">{p.leverage}x</td>
                <td className={`px-3 py-2 text-right font-medium ${p.unrealizedPnL >= 0 ? 'text-green' : 'text-red'}`}>
                  {fmtPnl(p.unrealizedPnL)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ==================== Holdings Table ====================

function HoldingsTable({ holdings }: { holdings: SecHolding[] }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-3">
        Securities Holdings
      </h3>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-bg-secondary text-text-muted text-left">
              <th className="px-3 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium text-right">Avg Entry</th>
              <th className="px-3 py-2 font-medium text-right">Current</th>
              <th className="px-3 py-2 font-medium text-right">Mkt Value</th>
              <th className="px-3 py-2 font-medium text-right">PnL</th>
              <th className="px-3 py-2 font-medium text-right">PnL %</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2 font-medium text-text">{h.symbol}</td>
                <td className="px-3 py-2 text-right text-text">{fmtNum(h.qty)}</td>
                <td className="px-3 py-2 text-right text-text-muted">{fmt(h.avgEntryPrice)}</td>
                <td className="px-3 py-2 text-right text-text">{fmt(h.currentPrice)}</td>
                <td className="px-3 py-2 text-right text-text">{fmt(h.marketValue)}</td>
                <td className={`px-3 py-2 text-right font-medium ${h.unrealizedPnL >= 0 ? 'text-green' : 'text-red'}`}>
                  {fmtPnl(h.unrealizedPnL)}
                </td>
                <td className={`px-3 py-2 text-right ${h.unrealizedPnLPercent >= 0 ? 'text-green' : 'text-red'}`}>
                  {h.unrealizedPnLPercent >= 0 ? '+' : ''}{h.unrealizedPnLPercent.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ==================== Trade Log ====================

function TradeLog({ crypto, securities }: { crypto: WalletCommitLog[]; securities: WalletCommitLog[] }) {
  // Merge and sort by timestamp descending
  const all = [
    ...crypto.map((c) => ({ ...c, source: 'crypto' as const })),
    ...securities.map((c) => ({ ...c, source: 'securities' as const })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 15)

  if (all.length === 0) return null

  return (
    <div>
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-3">
        Recent Trades
      </h3>
      <div className="space-y-2">
        {all.map((commit) => (
          <div key={commit.hash} className="border border-border rounded-lg bg-bg-secondary px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                commit.source === 'crypto' ? 'bg-accent/15 text-accent' : 'bg-green/15 text-green'
              }`}>
                {commit.source === 'crypto' ? 'CRYPTO' : 'SEC'}
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
                        <span className={`ml-1 ${op.status === 'filled' ? 'text-green' : op.status === 'rejected' ? 'text-red' : 'text-text-muted/50'}`}>
                          {op.status}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ==================== Formatting Helpers ====================

function fmt(n: number): string {
  return n >= 1000 ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${n.toFixed(2)}`
}

function fmtPnl(n: number): string {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${fmt(n)}`
}

function fmtNum(n: number): string {
  return n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 4 })
    : n.toPrecision(4)
}
