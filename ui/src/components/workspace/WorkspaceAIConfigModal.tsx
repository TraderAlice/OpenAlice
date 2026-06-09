/**
 * Per-workspace AI provider config modal.
 *
 * Workspaces are VS-Code-style "open folders" — each owns its CLI config
 * files (.claude/settings.local.json, .codex/config.toml + env.json). This
 * modal is the visual editor for those files. Files are the source of
 * truth; the modal reads + writes via the workspace API. Restart any open
 * sessions for changes to take effect (env is read at CLI startup).
 */

import { useEffect, useMemo, useState } from 'react'
import {
  getAgentConfig,
  listCredentials,
  saveAgentConfig,
  saveCredential,
  testAgentConfig,
  type AgentConfig,
  type AgentConfigBundle,
  type AgentId,
  type SavedCredential,
} from './api'
import { api, type Preset, type WireShape } from '../../api'
import { baseUrlToVendor, vendorPreset, presetModels, pickAgentWire } from '../../lib/presetHelpers'
import { ModelCombobox } from '../credentials/PresetFields'
import { useTestGate } from '../../lib/useTestGate'

// The agent tab implies a default vendor when the baseUrl alone can't say:
// claude → Anthropic, codex → OpenAI; opencode/pi run anything so they have no
// default (model suggestions then come only from a recognized baseUrl).
const TAB_FALLBACK_VENDOR: Record<Tab, string | null> = {
  claude: 'anthropic',
  codex: 'openai',
  opencode: null,
  pi: null,
}

interface Props {
  wsId: string
  onClose: () => void
}

const inputClass =
  'w-full bg-bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent'

type Tab = 'claude' | 'codex' | 'opencode' | 'pi'

const TAB_LABEL: Record<Tab, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'opencode', pi: 'Pi' }

interface FormState {
  baseUrl: string
  apiKey: string
  model: string
  /** The wire protocol — drives the test + how the adapter is configured. */
  wireShape: WireShape
  wireApi: 'chat' | 'responses'
  // Claude-only: which header carries the key. 'x-api-key' is Anthropic's
  // first-party default; 'bearer' (Authorization: Bearer) is what most
  // anthropic-compatible gateways want — MiniMax's international endpoint
  // (api.minimax.io) only accepts Bearer, which is why x-api-key 401s there.
  authMode: 'x-api-key' | 'bearer'
}

/** The wire shape each agent defaults to when nothing else specifies one. */
const DEFAULT_WIRE_BY_TAB: Record<Tab, WireShape> = {
  claude: 'anthropic',
  codex: 'openai-responses', // codex is Responses-only (hard-rejects chat)
  opencode: 'openai-chat',
  pi: 'openai-chat',
}

const EMPTY_FORM: FormState = { baseUrl: '', apiKey: '', model: '', wireShape: 'anthropic', wireApi: 'responses', authMode: 'x-api-key' }

function configToForm(cfg: AgentConfig | null, tab: Tab): FormState {
  if (!cfg) return { ...EMPTY_FORM, wireShape: DEFAULT_WIRE_BY_TAB[tab] }
  return {
    baseUrl: cfg.baseUrl ?? '',
    apiKey: cfg.apiKey ?? '',
    model: cfg.model ?? '',
    wireShape: cfg.wireShape ?? DEFAULT_WIRE_BY_TAB[tab],
    wireApi: 'responses',
    authMode: cfg.authMode === 'bearer' ? 'bearer' : 'x-api-key',
  }
}

function formToConfig(form: FormState, agent: AgentId): AgentConfig {
  const cfg: AgentConfig = {
    baseUrl: form.baseUrl.trim() || null,
    apiKey: form.apiKey.trim() || null,
    model: form.model.trim() || null,
    wireShape: form.wireShape,
  }
  if (agent === 'codex') {
    return { ...cfg, wireApi: form.wireApi }
  }
  if (agent === 'claude') {
    return { ...cfg, authMode: form.authMode }
  }
  // opencode / pi: baseUrl/apiKey/model + wireShape.
  return cfg
}

