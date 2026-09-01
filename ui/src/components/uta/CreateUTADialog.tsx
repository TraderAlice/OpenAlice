import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, CircleAlert, X } from 'lucide-react'

import { api } from '../../api'
import type { AccountInfo, BrokerPackStatus, BrokerPreset, Position, TestConnectionResult, UTAConfig } from '../../api/types'
import type { SDKOption } from '../SDKSelector'
import { SDKSelector } from '../SDKSelector'
import { Toggle } from '../Toggle'
import { Field, inputClass } from '../form'
import { Button } from '../ui/button'
import { useSchemaForm } from '../../hooks/useSchemaForm'
import { Dialog } from './Dialog'
import { SchemaFormFields } from './SchemaFormFields'

const WIZARD_STEPS = ['pick', 'install', 'config', 'test'] as const
type WizardStep = (typeof WIZARD_STEPS)[number]

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
  onPackInstalled,
  initialReadOnly = false,
  initialAsVendor = true,
  escapeAction,
}: {
  presets: BrokerPreset[]
  onSave: (uta: Omit<UTAConfig, 'id'>) => Promise<UTAConfig>
  onOpenExisting: (id: string) => void
  onClose: () => void
  onPackInstalled?: (status: BrokerPackStatus) => void
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
  const [packStatuses, setPackStatuses] = useState<BrokerPackStatus[] | null>(null)
  const [packStatusError, setPackStatusError] = useState('')
  const [installingPack, setInstallingPack] = useState(false)

  const preset = presets.find(p => p.id === presetId)
  const hasSensitive = preset?.schema && Object.values((preset.schema as { properties?: Record<string, { writeOnly?: boolean }> }).properties ?? {}).some(p => p.writeOnly)
  const { fields, formData, setField, getSubmitData, validate } = useSchemaForm(preset?.schema)

  const defaultName = preset?.defaultName ?? ''
  const finalName = name.trim() || defaultName
  const packStatus = preset ? packStatuses?.find((row) => row.engine === preset.engine) : undefined

  useEffect(() => {
    let cancelled = false
    api.trading.getBrokerPacks()
      .then((result) => { if (!cancelled) setPackStatuses(result.packs) })
      .catch((err) => {
        if (!cancelled) {
          setPackStatuses([])
          setPackStatusError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (step === 'install' && packStatus?.installed) setStep('config')
  }, [packStatus?.installed, step])

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
    const selected = presets.find((row) => row.id === id)
    setPresetId(id)
    setReadOnly(initialReadOnly)
    setAsVendor(initialAsVendor)
    setError('')
    const status = selected ? packStatuses?.find((row) => row.engine === selected.engine) : undefined
    setStep(status?.installed ? 'config' : 'install')
  }

  const handleInstallPack = async () => {
    if (!preset || preset.engine === 'mock') return
    setInstallingPack(true)
    setError('')
    try {
      const installed = await api.trading.installBrokerPack(preset.engine)
      setPackStatuses((rows) => [
        ...(rows ?? []).filter((row) => row.engine !== installed.engine),
        installed,
      ])
      onPackInstalled?.(installed)
      setStep('config')
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to install ${preset.label} support`)
    } finally {
      setInstallingPack(false)
    }
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
    step === 'pick' ? 'Connect broker — Choose platform' :
    step === 'install' ? `Connect broker — Install ${preset?.label ?? ''}` :
    step === 'config' ? `Connect broker — Configure ${preset?.label ?? ''}` :
                        `Connect broker — Test ${preset?.label ?? ''}`

  const escapeButton = escapeAction ? (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => { void escapeAction.onClick() }}
      disabled={escapeAction.disabled}
    >
      {escapeAction.label}
    </Button>
  ) : null

  return (
    <Dialog ariaLabel={headerLabel} onClose={onClose}>
      <div className="shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-[14px] font-semibold text-foreground truncate">{headerLabel}</h3>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            Step {WIZARD_STEPS.indexOf(step) + 1} of {WIZARD_STEPS.length}
          </span>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close broker setup">
          <X aria-hidden />
        </Button>
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
                  <div className="text-[12px] font-medium text-foreground">Read-only account</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    Allow analysis reads; block broker-side order changes.
                  </div>
                </div>
                <Toggle ariaLabel="Read-only account" size="sm" checked={readOnly} onChange={setReadOnly} />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-foreground">Use as data source</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    Include this connector in K-line and contract discovery.
                  </div>
                </div>
                <Toggle ariaLabel="Use as data source" size="sm" checked={asVendor} onChange={setAsVendor} />
              </div>
              <SchemaFormFields
                fields={fields}
                formData={formData}
                setField={setField}
                showSecrets={showSecrets}
              />
              {hasSensitive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSecrets(!showSecrets)}
                  className="px-0 text-muted-foreground hover:bg-transparent"
                >
                  {showSecrets ? 'Hide secrets' : 'Show secrets'}
                </Button>
              )}
              {error && <p className="text-[12px] text-destructive">{error}</p>}
            </div>
          </div>
        )}

        {step === 'install' && preset && (
          <BrokerPackInstallPanel
            preset={preset}
            status={packStatus}
            error={error || packStatusError}
          />
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
          {step === 'pick' && <Button variant="outline" onClick={onClose}>Cancel</Button>}
          {step === 'install' && <Button variant="outline" onClick={() => setStep('pick')}><ArrowLeft aria-hidden />Back</Button>}
          {step === 'config' && <Button variant="outline" onClick={() => setStep('pick')}><ArrowLeft aria-hidden />Back</Button>}
          {step === 'test' && <Button variant="outline" onClick={() => setStep('config')}><ArrowLeft aria-hidden />Back</Button>}
          {escapeButton}
        </div>
        <div className="flex shrink-0 items-center justify-end">
          {step === 'install' && (
            packStatuses === null ? (
              <span className="text-[11px] text-muted-foreground">Checking installed support…</span>
            ) : (
              <Button onClick={() => { void handleInstallPack() }} disabled={installingPack}>
                {installingPack ? 'Installing…' : packStatus?.source === 'broken' ? 'Repair support' : `Install ${preset?.label ?? 'broker'} support`}
              </Button>
            )
          )}
          {step === 'config' && (
            <Button onClick={handleTest} disabled={testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
          )}
          {step === 'test' && (
            conflict ? (
              <Button onClick={() => onOpenExisting(conflict.existing.id)}>
                Open existing
              </Button>
            ) : testResult?.success ? (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save connector'}
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground">Fix the config and try again</span>
            )
          )}
        </div>
      </div>
    </Dialog>
  )
}

function PickerSectionHeader({ title }: { title: string }) {
  return (
    <p className="text-[12px] font-medium text-muted-foreground">
      {title}
    </p>
  )
}

function BrokerPackInstallPanel({ preset, status, error }: {
  preset: BrokerPreset
  status?: BrokerPackStatus
  error: string
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-secondary/40 px-4 py-4">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground">Install {preset.label} support</div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            OpenAlice installs the broker integration on demand and loads it when this account connects.
          </p>
        </div>
      </div>
      <div className="rounded-md border border-border px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        The downloaded pack is matched to this OpenAlice version and operating system, checksum-verified, then activated atomically. Your account credentials are requested only after installation.
      </div>
      {status?.reason && <p className="text-[12px] text-warning">{status.reason}</p>}
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  )
}

function HintBlock({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/50 px-3 py-2.5 space-y-2">
      {text.trim().split('\n\n').map((para, i) => (
        <p key={i} className="text-[12px] text-muted-foreground leading-relaxed">
          {para.split(/(\*\*[^*]+\*\*)/).map((seg, j) =>
            seg.startsWith('**') && seg.endsWith('**')
              ? <strong key={j} className="text-foreground">{seg.slice(2, -2)}</strong>
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
        <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden />
        <span className="text-[13px] font-medium text-foreground">Broker already configured</span>
      </div>
      <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5">
        <p className="text-[12px] text-foreground leading-relaxed">
          Another broker connector already exists for this broker (same identity-defining credentials).
          Re-using the same key from a separate account would double-count its positions in
          aggregate views.
        </p>
        <p className="text-[12px] text-muted-foreground leading-relaxed mt-2">
          Existing: <strong className="text-foreground">{existing.label}</strong> <span className="font-mono text-muted-foreground/70">({existing.id})</span>
        </p>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Open the existing connector or go back and enter another account.
      </p>
      <Button variant="outline" onClick={onOpenExisting} className="w-full">Open existing connector</Button>
    </div>
  )
}

function TestResultPanel({ result, utaId }: { result: TestConnectionResult; utaId: string }) {
  if (!result.success) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
          <span className="text-[13px] font-medium text-destructive">Connection failed</span>
        </div>
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
          <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-wrap">{result.error ?? 'Unknown error'}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Go back, update the configuration, and test the connection again.
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
        <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
        <span className="text-[13px] font-medium text-success">Connected as {utaId}</span>
      </div>

      {acct && (
        <div className="rounded-md border border-border bg-secondary/50 px-3 py-2.5 space-y-1">
          <div className="flex justify-between text-[12px]">
            <span className="text-muted-foreground">Net Liquidation</span>
            <span className="text-foreground font-medium">{acct.baseCurrency} {acct.netLiquidation}</span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span className="text-muted-foreground">Cash</span>
            <span className="text-foreground">{acct.baseCurrency} {acct.totalCashValue}</span>
          </div>
          {acct.unrealizedPnL !== '0' && (
            <div className="flex justify-between text-[12px]">
              <span className="text-muted-foreground">Unrealized P&L</span>
              <span className="text-foreground">{acct.baseCurrency} {acct.unrealizedPnL}</span>
            </div>
          )}
        </div>
      )}

      <div>
        <p className="mb-2 text-[12px] font-medium text-muted-foreground">
          Positions ({positions.length})
        </p>
        {positions.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No open positions — connection works, account is empty.</p>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-muted/30 text-muted-foreground">
                  <th className="text-left px-2.5 py-1.5 font-medium">Contract</th>
                  <th className="text-left px-2.5 py-1.5 font-medium">Side</th>
                  <th className="text-right px-2.5 py-1.5 font-medium">Qty</th>
                  <th className="text-right px-2.5 py-1.5 font-medium">Mkt Value</th>
                </tr>
              </thead>
              <tbody>
                {visiblePositions.map((p, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2.5 py-1.5 text-foreground font-mono" title={p.contract.aliceId}>{p.contract.symbol ?? p.contract.localSymbol ?? p.contract.aliceId ?? '?'}</td>
                    <td className="px-2.5 py-1.5 text-muted-foreground">{p.side}</td>
                    <td className="px-2.5 py-1.5 text-right text-foreground">{p.quantity}</td>
                    <td className="px-2.5 py-1.5 text-right text-foreground">{p.currency} {p.marketValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {moreCount > 0 && (
              <div className="px-2.5 py-1.5 border-t border-border text-[11px] text-muted-foreground bg-muted/20">
                +{moreCount} more
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
