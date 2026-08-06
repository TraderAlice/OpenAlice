import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Hash, History, Inbox, ListChecks, MessageSquare, RotateCcw, Settings, TrendingUp, X } from 'lucide-react'

import type { HeadlessTaskStatus } from '../api/headless'
import type { InboxEntry } from '../api/inbox'
import type {
  IssueDetail as IssueDetailData,
  IssueDetailIssue,
  IssuePatch,
  IssueActivityRecord,
  IssuePriority,
  IssueProvenanceRecord,
  IssueRunRecord,
  IssueStatus,
  WikilinkIssueRef,
  WikilinkResolution,
} from '../api/issues'
import type { ModelReasoningEffort } from '../api/types'
import type { ModelSemantics, Preset, PresetModel } from '../api/types'
import { configApi } from '../api/config'
import {
  detectWorkspaceCredential,
  getAgentReadiness,
  getWorkspaceSessionDirectory,
  listAgentCredentials,
  type AgentCredentialReadiness,
  type AgentId,
  type SavedCredential,
  type WorkspaceCredentialDetection,
  type WorkspaceSessionDirectoryEntry,
} from './workspace/api'
import { issuesApi } from '../api/issues'
import {
  WORKSPACE_AGENT_CONFIG_CHANGED_EVENT,
  type WorkspaceAgentConfigChangedDetail,
} from '../lib/workspaceAiEvents'
import { useIssueDetail } from '../hooks/useIssueDetail'
import { useWorkspaces } from '../contexts/workspaces-context'
import { formatRelativeTime } from '../lib/intl'
import { useInboxRead } from '../live/inbox-read'
import { useInboxSelection } from '../live/inbox-selection'
import { previewForEntry } from '../live/inbox-threads'
import { useWikilinkHandler } from '../live/wikilink'
import { useWorkspace } from '../tabs/store'
import { AutomationHealthPill, CadencePill, PriorityIndicator } from './IssuesBoard'
import { IssueSectionNavigation } from './IssueSectionNavigation'
import { STATUS_META } from './issue-status-meta'
import { MarkdownContent } from './MarkdownContent'
import { MarkdownWhatEditor } from './MarkdownWhatEditor'
import { CenteredLoading } from './StateViews'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  issueEffortOptions,
  issueModelOptions,
  issueModelSemantics,
} from './issue-runtime-options'

// Run-status pill tints — mirrors AutomationRunsSection's STATUS_STYLE so the
// Issue's independent operational history stays consistent with Automation.
const RUN_STATUS_STYLE: Record<HeadlessTaskStatus, string> = {
  running: 'bg-info/15 text-info',
  done: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  interrupted: 'bg-warning/15 text-warning',
}

// Dropdown ordering for the editable Properties rail. Mirrors the board's
// STATUS_ORDER (active work first) and the priority enum (most → least urgent).
const STATUS_OPTIONS: IssueStatus[] = ['in_progress', 'todo', 'backlog', 'done', 'canceled']
const PRIORITY_OPTIONS: IssuePriority[] = ['urgent', 'high', 'medium', 'low', 'none']

// Shared compact control styling for the rail's selects / inline input — the
// settings `inputClass`, trimmed for the narrow rail.
const railControl =
  'min-h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground outline-none transition-colors focus:border-primary/60 focus:shadow-[0_0_0_1px_var(--primary-muted)] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0'

const CONFIGURABLE_AGENTS: readonly AgentId[] = ['claude', 'codex', 'opencode', 'pi']

function isConfigurableAgent(agent: string | null | undefined): agent is AgentId {
  return CONFIGURABLE_AGENTS.includes(agent as AgentId)
}

function fmtDuration(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// ==================== Properties rail ====================

function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 max-[359px]:flex-col max-[359px]:gap-1">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right text-[13px] text-foreground max-[359px]:w-full max-[359px]:text-left">{children}</div>
    </div>
  )
}

/** Editable row: label on the left, an interactive control filling the right. */
function EditRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 max-[359px]:flex-col max-[359px]:items-stretch max-[359px]:gap-1">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 max-[359px]:w-full max-[359px]:justify-start">{children}</div>
    </div>
  )
}

