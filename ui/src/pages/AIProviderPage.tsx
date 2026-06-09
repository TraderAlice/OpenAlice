/**
 * AI Provider — Alice's credential vault.
 *
 * Post-Workspace-pivot the in-process model loop is gone; the only thing this
 * page manages is the central set of api-key credentials that get injected into
 * workspaces (and pulled/pushed from the per-workspace AI config modal). It is
 * NOT a profile editor anymore — no backend/loginMethod, no active profile, no
 * SDK adapters, and Test runs the lightweight HTTP probe, not the old provider
 * router.
 *
 * Subscription logins (Claude Pro/Max via `claude login`, ChatGPT via
 * `codex login`) are deliberately absent — those live in the CLI's own auth,
 * not in Alice. The preset catalog is reused here purely as an "add credential"
 * helper: it carries each vendor's endpoint + model suggestions + request shape.
 */

import { useState, useEffect, useMemo } from 'react'
import { api, type Preset, type WireShape } from '../api'
import type { CredentialSummary } from '../api/config'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/StateViews'
import { Field, inputClass } from '../components/form'
import { ModelCombobox } from '../components/credentials/PresetFields'
import {
  VENDOR_BY_PRESET, isApiKeyPreset, presetModels, vendorPreset, WIRE_SHAPE_SHORT,
  presetRegions, regionById, regionShapes,
} from '../lib/presetHelpers'
import { useTestGate } from '../lib/useTestGate'

const SHAPE_ORDER: WireShape[] = ['anthropic', 'openai-chat', 'openai-responses']

/** Find the region whose wires match a stored credential (for edit mode). */
function matchRegionId(preset: Preset | null, wires: Partial<Record<WireShape, string>>): string | undefined {
  const shapes = Object.keys(wires) as WireShape[]
  if (shapes.length === 0) return undefined
  return presetRegions(preset).find((r) => shapes.every((s) => r.wires[s] === wires[s]))?.id
}

// ==================== Agent runtimes ====================
//
// The four CLI runtimes a workspace can launch. These credentials feed them;
// this panel orients the user on what each is and how it authenticates. Editorial
// copy grounded in the adapters (src/workspaces/adapters/*) — keep it factual.

interface RuntimeInfo {
  id: string
  name: string
  blurb: string
  facts: Array<[label: string, value: string]>
}

const AGENT_RUNTIMES: RuntimeInfo[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    blurb: "Anthropic's coding-agent CLI — the deepest agentic loop.",
    facts: [
      ['Models', 'Claude (Anthropic). Anthropic-compatible gateways — GLM, MiniMax, Kimi, DeepSeek — via base URL + auth header'],
      ['Auth', 'Claude Pro/Max subscription (claude login) or an Anthropic API key'],
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    blurb: "OpenAI's coding-agent CLI.",
    facts: [
      ['Models', 'OpenAI (GPT). Responses API only — Chat-only providers need a Responses proxy (OpenRouter / VibeAround)'],
      ['Auth', 'ChatGPT subscription (codex login) or an OpenAI API key'],
    ],
  },
  {
    id: 'opencode',
    name: 'opencode',
    blurb: 'Provider-agnostic open-source agent CLI (AI SDK + Models.dev, 75+ providers).',
    facts: [
      ['Models', 'Anthropic, OpenAI, Google, OpenRouter, Bedrock/Azure, and anything OpenAI-compatible — incl. local (Ollama, vLLM, LM Studio)'],
      ['Auth', 'Per-provider API key (Claude Pro/Max isn’t sanctioned in opencode — API billing only for Claude models)'],
    ],
  },
  {
    id: 'pi',
    name: 'Pi',
    blurb: 'Minimal open-source agent CLI (earendil-works/pi) — unified multi-provider API.',
    facts: [
      ['Models', 'OpenAI, Anthropic, Google + custom (Ollama, vLLM, LM Studio, proxies); OpenAI-compatible and anthropic-messages wires'],
      ['Auth', 'Per-provider API key'],
    ],
  },
]

// ==================== Page ====================

