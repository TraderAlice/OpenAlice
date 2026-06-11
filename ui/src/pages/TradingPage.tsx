import { useState, useEffect, useMemo } from 'react'
import { Field, inputClass } from '../components/form'
import { SDKSelector } from '../components/SDKSelector'
import type { SDKOption } from '../components/SDKSelector'
import { useTradingConfig } from '../hooks/useTradingConfig'
import { useAccountHealth } from '../hooks/useAccountHealth'
import { useSchemaForm } from '../hooks/useSchemaForm'
import { PageHeader } from '../components/PageHeader'
import { Dialog } from '../components/uta/Dialog'
import { HealthBadge } from '../components/uta/HealthBadge'
import { SchemaFormFields } from '../components/uta/SchemaFormFields'
import { EditUTADialog } from '../components/uta/EditUTADialog'
import { fmt } from '../lib/format'
import { api } from '../api'
import { useWorkspace } from '../tabs/store'
import type { UTAConfig, BrokerPreset, BrokerHealthInfo, TestConnectionResult, Position, AccountInfo } from '../api/types'

// ==================== External order monitoring cadence ====================
//
// data/config/trading.json observeExternalOrdersEvery — how often UTA lists
// the broker's open orders to catch ones placed outside Alice. Saving
// bounces the UTA process (boot-time config), same protocol as broker
// edits; the health badges show the brief reconnect.

const OBSERVE_CADENCE_OPTIONS = ['off', '1m', '5m', '10m', '15m'] as const

