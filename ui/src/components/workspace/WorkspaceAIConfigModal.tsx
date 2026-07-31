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

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, GitMerge, Info, Layers3, Rocket, RotateCcw, Settings, X } from 'lucide-react'
import {
  getAgentConfig,
  listCredentials,
  saveAgentConfig,
  saveCredential,
  testAgentConfig,
  type AgentConfig,
  type AgentConfigBundle,
  type AgentId,
  type AgentInfo,
  type AgentProviderCapabilities,
  type SavedCredential,
} from './api'
import { api, type ModelReasoningEffort, type Preset, type WireShape } from '../../api'
import {
  WIRE_SHAPE_GUIDANCE,
  agentWirePreference,
  agentWireShapes,
  anthropicAuthModeForBaseUrl,
  baseUrlToVendor,
  describeModelSemantics,
  presetModel,
  savedCredentialModel,
  vendorPreset,
  presetModels,
  pickAgentWire,
} from '../../lib/presetHelpers'
import { ModelCombobox } from '../credentials/PresetFields'
import { useTestGate } from '../../lib/useTestGate'
import { useWorkspaces } from '../../contexts/workspaces-context'
import { notifyWorkspaceAgentConfigChanged } from '../../lib/workspaceAiEvents'
import { WorkspaceTemplateUpgradePanel } from './WorkspaceTemplateUpgradePanel'
import { WorkspaceAbsorbPanel } from './WorkspaceAbsorbPanel'
import { WorkspaceLaunchConfigurationPanel } from './WorkspaceLaunchConfigurationPanel'

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
type Section = 'general' | 'launch' | 'ai' | 'template' | 'absorb'

interface Props {
  wsId: string
  onClose: () => void
  onAiSaved?: (result: WorkspaceAiSaveResult) => void
  initialAgent?: Tab
  initialSection?: Section
}

export interface WorkspaceAiSaveResult {
  readonly agent: Tab
  readonly runtimeLabel: string
  readonly model: string | null
  readonly workspaceLabel: string
}

const inputClass =
  'w-full bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary'

const TAB_LABEL: Record<Tab, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'opencode', pi: 'Pi' }
const CONTEXT_WINDOW_OPTIONS = [
  { value: 128_000, label: '128K' },
  { value: 256_000, label: '256K' },
  { value: 512_000, label: '512K' },
  { value: 1_000_000, label: '1M' },
] as const

const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function dialogFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
    .filter((element) => (
      element.tabIndex >= 0 &&
      element.closest('[hidden], [aria-hidden="true"]') === null
    ))
}

function makeDialogBackgroundInert(modalBranch: HTMLElement): () => void {
  const changed: Array<{
    element: HTMLElement
    hadInert: boolean
    ariaHidden: string | null
  }> = []
  let branch: HTMLElement | null = modalBranch

  while (branch?.parentElement) {
    const parent: HTMLElement = branch.parentElement
    for (const sibling of Array.from(parent.children)) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue
      changed.push({
        element: sibling,
        hadInert: sibling.hasAttribute('inert'),
        ariaHidden: sibling.getAttribute('aria-hidden'),
      })
      sibling.setAttribute('inert', '')
      sibling.setAttribute('aria-hidden', 'true')
    }
    if (parent === document.body) break
    branch = parent
  }

  return () => {
    for (const { element, hadInert, ariaHidden } of changed.reverse()) {
      if (!hadInert) element.removeAttribute('inert')
      if (ariaHidden === null) element.removeAttribute('aria-hidden')
      else element.setAttribute('aria-hidden', ariaHidden)
    }
  }
}

export interface FormState {
  baseUrl: string
  apiKey: string
  model: string
  /** Null lets registered model semantics or the native runtime decide. */
  contextWindow: number | null
  /** null = let registry/runtime decide; boolean = unknown-model override. */
  reasoning: boolean | null
  /** null = fill from the registered model default when one is known. */
  reasoningEffort: ModelReasoningEffort | null
  /** The wire protocol — drives the test + how the adapter is configured. */
  wireShape: WireShape
  wireApi: 'chat' | 'responses'
  // Anthropic-wire only: which header carries the key. 'x-api-key' is Anthropic's
  // first-party default; 'bearer' (Authorization: Bearer) is what most
  // anthropic-compatible gateways want — MiniMax documents Bearer for both
  // regional endpoints and the international endpoint rejects x-api-key.
  authMode: 'x-api-key' | 'bearer'
}

function providerCapabilities(
  agents: readonly AgentInfo[],
  agent: string,
): AgentProviderCapabilities | undefined {
  return agents.find((candidate) => candidate.id === agent)?.capabilities.aiProvider
}

function defaultWire(capabilities: AgentProviderCapabilities | undefined): WireShape {
  return capabilities?.defaultWire ?? capabilities?.wirePreference[0] ?? 'anthropic'
}

