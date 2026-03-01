import { useState, useEffect, useCallback, useMemo } from 'react'
import { api, type AppConfig, type EventLogEntry } from '../api'
import { Toggle } from '../components/Toggle'
import { SaveIndicator } from '../components/SaveIndicator'
import { Section, Field, inputClass } from '../components/form'
import { useAutoSave } from '../hooks/useAutoSave'

// ==================== Helpers ====================

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour12: false })
  return `${date} ${time}`
}

function eventTypeColor(type: string): string {
  if (type === 'heartbeat.done') return 'text-green'
  if (type === 'heartbeat.skip') return 'text-text-muted'
  if (type === 'heartbeat.error') return 'text-red'
  return 'text-purple'
}

// ==================== Status Bar ====================

function StatusBar() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.heartbeat.status().then(({ enabled }) => setEnabled(enabled)).catch(console.warn)
  }, [])

  const handleToggle = async (v: boolean) => {
    try {
      const result = await api.heartbeat.setEnabled(v)
      setEnabled(result.enabled)
    } catch {
      setError('Failed to toggle heartbeat')
      setTimeout(() => setError(null), 3000)
    }
  }

  const handleTrigger = async () => {
    setTriggering(true)
    setFeedback(null)
    try {
      await api.heartbeat.trigger()
      setFeedback('Heartbeat triggered!')
      setTimeout(() => setFeedback(null), 3000)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Trigger failed')
      setTimeout(() => setFeedback(null), 5000)
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="bg-bg rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">💓</span>
          <div>
            <div className="text-sm font-medium text-text">Heartbeat</div>
            <div className="text-xs text-text-muted">
              Periodic self-check and autonomous thinking
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {feedback && (
            <span className={`text-xs ${feedback.includes('failed') || feedback.includes('not found') ? 'text-red' : 'text-green'}`}>
              {feedback}
            </span>
          )}

          {error && <span className="text-xs text-red">{error}</span>}

          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="px-3 py-1.5 text-xs rounded-md bg-purple-dim text-purple border border-purple/30 hover:bg-purple/30 transition-colors disabled:opacity-50"
          >
            {triggering ? 'Triggering...' : 'Trigger Now'}
          </button>

          {enabled !== null && (
            <Toggle checked={enabled} onChange={handleToggle} />
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== Config Section ====================

function ConfigSection({ config }: { config: AppConfig }) {
  const [every, setEvery] = useState(config.heartbeat?.every || '30m')
  const [ahEnabled, setAhEnabled] = useState(config.heartbeat?.activeHours != null)
  const [ahStart, setAhStart] = useState(config.heartbeat?.activeHours?.start || '09:00')
  const [ahEnd, setAhEnd] = useState(config.heartbeat?.activeHours?.end || '22:00')
  const [ahTimezone, setAhTimezone] = useState(config.heartbeat?.activeHours?.timezone || 'local')

  const configData = useMemo(() => ({
    ...config.heartbeat,
    every,
    activeHours: ahEnabled ? { start: ahStart, end: ahEnd, timezone: ahTimezone } : null,
  }), [config.heartbeat, every, ahEnabled, ahStart, ahEnd, ahTimezone])

  const save = useCallback(async (d: Record<string, unknown>) => {
    await api.config.updateSection('heartbeat', d)
  }, [])

  const { status, retry } = useAutoSave({ data: configData, save })

  return (
    <Section title="Configuration">
      <Field label="Interval">
        <input
          className={inputClass}
          value={every}
          onChange={(e) => setEvery(e.target.value)}
          placeholder="30m"
        />
      </Field>

      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[13px] text-text-muted">Active Hours</label>
          <Toggle checked={ahEnabled} onChange={setAhEnabled} />
        </div>
        {ahEnabled && (
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-[11px] text-text-muted mb-1">Start</label>
              <input
                className={inputClass}
                value={ahStart}
                onChange={(e) => setAhStart(e.target.value)}
                placeholder="09:00"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] text-text-muted mb-1">End</label>
              <input
                className={inputClass}
                value={ahEnd}
                onChange={(e) => setAhEnd(e.target.value)}
                placeholder="22:00"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] text-text-muted mb-1">Timezone</label>
              <select
                className={inputClass}
                value={ahTimezone}
                onChange={(e) => setAhTimezone(e.target.value)}
              >
                <option value="local">Local</option>
                <option value="UTC">UTC</option>
                <option value="America/New_York">US Eastern</option>
                <option value="America/Chicago">US Central</option>
                <option value="America/Los_Angeles">US Pacific</option>
                <option value="Europe/London">London</option>
                <option value="Europe/Berlin">Berlin</option>
                <option value="Asia/Tokyo">Tokyo</option>
                <option value="Asia/Shanghai">Shanghai</option>
                <option value="Asia/Hong_Kong">Hong Kong</option>
                <option value="Asia/Singapore">Singapore</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <SaveIndicator status={status} onRetry={retry} />
    </Section>
  )
}

// ==================== Prompt Editor ====================

function PromptEditor() {
  const [content, setContent] = useState('')
  const [filePath, setFilePath] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    api.heartbeat.getPromptFile()
      .then(({ content, path }) => {
        setContent(content)
        setFilePath(path)
      })
      .catch(() => setError('Failed to load prompt file'))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api.heartbeat.updatePromptFile(content)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Prompt File" description={filePath || undefined}>
      {loading ? (
        <div className="text-sm text-text-muted">Loading...</div>
      ) : (
        <>
          <textarea
            className={`${inputClass} min-h-[200px] max-h-[400px] resize-y font-mono text-xs leading-relaxed`}
            value={content}
            onChange={(e) => { setContent(e.target.value); setDirty(true) }}
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="px-3 py-1.5 text-xs rounded-md bg-accent text-bg font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-green" />
                <span className="text-text-muted">Saved</span>
              </span>
            )}
            {error && (
              <span className="inline-flex items-center gap-1.5 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-red" />
                <span className="text-red">{error}</span>
              </span>
            )}
            {dirty && !saved && !error && (
              <span className="text-[11px] text-text-muted">Unsaved changes</span>
            )}
          </div>
        </>
      )}
    </Section>
  )
}

// ==================== Recent Events ====================

function RecentEvents() {
  const [entries, setEntries] = useState<EventLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.events.recent({ limit: 500 })
      .then(({ entries }) => {
        const hbEntries = entries
          .filter((e) => e.type.startsWith('heartbeat.'))
          .slice(-20)
          .reverse()
        setEntries(hbEntries)
      })
      .catch(console.warn)
      .finally(() => setLoading(false))
  }, [])

  return (
    <Section title="Recent Events">
      <div className="bg-bg rounded-lg border border-border overflow-hidden font-mono text-xs">
        {loading ? (
          <div className="px-4 py-6 text-center text-text-muted">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-text-muted">No heartbeat events yet</div>
        ) : (
          <table className="w-full">
            <thead className="bg-bg-secondary">
              <tr className="text-text-muted text-left">
                <th className="px-3 py-2 w-12">#</th>
                <th className="px-3 py-2 w-36">Time</th>
                <th className="px-3 py-2 w-32">Type</th>
                <th className="px-3 py-2">Payload</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const payloadStr = JSON.stringify(entry.payload)
                return (
                  <tr key={entry.seq} className="border-t border-border/50">
                    <td className="px-3 py-1.5 text-text-muted">{entry.seq}</td>
                    <td className="px-3 py-1.5 text-text-muted whitespace-nowrap">{formatDateTime(entry.ts)}</td>
                    <td className={`px-3 py-1.5 ${eventTypeColor(entry.type)}`}>
                      {entry.type.replace('heartbeat.', '')}
                    </td>
                    <td className="px-3 py-1.5 text-text-muted truncate max-w-0">
                      {payloadStr.length > 120 ? payloadStr.slice(0, 120) + '...' : payloadStr}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </Section>
  )
}

// ==================== Main Page ====================

export function HeartbeatPage() {
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    api.config.load().then(setConfig).catch(console.warn)
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 py-4">
          <h2 className="text-base font-semibold text-text">Heartbeat</h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[720px] space-y-6">
          <StatusBar />
          {config && <ConfigSection config={config} />}
          <PromptEditor />
          <RecentEvents />
        </div>
      </div>
    </div>
  )
}
