import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, ChevronRight, Clock, Cpu, Hash, History, Inbox, KeyRound, ListChecks, LoaderCircle, MessageSquare, Play, RotateCcw, Search, Settings, SlidersHorizontal, Timer, TrendingUp, UserRound, X } from 'lucide-react'

import type { HeadlessTaskStatus, HeadlessTurnProgress } from '../api/headless'
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
  IssueTimeout,
  WikilinkIssueRef,
  WikilinkResolution,
} from '../api/issues'
import { DEFAULT_ISSUE_COMMENT_PROMPT, ISSUE_TIMEOUTS, issuesApi } from '../api/issues'

import {
  getAgentReadiness,
  getWorkspaceSessionDirectory,
  listAgentCredentials,
  updateResumeRuntime,
  type AgentCredentialReadiness,
  type AgentId,
  type AgentInfo,
  type PausedSessionRuntimeUpdate,
  type SavedCredential,
  type WorkspaceRuntimeModeSettings,
  type WorkspaceSessionDirectoryEntry,
} from './workspace/api'
import { AgentLaunchSelectors, credentialAccessLabel } from './workspace/AgentLaunchControls'
import {
  formatPinnedCapability,
  pinnedLaunchFromBinding,
  usePinnedRuntimeDraft,
} from '../hooks/usePinnedRuntimeDraft'
import { useIssueDetail } from '../hooks/useIssueDetail'
import { useWorkspaces } from '../contexts/workspaces-context'
import { formatRelativeTime } from '../lib/intl'
import { useInboxRead } from '../live/inbox-read'
import { useInboxSelection } from '../live/inbox-selection'
import { previewForEntry } from '../live/inbox-threads'
import { useWikilinkHandler } from '../live/wikilink'
import { useWorkspace } from '../tabs/store'
import { ConfirmDialog } from './ConfirmDialog'
import { AutomationHealthPill, CadencePill, CadenceSummary, PriorityIndicator } from './IssuesBoard'
import { IssueSectionNavigation } from './IssueSectionNavigation'
import { STATUS_META } from './issue-status-meta'
import { MarkdownContent } from './MarkdownContent'
import { hasTurnProgress, TurnProgress } from './TurnProgress'
import { MarkdownWhatEditor } from './MarkdownWhatEditor'
import { CenteredLoading } from './StateViews'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { resolveIssueAiSelection } from './issue-runtime-options'

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

// Shared control styling for the Inspector and its configuration dialog.
const railControl =
  'h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:shadow-[0_0_0_1px_var(--primary-muted)] disabled:cursor-not-allowed disabled:opacity-50 sm:h-9'

const CONFIGURABLE_AGENTS: readonly AgentId[] = ['claude', 'codex', 'cursor', 'agy', 'grok', 'omp', 'opencode', 'pi']

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

function InspectorField({
  label,
  icon,
  children,
  className = '',
}: {
  label: string
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      <div className="min-w-0 text-sm text-foreground">{children}</div>
    </div>
  )
}

function InspectorSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="border-t border-border/60 px-4 py-4 first:border-t-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75">{title}</h3>
      {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
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
  onChange: (next: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [draftValue, setDraftValue] = useState(value)
  const [committing, setCommitting] = useState(false)
  const sessionChoices = sessions
    .filter((session) =>
      session.resumeId
      && session.agent !== 'shell'
      && session.resumable
      && (session.presence ?? 'active') === 'active')
    .toSorted((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt)
  const selectedResumeId = value.startsWith('@resume-') ? value.slice(1) : null
  const draftResumeId = draftValue.startsWith('@resume-') ? draftValue.slice(1) : null
  const hasSelected = !selectedResumeId || sessionChoices.some((session) => session.resumeId === selectedResumeId)
  const contextFor = (session: WorkspaceSessionDirectoryEntry) => {
    const rawContext = session.interactive?.title
      || session.interactive?.name
      || session.latestExecution?.assistantPreview
    const normalizedContext = rawContext?.replace(/\s+/g, ' ').trim()
    if (!normalizedContext || normalizedContext === session.resumeId) return null
    return normalizedContext.length > 120
      ? `${normalizedContext.slice(0, 117).trimEnd()}…`
      : normalizedContext
  }
  const labelFor = (session: WorkspaceSessionDirectoryEntry) => {
    const activity = session.active ? 'active' : formatRelativeTime(session.updatedAt)
    return `${session.resumeId} · ${session.agent} · ${activity}`
  }

  const policyChoices = scheduled
    ? [
        { value: '@new-then-resume', label: t('issues.detail.assigneeNew'), description: t('issues.detail.assigneeNewDescription') },
        { value: '@new-each-run', label: t('issues.detail.assigneeWorkspaceScheduled'), description: t('issues.detail.assigneeEachDescription') },
      ]
    : [
        { value: '@human', label: t('issues.detail.human'), description: t('issues.detail.assigneeHumanDescription') },
        { value: '@unassigned', label: t('issues.detail.unassigned'), description: t('issues.detail.assigneeUnassignedDescription') },
      ]
  const selectedSession = selectedResumeId
    ? sessionChoices.find((session) => session.resumeId === selectedResumeId)
    : null
  const selectedPolicy = policyChoices.find((choice) => choice.value === value)
  const selectedLabel = selectedSession
    ? contextFor(selectedSession) ?? selectedSession.resumeId
    : selectedPolicy?.label ?? (selectedResumeId ? selectedResumeId : value)
  const selectedDescription = selectedSession
    ? `${selectedSession.agent} · ${selectedSession.active ? t('issues.detail.activeNow') : formatRelativeTime(selectedSession.updatedAt)}`
    : selectedPolicy?.description
  const draftSession = draftResumeId
    ? sessionChoices.find((session) => session.resumeId === draftResumeId)
    : null
  const draftPolicy = policyChoices.find((choice) => choice.value === draftValue)
  const draftLabel = draftSession
    ? contextFor(draftSession) ?? draftSession.resumeId
    : draftPolicy?.label ?? (draftResumeId ? draftResumeId : draftValue)
  const draftDescription = draftSession
    ? `${draftSession.resumeId} · ${draftSession.agent} · ${draftSession.active ? t('issues.detail.activeNow') : formatRelativeTime(draftSession.updatedAt)}`
    : draftPolicy?.description
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredSessions = normalizedQuery
    ? sessionChoices.filter((session) => [session.resumeId, session.agent, contextFor(session)]
        .filter(Boolean)
        .some((candidate) => candidate!.toLocaleLowerCase().includes(normalizedQuery)))
    : sessionChoices
  const close = () => {
    setOpen(false)
    setQuery('')
    setDraftValue(value)
  }
  const apply = async () => {
    if (draftValue === value || committing) return
    setCommitting(true)
    try {
      if (await onChange(draftValue)) {
        setOpen(false)
        setQuery('')
      }
    } finally {
      setCommitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (next) {
        setDraftValue(value)
        setOpen(true)
        return
      }
      if (!committing) close()
    }}>
      <button
        type="button"
        disabled={disabled}
        aria-label={t('issues.detail.assignee')}
        onClick={() => {
          setDraftValue(value)
          setOpen(true)
        }}
        className="oa-pressable flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <UserRound size={15} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">{selectedLabel}</span>
          {selectedDescription && <span className="block truncate text-[11px] text-muted-foreground">{selectedDescription}</span>}
        </span>
        <ChevronRight size={14} className="shrink-0 text-muted-foreground/70" aria-hidden />
      </button>
      <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>{t('issues.detail.chooseAssignee')}</DialogTitle>
          <DialogDescription>{t('issues.detail.chooseAssigneeDescription')}</DialogDescription>
        </DialogHeader>
        <label className="mx-4 flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-ring/30">
          <Search size={15} className="text-muted-foreground" aria-hidden />
          <span className="sr-only">{t('issues.detail.searchSessions')}</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('issues.detail.searchSessions')}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="min-h-0 max-w-full overflow-x-hidden overflow-y-auto px-2 pb-4">
          <p className="px-2 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            {t('issues.detail.assignmentPolicy')}
          </p>
          <div className="space-y-0.5">
            {policyChoices.map((choice) => (
              <AssigneeChoice
                key={choice.value}
                label={choice.label}
                description={choice.description}
                selected={draftValue === choice.value}
                onClick={() => setDraftValue(choice.value)}
              />
            ))}
          </div>
          <p className="mt-2 border-t border-border/60 px-2 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            {t('issues.detail.workspaceSessions')}
          </p>
          <div className="space-y-0.5">
            {!hasSelected && selectedResumeId && (
              <AssigneeChoice
                label={t('issues.detail.signedSession', { resumeId: selectedResumeId })}
                description={t('issues.detail.sessionUnavailable')}
                selected={draftValue === value}
                onClick={() => setDraftValue(value)}
              />
            )}
            {filteredSessions.map((session) => (
              <AssigneeChoice
                key={session.resumeId}
                label={contextFor(session) ?? session.resumeId}
                description={labelFor(session)}
                selected={draftResumeId === session.resumeId}
                onClick={() => setDraftValue(`@${session.resumeId}`)}
              />
            ))}
            {filteredSessions.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t('issues.detail.noSessionsFound')}</p>
            )}
          </div>
        </div>
        <DialogFooter className="mx-0 mb-0 min-w-0 flex-col items-stretch rounded-none px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 w-full max-w-full overflow-hidden text-left sm:mr-auto sm:flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
              {t('issues.detail.pendingAssignee')}
            </span>
            <span className="mt-0.5 block truncate text-sm font-medium text-foreground">{draftLabel}</span>
            {draftDescription && <span className="block truncate text-xs text-muted-foreground">{draftDescription}</span>}
          </div>
          <div className="flex w-full shrink-0 justify-end gap-2 sm:w-auto">
            <Button type="button" variant="outline" disabled={committing} onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={committing || draftValue === value} onClick={() => void apply()}>
              {committing ? t('issues.detail.assigning') : t('issues.detail.confirmAssignment')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AssigneeChoice({
  label,
  description,
  selected,
  onClick,
}: {
  label: string
  description?: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-md px-3 py-2 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        {description && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>}
      </span>
      {selected && <Check size={16} className="shrink-0 text-primary" aria-hidden />}
    </button>
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
        className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:size-9"
      >
        <Settings size={14} aria-hidden />
      </button>
    </>
  )
}

function credentialLabel(credential: SavedCredential | null | undefined): string {
  return credential ? credentialAccessLabel(credential) : ''
}

function issuePatchToRuntimeUpdate(patch: IssuePatch): PausedSessionRuntimeUpdate {
  const vault = Boolean(patch.credential)
  return {
    credentialSource: vault ? 'vault' : 'native',
    ...(vault ? { credentialSlug: patch.credential } : {}),
    model: patch.model ?? null,
    reasoningEffort: patch.effort ?? null,
  }
}

function runtimeUpdateToIssuePatch(
  update: PausedSessionRuntimeUpdate,
  inherit: boolean,
): IssuePatch {
  if (inherit) {
    return {
      credential: null,
      credentialSource: null,
      model: update.model ?? null,
      effort: update.reasoningEffort ?? null,
    }
  }
  return {
    credential: update.credentialSource === 'vault' ? update.credentialSlug ?? null : null,
    credentialSource: update.credentialSource === 'native' ? 'native' : null,
    model: update.model ?? null,
    effort: update.reasoningEffort ?? null,
  }
}

function ownerSessionBusy(session: WorkspaceSessionDirectoryEntry | undefined): boolean {
  return Boolean(
    session?.active
    || session?.interactive?.state === 'running'
    || session?.latestExecution?.status === 'running',
  )
}

function issueLaunchSeed(
  agent: string,
  issue: IssueDetailIssue,
  mode: WorkspaceRuntimeModeSettings | null,
): ReturnType<typeof pinnedLaunchFromBinding> {
  if (issue.credentialSource === 'native') {
    return pinnedLaunchFromBinding(agent, {
      credentialSource: 'native',
      model: issue.model,
      reasoningEffort: issue.effort,
    })
  }
  if (issue.credential) {
    return pinnedLaunchFromBinding(agent, {
      credentialSource: 'vault',
      credentialSlug: issue.credential,
      model: issue.model,
      reasoningEffort: issue.effort,
    })
  }
  const inherited = resolveIssueAiSelection({ mode, agent, issue })
  return pinnedLaunchFromBinding(agent, {
    credentialSource: inherited.accessMode,
    credentialSlug: inherited.credentialSlug,
    model: issue.model ?? inherited.model,
    reasoningEffort: issue.effort ?? inherited.reasoningEffort,
  })
}

function IssueAiEditor({
  wsId,
  issue,
  agent,
  agents,
  mode,
  credentials,
  disabled,
  bound,
  boundRuntime,
  onApply,
  onConfigureProvider,
}: {
  wsId: string
  issue: IssueDetailIssue
  agent: string | null
  agents: readonly AgentInfo[]
  mode: WorkspaceRuntimeModeSettings | null
  credentials: readonly SavedCredential[]
  disabled: boolean
  bound?: boolean
  boundRuntime?: WorkspaceSessionDirectoryEntry['runtime']
  onApply: (patch: IssuePatch, capability: { from: string; to: string }) => void
  onConfigureProvider: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const inheritsAccess = !bound && issue.credentialSource !== 'native' && !issue.credential
  const [inherit, setInherit] = useState(inheritsAccess)
  const agentId = agent ?? 'codex'
  const initial = bound
    ? pinnedLaunchFromBinding(agentId, boundRuntime)
    : issueLaunchSeed(agentId, issue, mode)
  const editor = usePinnedRuntimeDraft({
    workspaceId: wsId,
    agent: agentId,
    agents,
    initial,
    active: open,
  })

  useEffect(() => {
    if (!open) return
    setInherit(inheritsAccess)
  }, [inheritsAccess, open])

  const committed = bound
    ? {
        accessMode: (boundRuntime?.credentialSource === 'vault' ? 'vault' : 'native') as 'vault' | 'native',
        credentialSlug: boundRuntime?.credentialSource === 'vault' ? boundRuntime.credentialSlug : undefined,
        model: boundRuntime?.model,
        reasoningEffort: boundRuntime?.reasoningEffort,
        accessOrigin: 'issue' as const,
      }
    : resolveIssueAiSelection({ mode, agent, issue })
  const accessLabel = (modeValue: string, slug: string | undefined, fallbackCredential: SavedCredential | null) => (
    modeValue === 'vault' || modeValue.startsWith('vault:')
      ? credentialLabel(fallbackCredential)
        || slug
        || (modeValue.startsWith('vault:') ? modeValue.slice(6) : undefined)
        || t('issues.detail.savedAccess')
      : t('issues.detail.agentLogin')
  )
  const committedCredential = committed.credentialSlug
    ? credentials.find((candidate) => candidate.slug === committed.credentialSlug) ?? null
    : null
  const fallback = {
    access: t('issues.detail.agentLogin'),
    model: t('issues.detail.runtimeDecides'),
    effort: t('issues.detail.runtimeDecides'),
  }
  const summaryAccess = accessLabel(committed.accessMode, committed.credentialSlug, committedCredential)
  const summaryModel = bound
    ? committed.model ?? t('issues.detail.runtimeDecides')
    : committed.model ?? committedCredential?.resolvedModel ?? t('issues.detail.runtimeDecides')
  const summaryEffort = bound
    ? committed.reasoningEffort ?? t('issues.detail.runtimeDecides')
    : committed.reasoningEffort ?? committedCredential?.resolvedReasoningEffort ?? t('issues.detail.runtimeDecides')
  const draftCapability = inherit && !bound
    ? {
        access: t('issues.detail.followWorkspaceHeadless'),
        model: editor.capability(fallback).model,
        effort: editor.capability(fallback).effort,
      }
    : editor.capability(fallback)
  const provenance = bound
    ? t('issues.detail.sessionBinding')
    : committed.accessOrigin === 'workspace-fixed'
      ? t('issues.detail.workspaceHeadlessFixed')
      : committed.accessOrigin === 'workspace-recent'
        ? t('issues.detail.workspaceHeadlessRecent')
        : committed.accessOrigin === 'runtime'
          ? t('issues.detail.agentRuntimeDefault')
          : t('issues.detail.issueOverride')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        aria-label={t('issues.detail.aiConfiguration')}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="oa-pressable grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-secondary/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <KeyRound size={15} className="text-muted-foreground" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-foreground">{summaryAccess}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{summaryModel} · {summaryEffort}</span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground/75">{provenance}</span>
        </span>
        <ChevronRight size={14} className="text-muted-foreground/70" aria-hidden />
      </button>
      <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('issues.detail.aiConfiguration')}</DialogTitle>
          <DialogDescription>
            {t(bound
              ? 'issues.detail.sessionAiConfigurationDescription'
              : 'issues.detail.aiConfigurationDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!bound && (
            <label className="flex min-h-12 items-start gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <input
                className="mt-1"
                type="checkbox"
                checked={inherit}
                disabled={disabled}
                aria-label={t('issues.detail.followWorkspaceHeadless')}
                onChange={(event) => {
                  const next = event.target.checked
                  setInherit(next)
                  if (next) return
                  const resolved = resolveIssueAiSelection({ mode, agent, issue })
                  if (resolved.accessMode === 'vault' && resolved.credentialSlug) {
                    editor.config.selectCredential(resolved.credentialSlug)
                  } else {
                    editor.config.selectRuntimeDefault()
                  }
                }}
              />
              <span>
                <span className="block text-sm font-medium text-foreground">
                  {t('issues.detail.followWorkspaceHeadless')}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {t('issues.detail.aiAccessDescription')}
                </span>
              </span>
            </label>
          )}
          <fieldset disabled={disabled} className="min-w-0 space-y-3 disabled:opacity-60">
            <AgentLaunchSelectors
              config={editor.config}
              onConfigureProvider={onConfigureProvider}
              showRuntime={false}
              showAccess={bound || !inherit}
              toolbar
              layout="settings"
              menuPlacement="down"
              menuPositionerClassName="z-[80]"
            />
          </fieldset>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t(bound ? 'issues.detail.sessionAiAccessDescription' : 'issues.detail.aiAccessDescription')}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={() => {
              const update = editor.toRuntimeUpdate()
              onApply(runtimeUpdateToIssuePatch(update, Boolean(!bound && inherit)), {
                from: formatPinnedCapability({
                  access: summaryAccess,
                  model: summaryModel,
                  effort: summaryEffort,
                }),
                to: formatPinnedCapability(draftCapability),
              })
              setOpen(false)
            }}
          >
            {t('issues.detail.applyAiConfiguration')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SchedulePolicyEditor({
  issue,
  saving,
  onPatch,
}: {
  issue: IssueDetailIssue
  saving: boolean
  onPatch: (patch: IssuePatch) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (!issue.when) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={saving}
        onClick={() => setOpen(true)}
        className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <SlidersHorizontal size={13} aria-hidden />
        {t('issues.detail.editSchedule')}
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('issues.detail.scheduleSettings')}</DialogTitle>
          <DialogDescription>{t('issues.detail.scheduleSettingsDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {issue.when.kind === 'cron' && (
            <label className="flex min-h-12 items-start gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <input
                className="mt-1"
                type="checkbox"
                checked={issue.when.catchUp !== false}
                disabled={saving}
                aria-label={t('issues.detail.catchUp')}
                onChange={(event) => onPatch({ catchUp: event.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium text-foreground">{t('issues.detail.catchUp')}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {t('issues.detail.catchUpDescription')}
                </span>
              </span>
            </label>
          )}
          <label className="block space-y-1.5">
            <span className="flex items-center gap-2 text-xs font-medium text-foreground">
              <Timer size={14} aria-hidden />
              {t('issues.detail.timeout')}
            </span>
            <select
              className={`${railControl} w-full`}
              aria-label={t('issues.detail.timeout')}
              value={issue.timeout ?? ''}
              disabled={saving}
              onChange={(event) => {
                const value = event.target.value
                onPatch({ timeout: value === '' ? null : value as IssueTimeout })
              }}
            >
              <option value="">{t('issues.detail.timeoutNone')}</option>
              {ISSUE_TIMEOUTS.map((timeout) => (
                <option key={timeout} value={timeout}>{timeout}</option>
              ))}
            </select>
            <span className="block text-[11px] leading-relaxed text-muted-foreground">{t('issues.detail.timeoutHint')}</span>
          </label>
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CommentBehaviorEditor({
  value,
  disabled,
  onSave,
}: {
  value?: string
  disabled?: boolean
  onSave: (commentPrompt: string | null) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? DEFAULT_ISSUE_COMMENT_PROMPT)
  const [saving, setSaving] = useState(false)
  const stored = value ?? ''
  const custom = Boolean(stored)
  const dirty = draft !== (stored || DEFAULT_ISSUE_COMMENT_PROMPT)
  const preview = custom
    ? stored.split('\n').find((line) => line.trim()) ?? t('issues.detail.commentBehaviorCustom')
    : t('issues.detail.commentBehaviorDefaultHint')

  useEffect(() => {
    setDraft(value ?? DEFAULT_ISSUE_COMMENT_PROMPT)
  }, [value])

  const close = () => {
    if (saving) return
    setDraft(value ?? DEFAULT_ISSUE_COMMENT_PROMPT)
    setOpen(false)
  }

  const persist = async (commentPrompt: string | null) => {
    if (saving) return
    setSaving(true)
    try {
      const ok = await onSave(commentPrompt)
      if (ok !== false) {
        if (commentPrompt === null) setDraft(DEFAULT_ISSUE_COMMENT_PROMPT)
        setOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(value ?? DEFAULT_ISSUE_COMMENT_PROMPT)
          setOpen(true)
          return
        }
        close()
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={t('issues.detail.commentBehavior')}
        onClick={() => {
          setDraft(value ?? DEFAULT_ISSUE_COMMENT_PROMPT)
          setOpen(true)
        }}
        className="oa-pressable flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <MessageSquare size={15} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {custom ? t('issues.detail.commentBehaviorCustom') : t('issues.detail.default')}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">{preview}</span>
        </span>
        <ChevronRight size={14} className="shrink-0 text-muted-foreground/70" aria-hidden />
      </button>
      <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>{t('issues.detail.commentBehavior')}</DialogTitle>
          <DialogDescription>{t('issues.detail.commentPromptDescription')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-x-hidden overflow-y-auto px-4 pb-4">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">
              {t('issues.detail.commentPromptTokensLabel')}
            </p>
            <p className="mt-1 font-mono text-[11px] leading-snug text-muted-foreground">
              {t('issues.detail.commentPromptTokens')}
            </p>
          </div>
          <Textarea
            autoFocus
            value={draft}
            disabled={saving}
            aria-label={t('issues.detail.commentPrompt')}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-36 max-h-[min(24rem,50dvh)] resize-y overflow-y-auto font-mono text-[12.5px] leading-5"
          />
        </div>
        <DialogFooter className="mx-0 mb-0 min-w-0 flex-col items-stretch rounded-none px-4 py-3 sm:flex-row sm:items-center sm:justify-end">
          {custom ? (
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              className="sm:mr-auto"
              onClick={() => void persist(null)}
            >
              {t('issues.detail.commentPromptReset')}
            </Button>
          ) : null}
          <div className="flex w-full shrink-0 justify-end gap-2 sm:w-auto">
            <Button type="button" variant="outline" disabled={saving} onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={saving || !dirty}
              onClick={() => void persist(draft.trim() === DEFAULT_ISSUE_COMMENT_PROMPT ? null : draft)}
            >
              {saving ? t('issues.detail.whatSaving') : t('issues.detail.commentPromptSave')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PropertiesRail({
  wsId,
  issue,
  agents,
  issueDefaultAgent,
  defaultAgent,
  headlessRuntime,
  agentReadiness,
  sessions,
  saving,
  retrying,
  error,
  canRetry,
  canRunNow,
  onPatch,
  onRetry,
  onRunNow,
  onConfigureAgent,
  onRefreshSessions,
  sessionsLoaded,
}: {
  wsId: string
  issue: IssueDetailIssue
  agents: readonly AgentInfo[]
  issueDefaultAgent: string | null
  defaultAgent: string | null
  headlessRuntime: WorkspaceRuntimeModeSettings | null
  agentReadiness: Readonly<Record<string, AgentCredentialReadiness>>
  sessions: readonly WorkspaceSessionDirectoryEntry[]
  saving: boolean
  retrying: boolean
  error: string | null
  canRetry: boolean
  canRunNow: boolean
  onPatch: (patch: IssuePatch) => Promise<boolean>
  onRetry: () => Promise<void>
  onRunNow: () => Promise<void>
  onConfigureAgent: (agent: AgentId) => void
  onRefreshSessions: () => Promise<void>
  sessionsLoaded: boolean
}) {
  const { t } = useTranslation()
  const [confirmAction, setConfirmAction] = useState<'run' | 'retry' | null>(null)
  const [pendingCapability, setPendingCapability] = useState<{
    from: string
    to: string
    update: PausedSessionRuntimeUpdate
  } | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const meta = STATUS_META[issue.status]
  const issueDefaultInOptions = issueDefaultAgent && agents.some((a) => a.id === issueDefaultAgent) ? issueDefaultAgent : null
  const defaultInOptions = defaultAgent && agents.some((a) => a.id === defaultAgent) ? defaultAgent : null
  const ownerResumeId = issue.assignee.startsWith('@resume-')
    ? issue.assignee.slice(1)
    : null
  const ownerSession = ownerResumeId
    ? sessions.find((session) => session.resumeId === ownerResumeId)
    : undefined
  const effectiveAgent = ownerSession?.agent || issue.agent || issueDefaultInOptions || defaultInOptions || agents[0]?.id || null
  const selectedReadiness = effectiveAgent ? agentReadiness[effectiveAgent] : undefined
  const [credentialOptions, setCredentialOptions] = useState<{
    agent: string
    loading: boolean
    credentials: SavedCredential[]
  } | null>(null)
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

  const availableCredentials = credentialOptions?.agent === effectiveAgent
    ? credentialOptions.credentials
    : []
  const resolvedAi = resolveIssueAiSelection({ mode: headlessRuntime, agent: effectiveAgent, issue })
  const agentNeedsCredential = selectedReadiness?.requiresCredential === true
    && !selectedReadiness.ready
    && resolvedAi.accessMode === 'native'
  const automationHealthMessage = useMemo<string | null>(() => {
    const health = issue.automationHealth
    if (!health) return issue.when ? t('issues.detail.healthMessage.not_started') : null
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
    <aside
      id="issue-work-item"
      className="mt-5 min-w-0 w-full shrink-0 scroll-mt-20 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:mt-0 lg:self-start"
    >
      <div className="overflow-hidden rounded-xl border border-border bg-background lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
        <h3 className="sr-only">{t('issues.detail.workItem')}</h3>

        {issue.when && (
          <section className="oa-status-surface px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <AutomationHealthPill
                health={issue.automationHealth ?? {
                  state: 'not_started',
                  message: t('issues.detail.healthMessage.not_started'),
                }}
              />
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {t('issues.detail.lastRun')} · {issue.lastFiredAtMs
                  ? formatRelativeTime(issue.lastFiredAtMs)
                  : t('issues.detail.never')}
              </span>
            </div>
            {automationHealthMessage && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{automationHealthMessage}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {issue.lastFiredAtMs && (
                <a
                  href="#issue-runs"
                  className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('issues.detail.viewLastRun')}
                </a>
              )}
              {canRetry ? (
                <Button type="button" size="sm" disabled={retrying} onClick={() => setConfirmAction('retry')} className="ml-auto">
                  <RotateCcw size={12} aria-hidden />
                  {retrying ? t('issues.detail.retrying') : t('issues.detail.retryNow')}
                </Button>
              ) : canRunNow ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={retrying}
                  onClick={() => setConfirmAction('run')}
                  className="ml-auto"
                >
                  <Play size={12} aria-hidden />
                  {retrying ? t('issues.detail.runningNow') : t('issues.detail.runNow')}
                </Button>
              ) : null}
            </div>
          </section>
        )}

        <InspectorSection title={t('issues.detail.ownership')}>
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-2">
            <InspectorField
              label={t('issues.detail.status')}
              icon={<meta.Icon size={13} className={meta.className} aria-hidden />}
            >
              <select
                className={`${railControl} w-full`}
                value={issue.status}
                disabled={saving}
                aria-label={t('issues.detail.status')}
                onChange={(e) => onPatch({ status: e.target.value as IssueStatus })}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{t(`issues.status.${s}`)}</option>
                ))}
              </select>
            </InspectorField>
            <InspectorField
              label={t('issues.detail.priority')}
              icon={<PriorityIndicator priority={issue.priority} />}
            >
              <select
                className={`${railControl} w-full capitalize`}
                value={issue.priority}
                disabled={saving}
                aria-label={t('issues.detail.priority')}
                onChange={(e) => onPatch({ priority: e.target.value as IssuePriority })}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>{t(`issues.priority.${p}`)}</option>
                ))}
              </select>
            </InspectorField>
          </div>
          <InspectorField label={t('issues.detail.assignee')} className="mt-3">
            <AssigneeEditor
              value={issue.assignee}
              scheduled={Boolean(issue.when)}
              sessions={sessions}
              disabled={saving}
              onChange={(assignee) => onPatch({ assignee })}
            />
          </InspectorField>
        </InspectorSection>

        {issue.when && (
          <InspectorSection title={t('issues.detail.schedule')}>
            <CadenceSummary when={issue.when} />
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/50 pt-3 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock size={13} aria-hidden />
                {t('issues.detail.nextRun')}
              </span>
              <span className="tabular-nums text-foreground">
                {issue.nextDueAtMs ? formatRelativeTime(issue.nextDueAtMs) : '—'}
              </span>
            </div>
            <div className="mt-1 flex justify-end">
              <SchedulePolicyEditor issue={issue} saving={saving} onPatch={onPatch} />
            </div>
          </InspectorSection>
        )}

        <InspectorSection title={t('issues.detail.agent')}>
          {issue.when && (
            <>
              <InspectorField label={t('issues.detail.runtime')}>
                {ownerResumeId ? (
                  <div
                    className="flex min-h-10 items-center gap-2.5 rounded-md border border-border bg-muted/20 px-3 py-2"
                    title={t('issues.detail.sessionDeterminesRuntime')}
                  >
                    <Cpu size={14} className="text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {ownerSession?.agent ?? t('issues.detail.sessionOwned')}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{t('issues.detail.sessionBinding')}</span>
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    <AgentEditor
                      value={issue.agent}
                      issueDefaultAgent={issueDefaultAgent}
                      defaultAgent={defaultAgent}
                      options={agents}
                      readiness={agentReadiness}
                      disabled={saving}
                      onChange={(agent) => {
                        onPatch({
                          agent,
                          credential: null,
                          credentialSource: null,
                          model: null,
                          effort: null,
                        })
                      }}
                      onConfigure={onConfigureAgent}
                    />
                  </div>
                )}
              </InspectorField>

              <InspectorField label={t('issues.detail.aiConfiguration')} className="mt-3">
                <div className="flex min-w-0">
                  <IssueAiEditor
                    wsId={wsId}
                    issue={issue}
                    agent={effectiveAgent}
                    agents={agents}
                    mode={headlessRuntime}
                    credentials={availableCredentials}
                    disabled={saving || Boolean(ownerResumeId && (ownerSessionBusy(ownerSession) || (sessionsLoaded && !ownerSession)))}
                    bound={Boolean(ownerResumeId)}
                    boundRuntime={ownerSession?.runtime}
                    onConfigureProvider={() => {
                      if (effectiveAgent) onConfigureAgent(effectiveAgent as AgentId)
                    }}
                    onApply={(patch, capability) => {
                      if (!ownerResumeId) {
                        void onPatch(patch)
                        return
                      }
                      if (capability.from === capability.to) return
                      setRuntimeError(null)
                      setPendingCapability({
                        from: capability.from,
                        to: capability.to,
                        update: issuePatchToRuntimeUpdate(patch),
                      })
                    }}
                  />
                </div>
              </InspectorField>
              {ownerResumeId && ownerSessionBusy(ownerSession) && (
                <p className="mt-2 text-xs leading-snug text-muted-foreground">{t('issues.detail.sessionTurnInProgress')}</p>
              )}
              {ownerResumeId && sessionsLoaded && !ownerSession && (
                <p className="mt-2 text-xs leading-snug text-muted-foreground">{t('issues.detail.sessionUnavailable')}</p>
              )}
              {agentNeedsCredential && (
                <p className="mt-2 text-xs leading-snug text-warning">{t('issues.detail.aiCredentialMissing')}</p>
              )}
            </>
          )}
          <InspectorField
            label={t('issues.detail.commentBehavior')}
            className={issue.when ? 'mt-3' : undefined}
          >
            <CommentBehaviorEditor
              value={issue.commentPrompt}
              disabled={saving}
              onSave={(commentPrompt) => onPatch({ commentPrompt })}
            />
          </InspectorField>
        </InspectorSection>
      </div>
      {(error || runtimeError) && (
        <p role="alert" className="mt-2 text-xs leading-snug text-destructive">{error || runtimeError}</p>
      )}
      {pendingCapability && ownerResumeId && (
        <ConfirmDialog
          title={t('issues.detail.changeAssigneeCapabilitiesTitle')}
          message={t('issues.detail.changeAssigneeCapabilitiesMessage', {
            from: pendingCapability.from,
            to: pendingCapability.to,
          })}
          confirmLabel={t('issues.detail.changeAssigneeCapabilitiesConfirm')}
          cancelLabel={t('common.cancel')}
          workingLabel={t('issues.detail.changingAssigneeCapabilities')}
          variant="primary"
          onConfirm={async () => {
            try {
              await updateResumeRuntime(wsId, ownerResumeId, pendingCapability.update)
              await onRefreshSessions()
              setPendingCapability(null)
              setRuntimeError(null)
            } catch (cause) {
              setRuntimeError(cause instanceof Error ? cause.message : String(cause))
              throw cause
            }
          }}
          onClose={() => setPendingCapability(null)}
        />
      )}
      {confirmAction && (
        <ConfirmDialog
          title={t(confirmAction === 'retry' ? 'issues.detail.retryNowTitle' : 'issues.detail.runNowTitle')}
          message={t(confirmAction === 'retry' ? 'issues.detail.retryNowMessage' : 'issues.detail.runNowMessage')}
          confirmLabel={t(confirmAction === 'retry' ? 'issues.detail.retryNow' : 'issues.detail.runNow')}
          cancelLabel={t('common.cancel')}
          workingLabel={t(confirmAction === 'retry' ? 'issues.detail.retrying' : 'issues.detail.runningNow')}
          variant="primary"
          onConfirm={async () => {
            if (confirmAction === 'retry') await onRetry()
            else await onRunNow()
            setConfirmAction(null)
          }}
          onClose={() => { if (!retrying) setConfirmAction(null) }}
        />
      )}
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
    case 'timeout': return t('issues.detail.mutationField.timeout')
    case 'what': return t('issues.detail.mutationField.what')
    case 'commentPrompt': return t('issues.detail.mutationField.commentPrompt')
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

export function IssuePendingReply({
  targetResumeId,
  progress,
}: {
  targetResumeId: string
  progress?: HeadlessTurnProgress
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-3 border-t border-border/60 pt-2">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <LoaderCircle size={11} className="shrink-0 animate-spin text-primary" aria-hidden />
        <span>
          {t('issues.detail.waitingForPrefix')}{' '}
          <span className="font-mono text-foreground/75">@{targetResumeId}</span>{' '}
          {t('issues.detail.waitingForSuffix')}
        </span>
      </p>
      {hasTurnProgress(progress) && <TurnProgress progress={progress} />}
    </div>
  )
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
                      <IssuePendingReply
                        targetResumeId={delivery.targetResumeId}
                        progress={delivery.progress}
                      />
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
  const { agents, defaultAgent, issueDefaultAgent, workspaces, openAgentConfig, openHeadlessRun } = useWorkspaces()
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
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  // Set when a clicked `[[name]]` resolves to >1 target — drives the picker.
  const [picker, setPicker] = useState<WikilinkResolution | null>(null)
  const workspace = workspaces.find((candidate) => candidate.id === wsId) ?? null
  const workspaceIssueDefaultAgent = workspace?.runtimeSettings?.runtime.headless.defaultAgent
    ?? workspace?.runtimeSettings?.runtime.headless.recent.agent
    ?? issueDefaultAgent
  const workspaceLegacyDefaultAgent = workspace?.defaultAgent ?? defaultAgent

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

  const refreshSessions = useCallback(async () => {
    try {
      const directory = await getWorkspaceSessionDirectory(wsId)
      setSessionDirectory(Array.isArray(directory.sessions) ? directory.sessions : [])
    } catch {
      setSessionDirectory([])
    } finally {
      setSessionsLoaded(true)
    }
  }, [wsId])

  useEffect(() => {
    setSessionsLoaded(false)
    void refreshSessions()
  }, [refreshSessions])

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

  const onRunNow = useCallback(async () => {
    if (retrying) return
    setRetrying(true)
    setActionError(null)
    try {
      mutate(await issuesApi.runNow(wsId, id))
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
  const canRunNow = Boolean(
    issue.when
    && issue.status !== 'done'
    && issue.status !== 'canceled'
    && latestRun?.status !== 'running',
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
    <div className="mx-auto max-w-6xl px-4 py-5 md:px-6">
      {backToBoard}
      <main className="grid min-w-0 gap-x-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
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
          agents={agentOptions}
          issueDefaultAgent={workspaceIssueDefaultAgent}
          defaultAgent={workspaceLegacyDefaultAgent}
          headlessRuntime={workspace?.runtimeSettings?.runtime.headless ?? null}
          agentReadiness={agentReadiness}
          sessions={sessionDirectory}
          saving={saving}
          retrying={retrying}
          error={actionError}
          canRetry={canRetry}
          canRunNow={canRunNow}
          onPatch={onPatch}
          onRetry={onRetry}
          onRunNow={onRunNow}
          onConfigureAgent={(agent) => openAgentConfig(wsId, agent)}
          onRefreshSessions={refreshSessions}
          sessionsLoaded={sessionsLoaded}
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