function ExternalOrderMonitoringRow() {
  const [value, setValue] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        if (!cancelled) setValue(cfg?.trading?.observeExternalOrdersEvery ?? '15m')
      })
      .catch(() => { if (!cancelled) setValue('15m') })
    return () => { cancelled = true }
  }, [])

  const save = async (next: string) => {
    const prev = value
    setValue(next)
    setMsg('')
    try {
      const res = await fetch('/api/config/trading', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observeExternalOrdersEvery: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMsg('Saved — restarting UTA to apply')
      setTimeout(() => setMsg(''), 4000)
    } catch (err) {
      setValue(prev)
      setMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  if (value === null) return null

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border border-border rounded-lg">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-text">External order monitoring</div>
        <div className="text-[11px] text-text-muted">
          How often to scan for orders placed outside Alice (exchange app, direct API).
          Known pending orders are tracked every 10s regardless.
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {msg && <span className="text-[11px] text-text-muted">{msg}</span>}
        <select
          value={value}
          onChange={(e) => { void save(e.target.value) }}
          className={inputClass + ' w-auto'}
        >
          {OBSERVE_CADENCE_OPTIONS.map((v) => (
            <option key={v} value={v}>{v === 'off' ? 'Off' : `Every ${v}`}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ==================== Live equity (across all UTAs) ====================
//
// TradingPage is the CRUD surface for broker connections. The single
// per-card equity number is here as a liveness signal — "this connection
// returned real account data" — not as a portfolio view. Aggregate
// equity, sparklines, 24h deltas, and trade logs live in Portfolio.

interface EquitySummary {
  totalEquity: string
  totalCash: string
  totalUnrealizedPnL: string
  totalRealizedPnL: string
  accounts: Array<{ id: string; label: string; equity: string; cash: string }>
}

// ==================== Page ====================

export function TradingPage() {
  const tc = useTradingConfig()
  const healthMap = useAccountHealth()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [presets, setPresets] = useState<BrokerPreset[]>([])
  const [equity, setEquity] = useState<EquitySummary | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    api.trading.getBrokerPresets().then(r => setPresets(r.presets)).catch(() => {})
  }, [])

  // Per-card liveness signal — `equity()` lets each card show "this
  // connection actually returned an account balance" rather than just
  // "ping went through". 60s cadence is enough; trend/sparkline/aggregate
  // moved to Portfolio.
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const eq = await api.trading.equity().catch(() => null)
      if (cancelled) return
      if (eq) {
        setEquity(eq)
        setLastUpdated(new Date())
      }
    }
    refresh()
    const id = setInterval(refresh, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const editingUTA = editingId ? tc.utas.find(u => u.id === editingId) : null
  const editingPreset = editingUTA ? presets.find(p => p.id === editingUTA.presetId) : undefined

  const openInPortfolio = (id: string) => {
    setEditingId(null)
    setSidebar('portfolio')
    openOrFocus({ kind: 'uta-detail', params: { id } })
  }

  if (tc.loading) return <PageShell subtitle="Loading..." />
  if (tc.error) {
    return (
      <PageShell subtitle="Failed to load trading configuration.">
        <p className="text-[13px] text-red">{tc.error}</p>
        <button onClick={tc.refresh} className="mt-2 btn-secondary">Retry</button>
      </PageShell>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Trading"
        description="Configure your UTAs (Unified Trading Accounts)."
        live={tc.utas.length > 0 ? { lastUpdated } : undefined}
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[820px] mx-auto space-y-4">
          {tc.utas.length === 0 ? (
            <EmptyState onAdd={() => setShowAdd(true)} />
          ) : (
            <div className="space-y-2.5">
              {tc.utas.map((uta) => {
                const equityRow = equity?.accounts.find(a => a.id === uta.id) ?? null
                return (
                  <UTACard
                    key={uta.id}
                    uta={uta}
                    preset={presets.find(p => p.id === uta.presetId)}
                    health={healthMap[uta.id]}
                    equity={equityRow}
                    onClick={() => setEditingId(uta.id)}
                  />
                )
              })}
              <button
                onClick={() => setShowAdd(true)}
                className="w-full py-2.5 text-[12px] text-text-muted hover:text-text border border-dashed border-border hover:border-text-muted/40 rounded-lg transition-colors"
              >
                + Add UTA
              </button>
            </div>
          )}

          {tc.utas.length > 0 && <ExternalOrderMonitoringRow />}
        </div>
      </div>

      {showAdd && (
        <CreateWizard
          presets={presets}
          onSave={async (uta) => {
            const created = await tc.createUTA(uta)
            // Persisted — close NOW. The first broker connection runs in the
            // background and the list's health badge tracks it (Reconnecting
            // → Connected/Offline); credential validity has its own explicit
            // Test step in the wizard. Holding the dialog open on a failed
            // first connect lies about an already-created UTA — re-clicking
            // Save can only 409.
            setShowAdd(false)
            void tc.reconnectUTA(created.id).catch(() => {})
            // Trigger a fresh fetch so the new UTA shows live numbers right away.
            void api.trading.equity().then(setEquity).catch(() => {})
            return created
          }}
          onOpenExisting={(id) => {
            setShowAdd(false)
            setEditingId(id)
          }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {editingUTA && (
        <EditUTADialog
          uta={editingUTA}
          preset={editingPreset}
          health={healthMap[editingUTA.id]}
          onSave={async (next) => { await tc.saveUTA(next) }}
          onDelete={async () => {
            await tc.deleteUTA(editingUTA.id)
            setEditingId(null)
          }}
          onViewInPortfolio={() => openInPortfolio(editingUTA.id)}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  )
}

// ==================== Page Shell ====================

function PageShell({ subtitle, children }: { subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="Trading" description={subtitle} />
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">{children}</div>
    </div>
  )
}

// ==================== Empty State ====================

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-12 text-center">
      <h3 className="text-[16px] font-semibold text-text mb-2">No UTAs configured</h3>
      <p className="text-[13px] text-text-muted mb-6 max-w-[320px] mx-auto leading-relaxed">
        Connect a crypto exchange or brokerage to start automated trading.
      </p>
      <button onClick={onAdd} className="btn-primary">
        + Add UTA
      </button>
    </div>
  )
}

// ==================== Portfolio banner (hero) ====================

// ==================== Subtitle builder ====================

function buildSubtitle(uta: UTAConfig, preset?: BrokerPreset): string {
  if (!preset) return uta.presetId
  const pc = uta.presetConfig
  const parts: string[] = []
  for (const sf of preset.subtitleFields) {
    const val = pc[sf.field]
    if (typeof val === 'boolean') {
      if (val && sf.label) parts.push(sf.label)
      else if (!val && sf.falseLabel) parts.push(sf.falseLabel)
    } else if (val != null && val !== '') {
      let display = String(val)
      if (sf.field === 'mode' && preset.modes) {
        const mode = preset.modes.find(m => m.id === val)
        if (mode) display = mode.label
      }
      parts.push(`${sf.prefix ?? ''}${display}`)
    }
  }
  return parts.join(' · ') || preset.label
}

// ==================== UTA Card ====================

function UTACard({ uta, preset, health, equity, onClick }: {
  uta: UTAConfig
  preset?: BrokerPreset
  health?: BrokerHealthInfo
  equity?: { equity: string; cash: string } | null
  onClick: () => void
}) {
  const isDisabled = health?.disabled || uta.enabled === false
  const badge = preset
    ? { text: preset.badge, color: `${preset.badgeColor} ${preset.badgeColor.replace('text-', 'bg-')}/10` }
    : { text: uta.presetId.slice(0, 2).toUpperCase(), color: 'text-text-muted bg-text-muted/10' }

  // Per-card equity is a liveness signal, not a portfolio view —
  // proves the connection returned a real account balance, not just
  // a ping. Aggregate / curves / per-account drill-in all live in
  // Portfolio.
  const equityNum = equity ? Number(equity.equity) : null
  const equityNode = !isDisabled && equityNum != null && Number.isFinite(equityNum)
    ? <span className="tabular-nums">{fmt(equityNum, 'USD')}</span>
    : null

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border border-border bg-bg-secondary/30 px-4 py-3 transition-all hover:border-text-muted/40 hover:bg-bg-tertiary/20 ${isDisabled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-3">
        <span className={`text-[10px] font-bold px-2 py-1 rounded-md shrink-0 ${badge.color}`}>
          {badge.text}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-text truncate">{uta.label || uta.id}</div>
          <div className="text-[11px] text-text-muted truncate mt-0.5 font-mono">
            {uta.id}
            <span className="mx-1.5 text-text-muted/40">·</span>
            {buildSubtitle(uta, preset)}
            {uta.guards.length > 0 && <span className="ml-1.5 text-text-muted/50">{uta.guards.length} guard{uta.guards.length > 1 ? 's' : ''}</span>}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          {equityNode && (
            <span className="text-[11px] text-text-muted/80 hidden sm:inline">{equityNode}</span>
          )}
          {uta.enabled === false
            ? <span className="text-[11px] text-text-muted">Disabled</span>
            : <HealthBadge health={health} />
          }
        </div>
      </div>
    </button>
  )
}

// ==================== Hint renderer (markdown-lite) ====================

function HintBlock({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-secondary/50 px-3 py-2.5 space-y-2">
      {text.trim().split('\n\n').map((para, i) => (
        <p key={i} className="text-[12px] text-text-muted leading-relaxed">
          {para.split(/(\*\*[^*]+\*\*)/).map((seg, j) =>
            seg.startsWith('**') && seg.endsWith('**')
              ? <strong key={j} className="text-text">{seg.slice(2, -2)}</strong>
              : <span key={j}>{seg}</span>
          )}
        </p>
      ))}
    </div>
  )
}

// ==================== Create Wizard (multi-step) ====================

function PickerSectionHeader({ title }: { title: string }) {
  return (
    <p className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
      {title}
    </p>
  )
}

type WizardStep = 'pick' | 'config' | 'test'

interface BrokerConflict {
  existing: { id: string; label: string; presetId: string }
}

function CreateWizard({ presets, onSave, onOpenExisting, onClose }: {
  presets: BrokerPreset[]
  onSave: (uta: Omit<UTAConfig, 'id'>) => Promise<UTAConfig>
  onOpenExisting: (id: string) => void
  onClose: () => void
}) {
  const [step, setStep] = useState<WizardStep>('pick')
  const [presetId, setPresetId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [showSecrets, setShowSecrets] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState<BrokerConflict | null>(null)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)

  const preset = presets.find(p => p.id === presetId)
  const hasSensitive = preset?.schema && Object.values((preset.schema as { properties?: Record<string, { writeOnly?: boolean }> }).properties ?? {}).some(p => p.writeOnly)
  const { fields, formData, setField, getSubmitData, validate } = useSchemaForm(preset?.schema)

  const defaultName = preset?.defaultName ?? ''
  const finalName = name.trim() || defaultName

  const toOption = (p: BrokerPreset): SDKOption => ({
    id: p.id,
    name: p.label,
    description: p.description,
    badge: p.badge,
    badgeColor: p.badgeColor,
  })

  // 'testing' category presets (Simulator) are intentionally excluded — their
  // creation entry lives in Dev → Simulator so users picking a real broker
  // here don't see "Simulator" alongside Bybit / Alpaca / IBKR.
  const recommendedOptions: SDKOption[] = useMemo(
    () => presets.filter(p => p.category === 'recommended').map(toOption),
    [presets],
  )
  const cryptoOptions: SDKOption[] = useMemo(
    () => presets.filter(p => p.category === 'crypto').map(toOption),
    [presets],
  )

  const buildUTA = (): Omit<UTAConfig, 'id'> | null => {
    if (!preset) return null
    return {
      label: finalName,
      presetId: preset.id,
      enabled: true,
      guards: [],
      presetConfig: getSubmitData(),
    }
  }

  const handlePick = (id: string) => {
    setPresetId(id)
    setError('')
    setStep('config')
  }

  const handleTest = async () => {
    if (!preset) return
    setError('')
    setConflict(null)
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    const uta = buildUTA()
    if (!uta) return
    setTesting(true)
    try {
      const result = await api.trading.testConnection(uta)
      setTestResult(result)
      setStep('test')
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : String(err) })
      setStep('test')
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    const uta = buildUTA()
    if (!uta) return
    setSaving(true); setError(''); setConflict(null)
    try {
      await onSave(uta)
    } catch (err) {
      // Surface 409 collision info (typed as BrokerAlreadyExistsError) so
      // the user can jump to the existing UTA instead of forking.
      if (err instanceof Error && err.name === 'BrokerAlreadyExistsError') {
        const existing = (err as Error & { existing?: BrokerConflict['existing'] }).existing
        if (existing) {
          setConflict({ existing })
          setSaving(false)
          return
        }
      }
      setError(err instanceof Error ? err.message : 'Failed to save UTA')
      setSaving(false)
    }
  }

  const headerLabel =
    step === 'pick'   ? 'New UTA · Pick Platform' :
    step === 'config' ? `New UTA · Configure ${preset?.label ?? ''}` :
                        `New UTA · Test ${preset?.label ?? ''}`

  return (
    <Dialog onClose={onClose}>
      <div className="shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-[14px] font-semibold text-text truncate">{headerLabel}</h3>
          <StepDots current={step} />
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text p-1 transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {step === 'pick' && (
          <div className="space-y-6">
            {recommendedOptions.length > 0 && (
              <section className="space-y-3">
                <PickerSectionHeader title="Recommended" />
                <SDKSelector options={recommendedOptions} selected={presetId ?? ''} onSelect={handlePick} />
              </section>
            )}
            {cryptoOptions.length > 0 && (
              <section className="space-y-3">
                <PickerSectionHeader title="Crypto" />
                <SDKSelector options={cryptoOptions} selected={presetId ?? ''} onSelect={handlePick} />
              </section>
            )}
          </div>
        )}

        {step === 'config' && preset && (
          <div className="space-y-5">
            {preset.hint && <HintBlock text={preset.hint} />}
            <div className="space-y-3">
              <Field label="Name" description="Display label for this account. The unique id is derived automatically from the credentials below.">
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName} />
              </Field>
              <SchemaFormFields
                fields={fields}
                formData={formData}
                setField={setField}
                showSecrets={showSecrets}
              />
              {hasSensitive && (
                <button
                  onClick={() => setShowSecrets(!showSecrets)}
                  className="text-[11px] text-text-muted hover:text-text transition-colors"
                >
                  {showSecrets ? 'Hide secrets' : 'Show secrets'}
                </button>
              )}
              {error && <p className="text-[12px] text-red">{error}</p>}
            </div>
          </div>
        )}

        {step === 'test' && testResult && !conflict && (
          <TestResultPanel result={testResult} utaId={finalName} />
        )}

        {step === 'test' && conflict && (
          <BrokerConflictPanel existing={conflict.existing} onOpenExisting={() => onOpenExisting(conflict.existing.id)} />
        )}
      </div>

      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-border">
        {step === 'pick' && (
          <>
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <span className="text-[11px] text-text-muted">Pick a platform to continue</span>
          </>
        )}
        {step === 'config' && (
          <>
            <button onClick={() => setStep('pick')} className="btn-secondary">← Back</button>
            <button onClick={handleTest} disabled={testing} className="btn-primary">
              {testing ? 'Testing...' : 'Test Connection →'}
            </button>
          </>
        )}
        {step === 'test' && (
          <>
            <button onClick={() => setStep('config')} className="btn-secondary">← Back</button>
            {conflict ? (
              <button onClick={() => onOpenExisting(conflict.existing.id)} className="btn-primary">
                Open existing
              </button>
            ) : testResult?.success ? (
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : 'Save UTA'}
              </button>
            ) : (
              <span className="text-[11px] text-text-muted">Fix the config and try again</span>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

// ==================== Wizard substeps ====================

function StepDots({ current }: { current: WizardStep }) {
  const order: WizardStep[] = ['pick', 'config', 'test']
  return (
    <div className="flex items-center gap-1.5">
      {order.map((s) => (
        <span
          key={s}
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            s === current ? 'bg-accent' : 'bg-border'
          }`}
        />
      ))}
    </div>
  )
}

function BrokerConflictPanel({ existing, onOpenExisting }: {
  existing: { id: string; label: string; presetId: string }
  onOpenExisting: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
        <span className="text-[13px] font-medium text-text">Broker already configured</span>
      </div>
      <div className="rounded-md border border-yellow-400/30 bg-yellow-400/5 px-3 py-2.5">
        <p className="text-[12px] text-text leading-relaxed">
          Another UTA already exists for this broker (same identity-defining credentials).
          Re-using the same key from a separate account would double-count its positions in
          aggregate views.
        </p>
        <p className="text-[12px] text-text-muted leading-relaxed mt-2">
          Existing: <strong className="text-text">{existing.label}</strong> <span className="font-mono text-text-muted/70">({existing.id})</span>
        </p>
      </div>
      <p className="text-[11px] text-text-muted">
        Click <strong className="text-text">Open existing</strong> to use it, or <strong className="text-text">← Back</strong> to point this UTA at a different account.
      </p>
      <button onClick={onOpenExisting} className="btn-secondary w-full">Open existing UTA</button>
    </div>
  )
}

function TestResultPanel({ result, utaId }: { result: TestConnectionResult; utaId: string }) {
  if (!result.success) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red shrink-0" />
          <span className="text-[13px] font-medium text-red">Connection failed</span>
        </div>
        <div className="rounded-md border border-red/30 bg-red/5 px-3 py-2.5">
          <p className="text-[12px] text-text leading-relaxed whitespace-pre-wrap">{result.error ?? 'Unknown error'}</p>
        </div>
        <p className="text-[11px] text-text-muted">
          Click <strong className="text-text">← Back</strong> to fix the configuration and try again.
        </p>
      </div>
    )
  }

  const acct: AccountInfo | undefined = result.account
  const positions: Position[] = result.positions ?? []
  const visiblePositions = positions.slice(0, 8)
  const moreCount = positions.length - visiblePositions.length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green shrink-0" />
        <span className="text-[13px] font-medium text-green">Connected as {utaId}</span>
      </div>

      {acct && (
        <div className="rounded-md border border-border bg-bg-secondary/50 px-3 py-2.5 space-y-1">
          <div className="flex justify-between text-[12px]">
            <span className="text-text-muted">Net Liquidation</span>
            <span className="text-text font-medium">{acct.baseCurrency} {acct.netLiquidation}</span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span className="text-text-muted">Cash</span>
            <span className="text-text">{acct.baseCurrency} {acct.totalCashValue}</span>
          </div>
          {acct.unrealizedPnL !== '0' && (
            <div className="flex justify-between text-[12px]">
              <span className="text-text-muted">Unrealized P&L</span>
              <span className="text-text">{acct.baseCurrency} {acct.unrealizedPnL}</span>
            </div>
          )}
        </div>
      )}

      <div>
        <p className="text-[12px] font-medium text-text-muted uppercase tracking-wide mb-2">
          Positions ({positions.length})
        </p>
        {positions.length === 0 ? (
          <p className="text-[12px] text-text-muted">No open positions — connection works, account is empty.</p>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-bg-tertiary/30 text-text-muted">
                  <th className="text-left px-2.5 py-1.5 font-medium">Contract</th>
                  <th className="text-left px-2.5 py-1.5 font-medium">Side</th>
                  <th className="text-right px-2.5 py-1.5 font-medium">Qty</th>
                  <th className="text-right px-2.5 py-1.5 font-medium">Mkt Value</th>
                </tr>
              </thead>
              <tbody>
                {visiblePositions.map((p, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2.5 py-1.5 text-text font-mono">{p.contract.aliceId ?? p.contract.localSymbol ?? p.contract.symbol ?? '?'}</td>
                    <td className="px-2.5 py-1.5 text-text-muted">{p.side}</td>
                    <td className="px-2.5 py-1.5 text-right text-text">{p.quantity}</td>
                    <td className="px-2.5 py-1.5 text-right text-text">{p.currency} {p.marketValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {moreCount > 0 && (
              <div className="px-2.5 py-1.5 border-t border-border text-[11px] text-text-muted bg-bg-tertiary/20">
                +{moreCount} more
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
