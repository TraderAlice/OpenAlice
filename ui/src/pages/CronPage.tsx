import { useState, useEffect, useCallback } from 'react'
import { api, type CronJob, type CronSchedule, type EventLogEntry } from '../api'
import { Toggle } from '../components/Toggle'
import { PageHeader } from '../components/PageHeader'
import { Section, inputClass } from '../components/form'

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour12: false })
  return `${date} ${time}`
}

function formatRelative(ms: number): string {
  const now = Date.now()
  const diff = ms - now
  if (diff < 0) return 'overdue'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `in ${hrs}h ${mins % 60}m`
  return `in ${Math.floor(hrs / 24)}d`
}

function scheduleLabel(s: CronSchedule): string {
  switch (s.kind) {
    case 'at': return `once @ ${s.at}`
    case 'every': return `every ${s.every}`
    case 'cron': return s.cron
  }
}

function statusBadge(state: CronJob['state']): { color: string; label: string } {
  if (state.lastStatus === 'ok') return { color: 'bg-green', label: 'OK' }
  if (state.lastStatus === 'error') return { color: 'bg-red', label: `Error (${state.consecutiveErrors}x)` }
  return { color: 'bg-text-muted', label: 'Never run' }
}

// ==================== Job Card ====================

interface JobCardProps {
  job: CronJob
  onToggle: (id: string, enabled: boolean) => void
  onRunNow: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (job: CronJob) => void
}

function JobCard({ job, onToggle, onRunNow, onDelete, onEdit }: JobCardProps) {
  const [running, setRunning] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const badge = statusBadge(job.state)
  const isHeartbeat = job.name === '__heartbeat__'

  const handleRunNow = async () => {
    setRunning(true)
    try { await onRunNow(job.id) } finally { setRunning(false) }
  }

  return (
    <div className={`bg-bg rounded-lg border border-border p-4 transition-colors ${!job.enabled ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-text truncate">
              {isHeartbeat ? 'Heartbeat' : job.name}
            </h4>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white ${badge.color}`}>
              {badge.label}
            </span>
            {isHeartbeat && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-dim text-purple border border-purple/30">
                system
              </span>
            )}
          </div>
          <div className="text-xs text-text-muted space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-mono">{scheduleLabel(job.schedule)}</span>
              <span className="text-text-muted/50">|</span>
              <span className="text-[11px]">ID: {job.id}</span>
            </div>
            {job.state.nextRunAtMs && (
              <div>Next: {formatRelative(job.state.nextRunAtMs)} ({formatDateTime(job.state.nextRunAtMs)})</div>
            )}
            {job.state.lastRunAtMs && (
              <div>Last: {formatDateTime(job.state.lastRunAtMs)}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRunNow}
            disabled={running}
            className="px-2.5 py-1 text-[11px] rounded-md bg-purple-dim text-purple border border-purple/30 hover:bg-purple/30 transition-colors disabled:opacity-50"
            title="Run now"
          >
            {running ? '...' : 'Run'}
          </button>
          {!isHeartbeat && (
            <button
              onClick={() => onEdit(job)}
              className="px-2.5 py-1 text-[11px] rounded-md bg-bg-tertiary text-text-muted border border-border hover:text-text hover:bg-bg-tertiary/80 transition-colors"
            >
              Edit
            </button>
          )}
          <Toggle checked={job.enabled} onChange={(v) => onToggle(job.id, v)} size="sm" />
          {!isHeartbeat && (
            confirmDelete ? (
              <div className="flex items-center gap-1">
                <button onClick={() => onDelete(job.id)} className="px-2 py-1 text-[11px] rounded-md bg-red/20 text-red border border-red/30 hover:bg-red/30">Yes</button>
                <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 text-[11px] rounded-md bg-bg-tertiary text-text-muted border border-border">No</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-2 py-1 text-[11px] rounded-md text-red/60 hover:text-red hover:bg-red/10 transition-colors"
                title="Delete"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14H7L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                </svg>
              </button>
            )
          )}
        </div>
      </div>

      {/* Payload preview */}
      <details className="mt-3 group">
        <summary className="text-[11px] text-text-muted cursor-pointer hover:text-text transition-colors select-none">
          Show payload
        </summary>
        <pre className="mt-2 p-3 bg-bg-secondary rounded-md text-[11px] text-text-muted font-mono whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto leading-relaxed">
          {job.payload}
        </pre>
      </details>
    </div>
  )
}

// ==================== Add/Edit Modal ====================

