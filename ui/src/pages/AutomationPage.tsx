import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type AppConfig, type CronJob, type CronSchedule } from '../api'
import { getCurrentLocale } from '../lib/i18n-format'
import type { TFunction } from 'i18next'
import { Toggle } from '../components/Toggle'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, inputClass } from '../components/form'
import { useAutoSave } from '../hooks/useAutoSave'
import { PageHeader } from '../components/PageHeader'
import { AutomationFlowSection } from './AutomationFlowSection'
import { AutomationWebhookSection } from './AutomationWebhookSection'
import type { ViewSpec } from '../tabs/types'

type AutomationSection = Extract<ViewSpec, { kind: 'automation' }>['params']['section']

function getSectionTitles(t: ReturnType<typeof useTranslation>['t']): Record<AutomationSection, string> {
  return {
    flow: t('automation.flow'),
    heartbeat: t('automation.heartbeat'),
    cron: t('automation.cron'),
    webhook: t('automation.webhook'),
  }
}

function getSectionDescriptions(t: ReturnType<typeof useTranslation>['t']): Record<AutomationSection, string> {
  return {
    flow: t('automation.flowDescription'),
    heartbeat: t('automation.heartbeatDescription'),
    cron: t('automation.cronDescription'),
    webhook: t('automation.webhookDescription'),
  }
}

// ==================== Helpers ====================

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const locale = getCurrentLocale()
  const date = d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(locale, { hour12: false })
  return `${date} ${time}`
}

function timeAgo(t: TFunction, ts: number | null): string {
  if (!ts) return '-'
  const diff = Date.now() - ts
  if (diff < 60_000) return t('common.secondsAgo', '{{count}}s ago', { count: Math.floor(diff / 1000) })
  if (diff < 3_600_000) return t('common.minutesAgoShort', '{{count}}m ago', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('common.hoursAgoShort', '{{count}}h ago', { count: Math.floor(diff / 3_600_000) })
  return t('common.daysAgoShort', '{{count}}d ago', { count: Math.floor(diff / 86_400_000) })
}

function scheduleLabel(s: CronSchedule): string {
  switch (s.kind) {
    case 'at': return `at ${s.at}`
    case 'every': return `every ${s.every}`
    case 'cron': return `cron: ${s.cron}`
  }
}

// ==================== Heartbeat: Status Bar ====================

function StatusBar() {
  const { t } = useTranslation()
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
      setError(t('automation.failedToToggle'))
      setTimeout(() => setError(null), 3000)
    }
  }

  const handleTrigger = async () => {
    setTriggering(true)
    setFeedback(null)
    try {
      await api.heartbeat.trigger()
      setFeedback(t('automation.heartbeatTriggered'))
      setTimeout(() => setFeedback(null), 3000)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t('automation.triggerFailed'))
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
            <div className="text-sm font-medium text-text">{t('common.heartbeat')}</div>
            <div className="text-xs text-text-muted">
              {t('automation.heartbeatDescription')}
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
            className="btn-secondary-sm"
          >
            {triggering ? t('automation.triggering') : t('automation.triggerNow')}
          </button>

          {enabled !== null && (
            <Toggle checked={enabled} onChange={handleToggle} />
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== Heartbeat: Config Form ====================

function HeartbeatConfigForm({ config }: { config: AppConfig }) {
  const { t } = useTranslation()
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
    <ConfigSection title={t('common.configuration')} description={t('automation.heartbeatConfigDescription')}>
      <Field label={t('common.interval')}>
        <input
          className={inputClass}
          value={every}
          onChange={(e) => setEvery(e.target.value)}
          placeholder="30m"
        />
      </Field>

      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[13px] text-text font-medium">{t('automation.activeHours')}</label>
          <Toggle checked={ahEnabled} onChange={setAhEnabled} />
        </div>
        {ahEnabled && (
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-[11px] text-text-muted mb-1">{t('common.start')}</label>
              <input
                className={inputClass}
                value={ahStart}
                onChange={(e) => setAhStart(e.target.value)}
                placeholder="09:00"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] text-text-muted mb-1">{t('common.end')}</label>
              <input
                className={inputClass}
                value={ahEnd}
                onChange={(e) => setAhEnd(e.target.value)}
                placeholder="22:00"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] text-text-muted mb-1">{t('common.timezone')}</label>
              <select
                className={inputClass}
                value={ahTimezone}
                onChange={(e) => setAhTimezone(e.target.value)}
              >
                <option value="local">{t('common.local')}</option>
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
    </ConfigSection>
  )
}

// ==================== Heartbeat: Prompt Editor ====================

function PromptEditor() {
  const { t } = useTranslation()
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
      .catch(() => setError(t('automation.failedToLoadPrompt')))
      .finally(() => setLoading(false))
  }, [t])

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
      setError(t('common.failedToSave'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfigSection title={t('common.promptFile')} description={filePath || t('automation.promptFileDescription')}>
      {loading ? (
        <div className="text-sm text-text-muted">{t('common.loading')}</div>
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
              className="btn-primary-sm"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-green" />
                <span className="text-text-muted">{t('common.saved')}</span>
              </span>
            )}
            {error && (
              <span className="inline-flex items-center gap-1.5 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-red" />
                <span className="text-red">{error}</span>
              </span>
            )}
            {dirty && !saved && !error && (
              <span className="text-[11px] text-text-muted">{t('common.unsavedChanges')}</span>
            )}
          </div>
        </>
      )}
    </ConfigSection>
  )
}

