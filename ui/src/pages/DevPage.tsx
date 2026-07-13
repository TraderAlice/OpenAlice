import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Spinner, EmptyState } from '../components/StateViews'
import { getIntlLocale } from '../lib/intl'
import { useToast } from '../components/Toast'
import { LogsPage } from './LogsPage'
import { SimulatorPage } from './SimulatorPage'
import { OnboardingDesignPage } from './OnboardingDesignPage'
import {
  toolsApi,
  type ToolInfo,
  type ToolDetail,
  type ExecuteResult,
} from '../api/tools'
import { api, type UTASnapshotSummary } from '../api'
import type { ViewSpec } from '../tabs/types'
import { filterAccountTierUTAs } from '../lib/uta-account-filter'

// ==================== Tab Types ====================

type Tab = Extract<ViewSpec, { kind: 'dev' }>['params']['tab']

const TAB_TITLES: Record<Tab, string> = {
  tools: 'Tools',
  onboarding: 'Onboarding',
  snapshots: 'Snapshots',
  logs: 'Logs',
  simulator: 'Simulator',
}

/** Tabs that render content with internal scroll containers — the outer wrapper must NOT add overflow. */
const SELF_SCROLLING_TABS: ReadonlySet<Tab> = new Set(['tools', 'logs'])

// ==================== DevPage ====================

interface DevPageProps {
  spec: Extract<ViewSpec, { kind: 'dev' }>
}

export function DevPage({ spec }: DevPageProps) {
  const tab = spec.params.tab

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={TAB_TITLES[tab]} />
      <div className={`flex-1 min-h-0 ${SELF_SCROLLING_TABS.has(tab) ? 'flex flex-col' : 'overflow-y-auto'}`}>
        {tab === 'tools' && <ToolsTab />}
        {tab === 'onboarding' && <OnboardingDesignPage />}
        {tab === 'snapshots' && <SnapshotsTab />}
        {tab === 'logs' && <LogsPage />}
        {tab === 'simulator' && <SimulatorPage />}
      </div>
    </div>
  )
}

// ==================== Snapshots Tab ====================