function AssigneeEditor({
  value,
  scheduled,
  sessions,
  disabled,
  onChange,
}: {
  value: string
  scheduled: boolean
  sessions: readonly WorkspaceSessionDirectoryEntry[]
  disabled?: boolean
  onChange: (next: string) => void
}) {
  const { t } = useTranslation()
  const sessionChoices = sessions
    .filter((session) => session.resumeId && session.agent !== 'shell' && session.resumable)
    .toSorted((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt)
  const selectedResumeId = value.startsWith('@resume-') ? value.slice(1) : null
  const hasSelected = !selectedResumeId || sessionChoices.some((session) => session.resumeId === selectedResumeId)
  const labelFor = (session: WorkspaceSessionDirectoryEntry) => {
    const rawContext = session.interactive?.title
      || session.interactive?.name
      || session.latestExecution?.assistantPreview
    const normalizedContext = rawContext?.replace(/\s+/g, ' ').trim()
    const context = normalizedContext && normalizedContext !== session.resumeId
      ? normalizedContext.length > 28
        ? `${normalizedContext.slice(0, 27)}…`
        : normalizedContext
      : null
    const activity = session.active ? 'active' : formatRelativeTime(session.updatedAt)
    return `@${session.resumeId} · ${session.agent} · ${activity}${context ? ` — ${context}` : ''}`
  }

  return (
    <select
      className={railControl}
      value={value}
      disabled={disabled}
      aria-label={t('issues.detail.assignee')}
      onChange={(event) => onChange(event.target.value)}
    >
      {scheduled && <option value="@new-then-resume">{t('issues.detail.assigneeNew')}</option>}
      {scheduled && <option value="@new-each-run">{t('issues.detail.assigneeWorkspaceScheduled')}</option>}
      {!scheduled && <option value="@human">{t('issues.detail.human')}</option>}
      {!scheduled && <option value="@unassigned">{t('issues.detail.unassigned')}</option>}
      <optgroup label={t('issues.detail.workspaceSessions')}>
        {sessionChoices.map((session) => (
          <option key={session.resumeId} value={`@${session.resumeId}`}>
            {labelFor(session)}
          </option>
        ))}
        {!hasSelected && selectedResumeId && (
          <option value={value}>{t('issues.detail.signedSession', { resumeId: selectedResumeId })}</option>
        )}
      </optgroup>
    </select>
  )
}

function AgentEditor({
  value,
  issueDefaultAgent,
  defaultAgent,
  options,
  readiness,
  disabled,
  onChange,
  onConfigure,
}: {
  value?: string
  issueDefaultAgent: string | null
  defaultAgent: string | null
  options: readonly { id: string; displayName: string; installed?: boolean }[]
  readiness: Readonly<Record<string, AgentCredentialReadiness>>
  disabled?: boolean
  onChange: (next: string | null) => void
  onConfigure: (agent: AgentId) => void
}) {
  const { t } = useTranslation()
  const selected = value ?? ''
  const issueDefaultInOptions = issueDefaultAgent && options.some((a) => a.id === issueDefaultAgent) ? issueDefaultAgent : null
  const defaultInOptions = defaultAgent && options.some((a) => a.id === defaultAgent) ? defaultAgent : null
  const effectiveAgent = value || issueDefaultInOptions || defaultInOptions || options[0]?.id || null
  const canConfigure = isConfigurableAgent(effectiveAgent)
  const defaultLabel = issueDefaultInOptions
    ? t('issues.detail.defaultRuntime', {
        runtime: options.find((a) => a.id === issueDefaultInOptions)?.displayName ?? issueDefaultInOptions,
      })
    : defaultInOptions
    ? t('issues.detail.defaultWorkspaceRuntime', {
        runtime: options.find((a) => a.id === defaultInOptions)?.displayName ?? defaultInOptions,
      })
    : t('issues.detail.default')

  return (
    <>
      <select
        className={railControl}
        value={selected}
        disabled={disabled}
        aria-label={t('issues.detail.runtime')}
        onChange={(e) => {
          const next = e.target.value
          onChange(next ? next : null)
        }}
      >
        <option value="">{defaultLabel}</option>
        {options.map((agent) => {
          const row = readiness[agent.id]
          const suffix =
            agent.installed === false ? t('issues.detail.runtimeMissingSuffix')
            : row?.requiresCredential && !row.ready ? t('issues.detail.runtimeCredentialSuffix')
            : ''
          return (
            <option key={agent.id} value={agent.id}>
              {agent.displayName}{suffix}
            </option>
          )
        })}
        {value && !options.some((agent) => agent.id === value) && (
          <option value={value}>{value}</option>
        )}
      </select>
      <button
        type="button"
        disabled={!canConfigure}
        onClick={() => {
          if (canConfigure) onConfigure(effectiveAgent)
        }}
        title={canConfigure
          ? t('issues.detail.configureRuntime', { runtime: effectiveAgent })
          : t('issues.detail.noConfigurableRuntime')}
        aria-label={canConfigure
          ? t('issues.detail.configureRuntime', { runtime: effectiveAgent })
          : t('issues.detail.noConfigurableRuntime')}
        className="min-h-10 min-w-10 shrink-0 rounded-md border border-border bg-background px-2 py-1 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:min-w-0"
      >
        <Settings size={14} aria-hidden />
      </button>
    </>
  )
}

function ModelEditor({
  value,
  defaultModel,
  models,
  loadingDefault,
  disabled,
  onChange,
}: {
  value?: string
  defaultModel: string | null
  models: readonly PresetModel[]
  loadingDefault: boolean
  disabled?: boolean
  onChange: (next: string | null) => void
}) {
  const { t } = useTranslation()
  const [customMode, setCustomMode] = useState(Boolean(value))
  const [draft, setDraft] = useState(value ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setCustomMode(Boolean(value))
    setDraft(value ?? '')
  }, [value])
  const commit = () => {
    const next = draft.trim()
    if (next !== (value ?? '')) onChange(next || null)
    if (!next) setCustomMode(false)
  }
  const defaultLabel = loadingDefault
    ? t('issues.detail.defaultLoading')
    : defaultModel
      ? t('issues.detail.defaultValue', { value: defaultModel })
      : t('issues.detail.defaultRuntimeDecides')
  const knownValue = value && models.some((model) => model.id === value)

  return (
    <div className="min-w-0 flex-1">
      <select
        className={`${railControl} w-full`}
        value={customMode ? (knownValue ? value : 'custom') : 'default'}
        disabled={disabled}
        aria-label={t('issues.detail.runModel')}
        onChange={(event) => {
          if (event.target.value === 'default') {
            setCustomMode(false)
            setDraft('')
            if (value) onChange(null)
            return
          }
          if (event.target.value !== 'custom') {
            setCustomMode(true)
            setDraft(event.target.value)
            onChange(event.target.value)
            return
          }
          setCustomMode(true)
          queueMicrotask(() => inputRef.current?.focus())
        }}
      >
        <option value="default">{defaultLabel}</option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>{model.label}</option>
        ))}
        <option value="custom">
          {value ? t('issues.detail.overrideValue', { value }) : t('issues.detail.customModel')}
        </option>
      </select>
      {customMode && !knownValue && (
        <input
          ref={inputRef}
          className={`${railControl} mt-1 w-full`}
          value={draft}
          disabled={disabled}
          placeholder={t('issues.detail.nativeModelPlaceholder')}
          aria-label={t('issues.detail.customRunModel')}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
              event.currentTarget.blur()
            } else if (event.key === 'Escape' && !value) {
              setDraft('')
              setCustomMode(false)
            }
          }}
        />
      )}
    </div>
  )
}

function CredentialEditor({
  value,
  credentials,
  loading,
  workspaceCredential,
  disabled,
  onChange,
}: {
  value?: string
  credentials: readonly SavedCredential[]
  loading: boolean
  workspaceCredential: SavedCredential | null
  disabled?: boolean
  onChange: (next: string | null) => void
}) {
  const { t } = useTranslation()
  const defaultLabel = workspaceCredential
    ? t('issues.detail.defaultCredentialValue', {
        credential: workspaceCredential.label?.trim() || workspaceCredential.slug,
      })
    : t('issues.detail.defaultCredential')
  return (
    <select
      className={railControl}
      value={value ?? ''}
      disabled={disabled || loading}
      aria-label={t('issues.detail.runCredential')}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{loading ? t('issues.detail.defaultLoading') : defaultLabel}</option>
      {credentials.map((credential) => (
        <option key={credential.slug} value={credential.slug}>
          {credential.label?.trim() || credential.slug} · {credential.vendor}
        </option>
      ))}
      {value && !credentials.some((credential) => credential.slug === value) && (
        <option value={value}>{t('issues.detail.missingCredentialValue', { credential: value })}</option>
      )}
    </select>
  )
}

function workspaceEffortLabel(
  detected: WorkspaceCredentialDetection | null,
  loading: boolean,
  t: TFunction,
): string {
  if (loading) return t('issues.detail.defaultLoading')
  if (detected?.reasoningEffort) return t('issues.detail.defaultValue', { value: detected.reasoningEffort })
  if (detected?.reasoningMode === 'none') return t('issues.detail.defaultValue', { value: t('issues.detail.none') })
  if (detected?.reasoningMode === 'required') return t('issues.detail.defaultValue', { value: t('issues.detail.required') })
  if (detected?.reasoningDefaultEnabled === true) return t('issues.detail.defaultThinkingOn')
  if (detected?.reasoningDefaultEnabled === false) return t('issues.detail.defaultThinkingOff')
  return t('issues.detail.defaultRuntimeDecides')
}

function modelEffortLabel(
  semantics: ModelSemantics | null,
  fallback: WorkspaceCredentialDetection | null,
  loading: boolean,
  t: TFunction,
): string {
  const reasoning = semantics?.reasoning
  if (!reasoning) return workspaceEffortLabel(fallback, loading, t)
  if (reasoning.defaultEffort) return t('issues.detail.defaultValue', { value: reasoning.defaultEffort })
  if (reasoning.mode === 'none') return t('issues.detail.defaultValue', { value: t('issues.detail.none') })
  if (reasoning.mode === 'required') return t('issues.detail.defaultValue', { value: t('issues.detail.required') })
  if (reasoning.defaultEnabled === true) return t('issues.detail.defaultThinkingOn')
  if (reasoning.defaultEnabled === false) return t('issues.detail.defaultThinkingOff')
  return t('issues.detail.defaultRuntimeDecides')
}