// The test-before-save gate is shared with the credential vault via useTestGate
// (one gate per tab so switching tabs keeps each agent's verdict). The gate binds
// a result to the `key` it was tested against; editing any tested field changes
// the key, so the result stops matching and Save re-locks. `testKey` lists
// exactly the fields the probe covers (agent-specific: wireApi for codex,
// authMode for claude).
function testKey(form: FormState, agent: AgentId): string {
  return [
    form.baseUrl.trim(),
    form.apiKey.trim(),
    form.model.trim(),
    form.wireShape,
    agent === 'claude' ? form.authMode : '',
  ].join('|')
}

export function WorkspaceAIConfigModal({ wsId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('claude')
  const [credentials, setCredentials] = useState<SavedCredential[]>([])
  const [bundle, setBundle] = useState<AgentConfigBundle | null>(null)
  const [claudeForm, setClaudeForm] = useState<FormState>(EMPTY_FORM)
  const [codexForm, setCodexForm] = useState<FormState>(EMPTY_FORM)
  const [opencodeForm, setOpencodeForm] = useState<FormState>(EMPTY_FORM)
  const [piForm, setPiForm] = useState<FormState>(EMPTY_FORM)
  const [pickedCredential, setPickedCredential] = useState<string>('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  // Push-back prompt: shown after a successful Save when the just-saved key
  // isn't already in Alice's central store — offers to solidify it for reuse.
  const [offerSaveCred, setOfferSaveCred] = useState(false)
  const [savingCred, setSavingCred] = useState(false)
  const [credFlash, setCredFlash] = useState<string | null>(null)
  // One test-gate per tab (hooks are unconditional + fixed-count).
  const claudeGate = useTestGate()
  const codexGate = useTestGate()
  const opencodeGate = useTestGate()
  const piGate = useTestGate()
  const [presets, setPresets] = useState<Preset[]>([])

  useEffect(() => {
    void Promise.all([listCredentials(), getAgentConfig(wsId)])
      .then(([creds, b]) => {
        setCredentials(creds)
        setBundle(b)
        setClaudeForm(configToForm(b.claude, 'claude'))
        setCodexForm(configToForm(b.codex, 'codex'))
        setOpencodeForm(configToForm(b.opencode, 'opencode'))
        setPiForm(configToForm(b.pi, 'pi'))
      })
      .catch((err: Error) => setError(err.message))
    // Presets drive the model-id suggestions (anti-typo) — load once.
    void api.config.getPresets().then(({ presets: p }) => setPresets(p)).catch(() => {})
  }, [wsId])

  const form = { claude: claudeForm, codex: codexForm, opencode: opencodeForm, pi: piForm }[tab]
  const setForm = { claude: setClaudeForm, codex: setCodexForm, opencode: setOpencodeForm, pi: setPiForm }[tab]
  // Model-id suggestions for the current field: infer the provider vendor from
  // the entered baseUrl (api.z.ai → glm, …) with the tab as fallback, then pull
  // that vendor's enumerated models. Empty for custom/local endpoints → the
  // combobox is just a free-text input. This is vendor-axis, not agent-axis, so
  // it works when any tab is pointed at any gateway.
  const modelSuggestions = useMemo(() => {
    const vendor = baseUrlToVendor(form.baseUrl, TAB_FALLBACK_VENDOR[tab])
    if (!vendor) return []
    const p = vendorPreset(vendor, presets)
    return p ? presetModels(p) : []
  }, [form.baseUrl, tab, presets])
  const gate = { claude: claudeGate, codex: codexGate, opencode: opencodeGate, pi: piGate }[tab]
  const key = testKey(form, tab)
  const testing = gate.testing
  const result = gate.result
  const resultMatchesCurrent = gate.matchesCurrent(key)
  const testPassedForCurrent = gate.passedFor(key)
  const dirty = useMemo(() => {
    if (!bundle) return false
    const saved = bundle[tab]
    const savedForm = configToForm(saved, tab)
    return (
      savedForm.baseUrl !== form.baseUrl ||
      savedForm.apiKey !== form.apiKey ||
      savedForm.model !== form.model ||
      savedForm.wireShape !== form.wireShape ||
      (tab === 'claude' && savedForm.authMode !== form.authMode)
    )
  }, [bundle, form, tab])

  const applyCredential = () => {
    const cred = credentials.find((x) => x.slug === pickedCredential)
    if (!cred) return
    // Pick the wire this tab's agent speaks from the credential's capabilities.
    // (The picker only lists compatible credentials, so this is non-null.)
    const picked = pickAgentWire(cred.wires, tab)
    if (!picked) return
    // A credential carries no model, so default it to the matched provider's
    // first model — a stale model from a previous provider (e.g. minimax-m3 left
    // on a GLM endpoint) would 404. The user can still pick another below.
    const vendorP = vendorPreset(cred.vendor, presets)
    const defaultModel = vendorP ? (presetModels(vendorP)[0]?.id ?? '') : ''
    // Auth mode: api.minimax.io needs Bearer; default x-api-key otherwise.
    const bearer = /api\.minimax\.io/i.test(picked.baseUrl)
    setForm({
      ...form,
      baseUrl: picked.baseUrl,
      apiKey: cred.apiKey ?? '',
      model: defaultModel,
      wireShape: picked.shape,
      authMode: bearer ? 'bearer' : 'x-api-key',
    })
    gate.reset() // a new provider invalidates any prior test verdict
  }

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    try {
      await saveAgentConfig(wsId, tab, formToConfig(form, tab))
      const fresh = await getAgentConfig(wsId)
      setBundle(fresh)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1800)
      // Offer to solidify a hand-entered key into Alice's central store — but
      // only when that key isn't already there (one key = one account; dedup is
      // by key, so a known key shouldn't re-prompt).
      const key = form.apiKey.trim()
      const known = credentials.some((c) => c.apiKey === key)
      setOfferSaveCred(!!key && !known)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveCredential = async () => {
    setSavingCred(true)
    setError(null)
    try {
      const { slug } = await saveCredential({
        apiKey: form.apiKey.trim(),
        ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
        agent: tab,
        wireShape: form.wireShape,
      })
      setCredentials(await listCredentials())
      setOfferSaveCred(false)
      setCredFlash(`Saved to Alice as “${slug}” — reusable in any workspace.`)
      setTimeout(() => setCredFlash(null), 2600)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSavingCred(false)
    }
  }

  const handleReset = async () => {
    setError(null)
    setSaving(true)
    try {
      await saveAgentConfig(wsId, tab, { baseUrl: null, apiKey: null, model: null })
      const fresh = await getAgentConfig(wsId)
      setBundle(fresh)
      setForm({ ...EMPTY_FORM, wireShape: DEFAULT_WIRE_BY_TAB[tab] })
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1800)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const canTest =
    !!form.baseUrl.trim() && !!form.apiKey.trim() && !!form.model.trim()

  const handleTest = () => {
    if (!canTest) return
    // The result is bound to `key` (the current form's tested fields). If the
    // user edits mid-flight, the key no longer matches → Save stays locked.
    void gate.run(key, () =>
      testAgentConfig(wsId, tab, {
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        model: form.model.trim(),
        wireShape: form.wireShape,
        ...(tab === 'claude' ? { authMode: form.authMode } : {}),
      }),
    )
  }

  // Backdrop close uses onMouseDown (not onClick) so that text-selection
  // drags that start inside an input and release outside the card don't
  // count as a backdrop click and dismiss the modal — that's what was
  // making the window "flash" on what felt like random clicks.
  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-[15px] font-semibold text-text">Workspace AI Provider</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-bg-secondary/50">
          {(['claude', 'codex', 'opencode', 'pi'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 px-4 py-2.5 text-[13px] font-medium transition-colors ${
                tab === id
                  ? 'text-accent border-b-2 border-accent -mb-px'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {TAB_LABEL[id]}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Quick pick — load a saved credential into the form */}
          <div className="rounded-lg border border-border bg-bg-secondary/30 p-3">
            <label className="block text-xs font-medium text-text-muted mb-2">
              Load from saved credential
            </label>
            {(() => {
              // Only credentials that declare a wire THIS agent speaks. Codex is
              // Responses-only, so most credentials won't list here — the funnel
              // toward pi/opencode is by design.
              const compatible = credentials.filter((c) => pickAgentWire(c.wires, tab))
              return (
                <>
                  <div className="flex gap-2">
                    <select
                      value={pickedCredential}
                      onChange={(e) => setPickedCredential(e.target.value)}
                      className={inputClass + ' flex-1'}
                      disabled={compatible.length === 0}
                    >
                      <option value="">
                        {compatible.length === 0 ? `— no ${TAB_LABEL[tab]}-compatible credential —` : '— select a credential —'}
                      </option>
                      {compatible.map((cred) => {
                        const picked = pickAgentWire(cred.wires, tab)
                        return (
                          <option key={cred.slug} value={cred.slug}>
                            {cred.slug}{picked?.baseUrl ? ` · ${picked.baseUrl}` : ''}
                          </option>
                        )
                      })}
                    </select>
                    <button
                      onClick={applyCredential}
                      disabled={!pickedCredential}
                      className="px-3 py-2 rounded-md bg-accent text-bg text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
                    >
                      Load
                    </button>
                  </div>
                  <p className="text-[11px] text-text-muted/80 leading-snug mt-1.5">
                    {compatible.length === 0 && credentials.length > 0
                      ? `None of your saved credentials speak a wire ${TAB_LABEL[tab]} supports — add one for this provider, or use a runtime that matches (pi / opencode).`
                      : 'Fills base URL + key from a credential Alice already holds, using the wire this runtime speaks. Pick a model below. Or type a new one; you\'ll be offered to save it after Test + Save.'}
                  </p>
                </>
              )
            })()}
          </div>

          {/* Manual fields */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Base URL</label>
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder={
                tab === 'claude'
                  ? 'https://api.anthropic.com (default)'
                  : tab === 'opencode' || tab === 'pi'
                  ? 'https://api.deepseek.com/v1'
                  : 'https://api.openai.com/v1 (default)'
              }
              className={inputClass}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">API Key</label>
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="sk-..."
                className={inputClass + ' flex-1'}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="px-3 rounded-md border border-border text-text-muted hover:text-text text-[12px]"
                type="button"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {tab === 'claude' && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Auth header</label>
              <select
                value={form.authMode}
                onChange={(e) => setForm({ ...form, authMode: e.target.value as FormState['authMode'] })}
                className={inputClass}
              >
                <option value="x-api-key">x-api-key — Anthropic default</option>
                <option value="bearer">Authorization: Bearer — gateways (MiniMax intl, proxies)</option>
              </select>
              <p className="text-[11px] text-text-muted/80 leading-snug mt-1">
                Anthropic first-party uses <code className="font-mono text-[10.5px]">x-api-key</code>.
                Switch to <code className="font-mono text-[10.5px]">Bearer</code> for
                anthropic-compatible gateways that authenticate via{' '}
                <code className="font-mono text-[10.5px]">Authorization: Bearer</code> — e.g.
                MiniMax's international endpoint (<code className="font-mono text-[10.5px]">api.minimax.io</code>),
                which rejects x-api-key. Written as{' '}
                <code className="font-mono text-[10.5px]">ANTHROPIC_AUTH_TOKEN</code> instead of{' '}
                <code className="font-mono text-[10.5px]">ANTHROPIC_API_KEY</code>.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Model</label>
            <ModelCombobox
              value={form.model}
              suggestions={modelSuggestions}
              onChange={(v) => setForm({ ...form, model: v })}
              placeholder={tab === 'claude' ? 'claude-sonnet-4-6' : tab === 'opencode' || tab === 'pi' ? 'deepseek-chat' : 'gpt-4o'}
            />
            {modelSuggestions.length > 0 && (
              <p className="text-[11px] text-text-muted/70 mt-1">Suggestions from the matched provider — or type any model id.</p>
            )}
          </div>

          {tab === 'codex' && (
            <div className="rounded-md border border-border bg-bg-secondary/50 px-3 py-2.5 space-y-2">
              <p className="text-[12px] text-text-muted leading-relaxed">
                <strong className="text-text">Wire format is locked to <code className="font-mono text-[11.5px]">responses</code>.</strong>{' '}
                Codex 0.130+ hard-rejects <code className="font-mono text-[11.5px]">wire_api = "chat"</code> and only speaks the OpenAI Responses API.
              </p>
              <p className="text-[12px] text-text-muted leading-relaxed">
                <strong className="text-text">Chat-only providers</strong> (DeepSeek, Qwen, Moonshot, GLM, LM Studio, vLLM, llama.cpp, etc.) don't expose a Responses endpoint and won't work here directly.
                Run a translation proxy and point Base URL at it — e.g.{' '}
                <strong className="text-text">OpenRouter</strong> (hosted, BYOK) or{' '}
                <strong className="text-text">VibeAround</strong> (local) both speak Responses on the wire and forward to Chat Completions backends.
              </p>
            </div>
          )}

          {tab === 'opencode' && (
            <div className="rounded-md border border-border bg-bg-secondary/50 px-3 py-2.5">
              <p className="text-[12px] text-text-muted leading-relaxed">
                <strong className="text-text">Speaks OpenAI Chat Completions</strong> (via{' '}
                <code className="font-mono text-[11.5px]">@ai-sdk/openai-compatible</code>), so it
                connects <strong className="text-text">directly</strong> to Chat-only providers —
                DeepSeek, Qwen, Moonshot/Kimi, GLM, MiniMax — and local runtimes (Ollama, vLLM,
                LM Studio). No translation proxy needed. Base URL is the provider's
                OpenAI-compatible endpoint; Model is the bare model id.
              </p>
            </div>
          )}

          {tab === 'pi' && (
            <div className="rounded-md border border-border bg-bg-secondary/50 px-3 py-2.5">
              <p className="text-[12px] text-text-muted leading-relaxed">
                <strong className="text-text">OpenAI Chat Completions wire</strong> — connects
                directly to DeepSeek, Qwen, Kimi, GLM, MiniMax and local runtimes; Base URL is the
                provider's OpenAI-compatible endpoint, Model is the bare model id. Written to a
                per-workspace <code className="font-mono text-[11.5px]">.pi-agent/models.json</code>.
                Trading tools reach Pi through the <code className="font-mono text-[11.5px]">alice</code>{' '}
                CLI on PATH (the <code className="font-mono text-[11.5px]">openalice-cli</code> skill),
                not MCP — Pi has no native MCP.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red/40 bg-red/10 text-red text-[12px] px-3 py-2">
              {error}
            </div>
          )}
          {savedFlash && (
            <div className="rounded-md border border-green/40 bg-green/10 text-green text-[12px] px-3 py-2">
              Saved. Pause + resume any open session to reload.
            </div>
          )}
          {offerSaveCred && (
            <div className="rounded-md border border-accent/40 bg-accent/10 text-text text-[12px] px-3 py-2.5 flex items-center justify-between gap-3">
              <span className="leading-snug">
                Save this provider to Alice so other workspaces can reuse it?
              </span>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setOfferSaveCred(false)}
                  disabled={savingCred}
                  className="px-2.5 py-1 rounded-md border border-border text-text-muted hover:text-text text-[12px] disabled:opacity-40"
                >
                  Not now
                </button>
                <button
                  onClick={handleSaveCredential}
                  disabled={savingCred}
                  className="px-2.5 py-1 rounded-md bg-accent text-bg text-[12px] font-medium disabled:opacity-40 hover:bg-accent/90"
                >
                  {savingCred ? 'Saving…' : 'Save to Alice'}
                </button>
              </div>
            </div>
          )}
          {credFlash && (
            <div className="rounded-md border border-green/40 bg-green/10 text-green text-[12px] px-3 py-2">
              {credFlash}
            </div>
          )}
          {testing && (
            <div className="rounded-md border border-border bg-bg-secondary text-text-muted text-[12px] px-3 py-2">
              Testing…
            </div>
          )}
          {!testing && result?.ok && resultMatchesCurrent && (
            <div className="rounded-md border border-green/40 bg-green/10 text-green text-[12px] px-3 py-2">
              {result.response?.trim() ? (
                <>
                  <div className="font-medium mb-0.5">
                    Test passed — {tab === 'claude' ? 'Anthropic' : tab === 'opencode' || tab === 'pi' ? 'the provider' : 'OpenAI'} replied:
                  </div>
                  <div className="text-text whitespace-pre-wrap break-words font-mono text-[11.5px]">
                    {result.response.trim()}
                  </div>
                </>
              ) : (
                <div className="font-medium">Test passed — provider reachable (returned no text).</div>
              )}
            </div>
          )}
          {!testing && result && !result.ok && resultMatchesCurrent && (
            <div className="rounded-md border border-red/40 bg-red/10 text-red text-[12px] px-3 py-2">
              <div className="font-medium mb-0.5">Test failed:</div>
              <div className="whitespace-pre-wrap break-words font-mono text-[11.5px]">
                {result.error}
              </div>
            </div>
          )}
          {!testing && result && !resultMatchesCurrent && (
            <div className="rounded-md border border-yellow-400/30 bg-yellow-400/5 text-yellow-400/90 text-[12px] px-3 py-2">
              Form changed since last test — re-test before saving.
            </div>
          )}

          <p className="text-[11px] text-text-muted/80 leading-snug pt-1">
            Empty fields fall back to the CLI's global default. Changes apply to
            <strong className="text-text"> new sessions</strong>; pause and resume
            any open session to re-load.
            {tab === 'claude' && ' Claude reads `.claude/settings.local.json` from the workspace cwd.'}
            {tab === 'codex' && ' Codex reads `.codex/config.toml` + `.codex/env.json` (via CODEX_HOME).'}
            {tab === 'opencode' && ' opencode reads `opencode.json` from the workspace cwd; OpenAlice injects its MCP servers at spawn.'}
            {tab === 'pi' && ' Pi reads `.pi-agent/models.json` (via PI_CODING_AGENT_DIR); tools reach it via the `alice` CLI on PATH.'}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 p-3 border-t border-border bg-bg-secondary/30">
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              disabled={saving}
              className="px-3 py-2 rounded-md border border-border text-text-muted hover:text-text text-[12px] disabled:opacity-40"
            >
              Reset to global default
            </button>
            <button
              onClick={handleTest}
              disabled={!canTest || testing || saving}
              title={!canTest ? 'Fill base URL, API key, and model first' : undefined}
              className="px-3 py-2 rounded-md border border-border text-text-muted hover:text-text text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testing ? 'Testing…' : 'Test'}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3 py-2 rounded-md text-text-muted hover:text-text text-[13px]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !dirty || !testPassedForCurrent}
              title={
                !dirty
                  ? undefined
                  : !testPassedForCurrent
                  ? 'Click Test and get a passing reply before saving'
                  : undefined
              }
              className="px-4 py-2 rounded-md bg-accent text-bg text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