function SnapshotsTab() {
  const toast = useToast()
  const [accounts, setAccounts] = useState<Array<{ id: string; label: string }>>([])
  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const [snapshots, setSnapshots] = useState<UTASnapshotSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  // Load accounts list
  useEffect(() => {
    api.trading.listUTASummaries().then(r => {
      const list = filterAccountTierUTAs(r.utas).map(a => ({ id: a.id, label: a.label }))
      setAccounts(list)
      if (list.length > 0 && !selectedAccount) setSelectedAccount(list[0].id)
    }).catch(() => {})
  }, [])

  // Load snapshots when account changes
  const loadSnapshots = useCallback(async () => {
    if (!selectedAccount) return
    setLoading(true)
    setExpandedIdx(null)
    try {
      const r = await api.trading.snapshots(selectedAccount, { limit: 200 })
      setSnapshots(r.snapshots)
    } catch {
      setSnapshots([])
    }
    setLoading(false)
  }, [selectedAccount])

  useEffect(() => { loadSnapshots() }, [loadSnapshots])

  const handleDelete = async (timestamp: string) => {
    try {
      await api.trading.deleteSnapshot(selectedAccount, timestamp)
      toast.success('Snapshot deleted')
      setExpandedIdx(null)
      await loadSnapshots()
    } catch {
      toast.error('Failed to delete snapshot')
    }
  }

  return (
    <div className="px-4 md:px-6 py-5">
      <div className="max-w-[900px] space-y-4">
        {/* Account selector */}
        <div className="flex items-center gap-3">
          <label className="text-[13px] text-text-muted">Account:</label>
          <select
            value={selectedAccount}
            onChange={e => setSelectedAccount(e.target.value)}
            className="text-[13px] px-2 py-1.5 rounded-md border border-border bg-bg text-text"
          >
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.label} ({a.id})</option>
            ))}
          </select>
          <button
            onClick={loadSnapshots}
            className="text-[13px] px-2.5 py-1.5 rounded-md border border-border hover:bg-bg-tertiary transition-colors text-text-muted"
          >
            Refresh
          </button>
          <span className="text-[11px] text-text-muted/50">{snapshots.length} snapshots</span>
        </div>

        {/* Snapshots table */}
        {loading ? (
          <div className="flex justify-center py-10"><Spinner size="sm" /></div>
        ) : snapshots.length === 0 ? (
          <EmptyState title="No snapshots for this account." />
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-bg-secondary text-text-muted text-left text-[11px] uppercase tracking-wide">
                  <th className="px-3 py-2 font-medium">Timestamp</th>
                  <th className="px-3 py-2 font-medium">Trigger</th>
                  <th className="px-3 py-2 font-medium text-center">Health</th>
                  <th className="px-3 py-2 font-medium text-right">Positions</th>
                  <th className="px-3 py-2 font-medium text-right">Equity</th>
                  <th className="px-3 py-2 font-medium text-right w-[80px]"></th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s, i) => (
                  <SnapshotRow
                    key={s.timestamp}
                    snapshot={s}
                    expanded={expandedIdx === i}
                    onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
                    onDelete={() => handleDelete(s.timestamp)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SnapshotRow({ snapshot: s, expanded, onToggle, onDelete }: {
  snapshot: UTASnapshotSummary
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const healthColor = s.health === 'healthy' ? 'bg-green' : s.health === 'degraded' ? 'bg-yellow-400' : 'bg-red'

  return (
    <>
      <tr
        className="border-t border-border hover:bg-bg-tertiary/30 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-mono text-[11px] text-text">
          {new Date(s.timestamp).toLocaleString()}
        </td>
        <td className="px-3 py-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted">{s.trigger}</span>
        </td>
        <td className="px-3 py-2 text-center">
          <div className={`w-2 h-2 rounded-full ${healthColor} mx-auto`} />
        </td>
        <td className="px-3 py-2 text-right text-text">{s.positions.length}</td>
        <td className="px-3 py-2 text-right text-text tabular-nums">
          ${Number(s.account.netLiquidation).toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>
        <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
          {confirming ? (
            <div className="flex gap-1 justify-end">
              <button onClick={onDelete} className="text-[11px] px-2 py-0.5 rounded bg-red/15 text-red hover:bg-red/25 transition-colors">
                Confirm
              </button>
              <button onClick={() => setConfirming(false)} className="text-[11px] px-2 py-0.5 rounded bg-bg-tertiary text-text-muted hover:bg-bg-tertiary/80 transition-colors">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="text-[11px] px-2 py-0.5 rounded text-text-muted hover:text-red hover:bg-red/10 transition-colors"
            >
              Delete
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border/50">
          <td colSpan={6} className="px-3 py-3 bg-bg-secondary/50">
            <div className="space-y-2">
              {/* Account metrics */}
              <div className="flex gap-4 text-[11px]">
                <span className="text-text-muted">Cash: <span className="text-text">${Number(s.account.totalCashValue).toLocaleString(getIntlLocale(), { minimumFractionDigits: 2 })}</span></span>
                <span className="text-text-muted">Unrealized PnL: <span className={Number(s.account.unrealizedPnL) >= 0 ? 'text-green' : 'text-red'}>{Number(s.account.unrealizedPnL) >= 0 ? '+' : ''}${Number(s.account.unrealizedPnL).toLocaleString(getIntlLocale(), { minimumFractionDigits: 2 })}</span></span>
                {s.account.baseCurrency && <span className="text-text-muted">Base: <span className="text-text">{s.account.baseCurrency}</span></span>}
              </div>
              {/* Positions detail */}
              {s.positions.length > 0 && (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-text-muted text-left">
                      <th className="pr-3 pb-1 font-medium">Symbol</th>
                      <th className="pr-3 pb-1 font-medium text-center">Ccy</th>
                      <th className="pr-3 pb-1 font-medium text-right">Qty</th>
                      <th className="pr-3 pb-1 font-medium text-right">Avg Cost</th>
                      <th className="pr-3 pb-1 font-medium text-right">Mkt Price</th>
                      <th className="pr-3 pb-1 font-medium text-right">Mkt Value</th>
                      <th className="pr-3 pb-1 font-medium text-right">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.positions.map((p, j) => {
                      const sym = p.aliceId.split('|').pop() ?? p.aliceId
                      const pnl = Number(p.unrealizedPnL)
                      return (
                        <tr key={j} className="text-text">
                          <td className="pr-3 py-0.5 font-medium">{sym}</td>
                          <td className="pr-3 py-0.5 text-center text-text-muted">{p.currency}</td>
                          <td className="pr-3 py-0.5 text-right tabular-nums">{p.quantity}</td>
                          <td className="pr-3 py-0.5 text-right tabular-nums text-text-muted">{Number(p.avgCost).toFixed(2)}</td>
                          <td className="pr-3 py-0.5 text-right tabular-nums">{Number(p.marketPrice).toFixed(2)}</td>
                          <td className="pr-3 py-0.5 text-right tabular-nums">{Number(p.marketValue).toFixed(2)}</td>
                          <td className={`pr-3 py-0.5 text-right tabular-nums font-medium ${pnl >= 0 ? 'text-green' : 'text-red'}`}>
                            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              {s.positions.length === 0 && (
                <p className="text-[11px] text-text-muted">No positions in this snapshot.</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ==================== Tools Tab ====================

function ToolsTab() {
  const [inventory, setInventory] = useState<ToolInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ToolDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [filter, setFilter] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<{ name: string; data: ExecuteResult; durationMs: number } | null>(null)

  useEffect(() => {
    toolsApi.load().then((r) => {
      setInventory(r.inventory)
      // Expand all groups by default
      const groups = new Set(r.inventory.map((t) => t.group))
      setExpandedGroups(groups)
    }).catch(() => {})
  }, [])

  const grouped = useMemo(() => {
    const lc = filter.toLowerCase()
    const filtered = lc
      ? inventory.filter((t) => t.name.toLowerCase().includes(lc) || t.group.toLowerCase().includes(lc))
      : inventory
    const map = new Map<string, ToolInfo[]>()
    for (const t of filtered) {
      const list = map.get(t.group) ?? []
      list.push(t)
      map.set(t.group, list)
    }
    return map
  }, [inventory, filter])

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  const selectTool = useCallback(async (name: string) => {
    setSelected(name)
    setLoadingDetail(true)
    try {
      const d = await toolsApi.detail(name)
      setDetail(d)
    } catch {
      setDetail(null)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left: Tool list */}
      <div className="w-[280px] border-r border-border/60 flex flex-col min-h-0">
        <div className="px-3 py-3">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tools..."
            className="w-full px-2.5 py-1.5 bg-bg text-text border border-border rounded-md text-xs outline-none focus:border-accent"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-1 pb-3">
          {[...grouped.entries()].map(([group, tools]) => (
            <div key={group} className="mb-1">
              <button
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-text-muted hover:text-text transition-colors"
              >
                <span className="text-[10px]">{expandedGroups.has(group) ? '\u25BC' : '\u25B6'}</span>
                <span className="font-semibold uppercase tracking-wider">{group}</span>
                <span className="text-text-muted/50">({tools.length})</span>
              </button>
              {expandedGroups.has(group) && (
                <div className="ml-2">
                  {tools.map((t) => (
                    <button
                      key={t.name}
                      onClick={() => selectTool(t.name)}
                      className={`w-full text-left px-2 py-1 text-xs rounded transition-colors ${
                        selected === t.name
                          ? 'bg-accent/10 text-accent'
                          : 'text-text hover:bg-bg-tertiary/50'
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: Detail + Execute + Result (independent scroll) */}
      <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            Select a tool from the left panel.
          </div>
        ) : loadingDetail ? (
          <div className="flex justify-center py-10"><Spinner size="sm" /></div>
        ) : detail ? (
          <ToolExecutePanel detail={detail} result={result} onResult={setResult} />
        ) : (
          <p className="text-sm text-text-muted">Failed to load tool details.</p>
        )}
      </div>
    </div>
  )
}

// ==================== Tool Execute Panel ====================

interface ToolExecutePanelProps {
  detail: ToolDetail
  result: { name: string; data: ExecuteResult; durationMs: number } | null
  onResult: (r: { name: string; data: ExecuteResult; durationMs: number } | null) => void
}

function ToolExecutePanel({ detail, result, onResult }: ToolExecutePanelProps) {
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [executing, setExecuting] = useState(false)

  // Reset inputs when tool changes — seed from the tool's declared example
  // input (`inputSchema.examples[0]`, set via `.meta({ examples: [...] })` at
  // the tool definition) so the form is pre-filled with a runnable sample
  // instead of blank. Falls back to empty when a tool declares no example.
  useEffect(() => {
    const schema = detail.inputSchema as { examples?: Array<Record<string, unknown>> }
    const example = schema.examples?.[0]
    if (!example) {
      setInputs({})
      return
    }
    const seeded: Record<string, string> = {}
    for (const [key, value] of Object.entries(example)) {
      seeded[key] =
        typeof value === 'string'
          ? value
          : value != null && typeof value === 'object'
            ? JSON.stringify(value)
            : String(value)
    }
    setInputs(seeded)
  }, [detail.name, detail.inputSchema])

  const properties = useMemo(() => {
    const schema = detail.inputSchema as {
      properties?: Record<string, { type?: string; description?: string; default?: unknown }>
      required?: string[]
    }
    if (!schema.properties) return []
    const required = new Set(schema.required ?? [])
    return Object.entries(schema.properties).map(([key, prop]) => ({
      key,
      type: prop.type ?? 'string',
      description: prop.description ?? '',
      required: required.has(key),
      default: prop.default,
    }))
  }, [detail.inputSchema])

  const handleExecute = useCallback(async () => {
    setExecuting(true)
    const start = performance.now()

    // Build input object: parse numbers, skip empty optional fields
    const input: Record<string, unknown> = {}
    for (const prop of properties) {
      const raw = inputs[prop.key]?.trim()
      if (!raw && !prop.required) continue
      if (prop.type === 'number' || prop.type === 'integer') {
        input[prop.key] = raw ? Number(raw) : undefined
      } else if (prop.type === 'boolean') {
        input[prop.key] = raw === 'true'
      } else {
        input[prop.key] = raw ?? ''
      }
    }

    try {
      const data = await toolsApi.execute(detail.name, input)
      onResult({ name: detail.name, data, durationMs: Math.round(performance.now() - start) })
    } catch (err) {
      onResult({
        name: detail.name,
        data: { content: [{ type: 'text', text: String(err) }], isError: true },
        durationMs: Math.round(performance.now() - start),
      })
    } finally {
      setExecuting(false)
    }
  }, [detail.name, inputs, properties, onResult])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-text">{detail.name}</h2>
        {detail.group && <span className="text-xs text-text-muted uppercase tracking-wider">{detail.group}</span>}
        <p className="text-sm text-text-muted mt-1">{detail.description}</p>
      </div>

      {/* Input form */}
      {properties.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Input</h3>
          {properties.map((prop) => (
            <div key={prop.key}>
              <label className="flex items-center gap-1.5 text-[13px] text-text mb-1">
                <span className="font-mono">{prop.key}</span>
                <span className="text-[10px] text-text-muted/60">{prop.type}</span>
                {prop.required && <span className="text-[10px] text-accent/70">required</span>}
              </label>
              {prop.type === 'boolean' ? (
                <select
                  value={inputs[prop.key] ?? ''}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [prop.key]: e.target.value }))}
                  className="px-2.5 py-1.5 bg-bg text-text border border-border rounded-md text-xs outline-none focus:border-accent"
                >
                  <option value="">-</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type={prop.type === 'number' || prop.type === 'integer' ? 'number' : 'text'}
                  value={inputs[prop.key] ?? ''}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [prop.key]: e.target.value }))}
                  placeholder={prop.description || prop.key}
                  className="w-full px-2.5 py-1.5 bg-bg text-text border border-border rounded-md text-xs font-mono outline-none focus:border-accent"
                />
              )}
              {prop.description && (
                <p className="text-[11px] text-text-muted/60 mt-0.5">{prop.description}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Execute button */}
      <button
        onClick={handleExecute}
        disabled={executing}
        className="btn-primary-sm"
      >
        {executing ? 'Executing...' : 'Execute'}
      </button>

      {/* Result */}
      {result && result.name === detail.name && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs font-semibold ${result.data.isError ? 'text-red' : 'text-green'}`}>
              {result.data.isError ? 'ERROR' : 'OK'}
            </span>
            <span className="text-xs text-text-muted">{result.durationMs}ms</span>
          </div>
          <pre className="bg-bg border border-border/60 rounded-lg p-3 text-xs font-mono text-text overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap">
            {result.data.content.map((c) => c.text ?? JSON.stringify(c)).join('\n')}
          </pre>
        </div>
      )}
    </div>
  )
}
