import { useState, useEffect, useCallback } from 'react'
import { api, type AppConfig } from '../api'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)

  // Load config when panel opens
  useEffect(() => {
    if (!open) return
    api.config.load().then(setConfig).catch(() => showToast('Failed to load config', true))
  }, [open])

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

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/50 z-100 transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 w-[380px] max-w-[90vw] h-full bg-bg-secondary border-l border-border z-101 flex flex-col overflow-hidden transition-transform duration-250 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text hover:bg-bg-tertiary rounded-md px-2 py-1 text-xl transition-colors"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {config && (
            <>
              {/* AI Provider */}
              <Section title="AI Provider">
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

              {/* Evolution Mode */}
              <Section title="Evolution Mode">
                <div className="flex items-center justify-between">
                  <div className="flex-1 mr-3">
                    <span className="text-sm">
                      {config.agent?.evolutionMode ? 'Enabled' : 'Disabled'}
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
                <Section title="Model">
                  <ModelForm config={config} onSave={saveSection} />
                </Section>
              )}

              {/* Connectivity */}
              <Section title="Connectivity">
                <ConnectivityForm config={config} onSave={saveSection} />
              </Section>

              {/* Compaction */}
              <Section title="Compaction">
                <CompactionForm config={config} onSave={saveSection} />
              </Section>

              {/* Scheduler */}
              <Section title="Scheduler">
                <SchedulerForm config={config} onSave={saveSection} />
              </Section>
            </>
          )}
        </div>
      </div>

      {/* Toast */}
      <div
        className={`fixed bottom-20 left-1/2 -translate-x-1/2 bg-bg-tertiary text-text border border-border px-4 py-2 rounded-lg text-[13px] z-[200] transition-all duration-300 pointer-events-none ${
          toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
        } ${toast?.error ? 'border-red text-red' : ''}`}
      >
        {toast?.msg}
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
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

const inputClass =
  'w-full px-2.5 py-2 bg-bg text-text border border-border rounded-md font-sans text-sm outline-none transition-colors focus:border-accent'

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

function SchedulerForm({
  config,
  onSave,
}: {
  config: AppConfig
  onSave: (section: string, data: unknown, label: string) => void
}) {
  const [hbEnabled, setHbEnabled] = useState(config.scheduler?.heartbeat?.enabled || false)
  const [hbEvery, setHbEvery] = useState(config.scheduler?.heartbeat?.every || '30m')
  const [cronEnabled, setCronEnabled] = useState(config.scheduler?.cron?.enabled || false)

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm">Heartbeat</span>
        <Toggle checked={hbEnabled} onChange={setHbEnabled} />
      </div>
      <Field label="Heartbeat Interval">
        <input className={inputClass} value={hbEvery} onChange={(e) => setHbEvery(e.target.value)} placeholder="30m" />
      </Field>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm">Cron</span>
        <Toggle checked={cronEnabled} onChange={setCronEnabled} />
      </div>
      <SaveButton
        onClick={() =>
          onSave('scheduler', { heartbeat: { enabled: hbEnabled, every: hbEvery }, cron: { enabled: cronEnabled } }, 'Scheduler')
        }
      />
    </>
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