function PropertySection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-background p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{title}</h3>
      {description && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{description}</p>}
      <div className="mt-2 divide-y divide-border/60">{children}</div>
    </section>
  )
}

function PropertiesRail({
  wsId,
  issue,
  agentOptions,
  issueDefaultAgent,
  defaultAgent,
  agentReadiness,
  sessions,
  saving,
  retrying,
  error,
  canRetry,
  onPatch,
  onRetry,
  onConfigureAgent,
}: {
  wsId: string
  issue: IssueDetailIssue
  agentOptions: readonly { id: string; displayName: string; installed?: boolean }[]
  issueDefaultAgent: string | null
  defaultAgent: string | null
  agentReadiness: Readonly<Record<string, AgentCredentialReadiness>>
  sessions: readonly WorkspaceSessionDirectoryEntry[]
  saving: boolean
  retrying: boolean
  error: string | null
  canRetry: boolean
  onPatch: (patch: IssuePatch) => void
  onRetry: () => void
  onConfigureAgent: (agent: AgentId) => void
}) {
  const { t } = useTranslation()
  const meta = STATUS_META[issue.status]
  const issueDefaultInOptions = issueDefaultAgent && agentOptions.some((a) => a.id === issueDefaultAgent) ? issueDefaultAgent : null
  const defaultInOptions = defaultAgent && agentOptions.some((a) => a.id === defaultAgent) ? defaultAgent : null
  const ownerResumeId = issue.assignee.startsWith('@resume-')
    ? issue.assignee.slice(1)
    : null
  const ownerSession = ownerResumeId
    ? sessions.find((session) => session.resumeId === ownerResumeId)
    : undefined
  const effectiveAgent = ownerSession?.agent || issue.agent || issueDefaultInOptions || defaultInOptions || agentOptions[0]?.id || null
  const selectedReadiness = effectiveAgent ? agentReadiness[effectiveAgent] : undefined
  const [credentialOptions, setCredentialOptions] = useState<{
    agent: string
    loading: boolean
    credentials: SavedCredential[]
  } | null>(null)
  const [presets, setPresets] = useState<readonly Preset[]>([])
  const [workspaceDefaults, setWorkspaceDefaults] = useState<{
    agent: string
    loading: boolean
    detected: WorkspaceCredentialDetection | null
  } | null>(null)
  const [workspaceDefaultsRevision, setWorkspaceDefaultsRevision] = useState(0)

  useEffect(() => {
    let live = true
    void configApi.getPresets()
      .then(({ presets: next }) => { if (live) setPresets(next) })
      .catch(() => { if (live) setPresets([]) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!effectiveAgent) {
      setCredentialOptions(null)
      return
    }
    let live = true
    const refresh = () => {
      setCredentialOptions((current) => current?.agent === effectiveAgent
        ? { ...current, loading: true }
        : { agent: effectiveAgent, loading: true, credentials: [] })
      void listAgentCredentials(effectiveAgent)
        .then((credentials) => {
          if (live) setCredentialOptions({ agent: effectiveAgent, loading: false, credentials })
        })
        .catch(() => {
          if (live) setCredentialOptions({ agent: effectiveAgent, loading: false, credentials: [] })
        })
    }
    refresh()
    window.addEventListener('openalice:credentials-changed', refresh)
    return () => {
      live = false
      window.removeEventListener('openalice:credentials-changed', refresh)
    }
  }, [effectiveAgent])

  useEffect(() => {
    const handleWorkspaceAgentConfigChanged = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceAgentConfigChangedDetail>).detail
      if (detail?.wsId === wsId && detail.agent === effectiveAgent) {
        setWorkspaceDefaultsRevision((revision) => revision + 1)
      }
    }
    window.addEventListener(
      WORKSPACE_AGENT_CONFIG_CHANGED_EVENT,
      handleWorkspaceAgentConfigChanged,
    )
    return () => {
      window.removeEventListener(
        WORKSPACE_AGENT_CONFIG_CHANGED_EVENT,
        handleWorkspaceAgentConfigChanged,
      )
    }
  }, [effectiveAgent, wsId])

  useEffect(() => {
    if (!isConfigurableAgent(effectiveAgent)) {
      setWorkspaceDefaults(null)
      return
    }
    let live = true
    setWorkspaceDefaults({ agent: effectiveAgent, loading: true, detected: null })
    void detectWorkspaceCredential(wsId, effectiveAgent)
      .then((detected) => {
        if (live) setWorkspaceDefaults({ agent: effectiveAgent, loading: false, detected })
      })
      .catch(() => {
        if (live) setWorkspaceDefaults({ agent: effectiveAgent, loading: false, detected: null })
      })
    return () => { live = false }
  }, [effectiveAgent, workspaceDefaultsRevision, wsId])

  const selectedWorkspaceDefaults = workspaceDefaults?.agent === effectiveAgent
    ? workspaceDefaults
    : null
  const availableCredentials = credentialOptions?.agent === effectiveAgent
    ? credentialOptions.credentials
    : []
  const credentialsLoading = credentialOptions?.agent === effectiveAgent
    ? credentialOptions.loading
    : Boolean(effectiveAgent)
  const selectedCredential = issue.credential
    ? availableCredentials.find((credential) => credential.slug === issue.credential) ?? null
    : null
  const workspaceCredential = selectedWorkspaceDefaults?.detected?.slug
    ? availableCredentials.find((credential) => credential.slug === selectedWorkspaceDefaults.detected?.slug) ?? null
    : null
  const effectiveCredential = selectedCredential ?? workspaceCredential
  const workspaceModel = selectedWorkspaceDefaults?.detected?.model ?? null
  const defaultModel = selectedCredential?.resolvedModel
    ?? workspaceModel
    ?? workspaceCredential?.resolvedModel
    ?? null
  const modelOptions = issueModelOptions({
    agent: effectiveAgent,
    credential: effectiveCredential,
    defaultModel,
    presets,
  })
  const effectiveModel = issue.model ?? defaultModel
  const selectedModelSemantics = issueModelSemantics(effectiveModel, modelOptions)
  const effortOptions = issueEffortOptions({
    agent: effectiveAgent,
    semantics: selectedModelSemantics,
    modelKnown: selectedModelSemantics !== null,
  })
  const agentNeedsCredential = selectedReadiness?.requiresCredential === true
    && !selectedReadiness.ready
    && !issue.credential
  const automationHealthMessage = useMemo<string | null>(() => {
    const health = issue.automationHealth
    if (!health) return null
    // Failure/interruption messages may contain authoritative runtime diagnostics.
    // Keep those verbatim; only localize launcher-owned, deterministic states.
    if (health.state === 'failed' || health.state === 'interrupted') return health.message
    if (health.state === 'inactive') {
      return t('issues.detail.healthMessage.inactive', {
        status: t(`issues.status.${issue.status}`),
      })
    }
    const blockedMessages = {
      'Assigned Session does not exist. Choose an active Session or @new-each-run.': 'missingSession',
      'Assigned Session is retired. Reassign the Issue before its next run.': 'retiredSession',
      'Assigned Session has no resumable runtime conversation yet.': 'unboundSession',
      'Schedule has no future fire. Check its expression and timestamp.': 'noFutureRun',
    } as const
    if (health.state === 'blocked') {
      const key = blockedMessages[health.message as keyof typeof blockedMessages]
      if (key === 'missingSession') return t('issues.detail.healthMessage.missingSession')
      if (key === 'retiredSession') return t('issues.detail.healthMessage.retiredSession')
      if (key === 'unboundSession') return t('issues.detail.healthMessage.unboundSession')
      if (key === 'noFutureRun') return t('issues.detail.healthMessage.noFutureRun')
      return health.message
    }
    if (health.state === 'not_started') return t('issues.detail.healthMessage.not_started')
    if (health.state === 'due') return t('issues.detail.healthMessage.due')
    if (health.state === 'running') return t('issues.detail.healthMessage.running')
    return t('issues.detail.healthMessage.healthy')
  }, [issue.automationHealth, issue.status, t])

  return (
    <aside id="issue-work-item" className="mt-5 min-w-0 w-full shrink-0 scroll-mt-20 space-y-3 lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:mt-0">
      <PropertySection
        title={t('issues.detail.workItem')}
        description={t('issues.detail.workItemDescription')}
      >
        <EditRow label={t('issues.detail.status')}>
          <meta.Icon size={14} className={`shrink-0 ${meta.className}`} />
          <select
            className={railControl}
            value={issue.status}
            disabled={saving}
            aria-label={t('issues.detail.status')}
            onChange={(e) => onPatch({ status: e.target.value as IssueStatus })}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`issues.status.${s}`)}
              </option>
            ))}
          </select>
        </EditRow>
        <EditRow label={t('issues.detail.priority')}>
          <PriorityIndicator priority={issue.priority} />
          <select
            className={`${railControl} capitalize`}
            value={issue.priority}
            disabled={saving}
            aria-label={t('issues.detail.priority')}
            onChange={(e) => onPatch({ priority: e.target.value as IssuePriority })}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {t(`issues.priority.${p}`)}
              </option>
            ))}
          </select>
        </EditRow>
        <EditRow label={t('issues.detail.assignee')}>
          <AssigneeEditor
            value={issue.assignee}
            scheduled={Boolean(issue.when)}
            sessions={sessions}
            disabled={saving}
            onChange={(assignee) => onPatch({ assignee })}
          />
        </EditRow>
        {issue.when && (
          <>
          <PropRow label={t('issues.detail.cadence')}><CadencePill when={issue.when} /></PropRow>
          {ownerResumeId ? (
            <PropRow label={t('issues.detail.runtime')}>
              <span title={t('issues.detail.sessionDeterminesRuntime')}>
                {ownerSession?.agent ?? t('issues.detail.sessionOwned')}
              </span>
            </PropRow>
          ) : (
            <EditRow label={t('issues.detail.runtime')}>
              <AgentEditor
                value={issue.agent}
                issueDefaultAgent={issueDefaultAgent}
                defaultAgent={defaultAgent}
                options={agentOptions}
                readiness={agentReadiness}
                disabled={saving}
                onChange={(agent) => {
                  onPatch({
                    agent,
                    credential: null,
                    model: null,
                    effort: null,
                  })
                }}
                onConfigure={onConfigureAgent}
              />
            </EditRow>
          )}
          {!ownerResumeId && (
            <>
              <EditRow label={t('issues.detail.credential')}>
                <CredentialEditor
                  value={issue.credential}
                  credentials={availableCredentials}
                  loading={credentialsLoading}
                  workspaceCredential={workspaceCredential}
                  disabled={saving}
                  onChange={(credential) => onPatch({
                    credential,
                    model: null,
                    effort: null,
                  })}
                />
              </EditRow>
              <EditRow label={t('issues.detail.model')}>
                <ModelEditor
                  value={issue.model}
                  defaultModel={defaultModel}
                  models={modelOptions}
                  loadingDefault={selectedWorkspaceDefaults?.loading ?? credentialsLoading}
                  disabled={saving}
                  onChange={(model) => {
                    const nextEffectiveModel = model ?? defaultModel
                    const nextSemantics = issueModelSemantics(nextEffectiveModel, modelOptions)
                    const nextEfforts = issueEffortOptions({
                      agent: effectiveAgent,
                      semantics: nextSemantics,
                      modelKnown: nextSemantics !== null,
                    })
                    onPatch({
                      model,
                      ...(issue.effort && !nextEfforts.includes(issue.effort) ? { effort: null } : {}),
                    })
                  }}
                />
              </EditRow>
              <EditRow label={t('issues.detail.effort')}>
                <select
                  className={railControl}
                  value={issue.effort ?? ''}
                  disabled={saving}
                  aria-label={t('issues.detail.runEffort')}
                  onChange={(event) => onPatch({
                    effort: event.target.value
                      ? event.target.value as ModelReasoningEffort
                      : null,
                  })}
                >
                  <option value="">
                    {modelEffortLabel(
                      selectedModelSemantics,
                      selectedCredential ? null : selectedWorkspaceDefaults?.detected ?? null,
                      selectedWorkspaceDefaults?.loading ?? credentialsLoading,
                      t,
                    )}
                  </option>
                  {effortOptions.map((effort) => (
                    <option key={effort} value={effort}>{effort}</option>
                  ))}
                </select>
              </EditRow>
            </>
          )}
          {agentNeedsCredential && (
            <p className="py-2 text-right text-[11px] leading-snug text-warning max-[359px]:text-left">
              {t('issues.detail.aiCredentialMissing')}
            </p>
          )}
          {issue.automationHealth && (
            <PropRow label={t('issues.detail.health')}>
              <div className="flex flex-col items-end gap-1 max-[359px]:items-start">
                <AutomationHealthPill health={issue.automationHealth} />
                <span className="max-w-44 text-[11px] leading-snug text-muted-foreground max-[359px]:max-w-none">
                  {automationHealthMessage}
                </span>
                {canRetry && (
                  <button
                    type="button"
                    disabled={retrying}
                    onClick={onRetry}
                    className="oa-pressable mt-1 inline-flex min-h-10 items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] font-medium text-warning transition-colors hover:border-warning/60 hover:bg-warning/15 disabled:cursor-wait disabled:opacity-50 sm:min-h-0"
                  >
                    <RotateCcw size={12} aria-hidden />
                    {retrying ? t('issues.detail.retrying') : t('issues.detail.retryNow')}
                  </button>
                )}
              </div>
            </PropRow>
          )}
          <PropRow label={t('issues.detail.lastRun')}>
            {issue.lastFiredAtMs
              ? formatRelativeTime(issue.lastFiredAtMs)
              : <span className="text-muted-foreground">{t('issues.detail.never')}</span>}
          </PropRow>
          <PropRow label={t('issues.detail.nextRun')}>
            {issue.nextDueAtMs ? formatRelativeTime(issue.nextDueAtMs) : <span className="text-muted-foreground">—</span>}
          </PropRow>
          </>
        )}
      </PropertySection>
      {error && <p className="mt-2 text-[11px] leading-snug text-destructive">{error}</p>}
    </aside>
  )
}

