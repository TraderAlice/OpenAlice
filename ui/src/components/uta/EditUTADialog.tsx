import { useState, useEffect, useMemo } from 'react'
import { Section } from '../form'
import { Toggle } from '../Toggle'
import { GuardsSection, CRYPTO_GUARD_TYPES, SECURITIES_GUARD_TYPES } from '../guards'
import { ReconnectButton } from '../ReconnectButton'
import { useSchemaForm } from '../../hooks/useSchemaForm'
import type { UTAConfig, BrokerPreset, BrokerHealthInfo } from '../../api/types'
import { Dialog } from './Dialog'
import { HealthBadge } from './HealthBadge'
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
export function EditUTADialog({ uta, preset, health, onSave, onDelete, onViewInPortfolio, onClose }: {
  uta: UTAConfig
  preset?: BrokerPreset
  health?: BrokerHealthInfo
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

  return (
    <Dialog onClose={onClose} width="w-[560px]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-[14px] font-semibold text-text truncate">{uta.id}</h3>
          <HealthBadge health={health} size="md" />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {onViewInPortfolio && (
            <button
              onClick={onViewInPortfolio}
              className="text-[11px] text-text-muted hover:text-text inline-flex items-center gap-1 transition-colors"
              title="See this account's positions and equity in Portfolio"
            >
              View in Portfolio
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </button>
          )}
          <button onClick={onClose} className="text-text-muted hover:text-text p-1 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        <Section title="Configuration">
          <div className="mb-3">
            <span className="text-[12px] text-text-muted">Type</span>
            <span className="ml-2 text-[12px] font-medium text-text">{preset?.label ?? uta.presetId}</span>
          </div>
          <div className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-text">Read-only account</div>
              <div className="text-[11px] text-text-muted leading-relaxed">
                Allow analysis reads; block broker-side order changes.
              </div>
            </div>
            <Toggle size="sm" checked={draft.readOnly === true} onChange={(v) => setDraft(d => ({ ...d, readOnly: v }))} />
          </div>
          <div className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-text">Use as data source</div>
              <div className="text-[11px] text-text-muted leading-relaxed">
                Include this UTA in K-line and contract discovery.
              </div>
            </div>
            <Toggle size="sm" checked={draft.asVendor !== false} onChange={(v) => setDraft(d => ({ ...d, asVendor: v }))} />
          </div>
          <SchemaFormFields
            fields={fields}
            formData={formData}
            setField={setField}
            showSecrets={showKeys}
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
          {draft.enabled !== false && <ReconnectButton accountId={uta.id} />}
          <label className="flex items-center gap-2 cursor-pointer">
            <Toggle checked={draft.enabled !== false} onChange={async (v) => {
              const updated = { ...draft, enabled: v }
              setDraft(updated)
              await onSave(updated)
            }} />
            <span className="text-[12px] text-text-muted">{draft.enabled !== false ? 'Enabled' : 'Disabled'}</span>
          </label>
          {msg && <span className="text-[12px] text-text-muted">{msg}</span>}
        </div>
        <div className="flex-1" />
        <DeleteButton label="Delete UTA" onConfirm={onDelete} />
      </div>
    </Dialog>
  )
}

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
