import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { api, type AppConfig } from '../api'
import { Toggle } from '../components/Toggle'
import { SaveIndicator } from '../components/SaveIndicator'
import { Section, Field, inputClass } from '../components/form'
import { useAutoSave, type SaveStatus } from '../hooks/useAutoSave'

const SECTIONS = [
  { id: 'ai-provider', label: 'AI Provider' },
  { id: 'agent', label: 'Agent' },
  { id: 'model', label: 'Model' },
  { id: 'connectivity', label: 'Connectivity' },
  { id: 'compaction', label: 'Compaction' },
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'telegram', label: 'Telegram' },
]

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [activeSection, setActiveSection] = useState('ai-provider')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.config.load().then(setConfig).catch(() => {})
  }, [])

  // Track active section via IntersectionObserver
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !config) return

    const observer = new IntersectionObserver(
      (entries) => {
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

  const handleProviderSwitch = useCallback(
    async (provider: string) => {
      try {
        await api.config.setProvider(provider)
        setConfig((c) => (c ? { ...c, aiProvider: provider } : c))
      } catch {
        // Button state reflects actual saved state — no change on failure
      }
    },
    [],
  )

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
                    try {
                      await api.config.updateSection('agent', { ...config.agent, evolutionMode: v })
                      setConfig((c) => c ? { ...c, agent: { ...c.agent, evolutionMode: v } } : c)
                    } catch {
                      // Toggle doesn't flip on failure
                    }
                  }}
                />
              </div>
            </Section>

            {/* Model (only for Vercel AI SDK) */}
            {config.aiProvider === 'vercel-ai-sdk' && (
              <Section id="model" title="Model" description="Model and API keys for Vercel AI SDK. Supports Anthropic, OpenAI, and Google. Changes take effect on the next request (hot-reload).">
                <ModelForm config={config} />
              </Section>
            )}

            {/* Connectivity */}
            <Section id="connectivity" title="Connectivity" description="MCP server ports for external agent integration. Tool port exposes trading, analysis and other tools; Ask port provides a multi-turn conversation interface. Leave empty to disable. Restart required after changes.">
              <ConnectivityForm config={config} />
            </Section>

            {/* Compaction */}
            <Section id="compaction" title="Compaction" description="Context window management. When conversation size approaches Max Context minus Max Output tokens, older messages are automatically summarized to free up space. Set Max Context to match your model's context limit.">
              <CompactionForm config={config} />
            </Section>

            {/* Heartbeat */}
            <Section id="heartbeat" title="Heartbeat" description="Periodic self-check. Alice reviews markets, news and alerts at the configured interval, and only pushes a notification when there's something worth your attention. Interval format: 30m, 1h, 6h.">
              <HeartbeatForm config={config} />
            </Section>

            {/* Telegram */}
            <Section id="telegram" title="Telegram" description="Connect a Telegram bot for mobile notifications and two-way chat. Create a bot via @BotFather, paste the token below, and add your chat ID (send /start to the bot, then use @userinfobot to find your ID). Restart required.">
              <TelegramForm config={config} />
            </Section>

          </div>
        )}
      </div>
    </div>
  )
}

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

