import { useState, useEffect, useMemo } from 'react'
import { ChevronRight, ExternalLink, X } from 'lucide-react'
import { Section } from '../form'
import { Toggle } from '../Toggle'
import { Button } from '../ui/button'
import { GuardsSection, CRYPTO_GUARD_TYPES, SECURITIES_GUARD_TYPES } from '../guards'
import { ReconnectButton } from '../ReconnectButton'
import { useSchemaForm } from '../../hooks/useSchemaForm'
import type { UTAConfig, BrokerPreset, BrokerHealthInfo, BrokerEngine } from '../../api/types'
import type { AccountInteractionPolicy, AccountPackReadiness } from '../../hooks/useBrokerPackReadiness'
import { displayNameForUTA } from '../../lib/uta-account-filter'
import { Dialog } from './Dialog'
import { AccountReadinessBadge, BrokerSupportGate } from './BrokerPackGate'
import { SchemaFormFields } from './SchemaFormFields'

/**
 * UTA configuration dialog — edits credentials, guards, enabled state.
 * Mounted from Settings → Trading (primary CRUD entry) and from the UTA
 * detail page in Portfolio (sibling Edit button).
 *
 * When opened from Settings → Trading, the parent passes `onViewInPortfolio`
 * to render a header link that switches the user over to the Portfolio
 * drill-in for this account. When opened from inside Portfolio's detail
 * page, that prop is omitted (the user is already in that context).
 */
