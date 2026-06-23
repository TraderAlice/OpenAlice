import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { EventLogEntry } from '../api'
import type {
  StrategyDecision,
  RoleVerdict,
  RolePreview,
  FinalAction,
  VerdictLabel,
} from '../api/strategyCouncil'
import { PageHeader } from '../components/PageHeader'

// ==================== Helpers ====================

function verdictColor(v: VerdictLabel): string {
  switch (v) {
    case 'bullish':
    case 'long':
    case 'allow':
      return 'text-green'
    case 'bearish':
    case 'short':
      return 'text-red-400'
    case 'block':
      return 'text-red-500'
    case 'reduce':
      return 'text-amber-400'
    default:
      return 'text-text-muted'
  }
}

function actionColor(a: FinalAction): string {
  switch (a) {
    case 'long': return 'text-green'
    case 'short': return 'text-red-400'
    case 'blocked': return 'text-red-500'
    default: return 'text-text-muted'
  }
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false }) + '.' +
    String(d.getMilliseconds()).padStart(3, '0')
}

// ==================== Role Card ====================

interface RoleCardProps {
  label: string
  verdict?: RoleVerdict
  preview?: RolePreview
  running: boolean
}

function RoleCard({ label, verdict, preview, running }: RoleCardProps) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">{label}</h3>
        {running && (
          <span className="text-[10px] uppercase tracking-wider text-accent animate-pulse">
            thinking…
          </span>
        )}
      </div>

      {verdict ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${verdictColor(verdict.verdict)}`}>
              {verdict.verdict}
            </span>
            <span className="text-xs text-text-muted">
              conf {(verdict.confidence * 100).toFixed(0)}%
            </span>
            <span className="text-xs text-text-muted">
              · {formatElapsed(verdict.elapsedMs)}
            </span>
          </div>
          <p className="text-xs text-text-muted leading-relaxed line-clamp-4">
            {verdict.reasoning || '(no reasoning)'}
          </p>
          {verdict.parseError && (
            <p className="text-[10px] text-amber-400">
              parse error: {verdict.parseError}
            </p>
          )}
          {verdict.positionFactor !== undefined && (
            <p className="text-[10px] text-text-muted">
              position factor: {verdict.positionFactor.toFixed(2)}
            </p>
          )}
        </>
      ) : (
        <div className="text-xs text-text-muted italic">
          {running ? 'running…' : 'no verdict yet'}
        </div>
      )}

      {preview && (
        <details className="mt-2">
          <summary className="text-[10px] text-text-muted/60 cursor-pointer hover:text-text-muted">
            show tool groups
          </summary>
          <div className="mt-1 text-[10px] text-text-muted/80 leading-relaxed">
            <span className="font-medium">allowed:</span> {preview.allowedToolGroups.join(', ')}
            {preview.extraDisabledTools.length > 0 && (
              <>
                <br />
                <span className="font-medium">disabled:</span> {preview.extraDisabledTools.join(', ')}
              </>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

// ==================== History Row ====================

interface HistoryRowProps {
  decision: StrategyDecision
  onClick: () => void
  active: boolean
}

function HistoryRow({ decision, onClick, active }: HistoryRowProps) {
  const trend = decision.verdicts.find((v) => v.role === 'trend')
  const signal = decision.verdicts.find((v) => v.role === 'signal')
  const risk = decision.verdicts.find((v) => v.role === 'risk')
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
        active
          ? 'border-accent bg-bg-tertiary/60'
          : 'border-border bg-bg-secondary hover:bg-bg-tertiary/40'
      }`}
    >
      <div className="flex items-center gap-3 text-xs">
        <span className="text-text-muted w-24 shrink-0">{formatTimestamp(decision.timestamp)}</span>
        <span className={`font-bold w-16 shrink-0 ${actionColor(decision.finalAction)}`}>
          {decision.finalAction}
        </span>
        <span className="text-text-muted w-12 shrink-0">
          {(decision.positionFactor * 100).toFixed(0)}%
        </span>
        <span className="flex gap-2 text-text-muted w-40 shrink-0">
          <span className={verdictColor(trend?.verdict ?? 'neutral')}>{trend?.verdict.slice(0, 4) ?? '-'}</span>
          <span className={verdictColor(signal?.verdict ?? 'hold')}>{signal?.verdict.slice(0, 4) ?? '-'}</span>
          <span className={verdictColor(risk?.verdict ?? 'allow')}>{risk?.verdict.slice(0, 4) ?? '-'}</span>
        </span>
        <span className="text-text-muted truncate flex-1 min-w-0">{decision.input}</span>
        <span className="text-text-muted/60 shrink-0">{formatElapsed(decision.elapsedMs)}</span>
      </div>
    </button>
  )
}

