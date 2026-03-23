import { useState, useEffect, useCallback } from 'react'
import { Section, Field, inputClass } from '../components/form'
import { Toggle } from '../components/Toggle'
import { GuardsSection, CRYPTO_GUARD_TYPES, SECURITIES_GUARD_TYPES } from '../components/guards'
import { SDKSelector } from '../components/SDKSelector'
import type { SDKOption } from '../components/SDKSelector'
import { ReconnectButton } from '../components/ReconnectButton'
import { useTradingConfig } from '../hooks/useTradingConfig'
import { useAccountHealth } from '../hooks/useAccountHealth'
import { PageHeader } from '../components/PageHeader'
import { api } from '../api'
import type { AccountConfig, BrokerTypeInfo, BrokerConfigField, BrokerHealthInfo } from '../api/types'

// ==================== Dialog state ====================

type DialogState =
  | { kind: 'edit'; accountId: string }
  | { kind: 'add' }
  | null

// ==================== Page ====================

export function TradingPage() {
  const tc = useTradingConfig()
  const healthMap = useAccountHealth()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [brokerTypes, setBrokerTypes] = useState<BrokerTypeInfo[]>([])

  // Fetch broker type metadata on mount
  useEffect(() => {
    api.trading.getBrokerTypes().then(r => setBrokerTypes(r.brokerTypes)).catch(() => {})
  }, [])

  useEffect(() => {
    if (dialog?.kind === 'edit') {
      if (!tc.accounts.some((a) => a.id === dialog.accountId)) setDialog(null)
    }
  }, [tc.accounts, dialog])

  if (tc.loading) return <PageShell subtitle="Loading..." />
  if (tc.error) {
    return (
      <PageShell subtitle="Failed to load trading configuration.">
        <p className="text-[13px] text-red">{tc.error}</p>
        <button onClick={tc.refresh} className="mt-2 btn-secondary">Retry</button>
      </PageShell>
    )
  }

  const deleteAccount = async (accountId: string) => {
    await tc.deleteAccount(accountId)
    setDialog(null)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="Trading" description="Configure your trading accounts." />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[720px] space-y-3">
          {tc.accounts.length === 0 ? (
            <EmptyState onAdd={() => setDialog({ kind: 'add' })} />
          ) : (
            <>
              {tc.accounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  brokerType={brokerTypes.find(bt => bt.type === account.type)}
                  health={healthMap[account.id]}
                  onClick={() => setDialog({ kind: 'edit', accountId: account.id })}
                />
              ))}
              <button
                onClick={() => setDialog({ kind: 'add' })}
                className="w-full py-2.5 text-[12px] text-text-muted hover:text-text border border-dashed border-border hover:border-text-muted/40 rounded-lg transition-colors"
              >
                + Add Account
              </button>
            </>
          )}
        </div>
      </div>

      {/* Create Wizard */}
      {dialog?.kind === 'add' && (
        <CreateWizard
          brokerTypes={brokerTypes}
          existingAccountIds={tc.accounts.map((a) => a.id)}
          onSave={async (account) => {
            await tc.saveAccount(account)
            const result = await tc.reconnectAccount(account.id)
            if (!result.success) {
              throw new Error(result.error || 'Connection failed')
            }
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Edit Dialog */}
      {dialog?.kind === 'edit' && (() => {
        const account = tc.accounts.find((a) => a.id === dialog.accountId)
        if (!account) return null
        return (
          <EditDialog
            account={account}
            brokerType={brokerTypes.find(bt => bt.type === account.type)}
            health={healthMap[account.id]}
            onSaveAccount={tc.saveAccount}
            onDelete={() => deleteAccount(account.id)}
            onClose={() => setDialog(null)}
          />
        )
      })()}
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
      <h3 className="text-[16px] font-semibold text-text mb-2">No trading accounts</h3>
      <p className="text-[13px] text-text-muted mb-6 max-w-[320px] mx-auto leading-relaxed">
        Connect a crypto exchange or brokerage account to start automated trading.
      </p>
      <button onClick={onAdd} className="btn-primary">
        + Add Account
      </button>
    </div>
  )
}

// ==================== Dialog ====================

function Dialog({ onClose, width, children }: {
  onClose: () => void
  width?: string
  children: React.ReactNode
}) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative ${width || 'w-[560px]'} max-w-[95vw] max-h-[85vh] bg-bg rounded-xl border border-border shadow-2xl flex flex-col overflow-hidden`}>
        {children}
      </div>
    </div>
  )
}

// ==================== Health Badge ====================

function HealthBadge({ health, size = 'sm' }: { health?: BrokerHealthInfo; size?: 'sm' | 'md' }) {
  const textSize = size === 'md' ? 'text-[12px]' : 'text-[11px]'
  const dotSize = size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5'

  if (!health) return <span className="text-text-muted/40">—</span>

  if (health.disabled) {
    return (
      <span className={`inline-flex items-center gap-1.5 ${textSize} text-text-muted`} title={health.lastError}>
        <span className={`${dotSize} rounded-full bg-text-muted/40 shrink-0`} />
        Disabled
      </span>
    )
  }

  switch (health.status) {
    case 'healthy':
      return (
        <span className={`inline-flex items-center gap-1.5 ${textSize} text-green`}>
          <span className={`${dotSize} rounded-full bg-green shrink-0`} />
          Connected
        </span>
      )
    case 'degraded':
      return (
        <span className={`inline-flex items-center gap-1.5 ${textSize} text-yellow-400`}>
          <span className={`${dotSize} rounded-full bg-yellow-400 shrink-0`} />
          Unstable
        </span>
      )
    case 'offline':
      return (
        <span className={`inline-flex items-center gap-1.5 ${textSize} text-red`} title={health.lastError}>
          <span className={`${dotSize} rounded-full bg-red shrink-0 animate-pulse`} />
          {health.recovering ? 'Reconnecting...' : 'Offline'}
        </span>
      )
  }
}

// ==================== Subtitle builder ====================

function buildSubtitle(account: AccountConfig, brokerType?: BrokerTypeInfo): string {
  if (!brokerType) return account.type
  const bc = account.brokerConfig
  const parts: string[] = []
  for (const sf of brokerType.subtitleFields) {
    const val = bc[sf.field]
    if (typeof val === 'boolean') {
      if (val && sf.label) parts.push(sf.label)
      else if (!val && sf.falseLabel) parts.push(sf.falseLabel)
    } else if (val != null && val !== '') {
      parts.push(`${sf.prefix ?? ''}${val}`)
    }
  }
  return parts.join(' · ') || brokerType.name
}

// ==================== Account Card ====================

function AccountCard({ account, brokerType, health, onClick }: {
  account: AccountConfig
  brokerType?: BrokerTypeInfo
  health?: BrokerHealthInfo
  onClick: () => void
}) {
  const isDisabled = health?.disabled || account.enabled === false
  const badge = brokerType
    ? { text: brokerType.badge, color: `${brokerType.badgeColor} ${brokerType.badgeColor.replace('text-', 'bg-')}/10` }
    : { text: account.type.slice(0, 2).toUpperCase(), color: 'text-text-muted bg-text-muted/10' }

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
          <div className="text-[13px] font-medium text-text truncate">{account.id}</div>
          <div className="text-[11px] text-text-muted truncate mt-0.5">
            {buildSubtitle(account, brokerType)}
            {account.guards.length > 0 && <span className="ml-2 text-text-muted/50">{account.guards.length} guard{account.guards.length > 1 ? 's' : ''}</span>}
          </div>
        </div>
        <div className="shrink-0">
          {account.enabled === false
            ? <span className="text-[11px] text-text-muted">Disabled</span>
            : <HealthBadge health={health} />
          }
        </div>
      </div>
    </button>
  )
}

// ==================== Dynamic Broker Fields ====================

function DynamicBrokerFields({ fields, values, showSecrets, onChange }: {
  fields: BrokerConfigField[]
  values: Record<string, unknown>
  showSecrets: boolean
  onChange: (field: string, value: unknown) => void
}) {
  return (
    <div className="space-y-3">
      {fields.map((f) => {
        switch (f.type) {
          case 'boolean':
            return (
              <div key={f.name}>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <Toggle checked={Boolean(values[f.name] ?? f.default)} onChange={(v) => onChange(f.name, v)} />
                  <span className="text-[13px] text-text">{f.label}</span>
                </label>
                {f.description && <p className="text-[11px] text-text-muted/60 mt-1">{f.description}</p>}
              </div>
            )
          case 'select':
            return (
              <Field key={f.name} label={f.label}>
                <select className={inputClass} value={String(values[f.name] ?? f.default ?? '')} onChange={(e) => onChange(f.name, e.target.value)}>
                  {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            )
          case 'number':
            return (
              <Field key={f.name} label={f.label}>
                <input className={inputClass} type="number" value={Number(values[f.name] ?? f.default ?? 0)} onChange={(e) => onChange(f.name, parseInt(e.target.value) || 0)} placeholder={f.placeholder} />
              </Field>
            )
          case 'text':
          case 'password':
          default:
            return (
              <Field key={f.name} label={f.label}>
                <input
                  className={inputClass}
                  type={f.sensitive && !showSecrets ? 'password' : 'text'}
                  value={String(values[f.name] ?? f.default ?? '')}
                  onChange={(e) => onChange(f.name, e.target.value)}
                  placeholder={f.placeholder || (f.required ? 'Required' : '')}
                />
              </Field>
            )
        }
      })}
    </div>
  )
}

// ==================== Create Wizard ====================

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1 rounded-full transition-all ${
            i < current ? 'w-5 bg-accent' : 'w-5 bg-border'
          }`}
        />
      ))}
    </div>
  )
}

