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
  wireApi: 'chat' | 'responses'
  // Claude-only: which header carries the key. 'x-api-key' is Anthropic's
  // first-party default; 'bearer' (Authorization: Bearer) is what most
  // anthropic-compatible gateways want — MiniMax's international endpoint
  // (api.minimax.io) only accepts Bearer, which is why x-api-key 401s there.
  authMode: 'x-api-key' | 'bearer'
}

// codex-cli ≥ 0.130 hard-rejects `wire_api = "chat"`. The AgentConfig schema
// still carries `wireApi` (the backend writer / file IO is shared with other
// codex-shaped configs), but this modal locks it to "responses" for every
// codex provider — a stale 'chat' loaded from disk is normalized on display,
// so the next Save silently corrects it.
// Ref: github.com/openai/codex/discussions/7782
const EMPTY_FORM: FormState = { baseUrl: '', apiKey: '', model: '', wireApi: 'responses', authMode: 'x-api-key' }

function configToForm(cfg: AgentConfig | null): FormState {
  if (!cfg) return EMPTY_FORM
  return {
    baseUrl: cfg.baseUrl ?? '',
    apiKey: cfg.apiKey ?? '',
    model: cfg.model ?? '',
    wireApi: 'responses',
    authMode: cfg.authMode === 'bearer' ? 'bearer' : 'x-api-key',
  }
}

function formToConfig(form: FormState, agent: AgentId): AgentConfig {
  const cfg: AgentConfig = {
    baseUrl: form.baseUrl.trim() || null,
    apiKey: form.apiKey.trim() || null,
    model: form.model.trim() || null,
  }
  if (agent === 'codex') {
    return { ...cfg, wireApi: form.wireApi }
  }
  if (agent === 'claude') {
    return { ...cfg, authMode: form.authMode }
  }
  // opencode: plain baseUrl/apiKey/model — no wireApi, no authMode.
  return cfg
}

// Test result is per-tab so switching tabs doesn't lose the other agent's
// verdict, AND each result is bound to the exact form snapshot it was tested
// against — editing any field invalidates it (Save re-locks). This is the
// "test-before-save" linkage: Save only enables when the *current* form has a
// matching successful test.
interface TestResult {
  kind: 'pass' | 'fail'
  snapshot: FormState
  message: string  // model reply on pass, error on fail
}

