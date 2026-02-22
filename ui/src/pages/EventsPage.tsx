import { useState, useEffect, useRef, useCallback } from 'react'
import { api, type EventLogEntry, type CronJob, type CronSchedule } from '../api'

// ==================== Helpers ====================

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour12: false })
  return `${date} ${time}`
}

function timeAgo(ts: number | null): string {
  if (!ts) return '-'
  const diff = Date.now() - ts
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function scheduleLabel(s: CronSchedule): string {
  switch (s.kind) {
    case 'at': return `at ${s.at}`
    case 'every': return `every ${s.every}`
    case 'cron': return `cron: ${s.cron}`
  }
}

// Map event types to color classes
function eventTypeColor(type: string): string {
  if (type.startsWith('heartbeat.')) return 'text-purple-400'
  if (type.startsWith('cron.')) return 'text-accent'
  if (type.startsWith('message.')) return 'text-green'
  return 'text-text-muted'
}

// ==================== EventLog Section ====================

function EventLogSection() {
  const [entries, setEntries] = useState<EventLogEntry[]>([])
  const [typeFilter, setTypeFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const lastSeqRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Initial load
  useEffect(() => {
    api.events.recent({ limit: 200 }).then(({ entries, lastSeq }) => {
      setEntries(entries.reverse()) // newest first
      lastSeqRef.current = lastSeq
    }).catch(console.warn)
  }, [])

  // SSE for real-time events
  useEffect(() => {
    if (paused) return
    const es = api.events.connectSSE((entry) => {
      lastSeqRef.current = Math.max(lastSeqRef.current, entry.seq)
      setEntries((prev) => {
        const next = [entry, ...prev]
        return next.length > 500 ? next.slice(0, 500) : next
      })
    })
    return () => es.close()
  }, [paused])

  const filtered = typeFilter
    ? entries.filter((e) => e.type.includes(typeFilter))
    : entries

  // Unique event types for filter dropdown
  const types = [...new Set(entries.map((e) => e.type))].sort()

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Controls */}
      <div className="flex items-center gap-3 shrink-0">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-bg-tertiary text-text text-sm rounded-md border border-border px-2 py-1.5 outline-none focus:border-accent"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <button
          onClick={() => setPaused(!paused)}
          className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
            paused
              ? 'border-notification-border text-notification-border hover:bg-notification-bg'
              : 'border-border text-text-muted hover:bg-bg-tertiary'
          }`}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>

        <span className="text-xs text-text-muted ml-auto">
          {filtered.length} events{typeFilter && ` (filtered)`}
        </span>
      </div>

      {/* Event list — fills remaining space */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 bg-bg rounded-lg border border-border overflow-y-auto font-mono text-xs"
      >
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-text-muted">No events yet</div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-bg-secondary">
              <tr className="text-text-muted text-left">
                <th className="px-3 py-2 w-12">#</th>
                <th className="px-3 py-2 w-20">Time</th>
                <th className="px-3 py-2 w-40">Type</th>
                <th className="px-3 py-2">Payload</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <EventRow key={entry.seq} entry={entry} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function EventRow({ entry }: { entry: EventLogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const payloadStr = JSON.stringify(entry.payload)
  const isLong = payloadStr.length > 120

  return (
    <>
      <tr
        className="border-t border-border/50 hover:bg-bg-secondary/50 cursor-pointer"
        onClick={() => isLong && setExpanded(!expanded)}
      >
        <td className="px-3 py-1.5 text-text-muted">{entry.seq}</td>
        <td className="px-3 py-1.5 text-text-muted">{formatTime(entry.ts)}</td>
        <td className={`px-3 py-1.5 ${eventTypeColor(entry.type)}`}>{entry.type}</td>
        <td className="px-3 py-1.5 text-text-muted truncate">
          {isLong ? payloadStr.slice(0, 120) + '...' : payloadStr}
          {isLong && (
            <span className="ml-1 text-accent">{expanded ? '▾' : '▸'}</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border/30">
          <td colSpan={4} className="px-3 py-2">
            <pre className="text-text-muted whitespace-pre-wrap break-all bg-bg-tertiary rounded p-2 text-[11px]">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

// ==================== Cron Section ====================

function CronSection() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  const loadJobs = useCallback(async () => {
    try {
      const { jobs } = await api.cron.list()
      setJobs(jobs)
    } catch (err) {
      console.warn('Failed to load cron jobs:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadJobs() }, [loadJobs])

  // Refresh periodically to update next-run times
  useEffect(() => {
    const id = setInterval(loadJobs, 15_000)
    return () => clearInterval(id)
  }, [loadJobs])

  const handleToggle = async (job: CronJob) => {
    try {
      await api.cron.update(job.id, { enabled: !job.enabled })
      await loadJobs()
    } catch (err) {
      console.warn('Failed to toggle job:', err)
    }
  }

  const handleRunNow = async (job: CronJob) => {
    try {
      await api.cron.runNow(job.id)
      await loadJobs()
    } catch (err) {
      console.warn('Failed to run job:', err)
    }
  }

  const handleDelete = async (job: CronJob) => {
    if (job.name === '__heartbeat__') return // Don't delete heartbeat
    try {
      await api.cron.remove(job.id)
      await loadJobs()
    } catch (err) {
      console.warn('Failed to delete job:', err)
    }
  }

  if (loading) {
    return <div className="text-text-muted text-sm py-4">Loading cron jobs...</div>
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{jobs.length} jobs</span>
        <button
          onClick={() => setShowAdd(true)}
          className="text-xs px-3 py-1.5 rounded-md bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors"
        >
          + Add Job
        </button>
      </div>

      {showAdd && (
        <AddCronJobForm
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); loadJobs() }}
        />
      )}

      {jobs.length === 0 ? (
        <div className="text-text-muted text-sm text-center py-6">No cron jobs</div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <CronJobCard
              key={job.id}
              job={job}
              onToggle={() => handleToggle(job)}
              onRunNow={() => handleRunNow(job)}
              onDelete={() => handleDelete(job)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CronJobCard({ job, onToggle, onRunNow, onDelete }: {
  job: CronJob
  onToggle: () => void
  onRunNow: () => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isHeartbeat = job.name === '__heartbeat__'

  return (
    <div className={`rounded-lg border ${job.enabled ? 'border-border' : 'border-border/50 opacity-60'} bg-bg`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Toggle */}
        <button
          onClick={onToggle}
          className={`w-8 h-4 rounded-full relative transition-colors ${
            job.enabled ? 'bg-green' : 'bg-bg-tertiary'
          }`}
        >
          <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all ${
            job.enabled ? 'left-4.5' : 'left-0.5'
          }`} />
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${isHeartbeat ? 'text-purple-400' : 'text-text'}`}>
              {isHeartbeat ? '💓 heartbeat' : job.name}
            </span>
            <span className="text-xs text-text-muted">{job.id}</span>
            {job.state.lastStatus === 'error' && (
              <span className="text-xs text-red">
                {job.state.consecutiveErrors}x err
              </span>
            )}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {scheduleLabel(job.schedule)}
            {job.state.nextRunAtMs && (
              <span className="ml-2">• next: {formatDateTime(job.state.nextRunAtMs)}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onRunNow}
            title="Run now"
            className="p-1.5 rounded text-text-muted hover:text-accent hover:bg-bg-tertiary transition-colors text-xs"
          >
            ▶
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            title="Details"
            className="p-1.5 rounded text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors text-xs"
          >
            {expanded ? '▾' : '▸'}
          </button>
          {!isHeartbeat && (
            <button
              onClick={onDelete}
              title="Delete"
              className="p-1.5 rounded text-text-muted hover:text-red hover:bg-bg-tertiary transition-colors text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/50 px-4 py-3 text-xs space-y-2">
          <div>
            <span className="text-text-muted">Payload: </span>
            <pre className="inline text-text whitespace-pre-wrap break-all">{job.payload}</pre>
          </div>
          <div className="flex gap-4 text-text-muted">
            <span>Last run: {job.state.lastRunAtMs ? `${timeAgo(job.state.lastRunAtMs)} (${formatDateTime(job.state.lastRunAtMs)})` : 'never'}</span>
            <span>Status: {job.state.lastStatus ?? 'n/a'}</span>
            <span>Created: {formatDateTime(job.createdAt)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function AddCronJobForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [payload, setPayload] = useState('')
  const [schedKind, setSchedKind] = useState<'every' | 'cron' | 'at'>('every')
  const [schedValue, setSchedValue] = useState('1h')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !payload.trim()) {
      setError('Name and payload are required')
      return
    }

    let schedule: CronSchedule
    if (schedKind === 'every') schedule = { kind: 'every', every: schedValue }
    else if (schedKind === 'cron') schedule = { kind: 'cron', cron: schedValue }
    else schedule = { kind: 'at', at: schedValue }

    setSaving(true)
    setError('')
    try {
      await api.cron.add({ name: name.trim(), payload: payload.trim(), schedule })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-bg rounded-lg border border-accent/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">New Cron Job</span>
        <button type="button" onClick={onClose} className="text-text-muted hover:text-text text-xs">✕</button>
      </div>

      <input
        type="text"
        placeholder="Job name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-text outline-none focus:border-accent"
      />

      <textarea
        placeholder="Payload / instruction text"
        value={payload}
        onChange={(e) => setPayload(e.target.value)}
        rows={2}
        className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-text outline-none focus:border-accent resize-none"
      />

      <div className="flex gap-2">
        <select
          value={schedKind}
          onChange={(e) => {
            const k = e.target.value as 'every' | 'cron' | 'at'
            setSchedKind(k)
            if (k === 'every') setSchedValue('1h')
            else if (k === 'cron') setSchedValue('0 9 * * 1-5')
            else setSchedValue(new Date(Date.now() + 3600_000).toISOString())
          }}
          className="bg-bg-tertiary border border-border rounded-md px-2 py-2 text-sm text-text outline-none focus:border-accent"
        >
          <option value="every">Every</option>
          <option value="cron">Cron</option>
          <option value="at">At (one-shot)</option>
        </select>

        <input
          type="text"
          value={schedValue}
          onChange={(e) => setSchedValue(e.target.value)}
          placeholder={schedKind === 'every' ? '1h' : schedKind === 'cron' ? '0 9 * * 1-5' : 'ISO timestamp'}
          className="flex-1 bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-text outline-none focus:border-accent font-mono"
        />
      </div>

      {error && <div className="text-xs text-red">{error}</div>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded-md text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create'}
        </button>
      </div>
    </form>
  )
}

// ==================== Heartbeat Section ====================

function HeartbeatSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [triggerResult, setTriggerResult] = useState<string | null>(null)

  useEffect(() => {
    api.heartbeat.status().then(({ enabled }) => setEnabled(enabled)).catch(console.warn)
  }, [])

  const handleToggle = async () => {
    if (enabled === null) return
    try {
      const result = await api.heartbeat.setEnabled(!enabled)
      setEnabled(result.enabled)
    } catch (err) {
      console.warn('Failed to toggle heartbeat:', err)
    }
  }

  const handleTrigger = async () => {
    setTriggering(true)
    setTriggerResult(null)
    try {
      await api.heartbeat.trigger()
      setTriggerResult('Heartbeat triggered!')
      setTimeout(() => setTriggerResult(null), 3000)
    } catch (err) {
      setTriggerResult(err instanceof Error ? err.message : 'Trigger failed')
      setTimeout(() => setTriggerResult(null), 5000)
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
          {triggerResult && (
            <span className={`text-xs ${triggerResult.includes('failed') || triggerResult.includes('not found') ? 'text-red' : 'text-green'}`}>
              {triggerResult}
            </span>
          )}

          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="px-3 py-1.5 text-xs rounded-md bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-colors disabled:opacity-50"
          >
            {triggering ? 'Triggering...' : 'Trigger Now'}
          </button>

          {enabled !== null && (
            <button
              onClick={handleToggle}
              className={`w-10 h-5 rounded-full relative transition-colors ${
                enabled ? 'bg-green' : 'bg-bg-tertiary'
              }`}
            >
              <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${
                enabled ? 'left-5.5' : 'left-0.5'
              }`} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== Main Page ====================

type Tab = 'events' | 'cron'

export function EventsPage() {
  const [tab, setTab] = useState<Tab>('events')

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Page header */}
      <div className="flex items-center gap-4 px-4 md:px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-base font-semibold text-text">Events</h2>
        <div className="flex gap-1 bg-bg-secondary rounded-lg p-1">
          <button
            onClick={() => setTab('events')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              tab === 'events'
                ? 'bg-bg-tertiary text-text'
                : 'text-text-muted hover:text-text'
            }`}
          >
            Event Log
          </button>
          <button
            onClick={() => setTab('cron')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              tab === 'cron'
                ? 'bg-bg-tertiary text-text'
                : 'text-text-muted hover:text-text'
            }`}
          >
            Cron Jobs
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-h-0 px-4 md:px-6 py-5 gap-4">
        <HeartbeatSection />
        <div className="flex-1 min-h-0">
          {tab === 'events' ? <EventLogSection /> : <CronSection />}
        </div>
      </div>
    </div>
  )
}
