import { useMemo, useState } from 'react'

import { api } from '../../api'
import type { AccountInfo, BrokerPreset, Position, TestConnectionResult, UTAConfig } from '../../api/types'
import type { SDKOption } from '../SDKSelector'
import { SDKSelector } from '../SDKSelector'
import { Toggle } from '../Toggle'
import { Field, inputClass } from '../form'
import { useSchemaForm } from '../../hooks/useSchemaForm'
import { Dialog } from './Dialog'
import { SchemaFormFields } from './SchemaFormFields'

type WizardStep = 'pick' | 'config' | 'test'

interface BrokerConflict {
  existing: { id: string; label: string; presetId: string }
}

interface EscapeAction {
  label: string
  onClick: () => void | Promise<void>
  disabled?: boolean
}

export function CreateUTADialog({
  presets,
  onSave,
  onOpenExisting,
  onClose,
  initialReadOnly = false,
  initialAsVendor = true,
  escapeAction,
}: {
  presets: BrokerPreset[]
  onSave: (uta: Omit<UTAConfig, 'id'>) => Promise<UTAConfig>
  onOpenExisting: (id: string) => void
  onClose: () => void
  initialReadOnly?: boolean
  initialAsVendor?: boolean
  escapeAction?: EscapeAction
}) {
  const [step, setStep] = useState<WizardStep>('pick')
  const [presetId, setPresetId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [showSecrets, setShowSecrets] = useState(false)
  const [readOnly, setReadOnly] = useState(initialReadOnly)
  const [asVendor, setAsVendor] = useState(initialAsVendor)
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

  // 'testing' category presets (Simulator) are intentionally excluded; their
  // creation entry lives in Dev -> Simulator so real broker setup stays clean.
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
      readOnly,
      asVendor,
    }
  }

  const handlePick = (id: string) => {
    setPresetId(id)
    setReadOnly(initialReadOnly)
    setAsVendor(initialAsVendor)
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
      if (err instanceof Error && err.name === 'BrokerAlreadyExistsError') {
        const existing = (err as Error & { existing?: BrokerConflict['existing'] }).existing
        if (existing) {
          setConflict({ existing })
          setSaving(false)
          return
        }
      }
      setError(err instanceof Error ? err.message : 'Failed to save connector')
      setSaving(false)
    }
  }

  const headerLabel =
    step === 'pick'   ? 'Connect Broker · Pick Platform' :
    step === 'config' ? `Connect Broker · Configure ${preset?.label ?? ''}` :
                        `Connect Broker · Test ${preset?.label ?? ''}`

  const escapeButton = escapeAction ? (
    <button
      type="button"
      onClick={() => { void escapeAction.onClick() }}
      disabled={escapeAction.disabled}
      className="rounded-md px-3 py-2 text-[12px] font-medium text-text-muted transition-colors hover:bg-overlay hover:text-text disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted"
    >
      {escapeAction.label}
    </button>
  ) : null

  return (
    <Dialog onClose={onClose}>
      <div className="shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-[14px] font-semibold text-text truncate">{headerLabel}</h3>
          <StepDots current={step} />
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text p-1 transition-colors" aria-label="Close broker setup">
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
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-text">Read-only account</div>
                  <div className="text-[11px] text-text-muted leading-relaxed">
                    Allow analysis reads; block broker-side order changes.
                  </div>
                </div>
                <Toggle size="sm" checked={readOnly} onChange={setReadOnly} />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-text">Use as data source</div>
                  <div className="text-[11px] text-text-muted leading-relaxed">
                    Include this connector in K-line and contract discovery.
                  </div>
                </div>
                <Toggle size="sm" checked={asVendor} onChange={setAsVendor} />
              </div>
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

      <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-border">
        <div className="flex min-w-0 items-center gap-2">
          {step === 'pick' && <button onClick={onClose} className="btn-secondary">Cancel</button>}
          {step === 'config' && <button onClick={() => setStep('pick')} className="btn-secondary">← Back</button>}
          {step === 'test' && <button onClick={() => setStep('config')} className="btn-secondary">← Back</button>}
          {escapeButton}
        </div>
        <div className="flex shrink-0 items-center justify-end">
          {step === 'pick' && <span className="text-[11px] text-text-muted">Pick a platform to continue</span>}
          {step === 'config' && (
            <button onClick={handleTest} disabled={testing} className="btn-primary">
              {testing ? 'Testing...' : 'Test Connection →'}
            </button>
          )}
          {step === 'test' && (
            conflict ? (
              <button onClick={() => onOpenExisting(conflict.existing.id)} className="btn-primary">
                Open existing
              </button>
            ) : testResult?.success ? (
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : 'Save connector'}
              </button>
            ) : (
              <span className="text-[11px] text-text-muted">Fix the config and try again</span>
            )
          )}
        </div>
      </div>
    </Dialog>
  )
}

function PickerSectionHeader({ title }: { title: string }) {
  return (
    <p className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
      {title}
    </p>
  )
}

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
          Another broker connector already exists for this broker (same identity-defining credentials).
          Re-using the same key from a separate account would double-count its positions in
          aggregate views.
        </p>
        <p className="text-[12px] text-text-muted leading-relaxed mt-2">
          Existing: <strong className="text-text">{existing.label}</strong> <span className="font-mono text-text-muted/70">({existing.id})</span>
        </p>
      </div>
      <p className="text-[11px] text-text-muted">
        Click <strong className="text-text">Open existing</strong> to use it, or <strong className="text-text">← Back</strong> to point this connector at a different account.
      </p>
      <button onClick={onOpenExisting} className="btn-secondary w-full">Open existing connector</button>
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
                    <td className="px-2.5 py-1.5 text-text font-mono" title={p.contract.aliceId}>{p.contract.symbol ?? p.contract.localSymbol ?? p.contract.aliceId ?? '?'}</td>
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
