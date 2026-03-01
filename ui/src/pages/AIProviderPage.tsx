import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { api, type AppConfig, type AIProviderConfig } from '../api'
import { SaveIndicator } from '../components/SaveIndicator'
import { Section, Field, inputClass } from '../components/form'
import { useAutoSave, type SaveStatus } from '../hooks/useAutoSave'

const PROVIDER_MODELS: Record<string, { label: string; value: string }[]> = {
  anthropic: [
    { label: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
    { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
    { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
  ],
  openai: [
    { label: 'GPT-5.2 Pro', value: 'gpt-5.2-pro' },
    { label: 'GPT-5.2', value: 'gpt-5.2' },
    { label: 'GPT-5 Mini', value: 'gpt-5-mini' },
  ],
  google: [
    { label: 'Gemini 3.1 Pro', value: 'gemini-3.1-pro-preview' },
    { label: 'Gemini 3 Flash', value: 'gemini-3-flash-preview' },
    { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
  ],
}

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'custom', label: 'Custom' },
]

const SDK_FORMATS = [
  { value: 'openai', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic Compatible' },
  { value: 'google', label: 'Google Compatible' },
]

/** Detect whether saved config should show as "Custom" in the UI. */
function detectCustomMode(provider: string, model: string): boolean {
  const presets = PROVIDER_MODELS[provider]
  if (!presets) return true
  return !presets.some((p) => p.value === model)
}

export function AIProviderPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    api.config.load().then(setConfig).catch(() => {})
  }, [])

  const handleBackendSwitch = useCallback(
    async (backend: string) => {
      try {
        await api.config.setBackend(backend)
        setConfig((c) => c ? { ...c, aiProvider: { ...c.aiProvider, backend } } : c)
      } catch {
        // Button state reflects actual saved state
      }
    },
    [],
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 py-4">
          <h2 className="text-base font-semibold text-text">AI Provider</h2>
          <p className="text-[12px] text-text-muted mt-0.5">Configure the AI backend, model, and API keys.</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {config && (
          <div className="max-w-[640px] space-y-8">
            {/* Backend */}
            <Section id="backend" title="Backend" description="Runtime switch between AI backends. Claude Code calls the local CLI; Vercel AI SDK calls the API directly. Changes take effect immediately.">
              <div className="flex border border-border rounded-lg overflow-hidden">
                {(['claude-code', 'vercel-ai-sdk'] as const).map((b) => (
                  <button
                    key={b}
                    onClick={() => handleBackendSwitch(b)}
                    className={`flex-1 py-2 px-3 text-[13px] font-medium transition-colors ${
                      config.aiProvider.backend === b
                        ? 'bg-accent-dim text-accent'
                        : 'bg-bg text-text-muted hover:bg-bg-tertiary hover:text-text'
                    } ${b === 'vercel-ai-sdk' ? 'border-l border-border' : ''}`}
                  >
                    {b === 'claude-code' ? 'Claude Code' : 'Vercel AI SDK'}
                  </button>
                ))}
              </div>
            </Section>

            {/* Model (only for Vercel AI SDK) */}
            {config.aiProvider.backend === 'vercel-ai-sdk' && (
              <Section id="model" title="Model" description="Provider, model, and API keys for Vercel AI SDK. Changes take effect on the next request (hot-reload).">
                <ModelForm aiProvider={config.aiProvider} />
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ==================== Model Form ====================

function ModelForm({ aiProvider }: { aiProvider: AIProviderConfig }) {
  // Detect whether saved config should render as "Custom" in the UI
  const initCustom = detectCustomMode(aiProvider.provider || 'anthropic', aiProvider.model || '')
  const [uiProvider, setUiProvider] = useState(initCustom ? 'custom' : (aiProvider.provider || 'anthropic'))
  const [sdkProvider, setSdkProvider] = useState(aiProvider.provider || 'openai')
  const [model, setModel] = useState(aiProvider.model || '')
  const [customModel, setCustomModel] = useState(initCustom ? (aiProvider.model || '') : '')
  const [baseUrl, setBaseUrl] = useState(aiProvider.baseUrl || '')
  const [showKeys, setShowKeys] = useState(false)
  const [keys, setKeys] = useState({ anthropic: '', openai: '', google: '' })
  const [keySaveStatus, setKeySaveStatus] = useState<SaveStatus>('idle')
  const keySavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isCustomMode = uiProvider === 'custom'
  const effectiveProvider = isCustomMode ? sdkProvider : uiProvider
  const presets = PROVIDER_MODELS[uiProvider] || []
  const isCustomModelInStandard = !isCustomMode && model !== '' && !presets.some((p) => p.value === model)
  const effectiveModel = isCustomMode
    ? customModel
    : (isCustomModelInStandard ? customModel || model : model)

  // Auto-save model/provider/baseUrl (but NOT apiKeys — those use manual save)
  const modelData = useMemo(
    () => ({
      ...aiProvider,
      provider: effectiveProvider,
      model: effectiveModel,
      ...(baseUrl ? { baseUrl } : { baseUrl: undefined }),
    }),
    [aiProvider, effectiveProvider, effectiveModel, baseUrl],
  )

  const saveModel = useCallback(async (data: Record<string, unknown>) => {
    await api.config.updateSection('aiProvider', data)
  }, [])

  const { status: modelStatus, retry: modelRetry } = useAutoSave({
    data: modelData,
    save: saveModel,
  })

  // Derive key status from aiProvider config
  const keyStatus = useMemo(() => ({
    anthropic: !!aiProvider.apiKeys?.anthropic,
    openai: !!aiProvider.apiKeys?.openai,
    google: !!aiProvider.apiKeys?.google,
  }), [aiProvider.apiKeys])

  const [liveKeyStatus, setLiveKeyStatus] = useState(keyStatus)

  useEffect(() => setLiveKeyStatus(keyStatus), [keyStatus])

  useEffect(() => () => {
    if (keySavedTimer.current) clearTimeout(keySavedTimer.current)
  }, [])

  const handleProviderChange = (newUiProvider: string) => {
    setUiProvider(newUiProvider)
    setBaseUrl('')
    if (newUiProvider === 'custom') {
      setSdkProvider('openai')
      setModel('')
      setCustomModel('')
    } else {
      setSdkProvider(newUiProvider)
      const defaults = PROVIDER_MODELS[newUiProvider]
      if (defaults?.length) {
        setModel(defaults[0].value)
        setCustomModel('')
      } else {
        setModel('')
      }
    }
  }

  const handleModelSelect = (value: string) => {
    if (value === '__custom__') {
      setModel('')
      setCustomModel('')
    } else {
      setModel(value)
      setCustomModel('')
    }
  }

  const handleSaveKeys = async () => {
    setKeySaveStatus('saving')
    try {
      // Merge new keys into current aiProvider config
      const updatedKeys = { ...aiProvider.apiKeys }
      if (keys.anthropic) updatedKeys.anthropic = keys.anthropic
      if (keys.openai) updatedKeys.openai = keys.openai
      if (keys.google) updatedKeys.google = keys.google
      await api.config.updateSection('aiProvider', { ...modelData, apiKeys: updatedKeys })
      setLiveKeyStatus({
        anthropic: !!updatedKeys.anthropic,
        openai: !!updatedKeys.openai,
        google: !!updatedKeys.google,
      })
      setKeys({ anthropic: '', openai: '', google: '' })
      setKeySaveStatus('saved')
      if (keySavedTimer.current) clearTimeout(keySavedTimer.current)
      keySavedTimer.current = setTimeout(() => setKeySaveStatus('idle'), 2000)
    } catch {
      setKeySaveStatus('error')
    }
  }

  return (
    <>
      <Field label="Provider">
        <div className="flex border border-border rounded-lg overflow-hidden">
          {PROVIDERS.map((p, i) => (
            <button
              key={p.value}
              onClick={() => handleProviderChange(p.value)}
              className={`flex-1 py-2 px-3 text-[13px] font-medium transition-colors ${
                uiProvider === p.value
                  ? 'bg-accent-dim text-accent'
                  : 'bg-bg text-text-muted hover:bg-bg-tertiary hover:text-text'
              } ${i > 0 ? 'border-l border-border' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      {/* Custom mode: API format selector */}
      {isCustomMode && (
        <Field label="API Format">
          <select
            className={inputClass}
            value={sdkProvider}
            onChange={(e) => setSdkProvider(e.target.value)}
          >
            {SDK_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-text-muted mt-1">
            Which API protocol does your endpoint speak?
          </p>
        </Field>
      )}

      {/* Standard mode: preset model dropdown */}
      {!isCustomMode && (
        <Field label="Model">
          <select
            className={inputClass}
            value={isCustomModelInStandard || model === '' ? '__custom__' : model}
            onChange={(e) => handleModelSelect(e.target.value)}
          >
            {presets.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
            <option value="__custom__">Custom...</option>
          </select>
        </Field>
      )}

      {/* Free-text model ID — always shown in custom mode, or when "Custom..." selected in standard mode */}
      {(isCustomMode || isCustomModelInStandard || (!isCustomMode && model === '')) && (
        <Field label={isCustomMode ? 'Model ID' : 'Custom Model ID'}>
          <input
            className={inputClass}
            value={customModel || model}
            onChange={(e) => { setCustomModel(e.target.value); setModel(e.target.value) }}
            placeholder={isCustomMode ? 'e.g. gpt-4o, claude-3-opus' : 'e.g. claude-sonnet-4-5-20250929'}
          />
        </Field>
      )}

      <Field label="Base URL">
        <input
          className={inputClass}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={isCustomMode ? 'https://your-relay.example.com/v1' : 'Leave empty for official API'}
        />
        <p className="text-[11px] text-text-muted mt-1">
          {isCustomMode ? 'Your relay or proxy endpoint.' : 'Custom endpoint for proxy or relay.'}
        </p>
      </Field>

      <SaveIndicator status={modelStatus} onRetry={modelRetry} />

      {/* API Keys */}
      <div className="mt-5 border-t border-border pt-4">
        <button
          onClick={() => setShowKeys(!showKeys)}
          className="flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text transition-colors"
        >
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${showKeys ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          API Keys
          <span className="text-[11px] text-text-muted/60 ml-1">
            ({Object.values(liveKeyStatus).filter(Boolean).length}/{Object.keys(liveKeyStatus).length} configured)
          </span>
        </button>

        {showKeys && (
          <div className="mt-3 space-y-3">
            <p className="text-[11px] text-text-muted">
              {isCustomMode
                ? 'Enter the API key for your relay. It will be sent under the matching provider header.'
                : 'Enter API keys below. Leave empty to keep existing value.'}
            </p>
            {(isCustomMode
              ? SDK_FORMATS.filter((f) => f.value === sdkProvider)
              : PROVIDERS.filter((p) => p.value !== 'custom')
            ).map((p) => (
              <Field key={p.value} label={isCustomMode ? `API Key (${p.label})` : `${p.label} API Key`}>
                <div className="relative">
                  <input
                    className={inputClass}
                    type="password"
                    value={keys[p.value as keyof typeof keys] ?? ''}
                    onChange={(e) => setKeys((k) => ({ ...k, [p.value]: e.target.value }))}
                    placeholder={liveKeyStatus[p.value as keyof typeof liveKeyStatus] ? '(configured)' : 'Not configured'}
                  />
                  {liveKeyStatus[p.value as keyof typeof liveKeyStatus] && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-green">
                      active
                    </span>
                  )}
                </div>
              </Field>
            ))}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveKeys}
                disabled={keySaveStatus === 'saving'}
                className="bg-user-bubble text-white rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-50"
              >
                Save Keys
              </button>
              <SaveIndicator status={keySaveStatus} onRetry={handleSaveKeys} />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
