import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, type DailyPick, type HourlyEntry, type PickAction, type WatchlistEntry } from '../api'
import { PageHeader } from '../components/PageHeader'

// ==================== Helpers ====================

const ACTION_STYLES: Record<PickAction, { color: string; bg: string; border: string }> = {
  BUY: {
    color: 'text-green',
    bg: 'bg-green/10',
    border: 'border-green/30',
  },
  HOLD: {
    color: 'text-accent',
    bg: 'bg-accent/10',
    border: 'border-accent/30',
  },
  EXIT: {
    color: 'text-red',
    bg: 'bg-red/10',
    border: 'border-red/30',
  },
}

function pnlClass(pnl: string | null): string {
  if (!pnl) return 'text-text-muted'
  const n = Number(pnl)
  if (n > 0.01) return 'text-green'
  if (n < -0.01) return 'text-red'
  return 'text-text-muted'
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function latestEntry(pick: DailyPick | null): HourlyEntry | null {
  if (!pick || pick.hourly.length === 0) return null
  return pick.hourly[pick.hourly.length - 1]
}

function hoursRemaining(pick: DailyPick | null): number {
  // TWSE closes 13:30 Taipei = 05:30 UTC
  if (!pick) return 0
  const now = new Date()
  const utcHr = now.getUTCHours() + now.getUTCMinutes() / 60
  return Math.max(0, Math.round((5.5 - utcHr) * 10) / 10)
}

// ==================== Page ====================

export function TodayPickPage() {
  const [pick, setPick] = useState<DailyPick | null>(null)
  const [recent, setRecent] = useState<DailyPick[]>([])
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [running, setRunning] = useState<'pick' | 'hourly' | 'override' | null>(null)
  const [showOverride, setShowOverride] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [today, recents, wl] = await Promise.all([
        api.dailyPick.today(),
        api.dailyPick.recent(5),
        api.dailyPick.watchlist(),
      ])
      setPick(today.pick)
      setRecent(recents.picks.filter((p) => p.date !== today.pick?.date))
      setWatchlist(wl.entries)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Auto-refresh every 60s while there's an open pick
  useEffect(() => {
    if (!pick || pick.status === 'closed') return
    const id = setInterval(refresh, 60_000)
    return () => clearInterval(id)
  }, [pick, refresh])

  const triggerPick = async () => {
    setRunning('pick')
    try {
      await api.dailyPick.runPick()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pick failed')
    } finally {
      setRunning(null)
    }
  }

  const triggerHourly = async () => {
    setRunning('hourly')
    try {
      await api.dailyPick.runHourly()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hourly failed')
    } finally {
      setRunning(null)
    }
  }

  const triggerOverride = async (symbol: string, name?: string) => {
    setRunning('override')
    try {
      await api.dailyPick.overridePick(symbol, name, `手動切換到 ${symbol}${name ? ` ${name}` : ''}`)
      setShowOverride(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Override failed')
    } finally {
      setRunning(null)
    }
  }

  const latest = useMemo(() => latestEntry(pick), [pick])
  const action: PickAction = latest?.action ?? 'HOLD'
  const styles = ACTION_STYLES[action]

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Today's Pick"
        description={pick ? `${pick.date} · ${pick.symbol}${pick.symbolName ? ` ${pick.symbolName}` : ''}` : 'No pick for today yet'}
        right={
          <div className="flex gap-2">
            <button
              onClick={refresh}
              className="px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-muted hover:text-text transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={() => setShowOverride(!showOverride)}
              className="px-3 py-1.5 text-sm bg-bg-secondary border border-border rounded-lg text-text-muted hover:text-text transition-colors"
            >
              Choose Stock
            </button>
            <button
              onClick={triggerPick}
              disabled={running !== null}
              className="px-3 py-1.5 text-sm bg-accent/10 border border-accent/30 rounded-lg text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {running === 'pick' ? 'Picking…' : pick ? 'Re-pick (AI)' : 'Pick Now'}
            </button>
            {pick && pick.status === 'open' && (
              <button
                onClick={triggerHourly}
                disabled={running !== null}
                className="px-3 py-1.5 text-sm bg-green/10 border border-green/30 rounded-lg text-green hover:bg-green/20 transition-colors disabled:opacity-50"
              >
                {running === 'hourly' ? 'Analyzing…' : 'Run Hourly'}
              </button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {error && (
          <div className="mb-4 px-4 py-2.5 bg-red/10 border border-red/20 rounded-lg text-red text-sm">{error}</div>
        )}

        {showOverride && (
          <OverridePanel
            watchlist={watchlist}
            currentSymbol={pick?.symbol}
            disabled={running !== null}
            onCancel={() => setShowOverride(false)}
            onConfirm={triggerOverride}
          />
        )}

        {loading ? (
          <div className="text-text-muted text-sm">Loading…</div>
        ) : !pick ? (
          <EmptyToday onPick={triggerPick} running={running === 'pick'} />
        ) : (
          <div className="space-y-5 max-w-5xl">
            {/* Hero: action + confidence */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Action card — big number */}
              <div className={`md:col-span-2 ${styles.bg} ${styles.border} border rounded-2xl p-8 flex flex-col justify-between min-h-[200px]`}>
                <div className="text-[11px] uppercase tracking-wider text-text-muted">Recommended Action</div>
                <div className="flex items-end gap-4 flex-wrap">
                  <div className={`text-[88px] leading-none font-bold ${styles.color}`}>{action}</div>
                  <div className="pb-2">
                    <div className="text-2xl font-bold text-text">{pick.symbol}</div>
                    {pick.symbolName && <div className="text-sm text-text-muted">{pick.symbolName}</div>}
                  </div>
                </div>
                {latest?.hardRuleTriggered && (
                  <div className="text-[12px] text-red font-medium">
                    ⚠ Hard rule fired: {latest.hardRuleTriggered}
                  </div>
                )}
              </div>

              {/* Confidence card */}
              <div className="bg-bg-secondary border border-border rounded-2xl p-6 flex flex-col justify-between">
                <div className="text-[11px] uppercase tracking-wider text-text-muted">Confidence</div>
                <div>
                  <div className="text-[64px] leading-none font-bold text-text">
                    {latest?.confidence ?? 0}
                    <span className="text-2xl text-text-muted ml-1">/100</span>
                  </div>
                  <ConfidenceBar value={latest?.confidence ?? 0} />
                </div>
                <div className="text-[12px] text-text-muted">
                  {pick.status === 'closed' ? 'Position closed' : `${hoursRemaining(pick).toFixed(1)}h to close`}
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Price" value={latest?.price ?? '—'} />
              <Stat
                label="Unrealized P&L"
                value={latest?.pnlPct ? `${Number(latest.pnlPct) >= 0 ? '+' : ''}${latest.pnlPct}%` : '—'}
                valueClass={pnlClass(latest?.pnlPct ?? null)}
              />
              <Stat
                label="Entry"
                value={pick.entryPrice ?? '—'}
                sub={pick.entryAt ? formatTime(pick.entryAt) : 'not entered'}
              />
              <Stat
                label="Exit"
                value={pick.exitPrice ?? '—'}
                sub={pick.exitAt ? formatTime(pick.exitAt) : pick.status === 'closed' ? '—' : 'still open'}
              />
            </div>

            {/* Pick reason */}
            <Card title="Pick Reason" subtitle={`Picked at ${formatTime(pick.pickedAt)}`}>
              <p className="text-text text-sm leading-relaxed whitespace-pre-wrap">{pick.pickReason}</p>
            </Card>

            {/* Hourly timeline */}
            <Card title="Hourly Council Deliberations" subtitle={`${pick.hourly.length} entries`}>
              {pick.hourly.length === 0 ? (
                <p className="text-text-muted text-sm">No hourly analysis yet — wait until 10:00 or click "Run Hourly".</p>
              ) : (
                <div className="space-y-3">
                  {[...pick.hourly].reverse().map((h, i) => (
                    <HourlyRow key={i} entry={h} />
                  ))}
                </div>
              )}
            </Card>

            {/* History */}
            {recent.length > 0 && (
              <Card title="Past Picks" subtitle={`Last ${recent.length} trading days`}>
                <div className="overflow-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-secondary/50 text-text-muted text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Symbol</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium text-right">Entry</th>
                        <th className="px-3 py-2 font-medium text-right">Exit</th>
                        <th className="px-3 py-2 font-medium text-right">PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((p) => {
                        const pnl =
                          p.entryPrice && p.exitPrice
                            ? ((Number(p.exitPrice) - Number(p.entryPrice)) / Number(p.entryPrice)) * 100
                            : null
                        return (
                          <tr key={p.date} className="border-t border-border/50">
                            <td className="px-3 py-2 text-text-muted">{p.date}</td>
                            <td className="px-3 py-2 text-text font-medium">
                              {p.symbol}
                              {p.symbolName && <span className="text-text-muted ml-1.5 text-[12px]">{p.symbolName}</span>}
                            </td>
                            <td className="px-3 py-2">
                              <span className={p.status === 'closed' ? 'text-text-muted' : 'text-accent'}>
                                {p.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-text-muted">{p.entryPrice ?? '—'}</td>
                            <td className="px-3 py-2 text-right text-text-muted">{p.exitPrice ?? '—'}</td>
                            <td className={`px-3 py-2 text-right font-medium ${pnlClass(pnl !== null ? pnl.toFixed(2) : null)}`}>
                              {pnl !== null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ==================== Sub-components ====================

function ConfidenceBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value))
  const color = v >= 70 ? 'bg-green' : v >= 40 ? 'bg-accent' : 'bg-red'
  return (
    <div className="mt-3 h-1.5 w-full bg-bg-tertiary rounded-full overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${v}%` }} />
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string
  value: string
  sub?: string
  valueClass?: string
}) {
  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${valueClass ?? 'text-text'}`}>{value}</div>
      {sub && <div className="text-[12px] text-text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-bg-secondary/60 border border-border rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {subtitle && <span className="text-[11px] text-text-muted">{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

function HourlyRow({ entry }: { entry: HourlyEntry }) {
  const styles = ACTION_STYLES[entry.action]
  return (
    <div className={`flex gap-3 p-3 rounded-lg ${styles.bg} border ${styles.border}`}>
      <div className="shrink-0 w-14 text-text-muted font-mono text-sm pt-0.5">{entry.hour}</div>
      <div className="shrink-0 w-16">
        <span className={`px-2 py-0.5 text-[11px] font-bold rounded ${styles.color} ${styles.bg}`}>{entry.action}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-text font-semibold">{entry.price}</span>
          {entry.pnlPct && (
            <span className={`text-[12px] font-medium ${pnlClass(entry.pnlPct)}`}>
              {Number(entry.pnlPct) >= 0 ? '+' : ''}
              {entry.pnlPct}%
            </span>
          )}
          <span className="text-[11px] text-text-muted">conf {entry.confidence}/100</span>
          {entry.hardRuleTriggered && (
            <span className="text-[11px] text-red font-medium">⚠ {entry.hardRuleTriggered}</span>
          )}
        </div>
        <p className="text-[12px] text-text-muted mt-1 leading-relaxed">{entry.reason}</p>
        <details className="mt-2">
          <summary className="text-[11px] text-text-muted cursor-pointer hover:text-text">verdicts</summary>
          <div className="mt-2 space-y-1 text-[11px] text-text-muted pl-3 border-l border-border/50">
            <div>
              <span className="text-accent">trend:</span> {entry.verdicts.trend}
            </div>
            <div>
              <span className="text-accent">signal:</span> {entry.verdicts.signal}
            </div>
            <div>
              <span className="text-accent">risk:</span> {entry.verdicts.risk}
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}

function OverridePanel({
  watchlist,
  currentSymbol,
  disabled,
  onCancel,
  onConfirm,
}: {
  watchlist: WatchlistEntry[]
  currentSymbol?: string
  disabled: boolean
  onCancel: () => void
  onConfirm: (symbol: string, name?: string) => void
}) {
  const [customSymbol, setCustomSymbol] = useState('')

  return (
    <div className="mb-5 p-5 bg-bg-secondary border border-border rounded-xl">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">Choose stock to analyze</h3>
        <button onClick={onCancel} className="text-[12px] text-text-muted hover:text-text">
          Close
        </button>
      </div>

      <p className="text-[12px] text-text-muted mb-3">
        Pick from your watchlist or enter any TWSE code. This overrides today's pick — hourly analysis will start fresh
        for the new symbol.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-4">
        {watchlist.map((w) => {
          const isCurrent = w.symbol === currentSymbol
          return (
            <button
              key={w.symbol}
              disabled={disabled || isCurrent}
              onClick={() => onConfirm(w.symbol, w.name)}
              className={`px-3 py-2 rounded-lg border text-left transition-colors disabled:opacity-50 ${
                isCurrent
                  ? 'bg-accent/15 border-accent/40 text-accent cursor-default'
                  : 'bg-bg border-border text-text hover:border-accent/40 hover:bg-accent/5'
              }`}
            >
              <div className="font-mono text-sm font-semibold">{w.symbol}</div>
              {w.name && <div className="text-[11px] text-text-muted truncate">{w.name}</div>}
              {isCurrent && <div className="text-[10px] text-accent mt-0.5">current</div>}
            </button>
          )
        })}
      </div>

      <div className="flex gap-2 items-center">
        <input
          value={customSymbol}
          onChange={(e) => setCustomSymbol(e.target.value)}
          placeholder="Or enter TWSE code, e.g. 2330"
          className="flex-1 px-3 py-1.5 text-sm bg-bg border border-border rounded-md text-text placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50"
        />
        <button
          onClick={() => customSymbol.trim() && onConfirm(customSymbol.trim())}
          disabled={disabled || !customSymbol.trim()}
          className="px-4 py-1.5 text-sm bg-accent/10 border border-accent/30 rounded-md text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          Use this
        </button>
      </div>
    </div>
  )
}

function EmptyToday({ onPick, running }: { onPick: () => void; running: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="text-6xl mb-4 opacity-40">📊</div>
      <h2 className="text-lg font-semibold text-text mb-2">No pick yet today</h2>
      <p className="text-sm text-text-muted mb-6 max-w-md text-center">
        The picker runs automatically at 09:00 Taipei time. You can also trigger it manually.
      </p>
      <button
        onClick={onPick}
        disabled={running}
        className="px-5 py-2 bg-accent/10 border border-accent/30 rounded-lg text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
      >
        {running ? 'Picking…' : 'Pick Now'}
      </button>
    </div>
  )
}
