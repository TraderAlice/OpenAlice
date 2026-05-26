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
import { useTranslation } from 'react-i18next'
import {
  getAgentConfig,
  listAgentProfiles,
  saveAgentConfig,
  testAgentConfig,
  type AgentConfig,
  type AgentConfigBundle,
  type AgentId,
  type AgentProfile,
} from './api'

interface Props {
  wsId: string
  onClose: () => void
}

const inputClass =
  'w-full bg-bg-secondary border border-border rounded-md px-3 py-2 text-[13px] text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent'

type Tab = 'claude' | 'codex'

interface FormState {
  baseUrl: string
  apiKey: string
  model: string
  wireApi: 'chat' | 'responses'
}

// codex-cli ≥ 0.130 hard-rejects `wire_api = "chat"`. The AgentConfig schema
// still carries `wireApi` (the backend writer / file IO is shared with other
// codex-shaped configs), but this modal locks it to "responses" for every
// codex provider — a stale 'chat' loaded from disk is normalized on display,
// so the next Save silently corrects it.
// Ref: github.com/openai/codex/discussions/7782
const EMPTY_FORM: FormState = { baseUrl: '', apiKey: '', model: '', wireApi: 'responses' }

function configToForm(cfg: AgentConfig | null): FormState {
  if (!cfg) return EMPTY_FORM
  return {
    baseUrl: cfg.baseUrl ?? '',
    apiKey: cfg.apiKey ?? '',
    model: cfg.model ?? '',
    wireApi: 'responses',
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
    (agent !== 'codex' || a.wireApi === b.wireApi)
  )
}