// ==================== Comment composer ====================

/**
 * Human comment composer. Comments are markdown, but persist in the structured
 * per-Issue JSON sidecar rather than the agent-editable What document.
 */
function CommentComposer({
  wsId,
  id,
  ownerResumeId,
  assignee,
  onPosted,
}: {
  wsId: string
  id: string
  ownerResumeId: string | null
  assignee: string
  onPosted: (next: IssueDetailData) => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      const next = await issuesApi.addComment(wsId, id, body)
      onPosted(next)
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }, [text, sending, wsId, id, onPosted])

  return (
    <div
      id="issue-reply"
      className="scroll-mt-20 rounded-xl border border-border bg-background px-3 py-3 shadow-sm transition-colors focus-within:border-primary/45"
    >
      <textarea
        rows={3}
        value={text}
        disabled={sending}
        placeholder={ownerResumeId
          ? t('issues.detail.commentTo', { resumeId: ownerResumeId })
          : t('issues.detail.askAboutIssue')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
        }}
        className="min-h-20 w-full resize-y bg-transparent px-1 py-1 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
      />
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
        <p className="min-w-0 flex-1 basis-full break-words text-[11px] leading-snug text-muted-foreground sm:basis-auto">
          {ownerResumeId
            ? <>{t('issues.detail.assignedSessionPrefix')} <span className="font-mono text-foreground/75">@{ownerResumeId}</span> {t('issues.detail.assignedSessionSuffix')}</>
            : assignee === '@new-then-resume'
              ? t('issues.detail.replyBeforeFirstRun')
              : t('issues.detail.replyWithoutOwner')}
        </p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={sending || text.trim().length === 0}
          className="oa-pressable min-h-10 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0"
        >
          {sending
            ? t('issues.detail.sending')
            : ownerResumeId
              ? t('issues.detail.commentNotify')
              : t('issues.detail.commentAsk')}
        </button>
      </div>
    </div>
  )
}