function ModelForm({ config }: { config: AppConfig }) {
  const [provider, setProvider] = useState(config.model?.provider || 'anthropic')
  const [model, setModel] = useState(config.model?.model || '')
  const [customModel, setCustomModel] = useState('')
  const [showKeys, setShowKeys] = useState(false)
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({})
  const [keys, setKeys] = useState({ anthropic: '', openai: '', google: '' })
  const [keySaveStatus, setKeySaveStatus] = useState<SaveStatus>('idle')
  const keySavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const presets = PROVIDER_MODELS[provider] || []
  const isCustom = model !== '' && !presets.some((p) => p.value === model)
  const effectiveModel = isCustom || model === '' ? customModel || model : model

  const modelData = useMemo(
    () => ({ provider, model: effectiveModel }),
    [provider, effectiveModel],
  )

  const saveModel = useCallback(async (data: { provider: string; model: string }) => {
    await api.config.updateSection('model', data)
  }, [])

  const { status: modelStatus, retry: modelRetry } = useAutoSave({
    data: modelData,
    save: saveModel,
  })

  useEffect(() => {
    api.apiKeys.status().then(setKeyStatus).catch(() => {})
  }, [])

  useEffect(() => () => {
    if (keySavedTimer.current) clearTimeout(keySavedTimer.current)
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

  const handleSaveKeys = async () => {
    setKeySaveStatus('saving')
    try {
      const payload: Record<string, string> = {}
      if (keys.anthropic) payload.anthropic = keys.anthropic
      if (keys.openai) payload.openai = keys.openai
      if (keys.google) payload.google = keys.google
      await api.apiKeys.save(payload)
      const status = await api.apiKeys.status()
      setKeyStatus(status)
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

function CompactionForm({ config }: { config: AppConfig }) {
  const [ctx, setCtx] = useState(String(config.compaction?.maxContextTokens || ''))
  const [out, setOut] = useState(String(config.compaction?.maxOutputTokens || ''))

  const data = useMemo(
    () => ({ maxContextTokens: Number(ctx), maxOutputTokens: Number(out) }),
    [ctx, out],
  )

  const save = useCallback(async (d: { maxContextTokens: number; maxOutputTokens: number }) => {
    await api.config.updateSection('compaction', d)
  }, [])

  const { status, retry } = useAutoSave({ data, save })

  return (
    <>
      <Field label="Max Context Tokens">
        <input className={inputClass} type="number" step={1000} value={ctx} onChange={(e) => setCtx(e.target.value)} />
      </Field>
      <Field label="Max Output Tokens">
        <input className={inputClass} type="number" step={1000} value={out} onChange={(e) => setOut(e.target.value)} />
      </Field>
      <SaveIndicator status={status} onRetry={retry} />
    </>
  )
}

function ConnectivityForm({ config }: { config: AppConfig }) {
  const eng = config.engine as Record<string, unknown>
  const [mcpPort, setMcpPort] = useState(String(eng.mcpPort ?? ''))
  const [askMcpPort, setAskMcpPort] = useState(String(eng.askMcpPort ?? ''))

  const data = useMemo(() => {
    const patch = { ...eng }
    if (mcpPort) patch.mcpPort = Number(mcpPort); else delete patch.mcpPort
    if (askMcpPort) patch.askMcpPort = Number(askMcpPort); else delete patch.askMcpPort
    return patch
  }, [eng, mcpPort, askMcpPort])

  const save = useCallback(async (d: Record<string, unknown>) => {
    await api.config.updateSection('engine', d)
  }, [])

  const { status, retry } = useAutoSave({ data, save })

  return (
    <>
      <Field label="MCP Port (tools)">
        <input className={inputClass} type="number" value={mcpPort} onChange={(e) => setMcpPort(e.target.value)} placeholder="Disabled" />
      </Field>
      <Field label="Ask MCP Port (connector)">
        <input className={inputClass} type="number" value={askMcpPort} onChange={(e) => setAskMcpPort(e.target.value)} placeholder="Disabled" />
      </Field>
      <SaveIndicator status={status} onRetry={retry} />
    </>
  )
}

function HeartbeatForm({ config }: { config: AppConfig }) {
  const [hbEnabled, setHbEnabled] = useState(config.heartbeat?.enabled || false)
  const [hbEvery, setHbEvery] = useState(config.heartbeat?.every || '30m')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    api.heartbeat.status().then(({ enabled }) => {
      setHbEnabled(enabled)
      setReady(true)
    }).catch(() => setReady(true))
  }, [])

  const heartbeatData = useMemo(
    () => ({ ...config.heartbeat, enabled: hbEnabled, every: hbEvery }),
    [config.heartbeat, hbEnabled, hbEvery],
  )

  const save = useCallback(async (d: Record<string, unknown>) => {
    await api.config.updateSection('heartbeat', d)
  }, [])

  const { status, retry } = useAutoSave({
    data: heartbeatData,
    save,
    enabled: ready,
  })

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
            } catch {
              // Toggle doesn't flip on failure
            }
          }}
        />
      </div>
      <Field label="Interval">
        <input className={inputClass} value={hbEvery} onChange={(e) => setHbEvery(e.target.value)} placeholder="30m" />
      </Field>
      <SaveIndicator status={status} onRetry={retry} />
    </>
  )
}

function TelegramForm({ config }: { config: AppConfig }) {
  const tg = (config as Record<string, unknown>).telegram as Record<string, unknown> | undefined
  const [botToken, setBotToken] = useState((tg?.botToken as string) || '')
  const [botUsername, setBotUsername] = useState((tg?.botUsername as string) || '')
  const [chatIds, setChatIds] = useState(
    Array.isArray(tg?.chatIds) ? (tg.chatIds as number[]).join(', ') : '',
  )

  const data = useMemo(() => ({
    botToken: botToken || undefined,
    botUsername: botUsername || undefined,
    chatIds: chatIds
      ? chatIds.split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n))
      : [],
  }), [botToken, botUsername, chatIds])

  const save = useCallback(async (d: Record<string, unknown>) => {
    await api.config.updateSection('telegram', d)
  }, [])

  const { status, retry } = useAutoSave({ data, save })

  return (
    <>
      <Field label="Bot Token">
        <input
          className={inputClass}
          type="password"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder="123456:ABC-DEF..."
        />
      </Field>
      <Field label="Bot Username">
        <input
          className={inputClass}
          value={botUsername}
          onChange={(e) => setBotUsername(e.target.value)}
          placeholder="my_bot"
        />
      </Field>
      <Field label="Allowed Chat IDs">
        <input
          className={inputClass}
          value={chatIds}
          onChange={(e) => setChatIds(e.target.value)}
          placeholder="Comma-separated, e.g. 123456, 789012"
        />
      </Field>
      <SaveIndicator status={status} onRetry={retry} />
    </>
  )
}
