import { useState, useEffect, useCallback } from 'react'
import { Section, Field, inputClass } from '../components/form'
import { Toggle } from '../components/Toggle'
import { GuardsSection, CRYPTO_GUARD_TYPES, SECURITIES_GUARD_TYPES } from '../components/guards'
import { SDKSelector, PLATFORM_TYPE_OPTIONS } from '../components/SDKSelector'
import { ReconnectButton } from '../components/ReconnectButton'
import { useTradingConfig } from '../hooks/useTradingConfig'
import { useAccountHealth } from '../hooks/useAccountHealth'
import { PageHeader } from '../components/PageHeader'
import { api } from '../api'
import type { PlatformConfig, CcxtPlatformConfig, AlpacaPlatformConfig, AccountConfig, BrokerHealthInfo } from '../api/types'

// ==================== Constants ====================

const CCXT_EXCHANGES = [
  'binance', 'bybit', 'okx', 'bitget', 'gate', 'kucoin', 'coinbase',
  'kraken', 'htx', 'mexc', 'bingx', 'phemex', 'woo', 'hyperliquid',
] as const

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

  const getPlatform = (platformId: string) => tc.platforms.find((p) => p.id === platformId)

  const deleteAccountWithPlatform = async (accountId: string) => {
    const account = tc.accounts.find((a) => a.id === accountId)
    if (!account) return
    const platformId = account.platformId
    await tc.deleteAccount(accountId)
    const remaining = tc.accounts.filter((a) => a.id !== accountId && a.platformId === platformId)
    if (remaining.length === 0) {
      try { await tc.deletePlatform(platformId) } catch { /* best effort */ }
    }
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
                  platform={getPlatform(account.platformId)}
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
          existingAccountIds={tc.accounts.map((a) => a.id)}
          onSave={async (platform, account) => {
            await tc.savePlatform(platform)
            await tc.saveAccount(account)
            if (account.apiKey) {
              const result = await tc.reconnectAccount(account.id)
              if (!result.success) {
                throw new Error(result.error || 'Connection failed')
              }
            }
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Edit Dialog */}
      {dialog?.kind === 'edit' && (() => {
        const account = tc.accounts.find((a) => a.id === dialog.accountId)
        const platform = account ? getPlatform(account.platformId) : undefined
        if (!account || !platform) return null
        return (
          <EditDialog
            account={account}
            platform={platform}
            health={healthMap[account.id]}
            onSaveAccount={tc.saveAccount}
            onSavePlatform={tc.savePlatform}
            onDelete={() => deleteAccountWithPlatform(account.id)}
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

// ==================== Account Card ====================

function AccountCard({ account, platform, health, onClick }: {
  account: AccountConfig
  platform?: PlatformConfig
  health?: BrokerHealthInfo
  onClick: () => void
}) {
  const isDisabled = health?.disabled
  const badge = platform?.type === 'ccxt'
    ? { text: 'CC', color: 'text-accent bg-accent/10' }
    : { text: 'AL', color: 'text-green bg-green/10' }

  const subtitle = platform?.type === 'ccxt'
    ? [platform.exchange, platform.demoTrading && 'Demo', platform.sandbox && 'Sandbox'].filter(Boolean).join(' · ')
    : platform?.type === 'alpaca'
      ? platform.paper ? 'Paper Trading' : 'Live Trading'
      : '—'

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border border-border px-4 py-3.5 transition-all hover:border-text-muted/40 hover:bg-bg-tertiary/20 ${isDisabled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-3">
        {/* Badge */}
        <span className={`text-[10px] font-bold px-2 py-1 rounded-md shrink-0 ${badge.color}`}>
          {badge.text}
        </span>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-text truncate">{account.id}</div>
          <div className="text-[11px] text-text-muted truncate mt-0.5">
            {subtitle}
            {account.guards.length > 0 && <span className="ml-2 text-text-muted/50">{account.guards.length} guard{account.guards.length > 1 ? 's' : ''}</span>}
          </div>
        </div>

        {/* Health */}
        <div className="shrink-0">
          <HealthBadge health={health} />
        </div>
      </div>
    </button>
  )
}

// ==================== Create Wizard (2-step) ====================

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

function CreateWizard({ existingAccountIds, onSave, onClose }: {
  existingAccountIds: string[]
  onSave: (platform: PlatformConfig, account: AccountConfig) => Promise<void>
  onClose: () => void
}) {
  const [step, setStep] = useState(1)
  const [type, setType] = useState<'ccxt' | 'alpaca' | null>(null)

  // Connection fields
  const [id, setId] = useState('')
  const [exchange, setExchange] = useState('binance')
  const [sandbox, setSandbox] = useState(false)
  const [demoTrading, setDemoTrading] = useState(false)
  const [paper, setPaper] = useState(true)

  // Credential fields
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const defaultId = type === 'ccxt' ? `${exchange}-main` : 'alpaca-paper'
  const finalId = id.trim() || defaultId

  const handleNext = () => {
    if (!type) return
    if (existingAccountIds.includes(finalId)) {
      setError(`Account "${finalId}" already exists`)
      return
    }
    setError('')
    setStep(2)
  }

  const handleCreate = async () => {
    setSaving(true); setError('')
    try {
      const platformId = `${finalId}-platform`
      const platform: PlatformConfig = type === 'ccxt'
        ? { id: platformId, type: 'ccxt', exchange, sandbox, demoTrading }
        : { id: platformId, type: 'alpaca', paper }

      // Step 1: Test connection before saving anything
      const testResult = await api.trading.testConnection(platform, {
        apiKey, apiSecret,
        ...(password && type === 'ccxt' && { password }),
      })
      if (!testResult.success) {
        setError(testResult.error || 'Connection failed — check your credentials')
        setSaving(false)
        return
      }

      // Step 2: Connection verified — now persist config and create UTA
      const account: AccountConfig = {
        id: finalId, platformId,
        apiKey, apiSecret,
        ...(password && type === 'ccxt' && { password }),
        guards: [],
      }
      await onSave(platform, account)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account')
      setSaving(false)
    }
  }

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
        <StepIndicator current={step} total={2} />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {step === 1 && (
          <div className="space-y-5">
            {/* Platform selection */}
            <div>
              <p className="text-[12px] font-medium text-text-muted uppercase tracking-wide mb-3">Platform</p>
              <SDKSelector options={PLATFORM_TYPE_OPTIONS} selected={type ?? ''} onSelect={(t) => setType(t as 'ccxt' | 'alpaca')} />
            </div>

            {/* Connection config — expands after platform selection */}
            {type && (
              <div className="space-y-3 pt-2 border-t border-border">
                <p className="text-[12px] font-medium text-text-muted uppercase tracking-wide mb-1">Connection</p>

                <Field label="Account ID">
                  <input className={inputClass} value={id} onChange={(e) => setId(e.target.value.trim())} placeholder={defaultId} />
                </Field>

                {type === 'ccxt' && (
                  <>
                    <Field label="Exchange">
                      <select className={inputClass} value={exchange} onChange={(e) => setExchange(e.target.value)}>
                        {CCXT_EXCHANGES.map((ex) => (
                          <option key={ex} value={ex}>{ex.charAt(0).toUpperCase() + ex.slice(1)}</option>
                        ))}
                      </select>
                    </Field>
                    <div className="space-y-2 pt-1">
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <Toggle checked={sandbox} onChange={setSandbox} />
                        <span className="text-[13px] text-text">Sandbox Mode</span>
                      </label>
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <Toggle checked={demoTrading} onChange={setDemoTrading} />
                        <span className="text-[13px] text-text">Demo Trading</span>
                      </label>
                    </div>
                  </>
                )}

                {type === 'alpaca' && (
                  <>
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <Toggle checked={paper} onChange={setPaper} />
                      <span className="text-[13px] text-text">Paper Trading</span>
                    </label>
                    <p className="text-[11px] text-text-muted/60">When enabled, orders are routed to Alpaca's paper trading environment.</p>
                  </>
                )}
              </div>
            )}
            {error && <p className="text-[12px] text-red">{error}</p>}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-4">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${type === 'ccxt' ? 'text-accent bg-accent/10' : 'text-green bg-green/10'}`}>
                {type === 'ccxt' ? 'CC' : 'AL'}
              </span>
              <span className="text-[13px] text-text-muted">
                {type === 'ccxt' ? `${exchange} · CCXT` : `Alpaca · ${paper ? 'Paper' : 'Live'}`}
              </span>
            </div>

            <p className="text-[12px] font-medium text-text-muted uppercase tracking-wide mb-1">API Credentials</p>

            <Field label="API Key">
              <input className={inputClass} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Required" />
            </Field>
            <Field label={type === 'alpaca' ? 'Secret Key' : 'API Secret'}>
              <input className={inputClass} type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="Required" />
            </Field>
            {type === 'ccxt' && (
              <Field label="Password">
                <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Required by some exchanges (e.g. OKX)" />
              </Field>
            )}
            {error && <p className="text-[12px] text-red">{error}</p>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-border">
        <button onClick={step === 1 ? onClose : () => { setStep(1); setError('') }} className="btn-secondary">
          {step === 1 ? 'Cancel' : 'Back'}
        </button>
        {step === 1 && (
          <button onClick={handleNext} disabled={!type} className="btn-primary">
            Next
          </button>
        )}
        {step === 2 && (
          <button onClick={handleCreate} disabled={saving || !apiKey.trim() || !apiSecret.trim()} className="btn-primary">
            {saving ? 'Connecting...' : 'Create Account'}
          </button>
        )}
      </div>
    </Dialog>
  )
}

// ==================== Edit Dialog ====================

function EditDialog({ account, platform, health, onSaveAccount, onSavePlatform, onDelete, onClose }: {
  account: AccountConfig
  platform: PlatformConfig
  health?: BrokerHealthInfo
  onSaveAccount: (a: AccountConfig) => Promise<void>
  onSavePlatform: (p: PlatformConfig) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const [accountDraft, setAccountDraft] = useState(account)
  const [platformDraft, setPlatformDraft] = useState(platform)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [guardsOpen, setGuardsOpen] = useState(false)
  const [showKeys, setShowKeys] = useState(false)

  useEffect(() => { setAccountDraft(account) }, [account])
  useEffect(() => { setPlatformDraft(platform) }, [platform])

  const dirty =
    JSON.stringify(accountDraft) !== JSON.stringify(account) ||
    JSON.stringify(platformDraft) !== JSON.stringify(platform)

  const patchAccount = (field: keyof AccountConfig, value: unknown) => {
    setAccountDraft((d) => ({ ...d, [field]: value }))
  }

  const patchPlatform = (field: string, value: unknown) => {
    setPlatformDraft((d) => ({ ...d, [field]: value }) as PlatformConfig)
  }

  const handleSave = async () => {
    setSaving(true); setMsg('')
    try {
      if (JSON.stringify(platformDraft) !== JSON.stringify(platform)) {
        await onSavePlatform(platformDraft)
      }
      if (JSON.stringify(accountDraft) !== JSON.stringify(account)) {
        await onSaveAccount(accountDraft)
      }
      setMsg('Saved')
      setTimeout(() => setMsg(''), 2000)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const guardTypes = platform.type === 'ccxt' ? CRYPTO_GUARD_TYPES : SECURITIES_GUARD_TYPES

  return (
    <Dialog onClose={onClose} width="w-[560px]">
      {/* Header — account id + health */}
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
        {/* Connection */}
        <Section title="Connection">
          <div className="mb-3">
            <span className="text-[12px] text-text-muted">Type</span>
            <span className="ml-2 text-[12px] font-medium text-text">
              {platform.type === 'ccxt' ? 'CCXT' : 'Alpaca'}
            </span>
          </div>
          {platformDraft.type === 'ccxt' ? (
            <CcxtConnectionFields draft={platformDraft} onPatch={patchPlatform} />
          ) : (
            <AlpacaConnectionFields draft={platformDraft} onPatch={patchPlatform} />
          )}
        </Section>

        {/* Credentials */}
        <Section title={
          <div className="flex items-center justify-between w-full">
            <span>Credentials</span>
            <button
              onClick={() => setShowKeys(!showKeys)}
              className="text-[11px] text-text-muted hover:text-text font-normal normal-case tracking-normal transition-colors"
            >
              {showKeys ? 'Hide' : 'Show'}
            </button>
          </div>
        }>
          <Field label="API Key">
            <input className={inputClass} type={showKeys ? 'text' : 'password'} value={accountDraft.apiKey || ''} onChange={(e) => patchAccount('apiKey', e.target.value)} placeholder="Not configured" />
          </Field>
          <Field label={platform.type === 'alpaca' ? 'Secret Key' : 'API Secret'}>
            <input className={inputClass} type={showKeys ? 'text' : 'password'} value={accountDraft.apiSecret || ''} onChange={(e) => patchAccount('apiSecret', e.target.value)} placeholder="Not configured" />
          </Field>
          {platform.type === 'ccxt' && (
            <Field label="Password (optional)">
              <input className={inputClass} type={showKeys ? 'text' : 'password'} value={accountDraft.password || ''} onChange={(e) => patchAccount('password', e.target.value)} placeholder="Required by some exchanges (e.g. OKX)" />
            </Field>
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
            Guards ({accountDraft.guards.length})
          </button>
          {guardsOpen && (
            <div className="mt-3">
              <GuardsSection
                guards={accountDraft.guards}
                guardTypes={guardTypes}
                description="Guards validate operations before execution. Order matters."
                onChange={(guards) => patchAccount('guards', guards)}
                onChangeImmediate={(guards) => patchAccount('guards', guards)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer — Save/Reconnect left, Delete right */}
      <div className="shrink-0 flex items-center px-6 py-4 border-t border-border">
        <div className="flex items-center gap-3">
          {dirty && (
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          <ReconnectButton accountId={account.id} />
          {msg && <span className="text-[12px] text-text-muted">{msg}</span>}
        </div>
        <div className="flex-1" />
        <DeleteButton label="Delete Account" onConfirm={onDelete} />
      </div>
    </Dialog>
  )
}

// ==================== Connection Fields ====================

function CcxtConnectionFields({ draft, onPatch }: {
  draft: CcxtPlatformConfig
  onPatch: (field: string, value: unknown) => void
}) {
  return (
    <>
      <Field label="Exchange">
        <input className={inputClass} value={draft.exchange} onChange={(e) => onPatch('exchange', e.target.value.trim())} placeholder="binance" />
      </Field>
      <div className="space-y-2">
        <label className="flex items-center gap-2.5 cursor-pointer">
          <Toggle checked={draft.sandbox} onChange={(v) => onPatch('sandbox', v)} />
          <span className="text-[13px] text-text">Sandbox Mode</span>
        </label>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <Toggle checked={draft.demoTrading} onChange={(v) => onPatch('demoTrading', v)} />
          <span className="text-[13px] text-text">Demo Trading</span>
        </label>
      </div>
    </>
  )
}

function AlpacaConnectionFields({ draft, onPatch }: {
  draft: AlpacaPlatformConfig
  onPatch: (field: string, value: unknown) => void
}) {
  return (
    <>
      <label className="flex items-center gap-2.5 cursor-pointer">
        <Toggle checked={draft.paper} onChange={(v) => onPatch('paper', v)} />
        <span className="text-[13px] text-text">Paper Trading</span>
      </label>
      <p className="text-[11px] text-text-muted/60 mt-1">When enabled, orders are routed to Alpaca's paper trading environment.</p>
    </>
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
