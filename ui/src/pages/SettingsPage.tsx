import { useState, useEffect, useCallback, useRef } from 'react'
import { api, type AppConfig } from '../api'
import { Toggle } from '../components/Toggle'

const SECTIONS = [
  { id: 'ai-provider', label: 'AI Provider' },
  { id: 'agent', label: 'Agent' },
  { id: 'model', label: 'Model' },
  { id: 'connectivity', label: 'Connectivity' },
  { id: 'compaction', label: 'Compaction' },
  { id: 'heartbeat', label: 'Heartbeat' },
]

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)
  const [activeSection, setActiveSection] = useState('ai-provider')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.config.load().then(setConfig).catch(() => showToast('Failed to load config', true))
  }, [])

  // Track active section via IntersectionObserver
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !config) return

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost intersecting entry
        let topmost: IntersectionObserverEntry | null = null
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!topmost || entry.boundingClientRect.top < topmost.boundingClientRect.top) {
              topmost = entry
            }
          }
        }
        if (topmost) setActiveSection(topmost.target.id)
      },
      { root: container, rootMargin: '0px 0px -60% 0px', threshold: 0 },
    )

    for (const { id } of SECTIONS) {
      const el = container.querySelector(`#${id}`)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [config])

  const scrollToSection = (id: string) => {
    setActiveSection(id)
    const el = scrollRef.current?.querySelector(`#${id}`)
    el?.scrollIntoView({ behavior: 'smooth' })
  }

  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null)

  const showToast = useCallback((msg: string, error = false) => {
    setToast({ msg, error })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2000)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  const handleProviderSwitch = useCallback(
    async (provider: string) => {
      try {
        await api.config.setProvider(provider)
        setConfig((c) => (c ? { ...c, aiProvider: provider } : c))
        showToast(`Provider: ${provider === 'claude-code' ? 'Claude Code' : 'Vercel AI SDK'}`)
      } catch {
        showToast('Failed to switch provider', true)
      }
    },
    [showToast],
  )

  const saveSection = useCallback(
    async (section: string, data: unknown, label: string) => {
      try {
        await api.config.updateSection(section, data)
        showToast(`${label} updated`)
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Save failed', true)
      }
    },
    [showToast],
  )

  // Visible sections based on config
  const visibleSections = config
    ? SECTIONS.filter((s) => s.id !== 'model' || config.aiProvider === 'vercel-ai-sdk')
    : []

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Page header + section nav */}
      <div className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 py-4">
          <h2 className="text-base font-semibold text-text">Settings</h2>
        </div>
        <div className="flex gap-1 px-4 md:px-6 pb-3 overflow-x-auto">
          {visibleSections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollToSection(s.id)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                activeSection === s.id
                  ? 'bg-bg-tertiary text-text'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {config && (
          <div className="max-w-[640px] space-y-8">
            {/* AI Provider */}
            <Section id="ai-provider" title="AI Provider" description="Runtime switch between AI backends. Claude Code calls the local CLI with file and Bash access; Vercel AI SDK calls the API directly using the model configured below. Changes take effect immediately.">
              <div className="flex border border-border rounded-lg overflow-hidden">
                {(['claude-code', 'vercel-ai-sdk'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => handleProviderSwitch(p)}
                    className={`flex-1 py-2 px-3 text-[13px] font-medium transition-colors ${
                      config.aiProvider === p
                        ? 'bg-accent-dim text-accent'
                        : 'bg-bg text-text-muted hover:bg-bg-tertiary hover:text-text'
                    } ${p === 'vercel-ai-sdk' ? 'border-l border-border' : ''}`}
                  >
                    {p === 'claude-code' ? 'Claude Code' : 'Vercel AI SDK'}
                  </button>
                ))}
              </div>
            </Section>

            {/* Agent */}
            <Section id="agent" title="Agent" description="Controls file-system and tool permissions for the AI. Changes apply on the next request.">
              <div className="flex items-center justify-between">
                <div className="flex-1 mr-3">
                  <span className="text-sm">
                    Evolution Mode: {config.agent?.evolutionMode ? 'Enabled' : 'Disabled'}
                  </span>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {config.agent?.evolutionMode
                      ? 'Full project access — AI can modify source code'
                      : 'Sandbox mode — AI can only edit data/brain/'}
                  </p>
                </div>
                <Toggle
                  checked={config.agent?.evolutionMode || false}
                  onChange={async (v) => {
                    const agentData = { ...config.agent, evolutionMode: v }
                    await saveSection('agent', agentData, 'Evolution Mode')
                    setConfig((c) => c ? { ...c, agent: { ...c.agent, evolutionMode: v } } : c)
                  }}
                />
              </div>
            </Section>

            {/* Model (only for Vercel AI SDK) */}
            {config.aiProvider === 'vercel-ai-sdk' && (
              <Section id="model" title="Model" description="Model and API keys for Vercel AI SDK. Supports Anthropic, OpenAI, and Google. Changes take effect on the next request (hot-reload).">
                <ModelForm config={config} onSave={saveSection} showToast={showToast} />
              </Section>
            )}

            {/* Connectivity */}
            <Section id="connectivity" title="Connectivity" description="MCP server ports for external agent integration. Tool port exposes trading, analysis and other tools; Ask port provides a multi-turn conversation interface. Leave empty to disable. Restart required after changes.">
              <ConnectivityForm config={config} onSave={saveSection} />
            </Section>

            {/* Compaction */}
            <Section id="compaction" title="Compaction" description="Context window management. When conversation size approaches Max Context minus Max Output tokens, older messages are automatically summarized to free up space. Set Max Context to match your model's context limit.">
              <CompactionForm config={config} onSave={saveSection} />
            </Section>

            {/* Heartbeat */}
            <Section id="heartbeat" title="Heartbeat" description="Periodic self-check. Alice reviews markets, news and alerts at the configured interval, and only pushes a notification when there's something worth your attention. Interval format: 30m, 1h, 6h.">
              <HeartbeatForm config={config} onSave={saveSection} showToast={showToast} />
            </Section>

          </div>
        )}
      </div>

      {/* Toast */}
      <div
        className={`fixed bottom-20 left-1/2 -translate-x-1/2 bg-bg-tertiary text-text border border-border px-4 py-2 rounded-lg text-[13px] z-[200] transition-all duration-300 pointer-events-none ${
          toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
        } ${toast?.error ? 'border-red text-red' : ''}`}
      >
        {toast?.msg}
      </div>
    </div>
  )
}