function CreateWizard({ brokerTypes, existingAccountIds, onSave, onClose }: {
  brokerTypes: BrokerTypeInfo[]
  existingAccountIds: string[]
  onSave: (account: AccountConfig) => Promise<void>
  onClose: () => void
}) {
  const [step, setStep] = useState(1)
  const [type, setType] = useState<string | null>(null)
  const [id, setId] = useState('')
  const [brokerConfig, setBrokerConfig] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const bt = brokerTypes.find(b => b.type === type)
  const hasSensitive = bt?.fields.some(f => f.sensitive) ?? false
  const totalSteps = hasSensitive ? 2 : 1

  // Split fields into connection (non-sensitive) and credential (sensitive)
  const connectionFields = bt?.fields.filter(f => !f.sensitive) ?? []
  const credentialFields = bt?.fields.filter(f => f.sensitive) ?? []

  // Initialize defaults when type changes
  useEffect(() => {
    if (!bt) return
    const defaults: Record<string, unknown> = {}
    for (const f of bt.fields) {
      if (f.default !== undefined) defaults[f.name] = f.default
    }
    setBrokerConfig(defaults)
  }, [type])

  const defaultId = type ? `${type}-main` : ''
  const finalId = id.trim() || defaultId

  const platformOptions: SDKOption[] = brokerTypes.map(b => ({
    id: b.type,
    name: b.name,
    description: b.description,
    badge: b.badge,
    badgeColor: b.badgeColor,
  }))

  const handleNext = () => {
    if (!type) return
    if (existingAccountIds.includes(finalId)) {
      setError(`Account "${finalId}" already exists`)
      return
    }
    setError('')
    if (hasSensitive) {
      setStep(2)
    } else {
      handleCreate()
    }
  }

  const handleCreate = async () => {
    setSaving(true); setError('')
    try {
      const account: AccountConfig = { id: finalId, type: type!, enabled: true, guards: [], brokerConfig }

      const testResult = await api.trading.testConnection(account)
      if (!testResult.success) {
        setError(testResult.error || 'Connection failed')
        setSaving(false)
        return
      }

      await onSave(account)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account')
      setSaving(false)
    }
  }

  const canCreate = hasSensitive
    ? credentialFields.filter(f => f.required).every(f => String(brokerConfig[f.name] ?? '').trim())
    : true

  return (
    <Dialog onClose={onClose}>
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-semibold text-text">New Account</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text p-1 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <StepIndicator current={step} total={totalSteps} />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <p className="text-[12px] font-medium text-text-muted uppercase tracking-wide mb-3">Platform</p>
              <SDKSelector options={platformOptions} selected={type ?? ''} onSelect={(t) => setType(t)} />
            </div>

            {type && bt && (
              <div className="space-y-3 pt-2 border-t border-border">
                <p className="text-[12px] font-medium text-text-muted uppercase tracking-wide mb-1">Connection</p>
                <Field label="Account ID">
                  <input className={inputClass} value={id} onChange={(e) => setId(e.target.value.trim())} placeholder={defaultId} />
                </Field>
                <DynamicBrokerFields
                  fields={connectionFields}
                  values={brokerConfig}
                  showSecrets={false}
                  onChange={(f, v) => setBrokerConfig(prev => ({ ...prev, [f]: v }))}
                />
              </div>
            )}
            {error && <p className="text-[12px] text-red">{error}</p>}
          </div>
        )}

        {step === 2 && bt && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-4">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${bt.badgeColor} ${bt.badgeColor.replace('text-', 'bg-')}/10`}>
                {bt.badge}
              </span>
              <span className="text-[13px] text-text-muted">{bt.name}</span>
            </div>

            <p className="text-[12px] font-medium text-text-muted uppercase tracking-wide mb-1">Credentials</p>
            <DynamicBrokerFields
              fields={credentialFields}
              values={brokerConfig}
              showSecrets={false}
              onChange={(f, v) => setBrokerConfig(prev => ({ ...prev, [f]: v }))}
            />
            {error && <p className="text-[12px] text-red">{error}</p>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-border">
        <button onClick={step === 1 ? onClose : () => { setStep(1); setError('') }} className="btn-secondary">
          {step === 1 ? 'Cancel' : 'Back'}
        </button>
        {step === 1 && !hasSensitive && type && (
          <button onClick={handleNext} disabled={saving} className="btn-primary">
            {saving ? 'Connecting...' : 'Create Account'}
          </button>
        )}
        {step === 1 && (hasSensitive || !type) && (
          <button onClick={handleNext} disabled={!type} className="btn-primary">
            Next
          </button>
        )}
        {step === 2 && (
          <button onClick={handleCreate} disabled={saving || !canCreate} className="btn-primary">
            {saving ? 'Connecting...' : 'Create Account'}
          </button>
        )}
      </div>
    </Dialog>
  )
}

