/**
 * Per-workspace settings modal.
 *
 * Workspaces are VS-Code-style "open folders" — each owns its CLI config
 * files (.claude/settings.local.json, .codex/config.toml + env.json). This
 * modal is the visual editor for those files plus the workspace's
 * self-describing metadata. Files are the source of truth; the modal reads +
 * writes via the workspace API. Restart any open sessions for AI-provider
 * changes to take effect (env is read at CLI startup).
 */

import { useEffect, useMemo, useState } from 'react'
import { Bot, GitMerge, Info, Layers3, Settings, X } from 'lucide-react'
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
import {
  AGENT_WIRE_PREFERENCE,
  WIRE_SHAPE_GUIDANCE,
  agentWireShapes,
  anthropicAuthModeForBaseUrl,
  baseUrlToVendor,
  savedCredentialModel,
  vendorPreset,
  presetModels,
  pickAgentWire,
} from '../../lib/presetHelpers'
import { ModelCombobox } from '../credentials/PresetFields'
import { useTestGate } from '../../lib/useTestGate'
import { useWorkspaces } from '../../contexts/workspaces-context'
import { WorkspaceTemplateUpgradePanel } from './WorkspaceTemplateUpgradePanel'
import { WorkspaceAbsorbPanel } from './WorkspaceAbsorbPanel'

// The agent tab implies a default vendor when the baseUrl alone can't say:
// claude → Anthropic, codex → OpenAI; opencode/pi run anything so they have no
// default (model suggestions then come only from a recognized baseUrl).
const TAB_FALLBACK_VENDOR: Record<Tab, string | null> = {
  claude: 'anthropic',
  codex: 'openai',
  opencode: null,
  pi: null,
}

export type Tab = 'claude' | 'codex' | 'opencode' | 'pi'
type Section = 'general' | 'ai' | 'template' | 'absorb'

interface Props {
  wsId: string
  onClose: () => void
  initialAgent?: Tab
  initialSection?: Section
}

const inputClass =
  'w-full bg-bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent'

const TAB_LABEL: Record<Tab, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'opencode', pi: 'Pi' }
const DEFAULT_CONTEXT_WINDOW = 256_000
const CONTEXT_WINDOW_OPTIONS = [
  { value: 128_000, label: '128K' },
  { value: 256_000, label: '256K' },
  { value: 512_000, label: '512K' },
  { value: 1_000_000, label: '1M' },
] as const

export interface FormState {
  baseUrl: string
  apiKey: string
  model: string
  contextWindow: number
  reasoning: boolean
  /** The wire protocol — drives the test + how the adapter is configured. */
  wireShape: WireShape
  wireApi: 'chat' | 'responses'
  // Anthropic-wire only: which header carries the key. 'x-api-key' is Anthropic's
  // first-party default; 'bearer' (Authorization: Bearer) is what most
  // anthropic-compatible gateways want — MiniMax documents Bearer for both
  // regional endpoints and the international endpoint rejects x-api-key.
  authMode: 'x-api-key' | 'bearer'
}

/** The wire shape each agent defaults to when nothing else specifies one. */
const DEFAULT_WIRE_BY_TAB: Record<Tab, WireShape> = {
  claude: 'anthropic',
  codex: 'openai-responses', // codex is Responses-only (hard-rejects chat)
  opencode: 'openai-chat',
  pi: 'openai-chat',
}

const EMPTY_FORM: FormState = {
  baseUrl: '',
  apiKey: '',
  model: '',
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  reasoning: false,
  wireShape: 'anthropic',
  wireApi: 'responses',
  authMode: 'x-api-key',
}

function normalizeContextWindow(value: number | null | undefined): number {
  if (typeof value !== 'number') return DEFAULT_CONTEXT_WINDOW
  return CONTEXT_WINDOW_OPTIONS.some((o) => o.value === value) ? value : DEFAULT_CONTEXT_WINDOW
}