interface JobFormData {
  name: string
  scheduleKind: 'at' | 'every' | 'cron'
  scheduleValue: string
  payload: string
  channel: string
  enabled: boolean
}

const defaultForm: JobFormData = {
  name: '',
  scheduleKind: 'cron',
  scheduleValue: '',
  payload: '',
  channel: 'telegram',
  enabled: true,
}

function jobToForm(job: CronJob): JobFormData {
  const s = job.schedule
  return {
    name: job.name,
    scheduleKind: s.kind,
    scheduleValue: s.kind === 'at' ? s.at : s.kind === 'every' ? s.every : s.cron,
    payload: job.payload,
    channel: job.channel || '',
    enabled: job.enabled,
  }
}

function formToSchedule(form: JobFormData): CronSchedule {
  switch (form.scheduleKind) {
    case 'at': return { kind: 'at', at: form.scheduleValue }
    case 'every': return { kind: 'every', every: form.scheduleValue }
    case 'cron': return { kind: 'cron', cron: form.scheduleValue }
  }
}

interface JobModalProps {
  editing: CronJob | null
  onClose: () => void
  onSave: (form: JobFormData, editingId: string | null) => Promise<void>
}

function JobModal({ editing, onClose, onSave }: JobModalProps) {
  const [form, setForm] = useState<JobFormData>(editing ? jobToForm(editing) : defaultForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.scheduleValue.trim() || !form.payload.trim()) {
      setError('Name, schedule, and payload are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(form, editing?.id ?? null)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const update = (patch: Partial<JobFormData>) => setForm((f) => ({ ...f, ...patch }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-bg-secondary border border-border rounded-xl w-full max-w-[640px] max-h-[90vh] flex flex-col shadow-2xl mx-4"
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">{editing ? 'Edit Job' : 'New Cron Job'}</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-[13px] text-text mb-1.5 font-medium">Name</label>
            <input className={inputClass} value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder="My signal check" />
          </div>

          <div className="grid grid-cols-[140px_1fr] gap-3">
            <div>
              <label className="block text-[13px] text-text mb-1.5 font-medium">Schedule Type</label>
              <select className={inputClass} value={form.scheduleKind} onChange={(e) => update({ scheduleKind: e.target.value as any })}>
                <option value="cron">Cron (5-field)</option>
                <option value="every">Interval</option>
                <option value="at">One-shot</option>
              </select>
            </div>
            <div>
              <label className="block text-[13px] text-text mb-1.5 font-medium">
                {form.scheduleKind === 'cron' ? 'Expression' : form.scheduleKind === 'every' ? 'Interval' : 'ISO Timestamp'}
              </label>
              <input
                className={`${inputClass} font-mono`}
                value={form.scheduleValue}
                onChange={(e) => update({ scheduleValue: e.target.value })}
                placeholder={form.scheduleKind === 'cron' ? '0 9 * * 1-5' : form.scheduleKind === 'every' ? '4h' : '2026-04-01T09:00:00Z'}
              />
            </div>
          </div>

          <div>
            <label className="block text-[13px] text-text mb-1.5 font-medium">Channel</label>
            <select className={inputClass} value={form.channel} onChange={(e) => update({ channel: e.target.value })}>
              <option value="">Default (last interacted)</option>
              <option value="telegram">Telegram</option>
              <option value="web">Web</option>
            </select>
          </div>

          <div>
            <label className="block text-[13px] text-text mb-1.5 font-medium">Payload (prompt)</label>
            <textarea
              className={`${inputClass} min-h-[200px] max-h-[400px] resize-y font-mono text-xs leading-relaxed`}
              value={form.payload}
              onChange={(e) => update({ payload: e.target.value })}
              placeholder="Instructions for Alice when this job fires..."
            />
          </div>

          <div className="flex items-center gap-3">
            <Toggle checked={form.enabled} onChange={(v) => update({ enabled: v })} size="sm" />
            <span className="text-[13px] text-text-muted">{form.enabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <div>
            {error && <span className="text-xs text-red">{error}</span>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs rounded-md text-text-muted hover:text-text transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs rounded-md bg-accent text-bg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ==================== Recent Cron Events ====================

function CronEvents() {
  const [entries, setEntries] = useState<EventLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.events.recent({ limit: 500 })
      .then(({ entries }) => {
        const cronEntries = entries
          .filter((e) => e.type.startsWith('cron.'))
          .slice(-30)
          .reverse()
        setEntries(cronEntries)
      })
      .catch(console.warn)
      .finally(() => setLoading(false))
  }, [])

  const typeColor = (t: string) => {
    if (t === 'cron.done') return 'text-green'
    if (t === 'cron.error') return 'text-red'
    return 'text-purple'
  }

  return (
    <Section title="Recent Cron Events">
      <div className="bg-bg rounded-lg border border-border overflow-x-auto font-mono text-xs">
        {loading ? (
          <div className="px-4 py-6 text-center text-text-muted">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-text-muted">No cron events yet</div>
        ) : (
          <table className="w-full">
            <thead className="bg-bg-secondary">
              <tr className="text-text-muted text-left">
                <th className="px-3 py-2 w-36">Time</th>
                <th className="px-3 py-2 w-24">Type</th>
                <th className="px-3 py-2 w-40">Job</th>
                <th className="px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const p = entry.payload as Record<string, unknown>
                const detail = p.error ? String(p.error) :
                  p.durationMs ? `${p.durationMs}ms` :
                  ''
                return (
                  <tr key={entry.seq} className="border-t border-border/50 hover:bg-bg-tertiary/30 transition-colors">
                    <td className="px-3 py-1.5 text-text-muted whitespace-nowrap">{formatDateTime(entry.ts)}</td>
                    <td className={`px-3 py-1.5 ${typeColor(entry.type)}`}>{entry.type.replace('cron.', '')}</td>
                    <td className="px-3 py-1.5 text-text-muted truncate max-w-0">{String(p.jobName || p.jobId || '')}</td>
                    <td className="px-3 py-1.5 text-text-muted truncate max-w-0">{detail}</td>
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

export function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingJob, setEditingJob] = useState<CronJob | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

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

  const showFeedback = (msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(null), 3000)
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await api.cron.update(id, { enabled })
      await loadJobs()
    } catch { showFeedback('Toggle failed') }
  }

  const handleRunNow = async (id: string) => {
    try {
      await api.cron.runNow(id)
      showFeedback('Job triggered!')
      setTimeout(loadJobs, 2000)
    } catch { showFeedback('Trigger failed') }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.cron.remove(id)
      showFeedback('Job deleted')
      await loadJobs()
    } catch { showFeedback('Delete failed') }
  }

  const handleEdit = (job: CronJob) => {
    setEditingJob(job)
    setShowModal(true)
  }

  const handleSave = async (form: JobFormData, editingId: string | null) => {
    const schedule = formToSchedule(form)
    if (editingId) {
      await api.cron.update(editingId, {
        name: form.name,
        payload: form.payload,
        schedule,
        enabled: form.enabled,
      })
    } else {
      await api.cron.add({
        name: form.name,
        payload: form.payload,
        schedule,
        enabled: form.enabled,
      })
    }
    showFeedback(editingId ? 'Job updated' : 'Job created')
    await loadJobs()
  }

  const userJobs = jobs.filter((j) => j.name !== '__heartbeat__')
  const heartbeatJob = jobs.find((j) => j.name === '__heartbeat__')

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Cron Jobs"
        description={`${userJobs.filter((j) => j.enabled).length} active jobs`}
        right={
          <div className="flex items-center gap-3">
            {feedback && (
              <span className={`text-xs ${feedback.includes('failed') ? 'text-red' : 'text-green'}`}>
                {feedback}
              </span>
            )}
            <button
              onClick={() => { setEditingJob(null); setShowModal(true) }}
              className="px-3 py-1.5 text-xs rounded-md bg-accent text-bg font-medium hover:opacity-90 transition-opacity"
            >
              + New Job
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[800px] space-y-4">
          {loading ? (
            <div className="text-sm text-text-muted text-center py-12">Loading cron jobs...</div>
          ) : (
            <>
              {heartbeatJob && (
                <JobCard
                  job={heartbeatJob}
                  onToggle={handleToggle}
                  onRunNow={handleRunNow}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                />
              )}
              {userJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onToggle={handleToggle}
                  onRunNow={handleRunNow}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                />
              ))}
              {userJobs.length === 0 && !heartbeatJob && (
                <div className="text-center py-12">
                  <div className="text-text-muted text-sm mb-2">No cron jobs configured</div>
                  <button
                    onClick={() => { setEditingJob(null); setShowModal(true) }}
                    className="text-accent text-sm hover:underline"
                  >
                    Create your first job
                  </button>
                </div>
              )}
            </>
          )}

          <CronEvents />
        </div>
      </div>

      {showModal && (
        <JobModal
          editing={editingJob}
          onClose={() => { setShowModal(false); setEditingJob(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