// ==================== Heartbeat Tab ====================

function HeartbeatSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    api.config.load().then(setConfig).catch(console.warn)
  }, [])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[880px] mx-auto space-y-6">
        <div className="rounded-lg border border-border/50 bg-bg-secondary/50 px-4 py-3">
          <p className="text-[13px] text-text-muted leading-relaxed">
            {t('automation.heartbeatExplanation')}
          </p>
        </div>
        <StatusBar />
        {config && <HeartbeatConfigForm config={config} />}
        <PromptEditor />
      </div>
    </div>
  )
}

// ==================== Cron Section ====================

function CronSection() {
  const { t } = useTranslation()
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

  useEffect(() => {
    const id = setInterval(loadJobs, 15_000)
    return () => clearInterval(id)
  }, [loadJobs])

  const [error, setError] = useState<string | null>(null)

  const showError = (msg: string) => {
    setError(msg)
    setTimeout(() => setError(null), 3000)
  }

  const handleToggle = async (job: CronJob) => {
    try {
      await api.cron.update(job.id, { enabled: !job.enabled })
      await loadJobs()
    } catch {
      showError(t('automation.failedToToggleJob'))
    }
  }

  const handleRunNow = async (job: CronJob) => {
    try {
      await api.cron.runNow(job.id)
      await loadJobs()
    } catch {
      showError(t('automation.failedToRunJob'))
    }
  }

  const handleDelete = async (job: CronJob) => {
    if (job.name === '__heartbeat__') return
    try {
      await api.cron.remove(job.id)
      await loadJobs()
    } catch {
      showError(t('automation.failedToDeleteJob'))
    }
  }

  if (loading) {
    return <div className="text-text-muted text-sm py-4">{t('automation.loadingCronJobs')}</div>
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border/50 bg-bg-secondary/50 px-4 py-3">
        <p className="text-[13px] text-text-muted leading-relaxed">
          {t('automation.cronDescription')}
        </p>
      </div>
      {error && <div className="text-xs text-red">{error}</div>}
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{t('automation.jobsCount', { count: jobs.length })}</span>
        <button
          onClick={() => setShowAdd(true)}
          className="btn-secondary-sm"
        >
          + {t('common.add')}
        </button>
      </div>

      {showAdd && (
        <AddCronJobForm
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); loadJobs() }}
        />
      )}

      {jobs.length === 0 ? (
        <div className="text-text-muted text-sm text-center py-6">{t('automation.noCronJobs', 'No cron jobs')}</div>
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
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const isHeartbeat = job.name === '__heartbeat__'

  return (
    <div className={`rounded-lg border ${job.enabled ? 'border-border' : 'border-border/50 opacity-60'} bg-bg`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Toggle */}
        <Toggle size="sm" checked={job.enabled} onChange={() => onToggle()} />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${isHeartbeat ? 'text-purple' : 'text-text'}`}>
              {isHeartbeat ? '💓 heartbeat' : job.name}
            </span>
            <span className="text-xs text-text-muted">{job.id}</span>
            {job.state.lastStatus === 'error' && (
              <span className="text-xs text-red">
                {job.state.consecutiveErrors}x {t('automation.error', 'err')}
              </span>
            )}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {scheduleLabel(job.schedule)}
            {job.state.nextRunAtMs && (
              <span className="ml-2">• {t('automation.next', 'next')}: {formatDateTime(job.state.nextRunAtMs)}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onRunNow}
            title={t('automation.runNow', 'Run now')}
            className="p-1.5 rounded text-text-muted hover:text-accent hover:bg-bg-tertiary transition-colors text-xs"
          >
            ▶
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            title={t('automation.details', 'Details')}
            className="p-1.5 rounded text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors text-xs"
          >
            {expanded ? '▾' : '▸'}
          </button>
          {!isHeartbeat && (
            <button
              onClick={onDelete}
              title={t('common.delete')}
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
            <span className="text-text-muted">{t('automation.payload', 'Payload')}: </span>
            <pre className="inline text-text whitespace-pre-wrap break-all">{job.payload}</pre>
          </div>
          <div className="flex gap-4 text-text-muted">
            <span>{t('automation.lastRun', 'Last run')}: {job.state.lastRunAtMs ? `${timeAgo(t, job.state.lastRunAtMs)} (${formatDateTime(job.state.lastRunAtMs)})` : t('automation.never', 'never')}</span>
            <span>{t('automation.statusLabel', 'Status')}: {job.state.lastStatus ?? 'n/a'}</span>
            <span>{t('automation.created', 'Created')}: {formatDateTime(job.createdAt)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function AddCronJobForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [payload, setPayload] = useState('')
  const [schedKind, setSchedKind] = useState<'every' | 'cron' | 'at'>('every')
  const [schedValue, setSchedValue] = useState('1h')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !payload.trim()) {
      setError(t('automation.nameAndPayloadRequired', 'Name and payload are required'))
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
      setError(err instanceof Error ? err.message : t('automation.createFailed', 'Create failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-bg rounded-lg border border-accent/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">{t('automation.newCronJob', 'New Cron Job')}</span>
        <button type="button" onClick={onClose} className="text-text-muted hover:text-text text-xs">✕</button>
      </div>

      <input
        type="text"
        placeholder={t('automation.jobName', 'Job name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-text outline-none focus:border-accent"
      />

      <textarea
        placeholder={t('automation.payloadInstruction', 'Payload / instruction text')}
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
          className="btn-primary-sm"
        >
          {saving ? 'Creating...' : 'Create'}
        </button>
      </div>
    </form>
  )
}

// ==================== Page ====================

interface AutomationPageProps {
  spec: Extract<ViewSpec, { kind: 'automation' }>
}

/**
 * Automation page is sub-section-driven — `spec.params.section` picks which
 * surface renders. The Automation sidebar holds one row per section so each
 * section is its own tab in the editor area.
 */
export function AutomationPage({ spec }: AutomationPageProps) {
  const { t } = useTranslation()
  const section = spec.params.section
  const sectionTitles = getSectionTitles(t)
  const sectionDescriptions = getSectionDescriptions(t)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={sectionTitles[section]}
        description={sectionDescriptions[section]}
      />
      <div className="flex-1 flex flex-col min-h-0 px-4 md:px-6 py-5">
        <div className="flex-1 min-h-0">
          {section === 'flow' ? (
            <AutomationFlowSection />
          ) : section === 'heartbeat' ? (
            <HeartbeatSection />
          ) : section === 'cron' ? (
            <CronSection />
          ) : (
            <AutomationWebhookSection />
          )}
        </div>
      </div>
    </div>
  )
}
