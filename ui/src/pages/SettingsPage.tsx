import { useState, useEffect, useCallback, useRef } from 'react'
import { api, type AppConfig } from '../api'

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
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { root: container, rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    )

    for (const { id } of SECTIONS) {
      const el = container.querySelector(`#${id}`)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [config])

  const scrollToSection = (id: string) => {
    const el = scrollRef.current?.querySelector(`#${id}`)
    el?.scrollIntoView({ behavior: 'smooth' })
  }

  const showToast = useCallback((msg: string, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 2000)
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
        <div className="px-6 py-4">
          <h2 className="text-base font-semibold text-text">Settings</h2>
        </div>
        <div className="flex gap-1 px-6 pb-3">
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5">
        {config && (
          <div className="max-w-[640px] space-y-8">
            {/* AI Provider */}
            <Section id="ai-provider" title="AI Provider">
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
            <Section id="agent" title="Agent">
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
              <Section id="model" title="Model">
                <ModelForm config={config} onSave={saveSection} />
              </Section>
            )}

            {/* Connectivity */}
            <Section id="connectivity" title="Connectivity">
              <ConnectivityForm config={config} onSave={saveSection} />
            </Section>

            {/* Compaction */}
            <Section id="compaction" title="Compaction">
              <CompactionForm config={config} onSave={saveSection} />
            </Section>

            {/* Heartbeat */}
            <Section id="heartbeat" title="Heartbeat">
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

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id}>
      <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide mb-3">
        {title}
      </h3>
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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-[22px] rounded-full cursor-pointer transition-colors ${
        checked ? 'bg-accent-dim' : 'bg-bg-tertiary'
      }`}
    >
      <span
        className={`absolute w-4 h-4 rounded-full bottom-[3px] left-[3px] transition-all ${
          checked ? 'translate-x-[18px] bg-accent' : 'bg-text-muted'
        }`}
      />
    </button>
  )
}

const inputClass =
  'w-full px-2.5 py-2 bg-bg text-text border border-border rounded-md font-sans text-sm outline-none transition-colors focus:border-accent'

// ==================== Form Sections ====================

function ModelForm({
  config,
  onSave,
}: {
  config: AppConfig
  onSave: (section: string, data: unknown, label: string) => void
}) {
  const [provider, setProvider] = useState(config.model?.provider || '')
  const [model, setModel] = useState(config.model?.model || '')

  return (
    <>
      <Field label="Provider">
        <input className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="anthropic" />
      </Field>
      <Field label="Model">
        <input className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-sonnet-4-5-20250929" />
      </Field>
      <SaveButton onClick={() => onSave('model', { provider, model }, 'Model')} />
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
      <p className="text-[11px] text-text-muted mb-2">Leave empty to disable. Restart required after change.</p>
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