const EMPTY_FORM: FormState = {
  baseUrl: '',
  apiKey: '',
  model: '',
  contextWindow: null,
  reasoning: null,
  reasoningEffort: null,
  wireShape: 'anthropic',
  wireApi: 'responses',
  authMode: 'x-api-key',
}

function normalizeContextWindow(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function formatContextWindow(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(value)
}

export function configToForm(
  cfg: AgentConfig | null,
  capabilities?: AgentProviderCapabilities,
): FormState {
  if (!cfg) return { ...EMPTY_FORM, wireShape: defaultWire(capabilities) }
  return {
    baseUrl: cfg.baseUrl ?? '',
    apiKey: cfg.apiKey ?? '',
    model: cfg.model ?? '',
    contextWindow: normalizeContextWindow(cfg.contextWindow),
    reasoning: typeof cfg.reasoning === 'boolean' ? cfg.reasoning : null,
    reasoningEffort: cfg.reasoningEffort ?? null,
    wireShape: cfg.wireShape ?? defaultWire(capabilities),
    wireApi: 'responses',
    authMode: cfg.authMode === 'bearer' ? 'bearer' : 'x-api-key',
  }
}

export function formToConfig(
  form: FormState,
  agent: AgentId,
  capabilities?: AgentProviderCapabilities,
): AgentConfig {
  const cfg: AgentConfig = {
    baseUrl: form.baseUrl.trim() || null,
    apiKey: form.apiKey.trim() || null,
    model: form.model.trim() || null,
    wireShape: form.wireShape,
    ...(form.reasoningEffort ? { reasoningEffort: form.reasoningEffort } : {}),
  }
  const registration = capabilities?.modelRegistration
  if (registration?.contextWindow || registration?.reasoning) {
    return {
      ...cfg,
      ...(registration.contextWindow && form.contextWindow !== null
        ? { contextWindow: form.contextWindow }
        : {}),
      ...(registration.reasoning && typeof form.reasoning === 'boolean'
        ? { reasoning: form.reasoning }
        : {}),
      ...(form.wireShape === 'anthropic' ? { authMode: form.authMode } : {}),
    }
  }
  if (agent === 'codex') {
    return { ...cfg, wireApi: form.wireApi }
  }
  if (agent === 'claude') {
    return { ...cfg, authMode: form.authMode }
  }
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

/** Connection probes cover only transport/auth/model fields. Local runtime
 * metadata such as context-window size and unknown-model reasoning capability
 * is written into the Workspace config without changing the HTTP request that
 * was already verified. */
export function connectionFieldsChanged(
  saved: AgentConfig | null,
  form: FormState,
  capabilities?: AgentProviderCapabilities,
): boolean {
  // Codex and Claude Code can inherit their native login while a project file
  // selects only model/effort. With no OpenAlice-managed endpoint or key there
  // is no credential-bearing HTTP connection for this modal to probe.
  if (
    capabilities?.credentialSource === 'runtime-or-workspace' &&
    !form.baseUrl.trim() &&
    !form.apiKey.trim()
  ) {
    return false
  }
  return testKey(configToForm(saved, capabilities)) !== testKey(form)
}

export function WorkspaceAIConfigModal({
  wsId,
  onClose,
  onAiSaved,
  initialAgent = 'claude',
  initialSection = 'general',
}: Props) {
  const { t } = useTranslation()
  const backdropRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const dialogTitleId = useId()
  const dialogDescriptionId = useId()
  const {
    workspaces,
    agents = [],
    defaultAgent,
    refresh,
    saveWorkspaceMetadata,
  } = useWorkspaces()
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
  // A Workspace-only hand-entered key can still be promoted to Alice's vault,
  // but the choice must happen before the primary Save closes the dialog.
  const [dismissedCredentialKey, setDismissedCredentialKey] = useState<string | null>(null)
  const [savingCred, setSavingCred] = useState(false)
  const [credFlash, setCredFlash] = useState<string | null>(null)
  // One test-gate per tab (hooks are unconditional + fixed-count).
  const claudeGate = useTestGate()
  const codexGate = useTestGate()
  const opencodeGate = useTestGate()
  const piGate = useTestGate()
  const [presets, setPresets] = useState<Preset[]>([])

  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    const backdrop = backdropRef.current
    if (!dialog || !backdrop) return

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const restoreBackground = makeDialogBackgroundInert(backdrop)
    const initialFocus = dialog.querySelector<HTMLElement>('[aria-current="page"]')
      ?? dialogFocusableElements(dialog)[0]
      ?? dialog
    initialFocus.focus()

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = dialogFocusableElements(dialog)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement
      if (!dialog.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleDialogKeyDown)
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown)
      restoreBackground()
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

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
        setClaudeForm(configToForm(b.claude, providerCapabilities(agents, 'claude')))
        setCodexForm(configToForm(b.codex, providerCapabilities(agents, 'codex')))
        setOpencodeForm(configToForm(b.opencode, providerCapabilities(agents, 'opencode')))
        setPiForm(configToForm(b.pi, providerCapabilities(agents, 'pi')))
      })
      .catch((err: Error) => setError(err.message))
    // Presets drive the model-id suggestions (anti-typo) — load once.
    void api.config.getPresets().then(({ presets: p }) => setPresets(p)).catch(() => {})
  }, [agents, wsId])

  const form = { claude: claudeForm, codex: codexForm, opencode: opencodeForm, pi: piForm }[tab]
  const setForm = { claude: setClaudeForm, codex: setCodexForm, opencode: setOpencodeForm, pi: setPiForm }[tab]
  const tabProviderCapabilities = providerCapabilities(agents, tab)
  const modelRegistration = tabProviderCapabilities?.modelRegistration
  const formCredentialByKey = useMemo(() => credentials.find((credential) => (
    !!credential.apiKey && credential.apiKey === form.apiKey.trim()
  )) ?? null, [credentials, form.apiKey])
  const formCredentialVendor = useMemo(() => {
    const selected = credentials.find((credential) => credential.slug === pickedCredential)
    return selected?.vendor ?? formCredentialByKey?.vendor ?? null
  }, [credentials, formCredentialByKey, pickedCredential])
  const formWireOptions = useMemo(() => {
    return formCredentialByKey?.vendor &&
      tabProviderCapabilities?.vendorPolicies?.[formCredentialByKey.vendor]
      ? agentWireShapes(formCredentialByKey.wires, agents, tab, formCredentialByKey.vendor)
      : agentWirePreference(agents, tab)
  }, [agents, formCredentialByKey, tab, tabProviderCapabilities])

  useEffect(() => {
    if (
      !formCredentialByKey ||
      !tabProviderCapabilities?.vendorPolicies?.[formCredentialByKey.vendor]
    ) return
    if (formWireOptions.includes(form.wireShape)) return
    const repaired = pickAgentWire(
      formCredentialByKey.wires,
      agents,
      tab,
      form.wireShape,
      formCredentialByKey.vendor,
    )
    if (!repaired || repaired.shape === form.wireShape) return
    setForm({
      ...form,
      wireShape: repaired.shape,
      baseUrl: repaired.baseUrl,
      ...(repaired.shape === 'anthropic'
        ? { authMode: anthropicAuthModeForBaseUrl(repaired.baseUrl) }
        : {}),
    })
  }, [agents, form, formCredentialByKey, formWireOptions, setForm, tab, tabProviderCapabilities])
  // Model-id suggestions for the current field: infer the provider vendor from
  // the matched vault credential first, then its entered baseUrl (api.z.ai →
  // glm, …), with the tab as fallback. Official endpoints may intentionally be
  // empty, so key identity is the only reliable vendor signal for opencode/Pi.
  const modelSuggestions = useMemo(() => {
    const vendor = formCredentialVendor
      ?? baseUrlToVendor(form.baseUrl, TAB_FALLBACK_VENDOR[tab])
    if (!vendor) return []
    const p = vendorPreset(vendor, presets)
    return p ? presetModels(p) : []
  }, [form.baseUrl, formCredentialVendor, tab, presets])
  const selectedModelSemantics = useMemo(() => {
    const vendor = formCredentialVendor
      ?? baseUrlToVendor(form.baseUrl, TAB_FALLBACK_VENDOR[tab])
    if (!vendor) return null
    return presetModel(vendorPreset(vendor, presets), form.model)?.semantics ?? null
  }, [form.baseUrl, form.model, formCredentialVendor, tab, presets])
  const supportedReasoningEfforts = useMemo(() => {
    const efforts = selectedModelSemantics?.reasoning?.efforts ?? []
    // Claude Code project settings support these persisted values. `max` is a
    // session-only CLI choice, so do not offer a value the injector cannot own.
    return tab === 'claude'
      ? efforts.filter((effort) => effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh')
      : efforts
  }, [selectedModelSemantics, tab])
  const semanticsSummary = describeModelSemantics(selectedModelSemantics)
  const gate = { claude: claudeGate, codex: codexGate, opencode: opencodeGate, pi: piGate }[tab]
  const key = testKey(form)
  const testing = gate.testing
  const result = gate.result
  const resultMatchesCurrent = gate.matchesCurrent(key)
  const testPassedForCurrent = gate.passedFor(key)
  const dirty = useMemo(() => {
    if (!bundle) return false
    const saved = bundle[tab]
    const savedForm = configToForm(saved, tabProviderCapabilities)
    return (
      savedForm.baseUrl !== form.baseUrl ||
      savedForm.apiKey !== form.apiKey ||
      savedForm.model !== form.model ||
      savedForm.wireShape !== form.wireShape ||
      (modelRegistration?.contextWindow === true && savedForm.contextWindow !== form.contextWindow) ||
      (modelRegistration?.reasoning === true && savedForm.reasoning !== form.reasoning) ||
      savedForm.reasoningEffort !== form.reasoningEffort ||
      (form.wireShape === 'anthropic' && savedForm.authMode !== form.authMode)
    )
  }, [bundle, form, modelRegistration, tab, tabProviderCapabilities])
  const enteredApiKey = form.apiKey.trim()
  const offerSaveCred = !!enteredApiKey &&
    !credentials.some((credential) => credential.apiKey === enteredApiKey) &&
    dismissedCredentialKey !== enteredApiKey
  const connectionDirty = useMemo(
    () => !!bundle && connectionFieldsChanged(bundle[tab], form, tabProviderCapabilities),
    [bundle, form, tab, tabProviderCapabilities],
  )
  // The primary footer button morphs Test → Save off this: an unsaved change
  // to connection fields has to clear the probe before it can be saved. Local
  // model metadata (context/reasoning) can be saved without another API call.
  const needsTest = dirty && connectionDirty && !testPassedForCurrent

  const applyCredential = () => {
    const cred = credentials.find((x) => x.slug === pickedCredential)
    if (!cred) return
    // Pick the wire this tab's agent speaks from the credential's capabilities.
    // (The picker only lists compatible credentials, so this is non-null.)
    const picked = pickAgentWire(cred.wires, agents, tab, pickedWireShape || undefined, cred.vendor)
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
      contextWindow: null,
      reasoning: null,
      reasoningEffort: null,
      wireShape: picked.shape,
      authMode: anthropicAuthModeForBaseUrl(picked.baseUrl),
    })
    gate.reset() // a new provider invalidates any prior test verdict
  }

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    try {
      await saveAgentConfig(wsId, tab, formToConfig(form, tab, tabProviderCapabilities))
      notifyConfigChanged()
      onAiSaved?.({
        agent: tab,
        runtimeLabel: TAB_LABEL[tab],
        model: form.model.trim() || null,
        workspaceLabel,
      })
      setSaving(false)
      onClose()
    } catch (err) {
      setError((err as Error).message)
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
      setDismissedCredentialKey(null)
      setCredFlash(t('workspaceSettings.ai.savedReusable', { slug }))
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
      setForm({ ...EMPTY_FORM, wireShape: defaultWire(tabProviderCapabilities) })
      notifyConfigChanged()
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1800)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const notifyConfigChanged = () => {
    notifyWorkspaceAgentConfigChanged({ wsId, agent: tab })
    window.dispatchEvent(new CustomEvent('openalice:credentials-changed'))
  }

  // Official endpoints may be omitted; the backend probe resolves them from
  // the selected wire shape. Managed credentials still require key + model.
  const canTest = !!form.apiKey.trim() && !!form.model.trim()

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
      ref={backdropRef}
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-backdrop backdrop-blur-sm sm:items-center"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={dialogRef}
        data-testid="workspace-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        tabIndex={-1}
        className="flex h-full w-full flex-col overflow-hidden border-y border-border bg-background shadow-2xl sm:h-auto sm:w-[calc(100vw-24px)] sm:max-w-3xl sm:max-h-[85dvh] sm:rounded-xl sm:border"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 sm:p-4">
          <div className="min-w-0">
            <h2 id={dialogTitleId} className="text-[15px] font-semibold text-foreground">{t('workspaceSettings.title')}</h2>
            <p id={dialogDescriptionId} className="mt-0.5 truncate text-[11px] text-muted-foreground">{workspaceLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={t('workspaceSettings.close')}
            title={t('common.close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
          <aside
            data-testid="workspace-settings-section-nav"
            className="flex w-full shrink-0 gap-1 overflow-x-auto overscroll-x-contain border-b border-border bg-secondary/25 px-2 py-1.5 [scrollbar-width:none] sm:block sm:w-40 sm:overflow-visible sm:border-b-0 sm:border-r sm:p-2"
          >
            <button
              type="button"
              onClick={() => setSection('general')}
              aria-current={section === 'general' ? 'page' : undefined}
              className={`flex min-h-11 min-w-max flex-none items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors sm:min-h-0 sm:w-full ${
                section === 'general'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Settings size={15} />
              <span>{t('workspaceSettings.section.general')}</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('launch')}
              aria-current={section === 'launch' ? 'page' : undefined}
              className={`flex min-h-11 min-w-max flex-none items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors sm:mt-1 sm:min-h-0 sm:w-full ${
                section === 'launch'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Rocket size={15} />
              <span>{t('workspaceSettings.section.launch')}</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('ai')}
              aria-current={section === 'ai' ? 'page' : undefined}
              className={`flex min-h-11 min-w-max flex-none items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors sm:mt-1 sm:min-h-0 sm:w-full ${
                section === 'ai'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Bot size={15} />
              <span>{t('workspaceSettings.section.aiProvider')}</span>
            </button>
            <button
              type="button"
              onClick={() => setSection('template')}
              aria-current={section === 'template' ? 'page' : undefined}
              className={`flex min-h-11 min-w-max flex-none items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors sm:mt-1 sm:min-h-0 sm:w-full ${
                section === 'template'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Layers3 size={15} />
              <span>{t('workspaceSettings.section.template')}</span>
              {workspace?.upgradeAvailable && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-label="Update available" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setSection('absorb')}
              aria-current={section === 'absorb' ? 'page' : undefined}
              className={`flex min-h-11 min-w-max flex-none items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors sm:mt-1 sm:min-h-0 sm:w-full ${
                section === 'absorb'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <GitMerge size={15} />
              <span>{t('workspaceSettings.section.consolidate')}</span>
            </button>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {section === 'general' && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                  <div className="max-w-xl space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">{t('workspaceSettings.general.displayName')}</label>
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={80}
                      placeholder={stableTag}
                      className={inputClass}
                    />
                    <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-muted-foreground/70">
                      <span>{t('workspaceSettings.general.displayNameHelp')}</span>
                      <span>{displayName.length}/80</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">{t('workspaceSettings.general.description')}</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      maxLength={240}
                      rows={5}
                      placeholder={t('workspaceSettings.general.descriptionPlaceholder')}
                      className={`${inputClass} min-h-28 resize-y leading-relaxed`}
                    />
                    <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-muted-foreground/70">
                      <span>{t('workspaceSettings.general.descriptionHelp')}</span>
                      <span>{description.length}/240</span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="flex items-start gap-2">
                      <Info size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('workspaceSettings.general.stableTag')}</div>
                        <div className="mt-1 truncate font-mono text-[12px] text-foreground">{stableTag}</div>
                        <p className="mt-1 text-[11px] leading-snug text-muted-foreground/75">
                          {t('workspaceSettings.general.stableTagHelp')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-[12px] px-3 py-2">
                      {error}
                    </div>
                  )}
                  {metadataSavedFlash && (
                    <div className="rounded-md border border-success/40 bg-success/10 text-success text-[12px] px-3 py-2">
                      {t('workspaceSettings.general.saved')}
                    </div>
                  )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-secondary/30 px-3 py-2.5 sm:grid sm:grid-cols-[minmax(0,1fr)_auto]">
                  <p className="hidden min-w-0 text-[11px] leading-snug text-muted-foreground/75 sm:block">
                    {t('workspaceSettings.general.storedIn')}
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={metadataSaving}
                      className="whitespace-nowrap px-3 py-2 rounded-md text-muted-foreground hover:text-foreground text-[13px] disabled:opacity-40"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveMetadata}
                      disabled={metadataSaving || !metadataDirty}
                      className="whitespace-nowrap px-4 py-2 rounded-md bg-primary text-primary-foreground text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
                    >
                      {metadataSaving ? t('common.saving') : t('common.save')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {section === 'ai' && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Tabs */}
        <div className="flex shrink-0 overflow-x-auto overscroll-x-contain border-b border-border bg-secondary/50 [scrollbar-width:none]">
          {(['claude', 'codex', 'opencode', 'pi'] as const).map((id) => (
            <button
              key={id}
              aria-label={TAB_LABEL[id]}
              onClick={() => {
                setTab(id)
                setPickedCredential('')
                setPickedWireShape('')
              }}
              className={`min-h-11 flex-none whitespace-nowrap px-3 py-2 text-[13px] font-medium transition-colors sm:flex-1 sm:px-4 sm:py-2.5 ${
                tab === id
                  ? 'text-primary border-b-2 border-primary -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="sm:hidden">{id === 'claude' ? 'Claude' : TAB_LABEL[id]}</span>
              <span className="hidden sm:inline">{TAB_LABEL[id]}</span>
            </button>
          ))}
        </div>

        {/* Body */}
        <div
          data-testid="workspace-settings-ai-scroll"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable]"
        >
          {/* Quick pick — load a saved credential into the form */}
          {credentials.length === 0 ? (
            <p className="text-[11px] leading-snug text-muted-foreground/75">
              {t('workspaceSettings.ai.noCompatibleCredential', { agent: TAB_LABEL[tab] })}
            </p>
          ) : (
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              {t('workspaceSettings.ai.loadSaved')}
            </label>
            {(() => {
              // Only credentials that declare a wire THIS agent speaks. Codex is
              // Responses-only, so most credentials won't list here — the funnel
              // toward pi/opencode is by design.
              const compatible = credentials.filter((c) =>
                pickAgentWire(c.wires, agents, tab, undefined, c.vendor))
              const selectedCredential = compatible.find((c) => c.slug === pickedCredential)
              const selectedWireOptions = selectedCredential
                ? agentWireShapes(selectedCredential.wires, agents, tab, selectedCredential.vendor)
                : []
              return (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      aria-label={t('workspaceSettings.ai.savedCredentialLabel', { agent: TAB_LABEL[tab] })}
                      value={pickedCredential}
                      onChange={(e) => {
                        const slug = e.target.value
                        const cred = compatible.find((candidate) => candidate.slug === slug)
                        setPickedCredential(slug)
                        setPickedWireShape(
                          cred ? (agentWireShapes(cred.wires, agents, tab, cred.vendor)[0] ?? '') : '',
                        )
                      }}
                      className={inputClass + ' flex-1'}
                      disabled={compatible.length === 0}
                    >
                      <option value="">
                        {compatible.length === 0
                          ? t('workspaceSettings.ai.noCompatibleCredential', { agent: TAB_LABEL[tab] })
                          : t('workspaceSettings.ai.selectCredential')}
                      </option>
                      {compatible.map((cred) => {
                        const shapes = agentWireShapes(cred.wires, agents, tab, cred.vendor)
                        return (
                          <option key={cred.slug} value={cred.slug}>
                            {(cred.label?.trim() || cred.slug)}{shapes.length > 1 ? ` · ${t('workspaceSettings.ai.protocolCount', { count: shapes.length })}` : ''}
                          </option>
                        )
                      })}
                    </select>
                    {selectedWireOptions.length > 1 && (
                      <select
                        aria-label={t('workspaceSettings.ai.savedCredentialProtocolLabel')}
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
                      className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
                    >
                      {t('workspaceSettings.ai.load')}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground/80 leading-snug mt-1.5">
                    {compatible.length === 0 && credentials.length > 0
                      ? t('workspaceSettings.ai.incompatibleHelp', { agent: TAB_LABEL[tab] })
                      : t('workspaceSettings.ai.loadHelp')}
                  </p>
                </>
              )
            })()}
            </div>
          )}

          {/* Manual fields */}
          {(tabProviderCapabilities?.wirePreference.length ?? 0) > 1 && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t('workspaceSettings.ai.apiProtocol')}</label>
              <select
                aria-label={t('workspaceSettings.ai.apiProtocolLabel', { agent: TAB_LABEL[tab] })}
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
                {formWireOptions.map((shape) => (
                  <option key={shape} value={shape}>{WIRE_SHAPE_GUIDANCE[shape]}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground/80 leading-snug mt-1">
                {t('workspaceSettings.ai.apiProtocolHelp')}
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('workspaceSettings.ai.baseUrl')}</label>
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({
                ...form,
                baseUrl: e.target.value,
                reasoning: null,
                reasoningEffort: null,
              })}
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
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('workspaceSettings.ai.apiKey')}</label>
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
                className="px-3 rounded-md border border-border text-muted-foreground hover:text-foreground text-[12px]"
                type="button"
              >
                {showKey ? t('common.hide') : t('common.show')}
              </button>
            </div>
          </div>

          {form.wireShape === 'anthropic' && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t('workspaceSettings.ai.authHeader')}</label>
              <select
                aria-label={t('workspaceSettings.ai.authHeaderLabel', { agent: TAB_LABEL[tab] })}
                value={form.authMode}
                onChange={(e) => setForm({ ...form, authMode: e.target.value as FormState['authMode'] })}
                className={inputClass}
              >
                <option value="x-api-key">x-api-key — Anthropic default</option>
                <option value="bearer">Authorization: Bearer — gateways (MiniMax, LongCat, proxies)</option>
              </select>
              <p className="text-[11px] text-muted-foreground/80 leading-snug mt-1">
                {t('workspaceSettings.ai.authHeaderHelp')}
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('workspaceSettings.ai.model')}</label>
            <ModelCombobox
              value={form.model}
              suggestions={modelSuggestions}
              onChange={(v) => setForm({
                ...form,
                model: v,
                contextWindow: v === form.model ? form.contextWindow : null,
                reasoning: v === form.model ? form.reasoning : null,
                reasoningEffort: v === form.model ? form.reasoningEffort : null,
              })}
              placeholder={tab === 'claude' ? 'claude-opus-4-8' : tab === 'opencode' || tab === 'pi' ? 'deepseek-chat' : 'gpt-5.5'}
              ariaLabel={t('workspaceSettings.ai.model')}
              suggestionsLabel={t('workspaceSettings.ai.modelSuggestions')}
            />
            {modelSuggestions.length > 0 && (
              <p className="text-[11px] text-muted-foreground/70 mt-1">{t('workspaceSettings.ai.modelSuggestions')}</p>
            )}

            {semanticsSummary && (
              <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                <strong className="text-foreground">{t('workspaceSettings.ai.registeredAutomatically')}</strong>{' '}
                {semanticsSummary}.
              </div>
            )}

            {supportedReasoningEfforts.length > 0 && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  {t('workspaceSettings.ai.reasoningEffort')}
                </label>
                <select
                  aria-label={t('workspaceSettings.ai.reasoningEffortLabel', { agent: TAB_LABEL[tab] })}
                  value={form.reasoningEffort ?? selectedModelSemantics?.reasoning?.defaultEffort ?? ''}
                  onChange={(event) => setForm({
                    ...form,
                    reasoningEffort: event.target.value
                      ? event.target.value as ModelReasoningEffort
                      : null,
                  })}
                  className={inputClass}
                >
                  {!selectedModelSemantics?.reasoning?.defaultEffort && (
                    <option value="">{t('workspaceSettings.ai.runtimeDefaultOption')}</option>
                  )}
                  {supportedReasoningEfforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}{effort === selectedModelSemantics?.reasoning?.defaultEffort
                        ? ` — ${t('workspaceSettings.ai.registeredDefault')}`
                        : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10.5px] leading-snug text-muted-foreground/80 mt-1">
                  {selectedModelSemantics?.reasoning?.defaultEffort
                    ? t('workspaceSettings.ai.reasoningEffortHelp', {
                      runtime: TAB_LABEL[tab],
                      defaultEffort: selectedModelSemantics.reasoning.defaultEffort,
                      effort: form.reasoningEffort ?? selectedModelSemantics.reasoning.defaultEffort,
                    })
                    : t('workspaceSettings.ai.reasoningEffortUnknownHelp', { runtime: TAB_LABEL[tab] })}
                </p>
              </div>
            )}

            {selectedModelSemantics?.reasoning &&
              selectedModelSemantics.reasoning.mode !== 'none' &&
              supportedReasoningEfforts.length === 0 && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    {t('workspaceSettings.ai.thinkingPolicy')}
                  </label>
                  <div className={`${inputClass} cursor-default`}>
                    {selectedModelSemantics.reasoning.mode === 'required'
                      ? t('workspaceSettings.ai.thinkingAlwaysOn')
                      : selectedModelSemantics.reasoning.defaultEnabled === true
                        ? t('workspaceSettings.ai.thinkingEnabled')
                        : selectedModelSemantics.reasoning.defaultEnabled === false
                          ? t('workspaceSettings.ai.thinkingDisabled')
                          : t('workspaceSettings.ai.thinkingUnknown')}
                  </div>
                  <p className="text-[10.5px] leading-snug text-muted-foreground/80 mt-1">
                    {t('workspaceSettings.ai.thinkingPolicyHelp')}
                  </p>
                </div>
              )}

            {modelRegistration?.reasoning === true && !selectedModelSemantics?.reasoning && (
              <details className="mt-2 rounded-md border border-border bg-secondary/40 px-3 py-2">
                <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                  {t('aiProvider.advancedReasoning')}
                </summary>
                <div className="mt-2 space-y-1.5">
                  <select
                    aria-label={t('workspaceSettings.ai.reasoningOverrideLabel', { agent: TAB_LABEL[tab] })}
                    className={inputClass}
                    value={form.reasoning === null ? 'auto' : form.reasoning ? 'enabled' : 'disabled'}
                    onChange={(event) => setForm({
                      ...form,
                      reasoning: event.target.value === 'auto' ? null : event.target.value === 'enabled',
                    })}
                  >
                    <option value="auto">{t('aiProvider.useRuntimeDefault')}</option>
                    <option value="enabled">{t('aiProvider.supportsReasoning')}</option>
                    <option value="disabled">{t('aiProvider.noReasoning')}</option>
                  </select>
                  <p className="text-[10.5px] leading-snug text-muted-foreground/80">
                    {t('workspaceSettings.ai.unknownReasoningHelp')}
                  </p>
                </div>
              </details>
            )}

          </div>

          {modelRegistration?.contextWindow === true && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{t('workspaceSettings.ai.contextWindow')}</label>
              <select
                aria-label={t('workspaceSettings.ai.contextWindowLabel', { agent: TAB_LABEL[tab] })}
                value={form.contextWindow ?? ''}
                onChange={(e) => setForm({
                  ...form,
                  contextWindow: e.target.value ? Number(e.target.value) : null,
                })}
                className={inputClass}
              >
                <option value="">
                  {selectedModelSemantics?.contextWindow
                    ? t('workspaceSettings.ai.contextAutomatic', {
                      limit: formatContextWindow(selectedModelSemantics.contextWindow),
                    })
                    : t('workspaceSettings.ai.runtimeDefaultOption')}
                </option>
                {CONTEXT_WINDOW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          )}

          {(tab === 'codex' || tab === 'opencode' || tab === 'pi') && (
            <details className="rounded-md border border-border bg-secondary/40 px-3 py-2.5">
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                {t('workspaceSettings.ai.protocolDetails')}
              </summary>
              <div className="mt-2 space-y-2 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                {tab === 'codex' ? (
                  <p>{t('workspaceSettings.ai.codexResponsesOnly')}</p>
                ) : (
                  <p>
                    {form.wireShape === 'google-generative-ai'
                      ? t('workspaceSettings.ai.googleWire')
                      : form.wireShape === 'anthropic'
                        ? t('workspaceSettings.ai.anthropicWire')
                        : form.wireShape === 'openai-responses'
                          ? t('workspaceSettings.ai.responsesWire')
                          : t('workspaceSettings.ai.chatWire')}
                  </p>
                )}
                {tab === 'pi' && <p>{t('workspaceSettings.ai.piInjection')}</p>}
                {tab === 'opencode' && <p>{t('workspaceSettings.ai.opencodeInjection')}</p>}
              </div>
            </details>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-[12px] px-3 py-2">
              {error}
            </div>
          )}
          {savedFlash && (
            <div className="rounded-md border border-success/40 bg-success/10 text-success text-[12px] px-3 py-2">
              {t('workspaceSettings.ai.saved')}
            </div>
          )}
          {offerSaveCred && (
            <div className="rounded-md border border-primary/40 bg-primary/10 text-foreground text-[12px] px-3 py-2.5 flex items-center justify-between gap-3">
              <span className="leading-snug">
                {t('workspaceSettings.ai.saveCredentialPrompt')}
              </span>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setDismissedCredentialKey(enteredApiKey)}
                  disabled={savingCred}
                  className="px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground text-[12px] disabled:opacity-40"
                >
                  {t('workspaceSettings.ai.notNow')}
                </button>
                <button
                  onClick={handleSaveCredential}
                  disabled={savingCred}
                  className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[12px] font-medium disabled:opacity-40 hover:bg-primary/90"
                >
                  {savingCred ? t('common.saving') : t('workspaceSettings.ai.saveToAlice')}
                </button>
              </div>
            </div>
          )}
          {credFlash && (
            <div className="rounded-md border border-success/40 bg-success/10 text-success text-[12px] px-3 py-2">
              {credFlash}
            </div>
          )}
          {testing && (
            <div className="rounded-md border border-border bg-secondary text-muted-foreground text-[12px] px-3 py-2">
              {t('workspaceSettings.ai.testingConnection')}
            </div>
          )}
          {!testing && result?.ok && resultMatchesCurrent && (
            <div className="rounded-md border border-success/40 bg-success/10 text-success text-[12px] px-3 py-2">
              {result.response?.trim() ? (
                <>
                  <div className="font-medium mb-0.5">
                    {t('workspaceSettings.ai.testPassed', {
                      provider: tab === 'claude'
                        ? t('workspaceSettings.ai.providerReplyClaude')
                        : tab === 'opencode' || tab === 'pi'
                          ? t('workspaceSettings.ai.providerReplyGeneric')
                          : t('workspaceSettings.ai.providerReplyOpenAi'),
                    })}
                  </div>
                  <div className="text-foreground whitespace-pre-wrap break-words font-mono text-[11.5px]">
                    {result.response.trim()}
                  </div>
                </>
              ) : (
                <div className="font-medium">{t('workspaceSettings.ai.testPassedNoText')}</div>
              )}
            </div>
          )}
          {!testing && result && !result.ok && resultMatchesCurrent && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-[12px] px-3 py-2">
              <div className="font-medium mb-0.5">{t('workspaceSettings.ai.testFailed')}</div>
              <div className="whitespace-pre-wrap break-words font-mono text-[11.5px]">
                {result.error}
              </div>
            </div>
          )}
          {!testing && result && !resultMatchesCurrent && (
            <div className="rounded-md border border-warning/30 bg-warning/5 text-warning/90 text-[12px] px-3 py-2">
              {t('workspaceSettings.ai.formChanged')}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground/80 leading-snug pt-1">
            {t('workspaceSettings.ai.changesHelp')}
          </p>
        </div>

        {/* Footer */}
        <div
          data-testid="workspace-settings-ai-footer"
          className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-secondary/30 px-3 py-2.5"
        >
          <div className="flex gap-2">
            <button
              type="button"
              aria-label={t('workspaceSettings.ai.reset')}
              onClick={handleReset}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <RotateCcw size={14} />
              <span className="hidden sm:inline">{t('workspaceSettings.ai.reset')}</span>
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="whitespace-nowrap px-3 py-2 rounded-md text-muted-foreground hover:text-foreground text-[13px]"
            >
              {t('common.cancel')}
            </button>
            {/* Single primary CTA that walks the connection gate. Managed
                transport/auth/model changes show Test first; native-login
                model/effort and local runtime metadata save directly. */}
            {needsTest ? (
              <button
                onClick={handleTest}
                disabled={!canTest || testing || saving}
                title={!canTest ? t('workspaceSettings.ai.fillRequired') : undefined}
                className="whitespace-nowrap px-4 py-2 rounded-md bg-primary text-primary-foreground text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
              >
                {testing ? t('common.testing') : t('common.test')}
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving || !dirty}
                className="whitespace-nowrap px-4 py-2 rounded-md bg-primary text-primary-foreground text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
              >
                {saving ? t('common.saving') : t('common.save')}
              </button>
            )}
          </div>
        </div>
              </div>
            )}

            {section === 'launch' && (
              <WorkspaceLaunchConfigurationPanel
                wsId={wsId}
                agents={agents.map((agent) => agent.id)}
                workspaceDefaultAgent={workspace?.defaultAgent}
                installationDefaultAgent={defaultAgent}
                initialAgent={workspace?.defaultAgent ?? initialAgent}
                onSaveDefaultAgent={(agent) => saveWorkspaceMetadata(wsId, { defaultAgent: agent })}
              />
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
