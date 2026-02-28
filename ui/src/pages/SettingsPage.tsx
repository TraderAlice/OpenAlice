import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, type AppConfig } from '../api'
import { Toggle } from '../components/Toggle'
import { SaveIndicator } from '../components/SaveIndicator'
import { Section, Field, inputClass } from '../components/form'
import { useAutoSave } from '../hooks/useAutoSave'

const SECTIONS = [
  { id: 'agent', label: 'Agent' },
  { id: 'compaction', label: 'Compaction' },
  { id: 'heartbeat', label: 'Heartbeat' },
]

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    api.config.load().then(setConfig).catch(() => {})
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 py-4">
          <h2 className="text-base font-semibold text-text">Settings</h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {config && (
          <div className="max-w-[640px] space-y-8">
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

            {/* Compaction */}
            <Section id="compaction" title="Compaction" description="Context window management. When conversation size approaches Max Context minus Max Output tokens, older messages are automatically summarized to free up space. Set Max Context to match your model's context limit.">
              <CompactionForm config={config} />
            </Section>

            {/* Heartbeat */}
            <Section id="heartbeat" title="Heartbeat" description="Periodic self-check. Alice reviews markets, news and alerts at the configured interval, and only pushes a notification when there's something worth your attention. Interval format: 30m, 1h, 6h.">
              <HeartbeatForm config={config} />
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}

// ==================== Form Sections ====================

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
