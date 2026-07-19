import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, type Preset, type WireShape } from '../../api'
import type { CredentialSummary } from '../../api/config'
import { Field, inputClass } from '../form'
import {
  VENDOR_BY_PRESET,
  AGENT_LABELS,
  WIRE_SHAPE_GUIDANCE,
  compatibleAgentIds,
  presetCompatibleAgentIds,
  presetDefaultModel,
  presetModels,
  presetRegions,
  regionById,
  regionShapes,
  vendorPreset,
} from '../../lib/presetHelpers'
import { useTestGate } from '../../lib/useTestGate'
import { ModelCombobox } from './PresetFields'

const SHAPE_ORDER: WireShape[] = ['anthropic', 'google-generative-ai', 'openai-chat', 'openai-responses']
const STORED_REGION_ID = '__stored__'

/** Find the region whose wires match a stored credential (for edit mode). */
function matchRegionId(preset: Preset | null, wires: Partial<Record<WireShape, string>>): string | undefined {
  const shapes = Object.keys(wires) as WireShape[]
  if (shapes.length === 0) return undefined
  return presetRegions(preset).find((region) => {
    const regionShapes = Object.keys(region.wires) as WireShape[]
    return regionShapes.length === shapes.length && shapes.every((shape) => region.wires[shape] === wires[shape])
  })?.id
}

function validEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function agentNames(ids: readonly string[]): string {
  return ids.map((id) => AGENT_LABELS[id] ?? id).join(', ')
}