export function configToForm(cfg: AgentConfig | null, tab: Tab): FormState {
  if (!cfg) return { ...EMPTY_FORM, wireShape: DEFAULT_WIRE_BY_TAB[tab] }
  return {
    baseUrl: cfg.baseUrl ?? '',
    apiKey: cfg.apiKey ?? '',
    model: cfg.model ?? '',
    contextWindow: normalizeContextWindow(cfg.contextWindow),
    reasoning: cfg.reasoning === true,
    wireShape: cfg.wireShape ?? DEFAULT_WIRE_BY_TAB[tab],
    wireApi: 'responses',
    authMode: cfg.authMode === 'bearer' ? 'bearer' : 'x-api-key',
  }
}

export function formToConfig(form: FormState, agent: AgentId): AgentConfig {
  const cfg: AgentConfig = {
    baseUrl: form.baseUrl.trim() || null,
    apiKey: form.apiKey.trim() || null,
    model: form.model.trim() || null,
    wireShape: form.wireShape,
  }
  if (agent === 'opencode' || agent === 'pi') {
    return {
      ...cfg,
      contextWindow: form.contextWindow,
      ...(agent === 'pi' ? { reasoning: form.reasoning } : {}),
      ...(form.wireShape === 'anthropic' ? { authMode: form.authMode } : {}),
    }
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
// authMode for every Anthropic-wire request).
function testKey(form: FormState): string {
  return [
    form.baseUrl.trim(),
    form.apiKey.trim(),
    form.model.trim(),
    form.wireShape,
    form.wireShape === 'anthropic' ? form.authMode : '',
  ].join('|')
}

export function WorkspaceAIConfigModal({ wsId, onClose, initialAgent = 'claude', initialSection = 'general' }: Props) {
  const { workspaces, refresh, saveWorkspaceMetadata } = useWorkspaces()
  const workspace = workspaces.find((w) => w.id === wsId) ?? null
  const workspaceLabel = workspace?.displayName?.trim() || workspace?.tag || wsId
  const [section, setSection] = useState<Section>(initialSection)
  const [tab, setTab] = useState<Tab>(initialAgent)
  const [metadataFormWsId, setMetadataFormWsId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [metadataSaving, setMetadataSaving] = useState(false)
  const [metadataSavedFlash, setMetadataSavedFlash] = useState(false)
  const [credentials, setCredentials] = useState<SavedCredential[]>([])
  const [bundle, setBundle] = useState<AgentConfigBundle | null>(null)
  const [claudeForm, setClaudeForm] = useState<FormState>(EMPTY_FORM)
  const [codexForm, setCodexForm] = useState<FormState>(EMPTY_FORM)
  const [opencodeForm, setOpencodeForm] = useState<FormState>(EMPTY_FORM)
  const [piForm, setPiForm] = useState<FormState>(EMPTY_FORM)
  const [pickedCredential, setPickedCredential] = useState<string>('')
  const [pickedWireShape, setPickedWireShape] = useState<WireShape | ''>('')
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
    setSection(initialSection)
    setTab(initialAgent)
    setPickedCredential('')
    setPickedWireShape('')
  }, [initialAgent, initialSection, wsId])

  useEffect(() => {
    if (metadataFormWsId === wsId) return
    if (!workspace) return
    setDisplayName(workspace.displayName ?? '')
    setDescription(workspace.description ?? '')
    setMetadataFormWsId(wsId)
  }, [metadataFormWsId, workspace, wsId])

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
  const key = testKey(form)
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
      ((tab === 'opencode' || tab === 'pi') && savedForm.contextWindow !== form.contextWindow) ||
      (tab === 'pi' && savedForm.reasoning !== form.reasoning) ||
      (form.wireShape === 'anthropic' && savedForm.authMode !== form.authMode)
    )
  }, [bundle, form, tab])
  // The primary footer button morphs Test → Save off this: an unsaved change
  // has to clear the connection test before it can be saved, so the lit button
  // is always the next action to take.
  const needsTest = dirty && !testPassedForCurrent

  const applyCredential = () => {
    const cred = credentials.find((x) => x.slug === pickedCredential)
    if (!cred) return
    // Pick the wire this tab's agent speaks from the credential's capabilities.
    // (The picker only lists compatible credentials, so this is non-null.)
    const picked = pickAgentWire(cred.wires, tab, pickedWireShape || undefined)
    if (!picked) return
    // Prefer the model this credential last used. A newly-created credential
    // falls back to the catalog's explicit default, not list order: catalogs
    // put the newest models first for discovery while retaining a conservative
    // default for first use (notably Gemini Flash-Lite vs 3.5 Flash).
    const vendorP = vendorPreset(cred.vendor, presets)
    const defaultModel = savedCredentialModel(cred, vendorP)
    setForm({
      ...form,
      baseUrl: picked.baseUrl,
      apiKey: cred.apiKey ?? '',
      model: defaultModel,
      wireShape: picked.shape,
      authMode: anthropicAuthModeForBaseUrl(picked.baseUrl),
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
      window.dispatchEvent(new CustomEvent('openalice:workspace-agent-config-changed', {
        detail: { wsId, agent: tab },
      }))
      window.dispatchEvent(new CustomEvent('openalice:credentials-changed'))
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

  const stableTag = workspace?.tag || wsId
  const savedDisplayName = workspace?.displayName ?? ''
  const savedDescription = workspace?.description ?? ''
  const normalizedDisplayName = displayName.trim()
  const normalizedDescription = description.trim()
  const metadataDirty =
    normalizedDisplayName !== savedDisplayName ||
    normalizedDescription !== savedDescription

  const handleSaveMetadata = async () => {
    setError(null)
    setMetadataSaving(true)
    try {
      await saveWorkspaceMetadata(wsId, {
        displayName: normalizedDisplayName || null,
        description: normalizedDescription || null,
      })
      setDisplayName(normalizedDisplayName)
      setDescription(normalizedDescription)
      setMetadataSavedFlash(true)
      setTimeout(() => setMetadataSavedFlash(false), 1800)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setMetadataSaving(false)
    }
  }

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
        ...(form.wireShape === 'anthropic' ? { authMode: form.authMode } : {}),
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className="bg-bg border border-border rounded-xl shadow-2xl w-[calc(100vw-24px)] max-w-3xl max-h-[85vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-text">Workspace Settings</h2>
            <p className="mt-0.5 truncate text-[11px] text-text-muted">{workspaceLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted hover:bg-bg-tertiary hover:text-text transition-colors"
            aria-label="Close workspace settings"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <aside className="flex w-full shrink-0 gap-1 border-b border-border bg-bg-secondary/25 p-2 sm:block sm:w-40 sm:border-b-0 sm:border-r">
            <button
              type="button"
              onClick={() => setSection('general')}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors sm:w-full ${
                section === 'general'
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:bg-bg-tertiary hover:text-text'
              }`}
            >
              <Settings size={15} />
              <span>General</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('ai')}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors sm:mt-1 sm:w-full ${
                section === 'ai'
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:bg-bg-tertiary hover:text-text'
              }`}
            >
              <Bot size={15} />
              <span>AI Provider</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('template')}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors sm:mt-1 sm:w-full ${
                section === 'template'
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:bg-bg-tertiary hover:text-text'
              }`}
            >
              <Layers3 size={15} />
              <span>Template</span>
              {workspace?.upgradeAvailable && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" aria-label="Update available" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setSection('absorb')}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors sm:mt-1 sm:w-full ${
                section === 'absorb'
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:bg-bg-tertiary hover:text-text'
              }`}
            >
              <GitMerge size={15} />
              <span>Consolidate</span>
            </button>
          </aside>

          <div className="min-w-0 flex flex-1 flex-col">
            {section === 'general' && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="max-w-xl space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Display name</label>
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={80}
                      placeholder={stableTag}
                      className={inputClass}
                    />
                    <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-text-muted/70">
                      <span>Shown in the workspace list and tab titles.</span>
                      <span>{displayName.length}/80</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={240}
                      rows={5}
                      placeholder="Short note for recognizing this workspace."
                      className={`${inputClass} min-h-28 resize-y leading-relaxed`}
                    />
                    <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-text-muted/70">
                      <span>Shown on workspace overview cards.</span>
                      <span>{description.length}/240</span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-bg-secondary/30 p-3">
                    <div className="flex items-start gap-2">
                      <Info size={14} className="mt-0.5 shrink-0 text-text-muted" />
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Stable tag</div>
                        <div className="mt-1 truncate font-mono text-[12px] text-text">{stableTag}</div>
                        <p className="mt-1 text-[11px] leading-snug text-text-muted/75">
                          The tag stays stable for paths and launcher bookkeeping; the display name is the human-facing label.
                        </p>
                      </div>
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-md border border-red/40 bg-red/10 text-red text-[12px] px-3 py-2">
                      {error}
                    </div>
                  )}
                  {metadataSavedFlash && (
                    <div className="rounded-md border border-green/40 bg-green/10 text-green text-[12px] px-3 py-2">
                      Saved to <code className="font-mono text-[11.5px]">.alice/workspace.json</code>.
                    </div>
                  )}
                  </div>
                </div>
                <div className="flex flex-col gap-2 border-t border-border bg-bg-secondary/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[11px] text-text-muted/75">
                    Stored in <code className="font-mono text-[11.5px]">.alice/workspace.json</code>.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={metadataSaving}
                      className="px-3 py-2 rounded-md text-text-muted hover:text-text text-[13px] disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveMetadata}
                      disabled={metadataSaving || !metadataDirty}
                      className="px-4 py-2 rounded-md bg-accent text-bg text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
                    >
                      {metadataSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {section === 'ai' && (
              <>
        {/* Tabs */}
        <div className="flex border-b border-border bg-bg-secondary/50">
          {(['claude', 'codex', 'opencode', 'pi'] as const).map((id) => (
            <button
              key={id}
              onClick={() => {
                setTab(id)
                setPickedCredential('')
                setPickedWireShape('')
              }}
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
              const selectedCredential = compatible.find((c) => c.slug === pickedCredential)
              const selectedWireOptions = selectedCredential
                ? agentWireShapes(selectedCredential.wires, tab)
                : []
              return (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      aria-label={`${TAB_LABEL[tab]} saved credential`}
                      value={pickedCredential}
                      onChange={(e) => {
                        const slug = e.target.value
                        const cred = compatible.find((candidate) => candidate.slug === slug)
                        setPickedCredential(slug)
                        setPickedWireShape(cred ? (agentWireShapes(cred.wires, tab)[0] ?? '') : '')
                      }}
                      className={inputClass + ' flex-1'}
                      disabled={compatible.length === 0}
                    >
                      <option value="">
                        {compatible.length === 0 ? `— no ${TAB_LABEL[tab]}-compatible credential —` : '— select a credential —'}
                      </option>
                      {compatible.map((cred) => {
                        const shapes = agentWireShapes(cred.wires, tab)
                        return (
                          <option key={cred.slug} value={cred.slug}>
                            {(cred.label?.trim() || cred.slug)}{shapes.length > 1 ? ` · ${shapes.length} protocols` : ''}
                          </option>
                        )
                      })}
                    </select>
                    {selectedWireOptions.length > 1 && (
                      <select
                        aria-label="Saved credential API protocol"
                        value={pickedWireShape}
                        onChange={(e) => setPickedWireShape(e.target.value as WireShape)}
                        className={inputClass + ' sm:max-w-[210px]'}
                      >
                        {selectedWireOptions.map((shape) => (
                          <option key={shape} value={shape}>{WIRE_SHAPE_GUIDANCE[shape]}</option>
                        ))}
                      </select>
                    )}
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
                      : 'Fills base URL + key from a credential Alice already holds. When it exposes several compatible protocols, choose the one this Workspace should use. Pick a model below, or type a new one.'}
                  </p>
                </>
              )
            })()}
          </div>

          {/* Manual fields */}
          {(tab === 'opencode' || tab === 'pi') && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">API protocol</label>
              <select
                aria-label={`${TAB_LABEL[tab]} API protocol`}
                value={form.wireShape}
                onChange={(e) => {
                  const wireShape = e.target.value as WireShape
                  const selected = credentials.find((candidate) => candidate.slug === pickedCredential)
                  const selectedBaseUrl = selected?.wires[wireShape]
                  setForm({
                    ...form,
                    wireShape,
                    ...(selectedBaseUrl !== undefined ? { baseUrl: selectedBaseUrl } : {}),
                    ...(wireShape === 'anthropic'
                      ? { authMode: anthropicAuthModeForBaseUrl(selectedBaseUrl ?? form.baseUrl) }
                      : {}),
                  })
                  gate.reset()
                }}
                className={inputClass}
              >
                {(AGENT_WIRE_PREFERENCE[tab] ?? []).map((shape) => (
                  <option key={shape} value={shape}>{WIRE_SHAPE_GUIDANCE[shape]}</option>
                ))}
              </select>
              <p className="text-[11px] text-text-muted/80 leading-snug mt-1">
                This chooses the agent SDK/provider adapter. The Base URL must expose the matching protocol.
              </p>
            </div>
          )}

          {tab === 'pi' && (
            <label className="flex items-start gap-2.5 rounded-md border border-border bg-bg-secondary/50 px-3 py-2.5">
              <input
                type="checkbox"
                aria-label="Pi model supports reasoning"
                checked={form.reasoning}
                onChange={(e) => setForm({ ...form, reasoning: e.target.checked })}
                className="mt-0.5"
              />
              <span className="text-[12px] leading-relaxed text-text-muted">
                <strong className="text-text">Model supports reasoning.</strong>{' '}
                Enables Pi's native thinking controls for this custom model. Leave this off for
                models that do not expose reasoning tokens.
              </span>
            </label>
          )}

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Base URL</label>
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder={
                form.wireShape === 'google-generative-ai'
                  ? 'https://generativelanguage.googleapis.com/v1beta'
                  : tab === 'claude'
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
                placeholder={form.wireShape === 'google-generative-ai' ? 'AQ... or AIza...' : 'sk-...'}
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

          {form.wireShape === 'anthropic' && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Auth header</label>
              <select
                aria-label={`${TAB_LABEL[tab]} auth header`}
                value={form.authMode}
                onChange={(e) => setForm({ ...form, authMode: e.target.value as FormState['authMode'] })}
                className={inputClass}
              >
                <option value="x-api-key">x-api-key — Anthropic default</option>
                <option value="bearer">Authorization: Bearer — gateways (MiniMax, LongCat, proxies)</option>
              </select>
              <p className="text-[11px] text-text-muted/80 leading-snug mt-1">
                Anthropic first-party uses <code className="font-mono text-[10.5px]">x-api-key</code>.
                Switch to <code className="font-mono text-[10.5px]">Bearer</code> for
                anthropic-compatible gateways that authenticate via{' '}
                <code className="font-mono text-[10.5px]">Authorization: Bearer</code> — e.g.
                MiniMax and LongCat. The selected agent adapter writes the matching header or runtime setting.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Model</label>
            <ModelCombobox
              value={form.model}
              suggestions={modelSuggestions}
              onChange={(v) => setForm({ ...form, model: v })}
              placeholder={tab === 'claude' ? 'claude-opus-4-8' : tab === 'opencode' || tab === 'pi' ? 'deepseek-chat' : 'gpt-5.5'}
            />
            {modelSuggestions.length > 0 && (
              <p className="text-[11px] text-text-muted/70 mt-1">Suggestions from the matched provider — or type any model id.</p>
            )}

          </div>

          {(tab === 'opencode' || tab === 'pi') && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Context window</label>
              <select
                aria-label={`${TAB_LABEL[tab]} context window`}
                value={form.contextWindow}
                onChange={(e) => setForm({ ...form, contextWindow: Number(e.target.value) })}
                className={inputClass}
              >
                {CONTEXT_WINDOW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          )}

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
                {form.wireShape === 'google-generative-ai' ? (
                  <><strong className="text-text">Native Google Generative AI wire</strong> (via{' '}
                  <code className="font-mono text-[11.5px]">@ai-sdk/google</code>) — supports current{' '}
                  <code className="font-mono text-[11.5px]">AQ.</code> authorization keys and legacy{' '}
                  <code className="font-mono text-[11.5px]">AIza</code> keys without a translation proxy.</>
                ) : form.wireShape === 'anthropic' ? (
                  <><strong className="text-text">Anthropic Messages wire</strong> (via{' '}
                  <code className="font-mono text-[11.5px]">@ai-sdk/anthropic</code>) — use the
                  provider's Anthropic-compatible endpoint and choose its required auth header.</>
                ) : form.wireShape === 'openai-responses' ? (
                  <><strong className="text-text">OpenAI Responses wire</strong> (via{' '}
                  <code className="font-mono text-[11.5px]">@ai-sdk/openai</code>) — use an endpoint
                  that implements Responses, not a Chat-only compatibility URL.</>
                ) : (
                  <><strong className="text-text">Speaks OpenAI Chat Completions</strong> (via{' '}
                  <code className="font-mono text-[11.5px]">@ai-sdk/openai-compatible</code>), so it
                  connects <strong className="text-text">directly</strong> to Chat-only providers —
                  DeepSeek, Qwen, Moonshot/Kimi, GLM, MiniMax — and local runtimes (Ollama, vLLM,
                  LM Studio). No translation proxy needed. Base URL is the provider's
                  OpenAI-compatible endpoint; Model is the bare model id.</>
                )}
              </p>
            </div>
          )}

          {tab === 'pi' && (
            <div className="rounded-md border border-border bg-bg-secondary/50 px-3 py-2.5">
              <p className="text-[12px] text-text-muted leading-relaxed">
                {form.wireShape === 'google-generative-ai' ? (
                  <><strong className="text-text">Native Google Generative AI wire</strong> — sends current{' '}
                  <code className="font-mono text-[11.5px]">AQ.</code> authorization keys and legacy{' '}
                  <code className="font-mono text-[11.5px]">AIza</code> keys as{' '}
                  <code className="font-mono text-[11.5px]">x-goog-api-key</code>.</>
                ) : form.wireShape === 'anthropic' ? (
                  <><strong className="text-text">Anthropic Messages wire</strong> — use the
                  provider's Anthropic-compatible endpoint and choose its required auth header.</>
                ) : form.wireShape === 'openai-responses' ? (
                  <><strong className="text-text">OpenAI Responses wire</strong> — use an endpoint
                  that implements Responses rather than Chat Completions only.</>
                ) : (
                  <><strong className="text-text">OpenAI Chat Completions wire</strong> — connects
                  directly to DeepSeek, Qwen, Kimi, GLM, MiniMax and local runtimes; Base URL is the
                  provider's OpenAI-compatible endpoint, Model is the bare model id.</>
                )}{' '}OpenAlice registers the custom provider in Pi's normal user model registry,
                then selects it with the Workspace-local{' '}
                <code className="font-mono text-[11.5px]">.pi/settings.json</code>. Pi's own global
                packages, settings, auth, resources, and sessions continue to load normally.
                Trading tools reach Pi through the <code className="font-mono text-[11.5px]">alice-uta</code>{' '}
                CLI on PATH (the <code className="font-mono text-[11.5px]">alice-uta</code> skill),
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
            {tab === 'pi' && ' Pi uses its normal global agent directory plus the Workspace-local `.pi/settings.json`; tools reach it via the `alice` CLI on PATH.'}
          </p>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 p-3 border-t border-border bg-bg-secondary/30 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              disabled={saving}
              className="px-3 py-2 rounded-md border border-border text-text-muted hover:text-text text-[12px] disabled:opacity-40"
            >
              Reset to global default
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3 py-2 rounded-md text-text-muted hover:text-text text-[13px]"
            >
              Cancel
            </button>
            {/* Single primary CTA that walks the gate: an unverified change
                shows Test, and only a passing reply morphs it into Save. The
                action you can take is the one that's lit — no hidden rule that
                Save needs a prior Test. */}
            {needsTest ? (
              <button
                onClick={handleTest}
                disabled={!canTest || testing || saving}
                title={!canTest ? 'Fill base URL, API key, and model first' : undefined}
                className="px-4 py-2 rounded-md bg-accent text-bg text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
              >
                {testing ? 'Testing…' : 'Test'}
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving || !dirty}
                className="px-4 py-2 rounded-md bg-accent text-bg text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
              </>
            )}

            {section === 'template' && (
              <WorkspaceTemplateUpgradePanel
                wsId={wsId}
                onWorkspaceChanged={refresh}
                onClose={onClose}
              />
            )}

            {section === 'absorb' && workspace && (
              <WorkspaceAbsorbPanel
                target={workspace}
                workspaces={workspaces}
                onWorkspaceChanged={refresh}
                onClose={onClose}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