export function AIProviderPage() {
  const [credentials, setCredentials] = useState<CredentialSummary[] | null>(null)
  const [presets, setPresets] = useState<Preset[]>([])
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; cred: CredentialSummary } | null>(null)

  const reload = () => api.config.getCredentials().then(({ credentials: c }) => setCredentials(c)).catch(() => setCredentials([]))

  useEffect(() => {
    void reload()
    api.config.getPresets().then(({ presets: p }) => setPresets(p)).catch(() => {})
  }, [])

  const apiKeyPresets = useMemo(() => presets.filter(isApiKeyPreset), [presets])

  const handleDelete = async (slug: string) => {
    try {
      await api.config.deleteCredential(slug)
      await reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  if (!credentials) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <PageHeader title="AI Provider" description="Credentials Alice holds and injects into workspaces." />
        <PageLoading />
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="AI Provider" description="Credentials Alice holds and injects into workspaces." />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <div className="max-w-[1100px] mx-auto grid gap-6 lg:grid-cols-2">
          {/* ============== Credentials ============== */}
          <section>
            <div className="rounded-lg border border-border/50 bg-bg-secondary/50 px-4 py-3 mb-4">
              <p className="text-[13px] text-text-muted leading-relaxed">
                The API keys Alice keeps centrally. Templates inject them into new
                workspaces, and a workspace's AI config can load any of them. Subscription
                logins (Claude Pro/Max, ChatGPT) aren't stored here — they live in the agent
                CLI's own login (<code className="font-mono text-[11.5px]">claude login</code> /{' '}
                <code className="font-mono text-[11.5px]">codex login</code>).
              </p>
            </div>

            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13px] font-semibold text-text uppercase tracking-wide">Credentials</h2>
              <button
                onClick={() => setModal({ mode: 'add' })}
                className="text-[11px] px-2 py-1 rounded-md border border-border text-text-muted hover:text-accent hover:border-accent transition-colors"
              >
                + Add
              </button>
            </div>

            <div className="space-y-2.5">
              {credentials.map((cred) => (
                <div key={cred.slug} className="flex items-center gap-3 rounded-lg border border-border bg-bg px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium text-text">{cred.vendor}</span>
                      <span className="text-[11px] text-text-muted font-mono">{cred.slug}</span>
                      {(SHAPE_ORDER.filter((s) => s in cred.wires)).map((s) => (
                        <span key={s} className="text-[10px] text-text-muted border border-border rounded px-1">{WIRE_SHAPE_SHORT[s]}</span>
                      ))}
                      {cred.hasApiKey && (
                        <span className="text-[10px] text-green border border-green/40 rounded px-1">key set</span>
                      )}
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5 font-mono truncate">
                      {Object.values(cred.wires)[0] || 'default endpoint'}
                    </div>
                  </div>
                  <button
                    onClick={() => setModal({ mode: 'edit', cred })}
                    className="text-[11px] px-2 py-1 rounded-md border border-border text-text-muted hover:text-text transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(cred.slug)}
                    className="text-[11px] px-2 py-1 rounded-md border border-border text-text-muted hover:text-red transition-colors"
                  >
                    Delete
                  </button>
                </div>
              ))}

              {credentials.length === 0 && (
                <button
                  onClick={() => setModal({ mode: 'add' })}
                  className="w-full p-4 rounded-xl border-2 border-dashed border-border text-text-muted hover:border-accent/50 hover:text-accent transition-all text-[13px] font-medium"
                >
                  + Add your first credential
                </button>
              )}
            </div>
          </section>

          {/* ============== Agent runtimes ============== */}
          <section>
            <div className="rounded-lg border border-border/50 bg-bg-secondary/50 px-4 py-3 mb-4">
              <p className="text-[13px] text-text-muted leading-relaxed">
                The agent runtimes a workspace can launch — a credential above feeds whichever
                one a workspace (or cron job) runs. Pick by the models/provider you want; every
                runtime reaches the full OpenAlice tool surface either way (native MCP where
                supported, the <code className="font-mono text-[11.5px]">alice</code> CLI on PATH
                otherwise). The model is chosen per workspace, not here.
              </p>
            </div>

            <h2 className="text-[13px] font-semibold text-text uppercase tracking-wide mb-3">Agent runtimes</h2>

            <div className="space-y-2.5">
              {AGENT_RUNTIMES.map((rt) => (
                <div key={rt.id} className="rounded-lg border border-border bg-bg px-4 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-text">{rt.name}</span>
                    <span className="text-[11px] text-text-muted font-mono">{rt.id}</span>
                  </div>
                  <p className="text-[12px] text-text-muted mt-0.5 leading-snug">{rt.blurb}</p>
                  <dl className="mt-2 space-y-1">
                    {rt.facts.map(([label, value]) => (
                      <div key={label} className="flex gap-2 text-[11px] leading-snug">
                        <dt className="text-text-muted/70 shrink-0 w-[58px]">{label}</dt>
                        <dd className="text-text-muted">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {modal && (
        <CredentialModal
          mode={modal.mode}
          cred={modal.mode === 'edit' ? modal.cred : undefined}
          presets={apiKeyPresets}
          onClose={() => setModal(null)}
          onSaved={async () => { await reload(); setModal(null) }}
        />
      )}
    </div>
  )
}

// ==================== Add / Edit modal ====================

function CredentialModal({ mode, cred, presets, onClose, onSaved }: {
  mode: 'add' | 'edit'
  cred?: CredentialSummary
  presets: Preset[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  // In edit mode the vendor is fixed → resolve its preset + the region whose
  // wires match the stored credential; in add mode the user picks a provider.
  const initialPreset = mode === 'edit' && cred ? vendorPreset(cred.vendor, presets) ?? null : null
  const [preset, setPreset] = useState<Preset | null>(initialPreset)
  const [regionId, setRegionId] = useState<string>(
    () => matchRegionId(initialPreset, cred?.wires ?? {}) ?? presetRegions(initialPreset)[0]?.id ?? '',
  )
  // Custom (free-form) provider — one shape + a hand-typed endpoint.
  const customInit = cred ? (SHAPE_ORDER.find((s) => s in (cred.wires ?? {})) ?? 'openai-chat') : 'openai-chat'
  const [customShape, setCustomShape] = useState<WireShape>(customInit)
  const [customUrl, setCustomUrl] = useState<string>(cred?.wires?.[customInit] ?? '')
  const [apiKey, setApiKey] = useState(cred?.apiKey ?? '')
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const gate = useTestGate()

  useEffect(() => {
    if (initialPreset && !model) setModel(presetModels(initialPreset)[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const regions = presetRegions(preset)
  const isCustom = !!preset && regions.length === 0
  const region = regionById(preset, regionId)
  const models = preset ? presetModels(preset) : []

  // The wire capabilities this credential will declare: a whole region's map,
  // or — for custom — the single hand-entered shape→url.
  const wires: Partial<Record<WireShape, string>> = isCustom
    ? (customUrl.trim() ? { [customShape]: customUrl.trim() } : {})
    : (region?.wires ?? {})
  const shapes = isCustom ? [customShape] : regionShapes(region)
  // The shape the Test probes (the key is shared, so one probe validates it).
  const primaryShape = shapes[0]
  const primaryUrl = primaryShape ? (wires[primaryShape] ?? '') : ''

  const pickPreset = (p: Preset) => {
    setPreset(p)
    setRegionId(presetRegions(p)[0]?.id ?? '')
    setModel(presetModels(p)[0]?.id ?? '')
    setError('')
    gate.reset()
  }

  // The fields the test covers — editing any of them re-locks Save.
  const testKey = `${JSON.stringify(wires)}|${apiKey.trim()}|${model.trim()}`
  const canTest = !!apiKey.trim() && !!model.trim() && !!primaryShape
  // ADD must pass a test. EDIT keeping the stored key (key blank) can't be probed
  // — it was verified at creation, so allow it; if a key is entered, re-test.
  const needsTest = mode === 'add' || !!apiKey.trim()
  const canSave = !saving && (!needsTest || gate.passedFor(testKey))

  const handleTest = () => {
    if (!canTest || !primaryShape) { setError('Fill the API key + model first'); return }
    setError('')
    void gate.run(testKey, () =>
      api.config.testCredential({ wireShape: primaryShape, baseUrl: primaryUrl || undefined, apiKey: apiKey.trim(), model: model.trim() }),
    )
  }

  const handleSave = async () => {
    if (!preset) return
    if (Object.keys(wires).length === 0) { setError('Pick a region / endpoint first'); return }
    const vendor = VENDOR_BY_PRESET[preset.id] ?? 'custom'
    setSaving(true); setError('')
    try {
      if (mode === 'edit' && cred) {
        await api.config.updateCredential(cred.slug, {
          vendor, wires,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        })
      } else {
        if (!apiKey.trim()) { setError('API key is required'); setSaving(false); return }
        await api.config.addCredential({ vendor, wires, apiKey: apiKey.trim() })
      }
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
    }
  }

  const title = mode === 'edit' && cred ? `Edit credential · ${cred.slug}` : 'Add credential'
  const tested = gate.passedFor(testKey)
  const staleResult = gate.result && !gate.matchesCurrent(testKey)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-[15px] font-semibold text-text">{title}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!preset ? (
            <div className="grid grid-cols-2 gap-2">
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => pickPreset(p)}
                  className="flex flex-col items-start gap-0.5 p-3 rounded-lg border border-border bg-bg hover:bg-bg-tertiary hover:border-accent/40 transition-all text-left"
                >
                  <span className="text-[12px] font-medium text-text">{p.label}</span>
                  <span className="text-[10px] text-text-muted leading-snug">{p.description}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              {/* Provider header with a change link (add mode) */}
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
                  <Field label="API mode" description="Which wire protocol your endpoint speaks.">
                    <select className={inputClass} value={customShape} onChange={(e) => { setCustomShape(e.target.value as WireShape); gate.reset() }}>
                      {SHAPE_ORDER.map((s) => <option key={s} value={s}>{WIRE_SHAPE_SHORT[s]}</option>)}
                    </select>
                  </Field>
                  <Field label="Base URL">
                    <input className={inputClass + ' font-mono text-[12px]'} value={customUrl}
                      onChange={(e) => { setCustomUrl(e.target.value); gate.reset() }}
                      placeholder="https://… (leave empty for the official endpoint)"
                      spellCheck={false} autoCapitalize="off" autoCorrect="off" />
                  </Field>
                </>
              ) : (
                <>
                  {/* Region — only when the provider offers more than one */}
                  {regions.length > 1 && (
                    <Field label="Endpoint / region" description="Region picks the endpoints; this key authenticates against one region.">
                      <select className={inputClass} value={regionId} onChange={(e) => { setRegionId(e.target.value); gate.reset() }}>
                        {regions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                    </Field>
                  )}

                  {/* Wire capabilities this credential will declare (read-only) */}
                  <Field label="Wire capabilities" description="One key, every shape this region speaks — injected per agent (claude→Anthropic, opencode/pi→either, codex→Responses).">
                    <div className="space-y-1.5 rounded-lg border border-border bg-bg-secondary/30 px-3 py-2.5">
                      {shapes.length === 0 && <p className="text-[11px] text-text-muted">No endpoints for this provider.</p>}
                      {shapes.map((s) => (
                        <div key={s} className="flex items-baseline gap-2 text-[11px]">
                          <span className="text-text-muted w-28 shrink-0">{WIRE_SHAPE_SHORT[s]}</span>
                          <span className="font-mono text-text-muted/80 break-all">{wires[s] || 'official endpoint'}</span>
                        </div>
                      ))}
                    </div>
                  </Field>
                </>
              )}

              <Field label="API key">
                <div className="flex gap-2">
                  <input className={inputClass + ' flex-1'} type={showKey ? 'text' : 'password'} value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)} placeholder="Enter API key"
                    spellCheck={false} autoCapitalize="off" autoCorrect="off" />
                  <button type="button" onClick={() => setShowKey(!showKey)}
                    className="px-3 rounded-md border border-border text-text-muted hover:text-text text-[12px]">
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Field>

              <Field label="Test model" description="Used only to verify the key — not stored on the credential (the model is chosen per workspace).">
                <ModelCombobox value={model} suggestions={models} onChange={setModel} />
              </Field>

              {error && <p className="text-[12px] text-red">{error}</p>}
              {gate.testing && <p className="text-[12px] text-text-muted">Testing connection…</p>}
              {gate.result && !staleResult && (
                <div className={`text-[12px] rounded-lg px-3 py-2.5 ${gate.result.ok ? 'bg-green/10 text-green' : 'bg-red/10 text-red'}`}>
                  {gate.result.ok
                    ? (gate.result.response?.trim() ? `Connected — “${gate.result.response.trim().slice(0, 120)}”` : 'Connected — provider reachable (returned no text).')
                    : `Failed: ${gate.result.error}`}
                </div>
              )}
              {staleResult && (
                <p className="text-[11px] text-yellow-400/90">Form changed since the last test — re-test before saving.</p>
              )}
            </>
          )}
        </div>

        {preset && (
          <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border bg-bg-secondary/30">
            <button
              onClick={handleTest}
              disabled={gate.testing || !canTest}
              title={!canTest ? 'Fill the API key + model first' : undefined}
              className="text-[12px] px-3 py-1.5 rounded-md border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {gate.testing ? 'Testing…' : tested ? '✓ Tested' : 'Test'}
            </button>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="text-[12px] px-3 py-1.5 rounded-md text-text-muted hover:text-text">Cancel</button>
              <button
                onClick={handleSave}
                disabled={!canSave}
                title={needsTest && !tested ? 'Test the connection first' : undefined}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