// ==================== Canonical What editor ====================

function WhatEditor({
  value,
  scheduled,
  onSave,
}: {
  value: string
  scheduled: boolean
  onSave: (what: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  return (
    <section id="issue-what" className="mt-4 scroll-mt-20 border-t border-border/60 pt-4">
      <div className="mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
          {t('issues.detail.what')}
        </h2>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground/65">
          {scheduled
            ? t('issues.detail.whatScheduledDescription')
            : t('issues.detail.whatDescription')}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {t('issues.detail.whatEditHint')}
        </p>
      </div>
      <MarkdownWhatEditor value={value} onSave={onSave} />
    </section>
  )
}

// ==================== Run history ====================

function RunRow({ run, onOpen }: { run: IssueRunRecord; onOpen: (run: IssueRunRecord) => void }) {
  const { t } = useTranslation()
  const displayStatus = run.failure?.kind === 'system_paused' || run.failure?.kind === 'launcher_restarted'
    ? 'interrupted'
    : run.status
  return (
    <li className="min-w-0 overflow-hidden rounded-lg border border-border bg-secondary px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${RUN_STATUS_STYLE[displayStatus]}`}
        >
          {t(`issues.detail.runStatus.${displayStatus}`)}
        </span>
        <span className="text-xs text-muted-foreground">{run.agent}</span>
        {run.model && <span className="text-xs text-muted-foreground">· {run.model}</span>}
        {run.effort && <span className="text-xs text-muted-foreground">· {run.effort}</span>}
        <span className="ml-auto text-xs text-muted-foreground" title={new Date(run.startedAt).toLocaleString()}>
          {formatRelativeTime(run.startedAt)}
        </span>
        <span className="text-xs text-muted-foreground/70">· {fmtDuration(run.durationMs)}</span>
        <button
          type="button"
          onClick={() => onOpen(run)}
          disabled={!run.resumable || run.status === 'running'}
          title={run.resumable
            ? t('issues.detail.openRunSessionTitle')
            : t('issues.detail.noResumableSessionTitle')}
          className="min-h-10 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0"
        >
          {t('issues.detail.openConversation')}
        </button>
      </div>
      {run.prompt && (
        <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-foreground/80" title={run.prompt}>
          {run.prompt}
        </p>
      )}
      {run.output?.assistantPreview && (
        <p className="mt-1.5 line-clamp-2 border-l-2 border-primary/25 pl-2 text-[12px] leading-snug text-muted-foreground" title={run.output.assistantPreview}>
          {run.output.assistantPreview}
        </p>
      )}
      {run.output && (run.output.toolCalls > 0 || run.output.toolFailures > 0) && (
        <p className={`mt-1 text-[11px] ${run.output.toolFailures > 0 ? 'text-destructive' : 'text-muted-foreground/60'}`}>
          {t('issues.detail.toolCalls', { count: run.output.toolCalls })}
          {run.output.toolFailures > 0
            ? ` · ${t('issues.detail.toolFailures', { count: run.output.toolFailures })}`
            : ''}
        </p>
      )}
      {run.failure && (
        <div className={`mt-2 rounded-md border px-2.5 py-2 ${
          run.failure.kind === 'system_paused' || run.failure.kind === 'launcher_restarted'
            ? 'border-warning/25 bg-warning/10'
            : 'border-destructive/25 bg-destructive/10'
        }`}>
          <p className={`text-[12px] font-medium ${
            run.failure.kind === 'system_paused' || run.failure.kind === 'launcher_restarted'
              ? 'text-warning'
              : 'text-destructive'
          }`}>
            {run.failure.title}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{run.failure.message}</p>
        </div>
      )}
      {run.error && <p className="mt-1 text-[12px] text-destructive">{run.error}</p>}
    </li>
  )
}

// ==================== Inbox reports (issue → inbox) ====================

/**
 * The inbox reports this issue produced — the issue→inbox direction of the
 * cross-link (each entry's server-stamped `origin.issueId` is this issue).
 * Each row jumps to the Inbox, selecting + marking-read that entry. Rendered
 * only when there are reports; an empty report list would just be noise beside
 * the independent collaboration Activity and operational Runs sections.
 */
function InboxReportsSection({
  reports,
  onOpen,
}: {
  reports: InboxEntry[]
  onOpen: (entryId: string) => void
}) {
  const { t } = useTranslation()
  if (reports.length === 0) return null
  return (
    <section id="issue-inbox-reports" className="mt-8 scroll-mt-20">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
        {t('issues.detail.inboxReports')}
      </h3>
      <ul className="space-y-2">
        {reports.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onOpen(entry.id)}
              title={t('issues.detail.openInInbox')}
              className="group flex w-full items-center gap-2.5 rounded-lg border border-border bg-secondary px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted"
            >
              <Inbox size={14} className="shrink-0 text-muted-foreground/70 transition-colors group-hover:text-primary" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/80">
                {previewForEntry(entry) || t('issues.detail.emptyPush')}
              </span>
              <span
                className="ml-auto shrink-0 text-xs text-muted-foreground"
                title={new Date(entry.ts).toLocaleString()}
              >
                {formatRelativeTime(entry.ts)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ==================== Issue activity (changes + comments) ====================

function provenanceActionLabel(action: IssueProvenanceRecord['action'], t: TFunction): string {
  return t(`issues.detail.provenanceAction.${action}`)
}

function mutationFieldLabel(field: string, t: TFunction): string {
  switch (field) {
    case 'title': return t('issues.detail.mutationField.title')
    case 'status': return t('issues.detail.mutationField.status')
    case 'priority': return t('issues.detail.mutationField.priority')
    case 'assignee': return t('issues.detail.mutationField.assignee')
    case 'schedule': return t('issues.detail.mutationField.schedule')
    case 'runtime': return t('issues.detail.mutationField.runtime')
    case 'credential': return t('issues.detail.mutationField.credential')
    case 'model': return t('issues.detail.mutationField.model')
    case 'effort': return t('issues.detail.mutationField.effort')
    case 'what': return t('issues.detail.mutationField.what')
    default: return field
  }
}

function unknownOriginLabel(reason: string, t: TFunction): string {
  if (reason === 'direct-file-edit') return t('issues.detail.directFileEdit')
  if (reason === 'concurrent-workspace-edit') return t('issues.detail.concurrentEditUnknown')
  return t('issues.detail.unknownOrigin', { reason: reason.replaceAll('-', ' ') })
}

function mutationValue(field: string, value: string, t: TFunction): string {
  if (field === 'assignee') {
    if (value === '@new-then-resume') return t('issues.detail.mutationValue.newSessionKeepOwner')
    if (value === '@new-each-run') return t('issues.detail.mutationValue.newSessionEachRun')
    if (value === '@human') return t('issues.detail.human')
    if (value === '@unassigned') return t('issues.detail.unassigned')
  }
  if (field === 'status' && STATUS_OPTIONS.includes(value as IssueStatus)) {
    return t(`issues.status.${value as IssueStatus}`)
  }
  if (field === 'priority' && PRIORITY_OPTIONS.includes(value as IssuePriority)) {
    return t(`issues.priority.${value as IssuePriority}`)
  }
  if (field === 'schedule') {
    try {
      const schedule = JSON.parse(value) as { kind?: string; at?: string; every?: string; cron?: string; timezone?: string }
      if (schedule.kind === 'at' && schedule.at) {
        return t('issues.detail.mutationValue.once', { at: schedule.at })
      }
      if (schedule.kind === 'every' && schedule.every) {
        return t('issues.detail.mutationValue.every', { every: schedule.every })
      }
      if (schedule.kind === 'cron') return `${schedule.cron}${schedule.timezone ? ` · ${schedule.timezone}` : ''}`
    } catch {
      // Older audit rows can still carry a hand-written value; show it safely.
    }
  }
  return value
}

function mutationSummary(
  change: { field: string; before?: string; after?: string },
  t: TFunction,
): string {
  const label = mutationFieldLabel(change.field, t)
  if (change.before === undefined && change.after === undefined) {
    return t('issues.detail.mutationSummary.edited', { field: label })
  }
  if (change.before === undefined) {
    return t('issues.detail.mutationSummary.set', {
      field: label,
      value: mutationValue(change.field, change.after!, t),
    })
  }
  if (change.after === undefined) return t('issues.detail.mutationSummary.cleared', { field: label })
  return t('issues.detail.mutationSummary.changed', {
    field: label,
    before: mutationValue(change.field, change.before, t),
    after: mutationValue(change.field, change.after, t),
  })
}

export function IssueActivity({
  activity,
  onOpenSession,
  wsId,
  issueId,
  ownerResumeId,
  assignee,
  onPosted,
}: {
  activity: IssueActivityRecord[]
  onOpenSession: (record: IssueProvenanceRecord) => Promise<void>
  wsId: string
  issueId: string
  ownerResumeId: string | null
  assignee: string
  onPosted: (next: IssueDetailData) => void
}) {
  const { t } = useTranslation()
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [identityPopoverId, setIdentityPopoverId] = useState<string | null>(null)

  const openSession = async (record: IssueProvenanceRecord) => {
    setIdentityPopoverId(null)
    setOpeningId(record.id)
    setOpenError(null)
    try {
      await onOpenSession(record)
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err))
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <section id="issue-activity" className="mt-8 scroll-mt-20">
      <div className="mb-3 flex items-baseline justify-between gap-3 border-t border-border/60 pt-5">
        <h2 className="text-sm font-semibold text-foreground">{t('issues.detail.activity')}</h2>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          {t('issues.detail.activityDescription')}
        </span>
      </div>
      {activity.length === 0 ? (
        <p className="mb-3 rounded-lg border border-dashed border-border px-4 py-4 text-center text-xs text-muted-foreground">
          {t('issues.detail.noActivity')}
        </p>
      ) : (
        <ul className="relative mb-4 space-y-3 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-border">
          {activity.map((item) => {
            if (item.kind === 'comment') {
              const { comment } = item
              const delivery = comment.delivery
              return (
                <li key={`comment:${comment.id}`} className="relative pl-8">
                  <span className="absolute left-[3px] top-3 z-10 grid h-[18px] w-[18px] place-items-center rounded-full border border-border bg-background text-primary">
                    <MessageSquare size={10} aria-hidden />
                  </span>
                  <article className={`rounded-xl border bg-secondary px-4 py-3 ${comment.replyTo ? 'ml-3 border-primary/25' : 'border-border'}`}>
                    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/85">{comment.author}</span>
                      {comment.replyTo && (
                        <span className="rounded bg-muted px-1.5 py-0.5">{t('issues.detail.reply')}</span>
                      )}
                      <time className="ml-auto" dateTime={comment.at} title={new Date(comment.at).toLocaleString()}>
                        {formatRelativeTime(item.at)}
                      </time>
                    </div>
                    <MarkdownContent text={comment.markdown} />
                    {delivery?.state === 'pending' && (
                      <p className="mt-3 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                        {t('issues.detail.waitingForPrefix')}{' '}
                        <span className="font-mono text-foreground/75">@{delivery.targetResumeId}</span>{' '}
                        {t('issues.detail.waitingForSuffix')}
                      </p>
                    )}
                    {delivery?.state === 'failed' && (
                      <p className="mt-3 rounded-md border border-warning/25 bg-warning/10 px-2.5 py-2 text-[11px] leading-snug text-warning">
                        {t('issues.detail.replyFailed', { error: delivery.error })}
                      </p>
                    )}
                  </article>
                </li>
              )
            }
            const record = item
            const origin = record.origin
            const isSession = origin.kind === 'session'
            const originLabel = isSession
              ? `${origin.agent} · ${origin.resumeId}`
              : origin.kind === 'human'
                ? t('issues.detail.human')
                : origin.kind === 'external'
                  ? t('issues.detail.externalOrigin', { system: origin.system })
                  : unknownOriginLabel(origin.reason, t)
            return (
              <li key={`provenance:${record.id}`} className="relative flex min-w-0 items-start gap-2.5 py-1 pl-8">
                <span className="absolute left-[3px] top-2 z-10 grid h-[18px] w-[18px] place-items-center rounded-full border border-border bg-background text-muted-foreground">
                  <History size={10} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-muted-foreground">
                    {isSession ? (
                      <Popover
                        open={identityPopoverId === record.id}
                        onOpenChange={(open) => setIdentityPopoverId(open ? record.id : null)}
                      >
                        <PopoverTrigger
                          render={<button
                            type="button"
                            aria-label={t('issues.detail.showSessionDetails', { origin: originLabel })}
                            disabled={openingId !== null}
                            className="inline-flex min-h-10 items-center rounded-sm font-medium text-foreground/80 underline decoration-border underline-offset-2 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-wait disabled:opacity-50 sm:min-h-0"
                          />}
                        >
                            {originLabel}
                        </PopoverTrigger>
                        <PopoverContent
                            id={`issue-session-${record.id}`}
                            role="dialog"
                            aria-label={t('issues.detail.sessionDialog', { resumeId: origin.resumeId })}
                            align="start"
                            sideOffset={8}
                            initialFocus={false}
                            className="z-30 w-72 max-w-[calc(100vw-3rem)] gap-0 rounded-xl border border-border/70 bg-secondary p-3 text-left shadow-lg ring-0"
                          >
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                              {t('issues.detail.session')}
                            </p>
                            <p className="mt-1 text-[12px] font-medium text-foreground">{origin.agent}</p>
                            <p className="mt-0.5 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
                              {origin.resumeId}
                            </p>
                            <button
                              type="button"
                              onClick={() => void openSession(record)}
                              disabled={openingId !== null}
                              className="oa-pressable mt-3 min-h-10 w-full rounded-lg bg-primary px-3 py-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-50"
                            >
                              {openingId === record.id
                                ? t('issues.detail.opening')
                                : t('issues.detail.openConversation')}
                            </button>
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <span className="font-medium text-foreground/80">{originLabel}</span>
                    )}{' '}
                    {provenanceActionLabel(record.action, t)} ·{' '}
                    <span title={new Date(record.at).toLocaleString()}>{formatRelativeTime(record.at)}</span>
                  </div>
                  {record.mutation && (
                    <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-muted-foreground/80">
                      {record.mutation.fields.map((change) => (
                        <li key={change.field}>{mutationSummary(change, t)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {openError && (
        <p className="mt-2 text-xs text-destructive">
          {t('issues.detail.openSessionFailed', { error: openError })}
        </p>
      )}
      <CommentComposer
        wsId={wsId}
        id={issueId}
        ownerResumeId={ownerResumeId}
        assignee={assignee}
        onPosted={onPosted}
      />
    </section>
  )
}

function RunsSection({
  runs,
  onOpen,
}: {
  runs: IssueRunRecord[]
  onOpen: (run: IssueRunRecord) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  if (runs.length === 0) return null
  const visible = expanded ? runs : runs.slice(0, 4)
  return (
    <section id="issue-runs" className="mt-8 scroll-mt-20 rounded-xl border border-border bg-secondary/45 px-3 py-3 sm:px-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('issues.detail.runs')}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t('issues.detail.runsDescription')}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{runs.length}</span>
      </div>
      <ul className="space-y-2">
        {visible.map((run) => <RunRow key={run.taskId} run={run} onOpen={onOpen} />)}
      </ul>
      {runs.length > 4 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="oa-pressable mt-3 min-h-10 w-full rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-h-0"
        >
          {expanded
            ? t('issues.detail.showRecentRuns')
            : t('issues.detail.showMoreRuns', { count: runs.length - 4 })}
        </button>
      )}
    </section>
  )
}

// ==================== Wikilink disambiguation picker ====================

/**
 * Inline picker shown when a `[[name]]` in the body resolves to MORE THAN ONE
 * target (entity + issue(s), or the same name claimed by issues in >1
 * workspace). A name is a global handle, so the click can't pick for the user —
 * this enumerates the candidates by workspace (the "wsId-precise" affordance).
 * A unique token never reaches here (the handler navigates straight through).
 */
function WikilinkPicker({
  resolution,
  onClose,
  onEntity,
  onIssue,
}: {
  resolution: WikilinkResolution
  onClose: () => void
  onEntity: (name: string) => void
  onIssue: (ref: WikilinkIssueRef) => void
}) {
  const { t } = useTranslation()
  const EntityIcon = resolution.entity?.type === 'asset' ? TrendingUp : Hash
  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-border bg-secondary p-4 shadow-xl"
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
            <span className="font-mono normal-case text-foreground">[[{resolution.name}]]</span>{' '}
            {t('issues.detail.matchesSeveral')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('issues.detail.close')}
            className="-mr-1 -mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>
        <p className="mb-3 text-[12px] leading-snug text-muted-foreground">
          {t('issues.detail.pickWikilinkTarget')}
        </p>
        <ul className="space-y-1.5">
          {resolution.entity && (
            <li>
              <button
                type="button"
                onClick={() => onEntity(resolution.entity!.name)}
                title={t('issues.detail.openTrackedEntity', { name: resolution.entity.name })}
                className="group flex w-full items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted"
              >
                <EntityIcon size={14} className="shrink-0 text-muted-foreground/70 transition-colors group-hover:text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
                  {resolution.entity.name}
                </span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {resolution.entity.type}
                </span>
              </button>
            </li>
          )}
          {resolution.issues.map((iss) => (
            <li key={`${iss.wsId}:${iss.id}`}>
              <button
                type="button"
                onClick={() => onIssue(iss)}
                title={t('issues.detail.openIssueInWorkspace', { id: iss.id, workspace: iss.wsTag })}
                className="group flex w-full items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted"
              >
                <ListChecks size={14} className="shrink-0 text-muted-foreground/70 transition-colors group-hover:text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{iss.title}</span>
                <span
                  className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                  title={t('issues.workspaceTitle', {
                    workspace: iss.wsTag,
                    id: iss.wsId.slice(0, 8),
                  })}
                >
                  {iss.wsTag}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ==================== Detail view ====================

/**
 * Linear-style issue detail (Phase 2b — interactive). The identity header stays
 * first at every width. On narrow screens, the Properties work-item controls
 * follow it before the potentially long What and Activity flow; desktop keeps
 * those controls in the right rail. Runs stay in an independent operational
 * section. Properties expose status /
 * priority / assignee editable inline (each write PATCHes and applies the
 * server-returned detail — authoritative, refetch-free). The scheduled agent
 * runtime is editable because it is operational routing; schedule cadence and
 * fire prompt remain file-owned frontmatter.
 */
interface IssueDetailProps {
  wsId: string
  id: string
  backLabel?: string
  onBack?: () => void
  onOpenIssue?: (ref: WikilinkIssueRef) => void
}

export function IssueDetail({
  wsId,
  id,
  backLabel,
  onBack,
  onOpenIssue,
}: IssueDetailProps) {
  const { t } = useTranslation()
  const { data, error, loading, mutate } = useIssueDetail(wsId, id)
  const { agents, defaultAgent, issueDefaultAgent, openAgentConfig, openHeadlessRun } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const selectInboxEntry = useInboxSelection((s) => s.select)
  const markInboxRead = useInboxRead((s) => s.markRead)
  // Reuse the canonical `[[name]]` navigation (jump to Tracked + select the
  // entity) — see live/wikilink. We only override the click to first RESOLVE
  // the token across both namespaces (entity + issues).
  const gotoEntity = useWikilinkHandler()

  const [saving, setSaving] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [agentReadiness, setAgentReadiness] = useState<Record<string, AgentCredentialReadiness>>({})
  const [sessionDirectory, setSessionDirectory] = useState<readonly WorkspaceSessionDirectoryEntry[]>([])
  // Set when a clicked `[[name]]` resolves to >1 target — drives the picker.
  const [picker, setPicker] = useState<WikilinkResolution | null>(null)

  useEffect(() => {
    let live = true
    getAgentReadiness(wsId)
      .then((bundle) => {
        if (live) setAgentReadiness(bundle.agents)
      })
      .catch(() => {
        if (live) setAgentReadiness({})
      })
    return () => { live = false }
  }, [wsId])

  useEffect(() => {
    let live = true
    getWorkspaceSessionDirectory(wsId)
      .then((directory) => {
        if (live) setSessionDirectory(Array.isArray(directory.sessions) ? directory.sessions : [])
      })
      .catch(() => {
        if (live) setSessionDirectory([])
      })
    return () => { live = false }
  }, [wsId])

  const gotoIssue = useCallback(
    (ref: WikilinkIssueRef) => {
      if (onOpenIssue) {
        onOpenIssue(ref)
        return
      }
      setSidebar('issue')
      openOrFocus({ kind: 'issue-detail', params: { wsId: ref.wsId, id: ref.id } })
    },
    [onOpenIssue, openOrFocus, setSidebar],
  )

  // Open the Inbox at a specific entry (the issue→inbox cross-link). Mirrors the
  // sidebar's select-and-read, then surfaces the Inbox tab + sidebar.
  const gotoInbox = useCallback(
    (entryId: string) => {
      selectInboxEntry(entryId)
      markInboxRead(entryId)
      setSidebar('inbox')
      openOrFocus({ kind: 'inbox', params: {} })
    },
    [selectInboxEntry, markInboxRead, setSidebar, openOrFocus],
  )

  const openProvenanceSession = useCallback(
    async (record: IssueProvenanceRecord) => {
      if (record.origin.kind !== 'session') return
      setSidebar('chat')
      await openHeadlessRun(record.origin.workspaceId, record.origin.resumeId, {
        title: `${data?.issue.title ?? id} · ${record.action}`,
      })
    },
    [data?.issue.title, id, openHeadlessRun, setSidebar],
  )

  // Clicking a `[[name]]` in the body resolves it across BOTH namespaces. A
  // unique target navigates straight through (entity → Tracked, issue →
  // wsId-precise detail); a collision opens the disambiguation picker. The key
  // arrives lowercased from MarkdownContent (entity keys + the resolver match
  // are both case-insensitive). On resolver failure we fall back to the
  // default Tracked jump.
  const onWikilink = useCallback(
    async (key: string) => {
      try {
        const res = await issuesApi.resolveWikilink(key)
        const count = (res.entity ? 1 : 0) + res.issues.length
        if (count > 1) {
          setPicker(res)
        } else if (res.entity) {
          gotoEntity(res.entity.name)
        } else if (res.issues[0]) {
          gotoIssue(res.issues[0])
        } else {
          gotoEntity(key) // nothing resolved — preserve prior behaviour
        }
      } catch {
        gotoEntity(key)
      }
    },
    [gotoEntity, gotoIssue],
  )

  const agentOptions = agents.filter(
    (agent) => agent.kind !== 'utility',
  )

  const onPatch = useCallback(
    async (patch: IssuePatch): Promise<boolean> => {
      setSaving(true)
      setActionError(null)
      try {
        const next = await issuesApi.update(wsId, id, patch)
        mutate(next)
        return true
      } catch (e) {
        // The selects are bound to the (unchanged) server data, so they revert
        // on their own; we just surface why.
        setActionError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setSaving(false)
      }
    },
    [wsId, id, mutate],
  )

  const onRetry = useCallback(async () => {
    if (retrying) return
    setRetrying(true)
    setActionError(null)
    try {
      mutate(await issuesApi.retry(wsId, id))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setRetrying(false)
    }
  }, [retrying, wsId, id, mutate])

  const backToBoard = (
    <button
      type="button"
      onClick={() => {
        if (onBack) {
          onBack()
          return
        }
        setSidebar('issue')
        openOrFocus({ kind: 'issue', params: {} })
      }}
      className="mb-2 inline-flex min-h-10 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground sm:mb-4 sm:min-h-0"
    >
      <ArrowLeft size={13} /> {backLabel ?? t('nav.item.issue')}
    </button>
  )

  const stableOwnerResumeId = data?.issue.assignee.startsWith('@resume-')
    ? data.issue.assignee.slice(1)
    : null

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-5 md:px-6">
        {backToBoard}
        {loading ? (
          <CenteredLoading />
        ) : (
          <div className="rounded-lg border border-border bg-secondary px-6 py-12 text-center">
            <ListChecks size={24} className="mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-sm text-destructive">
              {t('issues.detail.loadError', { error: error ?? t('issues.unknownError') })}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground/70">
              {wsId.slice(0, 8)} / {id}
            </p>
          </div>
        )}
      </div>
    )
  }

  const { issue, runs } = data
  const latestRun = runs[0]
  const canRetry = Boolean(
    issue.when
    && latestRun?.failure?.retryable
    && (latestRun.status === 'failed' || latestRun.status === 'interrupted'),
  )
  const comments = data.comments ?? []
  const inboxReports = data.inboxReports ?? []
  const provenance = data.provenance ?? []
  const activity = data.activity ?? [
    ...provenance
      .filter((record) => record.action !== 'commented')
      .map((record) => ({ ...record, kind: 'change' as const })),
    ...comments.map((comment) => ({
      kind: 'comment' as const,
      id: comment.id,
      at: Date.parse(comment.at),
      comment,
    })),
  ].filter((record) => Number.isFinite(record.at)).sort((a, b) => a.at - b.at)
  return (
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-6">
      {backToBoard}
      <main className="grid min-w-0 gap-x-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <header className="min-w-0 lg:col-start-1 lg:row-start-1">
          <div className="mb-1 flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
            <span className="max-w-full break-all font-mono text-[11px] leading-snug text-muted-foreground/70">{id}</span>
            {issue.when && <CadencePill when={issue.when} />}
          </div>
          <h1 className="text-xl font-semibold text-foreground">{issue.title}</h1>
        </header>
        <IssueSectionNavigation
          hasRuns={runs.length > 0}
          hasInboxReports={inboxReports.length > 0}
        />
        <PropertiesRail
          wsId={wsId}
          issue={issue}
          agentOptions={agentOptions}
          issueDefaultAgent={issueDefaultAgent}
          defaultAgent={defaultAgent}
          agentReadiness={agentReadiness}
          sessions={sessionDirectory}
          saving={saving}
          retrying={retrying}
          error={actionError}
          canRetry={canRetry}
          onPatch={onPatch}
          onRetry={() => void onRetry()}
          onConfigureAgent={(agent) => openAgentConfig(wsId, agent)}
        />
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <WhatEditor
            key={`${wsId}:${id}`}
            value={issue.what}
            scheduled={Boolean(issue.when)}
            onSave={(what) => onPatch({ what })}
          />
          <IssueActivity
            activity={activity}
            onOpenSession={openProvenanceSession}
            wsId={wsId}
            issueId={id}
            ownerResumeId={stableOwnerResumeId}
            assignee={issue.assignee}
            onPosted={mutate}
          />
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-3">
          <RunsSection
            runs={runs}
            onOpen={(run) => {
              setSidebar('chat')
              void openHeadlessRun(run.wsId, run.resumeId, {
                title: `${issue.title} · ${run.agent}`,
              })
            }}
          />
          <InboxReportsSection reports={inboxReports} onOpen={gotoInbox} />
        </div>
      </main>
      {picker && (
        <WikilinkPicker
          resolution={picker}
          onClose={() => setPicker(null)}
          onEntity={(name) => {
            setPicker(null)
            gotoEntity(name)
          }}
          onIssue={(ref) => {
            setPicker(null)
            gotoIssue(ref)
          }}
        />
      )}
    </div>
  )
}