// ==================== Edit Dialog ====================

function EditDialog({ account, brokerType, health, onSaveAccount, onDelete, onClose }: {
  account: AccountConfig
  brokerType?: BrokerTypeInfo
  health?: BrokerHealthInfo
  onSaveAccount: (a: AccountConfig) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(account)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [guardsOpen, setGuardsOpen] = useState(false)
  const [showKeys, setShowKeys] = useState(false)

  useEffect(() => { setDraft(account) }, [account])

  const dirty = JSON.stringify(draft) !== JSON.stringify(account)

  const patchBrokerConfig = (field: string, value: unknown) => {
    setDraft(d => ({ ...d, brokerConfig: { ...d.brokerConfig, [field]: value } }))
  }

  const patchGuards = (guards: AccountConfig['guards']) => {
    setDraft(d => ({ ...d, guards }))
  }

  const handleSave = async () => {
    setSaving(true); setMsg('')
    try {
      await onSaveAccount(draft)
      setMsg('Saved')
      setTimeout(() => setMsg(''), 2000)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const fields = brokerType?.fields ?? []
  const hasSensitive = fields.some(f => f.sensitive)
  const guardTypes = (brokerType?.guardCategory === 'crypto') ? CRYPTO_GUARD_TYPES : SECURITIES_GUARD_TYPES

  return (
    <Dialog onClose={onClose} width="w-[560px]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-[14px] font-semibold text-text truncate">{account.id}</h3>
          <HealthBadge health={health} size="md" />
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text p-1 transition-colors shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        <Section title="Configuration">
          <div className="mb-3">
            <span className="text-[12px] text-text-muted">Type</span>
            <span className="ml-2 text-[12px] font-medium text-text">{brokerType?.name ?? account.type}</span>
          </div>
          <DynamicBrokerFields
            fields={fields}
            values={draft.brokerConfig}
            showSecrets={showKeys}
            onChange={patchBrokerConfig}
          />
          {hasSensitive && (
            <button
              onClick={() => setShowKeys(!showKeys)}
              className="text-[11px] text-text-muted hover:text-text transition-colors mt-2"
            >
              {showKeys ? 'Hide secrets' : 'Show secrets'}
            </button>
          )}
        </Section>

        {/* Guards */}
        <div>
          <button
            onClick={() => setGuardsOpen(!guardsOpen)}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-text-muted uppercase tracking-wide"
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={`transition-transform duration-150 ${guardsOpen ? 'rotate-90' : ''}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Guards ({draft.guards.length})
          </button>
          {guardsOpen && (
            <div className="mt-3">
              <GuardsSection
                guards={draft.guards}
                guardTypes={guardTypes}
                description="Guards validate operations before execution. Order matters."
                onChange={patchGuards}
                onChangeImmediate={patchGuards}
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center px-6 py-4 border-t border-border">
        <div className="flex items-center gap-3">
          {dirty && (
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {draft.enabled !== false && <ReconnectButton accountId={account.id} />}
          <label className="flex items-center gap-2 cursor-pointer">
            <Toggle checked={draft.enabled !== false} onChange={async (v) => {
              const updated = { ...draft, enabled: v }
              setDraft(updated)
              await onSaveAccount(updated)
            }} />
            <span className="text-[12px] text-text-muted">{draft.enabled !== false ? 'Enabled' : 'Disabled'}</span>
          </label>
          {msg && <span className="text-[12px] text-text-muted">{msg}</span>}
        </div>
        <div className="flex-1" />
        <DeleteButton label="Delete Account" onConfirm={onDelete} />
      </div>
    </Dialog>
  )
}

// ==================== Delete Button ====================

function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={() => { onConfirm(); setConfirming(false) }} className="btn-danger">
          Confirm
        </button>
        <button onClick={() => setConfirming(false)} className="btn-secondary">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button onClick={() => setConfirming(true)} className="btn-danger">
      {label}
    </button>
  )
}