export function EditUTADialog({ uta, preset, health, readiness, policy, installingEngine, onInstallBrokerPack, onRetryBrokerPack, onSave, onDelete, onViewInPortfolio, onClose }: {
  uta: UTAConfig
  preset?: BrokerPreset
  health?: BrokerHealthInfo
  readiness: AccountPackReadiness
  policy: AccountInteractionPolicy
  installingEngine?: BrokerEngine | null
  onInstallBrokerPack: (engine: Exclude<BrokerEngine, 'mock'>) => Promise<void>
  onRetryBrokerPack: () => Promise<void>
  onSave: (a: UTAConfig) => Promise<void>
  onDelete: () => Promise<void>
  onViewInPortfolio?: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(uta)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [guardsOpen, setGuardsOpen] = useState(false)
  const [showKeys, setShowKeys] = useState(false)

  const initialValues = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(uta.presetConfig)) {
      if (v != null) out[k] = String(v)
    }
    return out
  }, [uta])
  const { fields, formData, setField, getSubmitData } = useSchemaForm(preset?.schema, initialValues)
  const hasSensitive = fields.some(f => f.type === 'password')

  useEffect(() => {
    const submitData = getSubmitData()
    setDraft(d => ({ ...d, presetConfig: submitData }))
  }, [formData, getSubmitData])

  useEffect(() => { setDraft(uta) }, [uta])

  const dirty = JSON.stringify(draft) !== JSON.stringify(uta)

  const patchGuards = (guards: UTAConfig['guards']) => {
    setDraft(d => ({ ...d, guards }))
  }

  const handleSave = async () => {
    setSaving(true); setMsg('')
    try {
      await onSave(draft)
      setMsg('Saved')
      setTimeout(() => setMsg(''), 2000)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const guardTypes = (preset?.guardCategory === 'crypto') ? CRYPTO_GUARD_TYPES : SECURITIES_GUARD_TYPES
  const displayName = displayNameForUTA(uta, preset)

  return (
    <Dialog ariaLabel={`Edit ${displayName}`} onClose={onClose} width="w-full sm:w-[560px]">
      {/* Header */}
      <div className="relative shrink-0 border-b border-border px-4 py-3 sm:flex sm:items-center sm:justify-between sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-2 pr-8 sm:gap-3 sm:pr-0">
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] leading-[19px] font-semibold text-foreground truncate">{displayName}</h3>
            {displayName !== uta.id && (
              <div className="mt-0.5 truncate font-mono text-[10px] leading-[14px] text-muted-foreground">{uta.id}</div>
            )}
          </div>
          <AccountReadinessBadge readiness={readiness} health={health} size="md" />
        </div>
        <div className={`${onViewInPortfolio ? 'mt-2' : ''} flex shrink-0 items-center sm:mt-0 sm:gap-3`}>
          {onViewInPortfolio && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onViewInPortfolio}
              className="text-muted-foreground"
            >
              View in Portfolio
              <ExternalLink aria-hidden />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label={`Close ${displayName} editor`}
            className="absolute right-4 top-3 text-muted-foreground sm:static"
          >
            <X aria-hidden />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div
        data-testid="edit-uta-scroll"
        className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-gutter:stable] sm:px-6 sm:py-6"
      >
        {!readiness.operational && (
          <BrokerSupportGate
            readiness={readiness}
            installingEngine={installingEngine}
            onInstall={onInstallBrokerPack}
            onRetry={onRetryBrokerPack}
            compact
          />
        )}
        <Section title="Configuration">
          <div className="mb-3">
            <span className="text-[12px] text-muted-foreground">Type</span>
            <span className="ml-2 text-[12px] font-medium text-foreground">{preset?.label ?? uta.presetId}</span>
          </div>
          <div className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-foreground">Read-only account</div>
              <div className="text-[11px] text-muted-foreground leading-relaxed">
                Allow analysis reads; block broker-side order changes.
              </div>
            </div>
            <Toggle
              ariaLabel="Read-only account"
              size="sm"
              checked={draft.readOnly === true}
              onChange={(v) => setDraft(d => ({ ...d, readOnly: v }))}
            />
          </div>
          <div className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-foreground">Use as data source</div>
              <div className="text-[11px] text-muted-foreground leading-relaxed">
                Include this UTA in K-line and contract discovery.
              </div>
            </div>
            <Toggle
              ariaLabel="Use as data source"
              size="sm"
              checked={draft.asVendor !== false}
              onChange={(v) => setDraft(d => ({ ...d, asVendor: v }))}
            />
          </div>
          <SchemaFormFields
            fields={fields}
            formData={formData}
            setField={setField}
            showSecrets={showKeys}
          />
          {hasSensitive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowKeys(!showKeys)}
              className="mt-2 px-0 text-muted-foreground hover:bg-transparent"
            >
              {showKeys ? 'Hide secrets' : 'Show secrets'}
            </Button>
          )}
        </Section>

        {/* Guards */}
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setGuardsOpen(!guardsOpen)}
            className="px-0 text-[13px] text-muted-foreground hover:bg-transparent"
            aria-expanded={guardsOpen}
          >
            <ChevronRight
              aria-hidden
              className={`transition-transform duration-[110ms] [transition-timing-function:var(--motion-ease-out)] motion-reduce:transition-none ${guardsOpen ? 'rotate-90' : ''}`}
            />
            Guards ({draft.guards.length})
          </Button>
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
      <div
        data-testid="edit-uta-footer"
        className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3 sm:gap-3 sm:px-6 sm:py-4"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3">
          {dirty && (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
          {draft.enabled !== false && (
            <ReconnectButton accountId={uta.id} disabled={!policy.canReconnect} disabledReason={policy.reason} />
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <Toggle
              ariaLabel={`${uta.id} enabled`}
              checked={draft.enabled !== false}
              disabled={draft.enabled === false && !readiness.operational}
              title={draft.enabled === false && !readiness.operational ? policy.reason : undefined}
              onChange={async (v) => {
                const updated = { ...draft, enabled: v }
                setDraft(updated)
                await onSave(updated)
              }}
            />
            <span className="text-[12px] text-muted-foreground">{draft.enabled !== false ? 'Configured on' : 'Configured off'}</span>
          </label>
          {msg && <span className="text-[12px] text-muted-foreground">{msg}</span>}
        </div>
        <DeleteButton label="Delete UTA" onConfirm={onDelete} />
      </div>
    </Dialog>
  )
}

function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="destructive" onClick={() => { onConfirm(); setConfirming(false) }}>
          Confirm
        </Button>
        <Button variant="outline" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Button variant="destructive" onClick={() => setConfirming(true)} className="shrink-0">
      {label}
    </Button>
  )
}