export function CredentialModal({ mode, cred, presets, initialPresetId, initialApiKey, onClose, onSaved }: {
  mode: 'add' | 'edit'
  cred?: CredentialSummary
  presets: Preset[]
  initialPresetId?: string
  initialApiKey?: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  // In edit mode the vendor is fixed, so resolve its preset and matching region.
  const initialPreset = mode === 'edit' && cred
    ? vendorPreset(cred.vendor, presets) ?? null
    : presets.find((item) => item.id === initialPresetId) ?? null
  const storedWires = cred?.wires ?? {}
  const matchedInitialRegion = matchRegionId(initialPreset, storedWires)
  const initialRegions = presetRegions(initialPreset)
  const [preset, setPreset] = useState<Preset | null>(initialPreset)
  const [regionId, setRegionId] = useState<string>(
    () => matchedInitialRegion ?? (
      mode === 'edit' && Object.keys(storedWires).length > 0 && initialRegions.length > 0
        ? STORED_REGION_ID
        : initialRegions[0]?.id ?? ''
    ),
  )
  const customInit = cred ? (SHAPE_ORDER.find((shape) => shape in (cred.wires ?? {})) ?? 'openai-chat') : 'openai-chat'
  const [customName, setCustomName] = useState<string>(cred?.label ?? '')
  const [customShape, setCustomShape] = useState<WireShape>(customInit)
  const [customUrl, setCustomUrl] = useState<string>(cred?.wires?.[customInit] ?? '')
  const [apiKey, setApiKey] = useState(cred?.apiKey ?? initialApiKey ?? '')
  const [presetQuery, setPresetQuery] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState(cred?.lastModel ?? presetDefaultModel(initialPreset))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const gate = useTestGate()

  const regions = presetRegions(preset)
  const isCustom = !!preset && regions.length === 0
  const usingStoredRegion = !isCustom && regionId === STORED_REGION_ID
  const region = usingStoredRegion ? undefined : regionById(preset, regionId)
  const models = preset ? presetModels(preset) : []

  const wires: Partial<Record<WireShape, string>> = isCustom
    ? (customUrl.trim() ? { [customShape]: customUrl.trim() } : {})
    : usingStoredRegion
      ? storedWires
      : (region?.wires ?? {})
  const shapes = isCustom
    ? [customShape]
    : usingStoredRegion
      ? SHAPE_ORDER.filter((shape) => shape in wires)
      : regionShapes(region)
  const primaryShape = shapes[0]
  const primaryUrl = primaryShape ? (wires[primaryShape] ?? '') : ''
  const compatibilityWires = isCustom ? { [customShape]: customUrl.trim() } : wires
  const compatibleAgents = compatibleAgentIds(compatibilityWires)

  const pickPreset = (next: Preset) => {
    setPreset(next)
    setRegionId(presetRegions(next)[0]?.id ?? '')
    setModel(presetDefaultModel(next))
    setError('')
    gate.reset()
  }

  const visiblePresets = useMemo(() => {
    const query = presetQuery.trim().toLowerCase()
    return query
      ? presets.filter((item) =>
          [item.label, item.description, item.id].some((text) => text.toLowerCase().includes(query)),
        )
      : presets
  }, [presetQuery, presets])

  // The fields the test covers. Editing any of them re-locks Save.
  const testKey = `${JSON.stringify(wires)}|${apiKey.trim()}|${model.trim()}`
  const customLabel = customName.trim()
  const formProblem = !preset
    ? t('aiProvider.credentialModal.chooseProvider')
    : isCustom && !customLabel
      ? t('aiProvider.credentialModal.providerNameRequired')
      : isCustom && !customUrl.trim()
        ? t('aiProvider.credentialModal.customUrlRequired')
        : isCustom && !validEndpoint(customUrl.trim())
          ? t('aiProvider.credentialModal.customUrlInvalid')
          : Object.keys(wires).length === 0 || !primaryShape
            ? t('aiProvider.credentialModal.endpointRequired')
            : !apiKey.trim()
              ? t('aiProvider.credentialModal.keyRequired', { label: preset.setup?.apiKeyLabel?.toLowerCase() ?? t('aiProvider.credentialModal.apiKey') })
              : !model.trim()
                ? t('aiProvider.credentialModal.modelRequired')
                : ''
  const canTest = formProblem.length === 0
  const needsTest = mode === 'add' || !!apiKey.trim()
  const canSave = !saving && (!needsTest || gate.passedFor(testKey))

  const handleTest = () => {
    if (!canTest || !primaryShape) {
      setError(formProblem || t('aiProvider.credentialModal.completeRequired'))
      return
    }
    setError('')
    void gate.run(testKey, () =>
      api.config.testCredential({
        wireShape: primaryShape,
        baseUrl: primaryUrl || undefined,
        apiKey: apiKey.trim(),
        model: model.trim(),
      }),
    )
  }

  const handleSave = async () => {
    if (!preset) return
    if (formProblem) {
      setError(formProblem)
      return
    }
    const vendor = VENDOR_BY_PRESET[preset.id] ?? 'custom'
    const label = isCustom
      ? customLabel
      : vendor === 'custom'
        ? preset.label
        : undefined
    setSaving(true)
    setError('')
    try {
      if (mode === 'edit' && cred) {
        await api.config.updateCredential(cred.slug, {
          vendor,
          wires,
          ...(label ? { label } : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(model.trim() ? { lastModel: model.trim() } : {}),
        })
      } else {
        await api.config.addCredential({
          vendor,
          wires,
          apiKey: apiKey.trim(),
          ...(label ? { label } : {}),
          ...(model.trim() ? { lastModel: model.trim() } : {}),
        })
      }
      window.dispatchEvent(new CustomEvent('openalice:credentials-changed'))
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiProvider.saveFailed'))
      setSaving(false)
    }
  }

  const title = mode === 'edit' && cred
    ? t('aiProvider.credentialModal.editTitle', { slug: cred.slug })
    : t('aiProvider.credentialModal.addTitle')
  const tested = gate.passedFor(testKey)
  const staleResult = gate.result && !gate.matchesCurrent(testKey)
  const needsConnectionTest = needsTest && !tested
  const primaryDisabled = needsConnectionTest
    ? gate.testing || !canTest
    : !canSave

  const handlePrimaryAction = () => {
    if (needsConnectionTest) {
      handleTest()
      return
    }
    void handleSave()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-backdrop backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background border border-border rounded-xl shadow-2xl w-[calc(100vw-24px)] max-w-xl max-h-[88vh] flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('aiProvider.credentialModal.subtitle')}</p>
          </div>
          <button onClick={onClose} aria-label={t('aiProvider.credentialModal.close')} className="text-muted-foreground hover:text-foreground transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!preset ? (
            <div className="space-y-3">
              <input
                className={inputClass}
                value={presetQuery}
                onChange={(event) => setPresetQuery(event.target.value)}
                placeholder={t('aiProvider.credentialModal.search')}
                autoFocus
              />
              <div className="overflow-hidden rounded-lg border border-border bg-background">
                {visiblePresets.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => pickPreset(item)}
                    className="flex min-h-[46px] w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">{item.label}</span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">{item.description}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/75">
                        {item.category === 'custom'
                          ? t('aiProvider.credentialModal.chooseMode')
                          : t('aiProvider.credentialModal.worksWith', { agents: agentNames(presetCompatibleAgentIds(item)) })}
                      </span>
                    </span>
                    {item.category === 'custom' && (
                      <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t('aiProvider.credentialModal.freeForm')}
                      </span>
                    )}
                  </button>
                ))}
                {visiblePresets.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
                    {t('aiProvider.credentialModal.noMatches', { query: presetQuery })}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold text-foreground">{preset.label}</span>
                  <span className="text-[11px] text-muted-foreground">{preset.description}</span>
                </div>
                {mode === 'add' && (
                  <button onClick={() => { setPreset(null); gate.reset() }} className="text-[11px] text-primary hover:underline">{t('common.change')}</button>
                )}
              </div>

              {preset.hint && (
                <p className="text-[11px] text-muted-foreground bg-muted rounded-lg px-3 py-2.5 leading-relaxed">{preset.hint}</p>
              )}

              {isCustom ? (
                <>
                  <Field label={t('aiProvider.credentialModal.providerName')} description={t('aiProvider.credentialModal.providerNameHelp')}>
                    <input
                      className={inputClass}
                      value={customName}
                      onChange={(event) => setCustomName(event.target.value)}
                      placeholder={t('aiProvider.credentialModal.providerNamePlaceholder')}
                      maxLength={80}
                    />
                  </Field>
                  <Field label={t('aiProvider.credentialModal.compatibilityMode')} description={t('aiProvider.credentialModal.compatibilityModeHelp')}>
                    <select className={inputClass} value={customShape} onChange={(event) => { setCustomShape(event.target.value as WireShape); gate.reset() }}>
                      {SHAPE_ORDER.map((shape) => (
                        <option key={shape} value={shape}>
                          {WIRE_SHAPE_GUIDANCE[shape]} — {agentNames(compatibleAgentIds({ [shape]: '' }))}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t('aiProvider.credentialModal.baseUrl')} description={t('aiProvider.credentialModal.baseUrlHelp')}>
                    <input
                      className={inputClass + ' font-mono text-[12px]'}
                      value={customUrl}
                      onChange={(event) => { setCustomUrl(event.target.value); gate.reset() }}
                      placeholder="https://provider.example/v1"
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                    />
                  </Field>
                </>
              ) : (
                <>
                  {(regions.length > 1 || usingStoredRegion) && (
                    <Field
                      label={t('aiProvider.credentialModal.accountRegion')}
                      description={preset.setup?.regionHelp ?? t('aiProvider.credentialModal.accountRegionHelp')}
                    >
                      <select className={inputClass} value={regionId} onChange={(event) => { setRegionId(event.target.value); gate.reset() }}>
                        {usingStoredRegion && <option value={STORED_REGION_ID}>{t('aiProvider.credentialModal.storedEndpoint')}</option>}
                        {regions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                      </select>
                    </Field>
                  )}
                </>
              )}

              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] font-medium text-foreground">{t('aiProvider.credentialModal.compatibleRuntimes')}</span>
                  {compatibleAgents.map((agentId) => (
                    <span key={agentId} className="rounded border border-primary/25 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {AGENT_LABELS[agentId] ?? agentId}
                    </span>
                  ))}
                  {compatibleAgents.length === 0 && (
                    <span className="text-[10.5px] text-muted-foreground">{t('aiProvider.credentialModal.chooseSupportedMode')}</span>
                  )}
                </div>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
                  {t('aiProvider.credentialModal.injectionHelp')}
                </p>
              </div>

              <Field
                label={preset.setup?.apiKeyLabel ?? t('aiProvider.credentialModal.apiKey')}
                description={preset.setup?.apiKeyHelp ?? t('aiProvider.credentialModal.apiKeyHelp')}
              >
                <div className="flex gap-2">
                  <input
                    className={inputClass + ' flex-1'}
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={preset.setup?.apiKeyPlaceholder ?? t('aiProvider.credentialModal.apiKeyPlaceholder')}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="px-3 rounded-md border border-border text-muted-foreground hover:text-foreground text-[12px]"
                  >
                    {showKey ? t('common.hide') : t('common.show')}
                  </button>
                </div>
              </Field>

              <Field
                label={t('aiProvider.credentialModal.defaultModel')}
                description={preset.setup?.modelHelp ?? t('aiProvider.credentialModal.defaultModelHelp')}
              >
                <ModelCombobox value={model} suggestions={models} onChange={setModel} placeholder={t('aiProvider.credentialModal.modelPlaceholder')} />
              </Field>

              <details className="rounded-lg border border-border bg-secondary/20 px-3 py-2">
                <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
                  {t('aiProvider.credentialModal.endpointDetails')}
                </summary>
                <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                  {shapes.length === 0 && <p className="text-[11px] text-muted-foreground">{t('aiProvider.credentialModal.noEndpoint')}</p>}
                  {shapes.map((shape) => (
                    <div key={shape} className="grid grid-cols-[125px_minmax(0,1fr)] gap-2 text-[10.5px]">
                      <span className="text-muted-foreground">{WIRE_SHAPE_GUIDANCE[shape]}</span>
                      <span className="break-all font-mono text-muted-foreground/80">{wires[shape] || t('aiProvider.officialEndpoint')}</span>
                    </div>
                  ))}
                </div>
              </details>

              <p className="rounded-lg bg-muted px-3 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
                {t('aiProvider.credentialModal.testExplanation', { model: model.trim() || t('aiProvider.credentialModal.selectedModel') })}
              </p>

              {error && (
                <p className="min-w-0 max-w-full whitespace-pre-wrap break-words text-[12px] text-destructive">{error}</p>
              )}
              {gate.testing && <p className="text-[12px] text-muted-foreground">{t('aiProvider.credentialModal.testingConnection')}</p>}
              {gate.result && !staleResult && (
                <div className={`min-w-0 max-w-full overflow-hidden rounded-lg px-3 py-2.5 text-[12px] ${gate.result.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                  {gate.result.ok ? (
                    gate.result.response?.trim() ? (
                      <>
                        <div className="font-medium mb-0.5">{t('aiProvider.credentialModal.connectionVerified')}</div>
                        <div className="whitespace-pre-wrap break-words font-mono text-[11.5px] text-foreground">
                          {gate.result.response.trim().slice(0, 240)}
                        </div>
                      </>
                    ) : (
                      <div className="font-medium">{t('aiProvider.credentialModal.verifiedNoText')}</div>
                    )
                  ) : (
                    <>
                      <div className="font-medium mb-0.5">{t('aiProvider.credentialModal.testFailed')}</div>
                      <div className="whitespace-pre-wrap break-words font-mono text-[11.5px]">
                        {gate.result.error}
                      </div>
                    </>
                  )}
                </div>
              )}
              {staleResult && (
                <p className="text-[11px] text-warning/90">{t('aiProvider.credentialModal.formChanged')}</p>
              )}
            </>
          )}
        </div>

        {preset && (
          <div className="flex flex-col gap-3 px-5 py-3 border-t border-border bg-secondary/30 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-[12px] text-muted-foreground">
              {tested ? (
                <span className="inline-flex items-center gap-2 text-success">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  {t('aiProvider.credentialModal.connectionVerified')}
                </span>
              ) : staleResult ? (
                <span className="inline-flex items-center gap-2 text-warning/90">
                  <span className="h-2 w-2 rounded-full bg-warning/80" />
                  {t('aiProvider.credentialModal.formChangedShort')}
                </span>
              ) : gate.result && !gate.result.ok ? (
                <span className="inline-flex items-center gap-2 text-destructive">
                  <span className="h-2 w-2 rounded-full bg-destructive" />
                  {t('aiProvider.credentialModal.fixAndRetry')}
                </span>
              ) : (
                <span>{t('aiProvider.credentialModal.testBeforeSave')}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="text-[12px] px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground">{t('common.cancel')}</button>
              <button
                data-testid="credential-modal-primary"
                onClick={handlePrimaryAction}
                disabled={primaryDisabled}
                title={needsConnectionTest && !canTest ? formProblem : undefined}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {gate.testing ? t('common.testing') : needsConnectionTest ? t('common.testConnection') : saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