// ==================== Shared Components ====================

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <div id={id}>
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-3">
        {title}
      </h3>
      {description && (
        <p className="text-[12px] text-text-muted mb-3 -mt-1">{description}</p>
      )}
      {children}
    </div>
  )
}

function SaveButton({ onClick, label = 'Save' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="bg-user-bubble text-white rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-opacity hover:opacity-85 mt-1"
    >
      {label}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-[13px] text-text-muted mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputClass =
  'w-full px-2.5 py-2 bg-bg text-text border border-border rounded-md font-sans text-sm outline-none transition-colors focus:border-accent'

// ==================== Form Sections ====================

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
]

function ModelForm({
  config,
  onSave,
  showToast,
}: {
  config: AppConfig
  onSave: (section: string, data: unknown, label: string) => void
  showToast: (msg: string, error?: boolean) => void
}) {
  const [provider, setProvider] = useState(config.model?.provider || 'anthropic')
  const [model, setModel] = useState(config.model?.model || '')
  const [customModel, setCustomModel] = useState('')
  const [showKeys, setShowKeys] = useState(false)
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({})
  const [keys, setKeys] = useState({ anthropic: '', openai: '', google: '' })
  const [savingKeys, setSavingKeys] = useState(false)

  // Check if current model is in the preset list
  const presets = PROVIDER_MODELS[provider] || []
  const isCustom = model !== '' && !presets.some((p) => p.value === model)

  // Load API key status on mount
  useEffect(() => {
    api.apiKeys.status().then(setKeyStatus).catch(() => {})
  }, [])

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider)
    const defaults = PROVIDER_MODELS[newProvider]
    if (defaults?.length) {
      setModel(defaults[0].value)
      setCustomModel('')
    } else {
      setModel('')
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

  const effectiveModel = isCustom || model === '' ? customModel || model : model

  const handleSaveKeys = async () => {
    setSavingKeys(true)
    try {
      // Only send non-empty keys
      const payload: Record<string, string> = {}
      if (keys.anthropic) payload.anthropic = keys.anthropic
      if (keys.openai) payload.openai = keys.openai
      if (keys.google) payload.google = keys.google
      await api.apiKeys.save(payload)
      // Refresh status
      const status = await api.apiKeys.status()
      setKeyStatus(status)
      setKeys({ anthropic: '', openai: '', google: '' })
      showToast('API keys saved')
    } catch {
      showToast('Failed to save API keys', true)
    } finally {
      setSavingKeys(false)
    }
  }

  return (
    <>
      <Field label="Provider">
        <div className="flex border border-border rounded-lg overflow-hidden">
          {PROVIDERS.map((p) => (
            <button
              key={p.value}
              onClick={() => handleProviderChange(p.value)}
              className={`flex-1 py-2 px-3 text-[13px] font-medium transition-colors ${
                provider === p.value
                  ? 'bg-accent-dim text-accent'
                  : 'bg-bg text-text-muted hover:bg-bg-tertiary hover:text-text'
              } ${p.value !== 'anthropic' ? 'border-l border-border' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Model">
        <select
          className={inputClass}
          value={isCustom || model === '' ? '__custom__' : model}
          onChange={(e) => handleModelSelect(e.target.value)}
        >
          {presets.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
          <option value="__custom__">Custom...</option>
        </select>
      </Field>

      {(isCustom || model === '') && (
        <Field label="Custom Model ID">
          <input
            className={inputClass}
            value={customModel || model}
            onChange={(e) => { setCustomModel(e.target.value); setModel(e.target.value) }}
            placeholder="e.g. claude-sonnet-4-5-20250929"
          />
        </Field>
      )}

      <SaveButton onClick={() => onSave('model', { provider, model: effectiveModel }, 'Model')} />

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
            ({Object.values(keyStatus).filter(Boolean).length}/{Object.keys(keyStatus).length} configured)
          </span>
        </button>

        {showKeys && (
          <div className="mt-3 space-y-3">
            <p className="text-[11px] text-text-muted">
              Enter API keys below. Leave empty to keep existing value. Keys are stored in config JSON (not env vars).
            </p>
            {PROVIDERS.map((p) => (
              <Field key={p.value} label={`${p.label} API Key`}>
                <div className="relative">
                  <input
                    className={inputClass}
                    type="password"
                    value={keys[p.value as keyof typeof keys]}
                    onChange={(e) => setKeys((k) => ({ ...k, [p.value]: e.target.value }))}
                    placeholder={keyStatus[p.value] ? '(configured)' : 'Not configured'}
                  />
                  {keyStatus[p.value] && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-green">
                      active
                    </span>
                  )}
                </div>
              </Field>
            ))}
            <button
              onClick={handleSaveKeys}
              disabled={savingKeys}
              className="bg-user-bubble text-white rounded-lg px-4 py-2 text-[13px] font-medium cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {savingKeys ? 'Saving...' : 'Save Keys'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function CompactionForm({
  config,
  onSave,
}: {
  config: AppConfig
  onSave: (section: string, data: unknown, label: string) => void
}) {
  const [ctx, setCtx] = useState(String(config.compaction?.maxContextTokens || ''))
  const [out, setOut] = useState(String(config.compaction?.maxOutputTokens || ''))

  return (
    <>
      <Field label="Max Context Tokens">
        <input className={inputClass} type="number" step={1000} value={ctx} onChange={(e) => setCtx(e.target.value)} />
      </Field>
      <Field label="Max Output Tokens">
        <input className={inputClass} type="number" step={1000} value={out} onChange={(e) => setOut(e.target.value)} />
      </Field>
      <SaveButton
        onClick={() =>
          onSave('compaction', { maxContextTokens: Number(ctx), maxOutputTokens: Number(out) }, 'Compaction')
        }
      />
    </>
  )
}

function ConnectivityForm({
  config,
  onSave,
}: {
  config: AppConfig
  onSave: (section: string, data: unknown, label: string) => void
}) {
  const eng = config.engine as Record<string, unknown>
  const [mcpPort, setMcpPort] = useState(String(eng.mcpPort ?? ''))
  const [askMcpPort, setAskMcpPort] = useState(String(eng.askMcpPort ?? ''))

  return (
    <>
      <Field label="MCP Port (tools)">
        <input className={inputClass} type="number" value={mcpPort} onChange={(e) => setMcpPort(e.target.value)} placeholder="Disabled" />
      </Field>
      <Field label="Ask MCP Port (connector)">
        <input className={inputClass} type="number" value={askMcpPort} onChange={(e) => setAskMcpPort(e.target.value)} placeholder="Disabled" />
      </Field>
      <SaveButton
        onClick={() => {
          const patch = { ...eng }
          if (mcpPort) patch.mcpPort = Number(mcpPort); else delete patch.mcpPort
          if (askMcpPort) patch.askMcpPort = Number(askMcpPort); else delete patch.askMcpPort
          onSave('engine', patch, 'Connectivity')
        }}
      />
    </>
  )
}

function HeartbeatForm({
  config,
  onSave,
  showToast,
}: {
  config: AppConfig
  onSave: (section: string, data: unknown, label: string) => void
  showToast: (msg: string, error?: boolean) => void
}) {
  const [hbEnabled, setHbEnabled] = useState(config.heartbeat?.enabled || false)
  const [hbEvery, setHbEvery] = useState(config.heartbeat?.every || '30m')

  // Sync enabled state from API on mount (may differ from config if toggled on Events page)
  useEffect(() => {
    api.heartbeat.status().then(({ enabled }) => setHbEnabled(enabled)).catch(() => {})
  }, [])

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm">Enabled</span>
        <Toggle
          checked={hbEnabled}
          onChange={async (v) => {
            try {
              await api.heartbeat.setEnabled(v)
              setHbEnabled(v)
              showToast(`Heartbeat ${v ? 'enabled' : 'disabled'}`)
            } catch {
              showToast('Failed to toggle heartbeat', true)
            }
          }}
        />
      </div>
      <Field label="Interval">
        <input className={inputClass} value={hbEvery} onChange={(e) => setHbEvery(e.target.value)} placeholder="30m" />
      </Field>
      <SaveButton
        onClick={() =>
          onSave('heartbeat', { ...config.heartbeat, every: hbEvery }, 'Heartbeat interval')
        }
      />
    </>
  )
}
