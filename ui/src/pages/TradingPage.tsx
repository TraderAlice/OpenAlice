import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { api } from '../api'
import type { UTAConfig, BrokerPreset, BrokerHealthInfo, TestConnectionResult, Position, AccountInfo } from '../api/types'

// ==================== Page ====================

export function TradingPage() {
  const tc = useTradingConfig()
  const healthMap = useAccountHealth()
  const navigate = useNavigate()
  const [showAdd, setShowAdd] = useState(false)
  const [presets, setPresets] = useState<BrokerPreset[]>([])

  useEffect(() => {
    api.trading.getBrokerPresets().then(r => setPresets(r.presets)).catch(() => {})
  }, [])

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
      <PageHeader title="Trading" description="Configure your UTAs (Unified Trading Accounts)." />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[720px] space-y-3">
          {tc.utas.length === 0 ? (
            <EmptyState onAdd={() => setShowAdd(true)} />
          ) : (
            <>
              {tc.utas.map((uta) => (
                <UTACard
                  key={uta.id}
                  uta={uta}
                  preset={presets.find(p => p.id === uta.presetId)}
                  health={healthMap[uta.id]}
                  onClick={() => navigate(`/uta/${uta.id}`)}
                />
              ))}
              <button
                onClick={() => setShowAdd(true)}
                className="w-full py-2.5 text-[12px] text-text-muted hover:text-text border border-dashed border-border hover:border-text-muted/40 rounded-lg transition-colors"
              >
                + Add UTA
              </button>
            </>
          )}
        </div>
      </div>

      {showAdd && (
        <CreateWizard
          presets={presets}
          existingUTAIds={tc.utas.map((a) => a.id)}
          onSave={async (uta) => {
            await tc.saveUTA(uta)
            const result = await tc.reconnectUTA(uta.id)
            if (!result.success) {
              throw new Error(result.error || 'Connection failed')
            }
            setShowAdd(false)
          }}
          onClose={() => setShowAdd(false)}
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

function UTACard({ uta, preset, health, onClick }: {
  uta: UTAConfig
  preset?: BrokerPreset
  health?: BrokerHealthInfo
  onClick: () => void
}) {
  const isDisabled = health?.disabled || uta.enabled === false
  const badge = preset
    ? { text: preset.badge, color: `${preset.badgeColor} ${preset.badgeColor.replace('text-', 'bg-')}/10` }
    : { text: uta.presetId.slice(0, 2).toUpperCase(), color: 'text-text-muted bg-text-muted/10' }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border border-border px-4 py-3.5 transition-all hover:border-text-muted/40 hover:bg-bg-tertiary/20 ${isDisabled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-3">
        <span className={`text-[10px] font-bold px-2 py-1 rounded-md shrink-0 ${badge.color}`}>
          {badge.text}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-text truncate">{uta.id}</div>
          <div className="text-[11px] text-text-muted truncate mt-0.5">
            {buildSubtitle(uta, preset)}
            {uta.guards.length > 0 && <span className="ml-2 text-text-muted/50">{uta.guards.length} guard{uta.guards.length > 1 ? 's' : ''}</span>}
          </div>
        </div>
        <div className="shrink-0">
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

type WizardStep = 'pick' | 'config' | 'test'

function CreateWizard({ presets, existingUTAIds, onSave, onClose }: {
  presets: BrokerPreset[]
  existingUTAIds: string[]
  onSave: (uta: UTAConfig) => Promise<void>
  onClose: () => void
}) {
  const [step, setStep] = useState<WizardStep>('pick')
  const [presetId, setPresetId] = useState<string | null>(null)
  const [id, setId] = useState('')
  const [showSecrets, setShowSecrets] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)

  const preset = presets.find(p => p.id === presetId)
  const hasSensitive = preset?.schema && Object.values((preset.schema as { properties?: Record<string, { writeOnly?: boolean }> }).properties ?? {}).some(p => p.writeOnly)
  const { fields, formData, setField, getSubmitData, validate } = useSchemaForm(preset?.schema)

  const defaultId = preset?.defaultName ?? ''
  const finalId = id.trim() || defaultId

  const platformOptions: SDKOption[] = useMemo(() => presets.map(p => ({
    id: p.id,
    name: p.label,
    description: p.description,
    badge: p.badge,
    badgeColor: p.badgeColor,
  })), [presets])

  const buildUTA = (): UTAConfig | null => {
    if (!preset) return null
    return {
      id: finalId,
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
    if (existingUTAIds.includes(finalId)) {
      setError(`UTA "${finalId}" already exists`)
      return
    }
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
    setSaving(true); setError('')
    try {
      await onSave(uta)
    } catch (err) {
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
          <SDKSelector options={platformOptions} selected={presetId ?? ''} onSelect={handlePick} />
        )}

        {step === 'config' && preset && (
          <div className="space-y-5">
            {preset.hint && <HintBlock text={preset.hint} />}
            <div className="space-y-3">
              <Field label="UTA ID">
                <input className={inputClass} value={id} onChange={(e) => setId(e.target.value.trim())} placeholder={defaultId} />
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

        {step === 'test' && testResult && (
          <TestResultPanel result={testResult} utaId={finalId} />
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
            {testResult?.success ? (
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