// ==================== Page ====================

export function StrategyCouncilPage() {
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState<StrategyDecision | null>(null)
  const [history, setHistory] = useState<StrategyDecision[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [roles, setRoles] = useState<RolePreview[]>([])
  const [error, setError] = useState<string | null>(null)

  // Initial load
  useEffect(() => {
    api.strategyCouncil.roles().then(setRoles).catch(() => {})
    api.strategyCouncil.recent(20).then((entries) => {
      const decisions = entries.map((e) => e.payload as StrategyDecision)
      setHistory(decisions.reverse())
    }).catch(() => {})
  }, [])

  // SSE subscription
  useEffect(() => {
    const es = api.strategyCouncil.connectSSE((entry: EventLogEntry) => {
      const decision = entry.payload as StrategyDecision
      setHistory((prev) => {
        const filtered = prev.filter((d) => d.id !== decision.id)
        return [decision, ...filtered].slice(0, 50)
      })
    })
    return () => es.close()
  }, [])

  const selected = useMemo(() => {
    return selectedId ? history.find((d) => d.id === selectedId) ?? null : null
  }, [selectedId, history])

  const displayed = selected ?? current

  async function runDeliberate() {
    if (!input.trim()) return
    setRunning(true)
    setError(null)
    setCurrent(null)
    try {
      const decision = await api.strategyCouncil.deliberate(input.trim())
      setCurrent(decision)
      setSelectedId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const rolePreviewMap = useMemo(() => {
    const map = new Map<string, RolePreview>()
    for (const r of roles) map.set(r.name, r)
    return map
  }, [roles])

  const trendVerdict = displayed?.verdicts.find((v) => v.role === 'trend')
  const signalVerdict = displayed?.verdicts.find((v) => v.role === 'signal')
  const riskVerdict = displayed?.verdicts.find((v) => v.role === 'risk')

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Strategy Council"
        description="Three-role multi-agent deliberation — trend · signal · risk"
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          {/* Input */}
          <div className="rounded-lg border border-border bg-bg-secondary p-4 flex flex-col gap-3">
            <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
              Market Context
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              placeholder="e.g. Analyze TWSE 2330 (TSMC) intraday setup for the next 15 minutes. Current price around 1100, earlier session was flat."
              className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:border-accent resize-none"
              disabled={running}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-text-muted">
                {running
                  ? 'Council deliberating — all three agents running in parallel.'
                  : 'Press Deliberate to run all three agents against this context.'}
              </div>
              <button
                onClick={runDeliberate}
                disabled={running || !input.trim()}
                className="px-4 py-2 rounded-md bg-accent text-black text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
              >
                {running ? 'Running…' : 'Deliberate'}
              </button>
            </div>
            {error && (
              <div className="text-xs text-red-400 mt-1">error: {error}</div>
            )}
          </div>

          {/* Final action banner */}
          {displayed && (
            <div className="rounded-lg border border-border bg-bg-secondary p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Final Action</div>
                <div className={`text-3xl font-bold ${actionColor(displayed.finalAction)}`}>
                  {displayed.finalAction.toUpperCase()}
                </div>
                <div className="text-xs text-text-muted mt-1">{displayed.rationale}</div>
              </div>
              <div className="flex flex-col items-start md:items-end text-xs text-text-muted gap-1">
                <div>position factor: <span className="font-mono text-text">{displayed.positionFactor.toFixed(2)}</span></div>
                <div>elapsed: <span className="font-mono text-text">{formatElapsed(displayed.elapsedMs)}</span></div>
                <div>id: <span className="font-mono text-text-muted/60">{displayed.id.slice(0, 8)}</span></div>
              </div>
            </div>
          )}

          {/* Three role cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <RoleCard
              label="Trend / Regime"
              verdict={trendVerdict}
              preview={rolePreviewMap.get('trend')}
              running={running && !displayed}
            />
            <RoleCard
              label="Signal / Entry"
              verdict={signalVerdict}
              preview={rolePreviewMap.get('signal')}
              running={running && !displayed}
            />
            <RoleCard
              label="Risk Officer"
              verdict={riskVerdict}
              preview={rolePreviewMap.get('risk')}
              running={running && !displayed}
            />
          </div>

          {/* History */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">Recent Deliberations</h3>
              <span className="text-xs text-text-muted">{history.length} entries</span>
            </div>
            {history.length === 0 ? (
              <div className="text-xs text-text-muted italic py-4">
                No deliberations yet. Kick one off above.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {history.map((d) => (
                  <HistoryRow
                    key={d.id}
                    decision={d}
                    onClick={() => {
                      setSelectedId(d.id === selectedId ? null : d.id)
                      setCurrent(null)
                    }}
                    active={d.id === selectedId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