export function WorkspaceAIConfigModal({ wsId, onClose }: Props) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('claude')
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [bundle, setBundle] = useState<AgentConfigBundle | null>(null)
  const [claudeForm, setClaudeForm] = useState<FormState>(EMPTY_FORM)
  const [codexForm, setCodexForm] = useState<FormState>(EMPTY_FORM)
  const [pickedProfile, setPickedProfile] = useState<string>('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [testing, setTesting] = useState(false)
  const [claudeResult, setClaudeResult] = useState<TestResult | null>(null)
  const [codexResult, setCodexResult] = useState<TestResult | null>(null)

  useEffect(() => {
    void Promise.all([listAgentProfiles(), getAgentConfig(wsId)])
      .then(([ps, b]) => {
        setProfiles(ps)
        setBundle(b)
        setClaudeForm(configToForm(b.claude))
        setCodexForm(configToForm(b.codex))
      })
      .catch((err: Error) => setError(err.message))
  }, [wsId])

  const form = tab === 'claude' ? claudeForm : codexForm
  const setForm = tab === 'claude' ? setClaudeForm : setCodexForm
  const result = tab === 'claude' ? claudeResult : codexResult
  const setResult = tab === 'claude' ? setClaudeResult : setCodexResult
  const resultMatchesCurrent = !!result && formsMatch(result.snapshot, form, tab)
  const testPassedForCurrent = result?.kind === 'pass' && resultMatchesCurrent
  const dirty = useMemo(() => {
    if (!bundle) return false
    const saved = tab === 'claude' ? bundle.claude : bundle.codex
    const savedForm = configToForm(saved)
    return (
      savedForm.baseUrl !== form.baseUrl ||
      savedForm.apiKey !== form.apiKey ||
      savedForm.model !== form.model ||
      (tab === 'codex' && savedForm.wireApi !== form.wireApi)
    )
  }, [bundle, form, tab])

  const applyProfile = () => {
    const p = profiles.find((x) => x.name === pickedProfile)
    if (!p) return
    setForm({
      ...form,
      baseUrl: p.baseUrl ?? '',
      apiKey: p.apiKey ?? '',
      model: p.model ?? '',
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
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setError(null)
    setSaving(true)
    try {
      await saveAgentConfig(wsId, tab, { baseUrl: null, apiKey: null, model: null })
      const fresh = await getAgentConfig(wsId)
      setBundle(fresh)
      if (tab === 'claude') setClaudeForm(EMPTY_FORM)
      else setCodexForm(EMPTY_FORM)
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
    }
    setTesting(true)
    try {
      const r = await testAgentConfig(wsId, tab, {
        baseUrl: snapshot.baseUrl,
        apiKey: snapshot.apiKey,
        model: snapshot.model,
        ...(tab === 'codex' ? { wireApi: snapshot.wireApi } : {}),
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
          <h2 className="text-[15px] font-semibold text-text">{t('workspaceAI.title', 'Workspace AI Provider')}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-bg-secondary/50">
          {(['claude', 'codex'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 px-4 py-2.5 text-[13px] font-medium transition-colors ${
                tab === id
                  ? 'text-accent border-b-2 border-accent -mb-px'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {id === 'claude' ? t('workspaceAI.claudeCode', 'Claude Code') : t('workspaceAI.codex', 'Codex')}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Quick pick */}
          <div className="rounded-lg border border-border bg-bg-secondary/30 p-3">
            <label className="block text-xs font-medium text-text-muted mb-2">
              {t('workspaceAI.applyFromProfile', 'Apply from OpenAlice profile')}
            </label>
            <div className="flex gap-2">
              <select
                value={pickedProfile}
                onChange={(e) => setPickedProfile(e.target.value)}
                className={inputClass + ' flex-1'}
              >
                <option value="">{t('workspaceAI.selectProfile', '— select a profile —')}</option>
                {profiles.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={applyProfile}
                disabled={!pickedProfile}
                className="px-3 py-2 rounded-md bg-accent text-bg text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
              >
                {t('workspaceAI.apply', 'Apply')}
              </button>
            </div>
          </div>

          {/* Manual fields */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">{t('workspaceAI.baseUrl', 'Base URL')}</label>
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder={tab === 'claude' ? 'https://api.anthropic.com (default)' : 'https://api.openai.com/v1 (default)'}
              className={inputClass}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">{t('workspaceAI.apiKey', 'API Key')}</label>
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
                {showKey ? t('workspaceAI.hide', 'Hide') : t('workspaceAI.show', 'Show')}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">{t('workspaceAI.model', 'Model')}</label>
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder={tab === 'claude' ? 'claude-sonnet-4-6' : 'gpt-4o'}
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

          {error && (
            <div className="rounded-md border border-red/40 bg-red/10 text-red text-[12px] px-3 py-2">
              {error}
            </div>
          )}
          {savedFlash && (
            <div className="rounded-md border border-green/40 bg-green/10 text-green text-[12px] px-3 py-2">
              {t('workspaceAI.savedFlash', 'Saved. Pause + resume any open session to reload.')}
            </div>
          )}
          {testing && (
            <div className="rounded-md border border-border bg-bg-secondary text-text-muted text-[12px] px-3 py-2">
              {t('workspaceAI.testing', 'Testing…')}
            </div>
          )}
          {!testing && result?.kind === 'pass' && resultMatchesCurrent && (
            <div className="rounded-md border border-green/40 bg-green/10 text-green text-[12px] px-3 py-2">
              <div className="font-medium mb-0.5">
                {t('workspaceAI.testPassed', 'Test passed — {{provider}} replied:', { provider: tab === 'claude' ? 'Anthropic' : 'OpenAI' })}
              </div>
              <div className="text-text whitespace-pre-wrap break-words font-mono text-[11.5px]">
                {result.message || '(empty reply)'}
              </div>
            </div>
          )}
          {!testing && result?.kind === 'fail' && resultMatchesCurrent && (
            <div className="rounded-md border border-red/40 bg-red/10 text-red text-[12px] px-3 py-2">
              <div className="font-medium mb-0.5">{t('workspaceAI.testFailed', 'Test failed:')}</div>
              <div className="whitespace-pre-wrap break-words font-mono text-[11.5px]">
                {result.message}
              </div>
            </div>
          )}
          {!testing && result && !resultMatchesCurrent && (
            <div className="rounded-md border border-yellow-400/30 bg-yellow-400/5 text-yellow-400/90 text-[12px] px-3 py-2">
              {t('workspaceAI.formChanged', 'Form changed since last test — re-test before saving.')}
            </div>
          )}

          <p className="text-[11px] text-text-muted/80 leading-snug pt-1">
            {t('workspaceAI.emptyFieldsFallback', 'Empty fields fall back to the CLI\'s global default. Changes apply to new sessions; pause and resume any open session to re-load.')}
            {tab === 'claude' && ' Claude reads `.claude/settings.local.json` from the workspace cwd.'}
            {tab === 'codex' && ' Codex reads `.codex/config.toml` + `.codex/env.json` (via CODEX_HOME).'}
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
              {t('workspaceAI.resetToGlobal', 'Reset to global default')}
            </button>
            <button
              onClick={handleTest}
              disabled={!canTest || testing || saving}
              title={!canTest ? 'Fill base URL, API key, and model first' : undefined}
              className="px-3 py-2 rounded-md border border-border text-text-muted hover:text-text text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testing ? t('workspaceAI.testing', 'Testing…') : t('workspaceAI.test', 'Test')}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3 py-2 rounded-md text-text-muted hover:text-text text-[13px]"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !dirty || !testPassedForCurrent}
              title={
                !dirty
                  ? undefined
                  : !testPassedForCurrent
                  ? t('workspaceAI.testBeforeSave', 'Click Test and get a passing reply before saving')
                  : undefined
              }
              className="px-4 py-2 rounded-md bg-accent text-bg text-[13px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
            >
              {saving ? t('workspaceAI.saving', 'Saving…') : t('common.save', 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
