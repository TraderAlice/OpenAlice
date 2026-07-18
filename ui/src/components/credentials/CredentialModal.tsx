import { useMemo, useState } from 'react'

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
    ? 'Choose a provider first.'
    : isCustom && !customLabel
      ? 'Enter a provider name.'
      : isCustom && !customUrl.trim()
        ? 'Enter the custom API base URL.'
        : isCustom && !validEndpoint(customUrl.trim())
          ? 'Enter a valid http:// or https:// API base URL.'
          : Object.keys(wires).length === 0 || !primaryShape
            ? 'Choose an API endpoint.'
            : !apiKey.trim()
              ? `Enter the ${preset.setup?.apiKeyLabel?.toLowerCase() ?? 'API key'}.`
              : !model.trim()
                ? 'Enter the exact model ID to test and remember.'
                : ''
  const canTest = formProblem.length === 0
  const needsTest = mode === 'add' || !!apiKey.trim()
  const canSave = !saving && (!needsTest || gate.passedFor(testKey))

  const handleTest = () => {
    if (!canTest || !primaryShape) {
      setError(formProblem || 'Complete the required fields first.')
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
      setError(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
    }
  }

  const title = mode === 'edit' && cred ? `Edit credential - ${cred.slug}` : 'Add credential'
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--color-credential-modal-neutral-dark-bg-subtle)] backdrop-blur-sm" onClick={onClose}>
      <div className="bg-bg border border-border rounded-xl shadow-2xl w-[calc(100vw-24px)] max-w-xl max-h-[88vh] flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-[15px] font-semibold text-text">{title}</h2>
            <p className="mt-0.5 text-[11px] text-text-muted">Connect a provider account to the agent runtimes that can use it.</p>
          </div>
          <button onClick={onClose} aria-label="Close credential dialog" className="text-text-muted hover:text-text transition-colors">
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
                placeholder="Search providers..."
                autoFocus
              />
              <div className="overflow-hidden rounded-lg border border-border bg-bg">
                {visiblePresets.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => pickPreset(item)}
                    className="flex min-h-[46px] w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-bg-tertiary/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-text">{item.label}</span>
                      <span className="block truncate text-[10.5px] text-text-muted">{item.description}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-text-muted/75">
                        {item.category === 'custom'
                          ? 'Choose an API mode to determine compatible agents'
                          : `Works with ${agentNames(presetCompatibleAgentIds(item))}`}
                      </span>
                    </span>
                    {item.category === 'custom' && (
                      <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted">
                        free-form
                      </span>
                    )}
                  </button>
                ))}
                {visiblePresets.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12px] text-text-muted">
                    No providers match "{presetQuery}".
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold text-text">{preset.label}</span>
                  <span className="text-[11px] text-text-muted">{preset.description}</span>
                </div>
                {mode === 'add' && (
                  <button onClick={() => { setPreset(null); gate.reset() }} className="text-[11px] text-accent hover:underline">change</button>
                )}
              </div>

              {preset.hint && (
                <p className="text-[11px] text-text-muted bg-bg-tertiary rounded-lg px-3 py-2.5 leading-relaxed">{preset.hint}</p>
              )}

              {isCustom ? (
                <>
                  <Field label="Provider name" description="A readable name for this custom credential in pickers.">
                    <input
                      className={inputClass}
                      value={customName}
                      onChange={(event) => setCustomName(event.target.value)}
                      placeholder="e.g. OpenRouter work key"
                      maxLength={80}
                    />
                  </Field>
                  <Field label="API compatibility mode" description="Match the API protocol implemented by the endpoint. This choice determines which agent runtimes can use the credential.">
                    <select className={inputClass} value={customShape} onChange={(event) => { setCustomShape(event.target.value as WireShape); gate.reset() }}>
                      {SHAPE_ORDER.map((shape) => (
                        <option key={shape} value={shape}>
                          {WIRE_SHAPE_GUIDANCE[shape]} — {agentNames(compatibleAgentIds({ [shape]: '' }))}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="API base URL" description="Required for a custom provider. Include any path prefix the provider documents, such as /v1.">
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
                      label="Account region"
                      description={preset.setup?.regionHelp ?? 'Choose the provider region that issued this API key.'}
                    >
                      <select className={inputClass} value={regionId} onChange={(event) => { setRegionId(event.target.value); gate.reset() }}>
                        {usingStoredRegion && <option value={STORED_REGION_ID}>Saved custom endpoint (keep unchanged)</option>}
                        {regions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                      </select>
                    </Field>
                  )}
                </>
              )}

              <div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] font-medium text-text">Compatible agent runtimes</span>
                  {compatibleAgents.map((agentId) => (
                    <span key={agentId} className="rounded border border-accent/25 bg-bg px-1.5 py-0.5 text-[10px] text-text-muted">
                      {AGENT_LABELS[agentId] ?? agentId}
                    </span>
                  ))}
                  {compatibleAgents.length === 0 && (
                    <span className="text-[10.5px] text-text-muted">Choose a supported API mode.</span>
                  )}
                </div>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-text-muted">
                  OpenAlice injects the key, endpoint, protocol, and model into one of these Workspace runtimes. Other runtimes will not offer this credential.
                </p>
              </div>

              <Field
                label={preset.setup?.apiKeyLabel ?? 'API key'}
                description={preset.setup?.apiKeyHelp ?? 'Use the API key issued by this provider. Subscription logins stay in the agent CLI.'}
              >
                <div className="flex gap-2">
                  <input
                    className={inputClass + ' flex-1'}
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={preset.setup?.apiKeyPlaceholder ?? 'Enter API key'}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="px-3 rounded-md border border-border text-text-muted hover:text-text text-[12px]"
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Field>

              <Field
                label="Default model"
                description={preset.setup?.modelHelp ?? 'OpenAlice tests this exact model ID and remembers it as the default for this credential. A Workspace can override it later.'}
              >
                <ModelCombobox value={model} suggestions={models} onChange={setModel} placeholder="Exact provider model ID" />
              </Field>

              <details className="rounded-lg border border-border bg-bg-secondary/20 px-3 py-2">
                <summary className="cursor-pointer select-none text-[11px] text-text-muted hover:text-text">
                  Protocol and endpoint details
                </summary>
                <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                  {shapes.length === 0 && <p className="text-[11px] text-text-muted">No endpoint is configured yet.</p>}
                  {shapes.map((shape) => (
                    <div key={shape} className="grid grid-cols-[125px_minmax(0,1fr)] gap-2 text-[10.5px]">
                      <span className="text-text-muted">{WIRE_SHAPE_GUIDANCE[shape]}</span>
                      <span className="break-all font-mono text-text-muted/80">{wires[shape] || 'Provider official endpoint'}</span>
                    </div>
                  ))}
                </div>
              </details>

              <p className="rounded-lg bg-bg-tertiary px-3 py-2 text-[10.5px] leading-relaxed text-text-muted">
                Test connection sends a small request to <span className="font-mono text-text">{model.trim() || 'the selected model'}</span>. Saving unlocks only after this exact key, endpoint, protocol, and model pass together.
              </p>

              {error && (
                <p className="min-w-0 max-w-full whitespace-pre-wrap break-words text-[12px] text-red">{error}</p>
              )}
              {gate.testing && <p className="text-[12px] text-text-muted">Testing connection...</p>}
              {gate.result && !staleResult && (
                <div className={`min-w-0 max-w-full overflow-hidden rounded-lg px-3 py-2.5 text-[12px] ${gate.result.ok ? 'bg-green/10 text-green' : 'bg-red/10 text-red'}`}>
                  {gate.result.ok ? (
                    gate.result.response?.trim() ? (
                      <>
                        <div className="font-medium mb-0.5">Connection verified.</div>
                        <div className="whitespace-pre-wrap break-words font-mono text-[11.5px] text-text">
                          {gate.result.response.trim().slice(0, 240)}
                        </div>
                      </>
                    ) : (
                      <div className="font-medium">Connection verified - provider returned no text.</div>
                    )
                  ) : (
                    <>
                      <div className="font-medium mb-0.5">Test failed:</div>
                      <div className="whitespace-pre-wrap break-words font-mono text-[11.5px]">
                        {gate.result.error}
                      </div>
                    </>
                  )}
                </div>
              )}
              {staleResult && (
                <p className="text-[11px] text-[var(--color-credential-modal-warning-text-subtle)]">Form changed since the last test - re-test before saving.</p>
              )}
            </>
          )}
        </div>

        {preset && (
          <div className="flex flex-col gap-3 px-5 py-3 border-t border-border bg-bg-secondary/30 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-[12px] text-text-muted">
              {tested ? (
                <span className="inline-flex items-center gap-2 text-green">
                  <span className="h-2 w-2 rounded-full bg-green" />
                  Connection verified
                </span>
              ) : staleResult ? (
                <span className="inline-flex items-center gap-2 text-[var(--color-credential-modal-warning-text-subtle)]">
                  <span className="h-2 w-2 rounded-full bg-[var(--color-credential-modal-warning-bg-subtle)]" />
                  Form changed - test again
                </span>
              ) : gate.result && !gate.result.ok ? (
                <span className="inline-flex items-center gap-2 text-red">
                  <span className="h-2 w-2 rounded-full bg-red" />
                  Fix the fields and test again
                </span>
              ) : (
                <span>Test the key before saving.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="text-[12px] px-3 py-1.5 rounded-md text-text-muted hover:text-text">Cancel</button>
              <button
                data-testid="credential-modal-primary"
                onClick={handlePrimaryAction}
                disabled={primaryDisabled}
                title={needsConnectionTest && !canTest ? formProblem : undefined}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {gate.testing ? 'Testing...' : needsConnectionTest ? 'Test connection' : saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