function formsMatch(a: FormState, b: FormState, agent: AgentId): boolean {
  return (
    a.baseUrl === b.baseUrl &&
    a.apiKey === b.apiKey &&
    a.model === b.model &&
    (agent !== 'codex' || a.wireApi === b.wireApi) &&
    (agent !== 'claude' || a.authMode === b.authMode)
  )
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
  const [testing, setTesting] = useState(false)
  const [claudeResult, setClaudeResult] = useState<TestResult | null>(null)
  const [codexResult, setCodexResult] = useState<TestResult | null>(null)
  const [opencodeResult, setOpencodeResult] = useState<TestResult | null>(null)
  const [piResult, setPiResult] = useState<TestResult | null>(null)

  useEffect(() => {
    void Promise.all([listCredentials(), getAgentConfig(wsId)])
      .then(([creds, b]) => {
        setCredentials(creds)
        setBundle(b)
        setClaudeForm(configToForm(b.claude))
        setCodexForm(configToForm(b.codex))
        setOpencodeForm(configToForm(b.opencode))
        setPiForm(configToForm(b.pi))
      })
      .catch((err: Error) => setError(err.message))
  }, [wsId])

  const form = { claude: claudeForm, codex: codexForm, opencode: opencodeForm, pi: piForm }[tab]
  const setForm = { claude: setClaudeForm, codex: setCodexForm, opencode: setOpencodeForm, pi: setPiForm }[tab]
  const result = { claude: claudeResult, codex: codexResult, opencode: opencodeResult, pi: piResult }[tab]
  const setResult = { claude: setClaudeResult, codex: setCodexResult, opencode: setOpencodeResult, pi: setPiResult }[tab]
  const resultMatchesCurrent = !!result && formsMatch(result.snapshot, form, tab)
  const testPassedForCurrent = result?.kind === 'pass' && resultMatchesCurrent
  const dirty = useMemo(() => {
    if (!bundle) return false
    const saved = bundle[tab]
    const savedForm = configToForm(saved)
    return (
      savedForm.baseUrl !== form.baseUrl ||
      savedForm.apiKey !== form.apiKey ||
      savedForm.model !== form.model ||
      (tab === 'codex' && savedForm.wireApi !== form.wireApi) ||
      (tab === 'claude' && savedForm.authMode !== form.authMode)
    )
  }, [bundle, form, tab])

  const applyCredential = () => {
    const cred = credentials.find((x) => x.slug === pickedCredential)
    if (!cred) return
    // A credential carries no model — that's a per-workspace choice — so we
    // flash baseUrl + key only and leave the model field for the user.
    // Auth mode: api.minimax.io needs Bearer; default x-api-key otherwise.
    const bearer = /api\.minimax\.io/i.test(cred.baseUrl ?? '')
    setForm({
      ...form,
      baseUrl: cred.baseUrl ?? '',
      apiKey: cred.apiKey ?? '',
      authMode: bearer ? 'bearer' : 'x-api-key',
    })
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
      // only when it isn't already there (loaded-from-credential, or re-typed
      // an existing one, shouldn't re-prompt).
      const key = form.apiKey.trim()
      const url = form.baseUrl.trim()
      const known = credentials.some((c) => c.apiKey === key && (c.baseUrl ?? '') === url)
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
      setForm(EMPTY_FORM)
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

  const handleTest = async () => {
    if (!canTest) return
    // Freeze the form snapshot at click time — async race protection: if the
    // user starts editing while the request is in flight, the result we get
    // back is still bound to *what was tested*, not what's currently typed.
    const snapshot: FormState = {
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      model: form.model.trim(),
      wireApi: form.wireApi,
      authMode: form.authMode,
    }
    setTesting(true)
    try {
      const r = await testAgentConfig(wsId, tab, {
        baseUrl: snapshot.baseUrl,
        apiKey: snapshot.apiKey,
        model: snapshot.model,
        ...(tab === 'codex' ? { wireApi: snapshot.wireApi } : {}),
        ...(tab === 'claude' ? { authMode: snapshot.authMode } : {}),
      })
      setResult(
        r.ok
          ? { kind: 'pass', snapshot, message: r.response ?? '' }
          : { kind: 'fail', snapshot, message: r.error ?? 'unknown error' },
      )
    } catch (err) {
      setResult({ kind: 'fail', snapshot, message: (err as Error).message })
    } finally {
      setTesting(false)
    }
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
            <div className="flex gap-2">
              <select
                value={pickedCredential}
                onChange={(e) => setPickedCredential(e.target.value)}
                className={inputClass + ' flex-1'}
                disabled={credentials.length === 0}
              >
                <option value="">
                  {credentials.length === 0 ? '— none saved yet —' : '— select a credential —'}
                </option>
                {credentials.map((cred) => (
                  <option key={cred.slug} value={cred.slug}>
                    {cred.slug}
                    {cred.baseUrl ? ` · ${cred.baseUrl}` : ''}
                  </option>
                ))}
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
              Fills base URL + key from a credential Alice already holds. Pick a
              model below — credentials don't carry one. Or just type a new one;
              you'll be offered to save it after Test + Save.
            </p>
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
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder={tab === 'claude' ? 'claude-sonnet-4-6' : tab === 'opencode' || tab === 'pi' ? 'deepseek-chat' : 'gpt-4o'}
              className={inputClass}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
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
          {!testing && result?.kind === 'pass' && resultMatchesCurrent && (
            <div className="rounded-md border border-green/40 bg-green/10 text-green text-[12px] px-3 py-2">
              <div className="font-medium mb-0.5">
                Test passed — {tab === 'claude' ? 'Anthropic' : tab === 'opencode' || tab === 'pi' ? 'the provider' : 'OpenAI'} replied:
              </div>
              <div className="text-text whitespace-pre-wrap break-words font-mono text-[11.5px]">
                {result.message || '(empty reply)'}
              </div>
            </div>
          )}
          {!testing && result?.kind === 'fail' && resultMatchesCurrent && (
            <div className="rounded-md border border-red/40 bg-red/10 text-red text-[12px] px-3 py-2">
              <div className="font-medium mb-0.5">Test failed:</div>
              <div className="whitespace-pre-wrap break-words font-mono text-[11.5px]">
                {result.message}
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
