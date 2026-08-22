import { useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Check,
  Clock3,
  LayoutGrid,
  MessageSquare,
  RotateCcw,
  Search,
} from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatRelativeTime } from '../../lib/intl'
import type { SessionRecord, Workspace, WorkspaceSessionDirectory } from './api'
import { workspaceDisplayName, workspaceDisplayTitle } from './display'
import {
  joinWorkspaceHarnessSessions,
  type HarnessSession,
} from './harness-sessions'
import { harnessSessionSourceLabel } from './harness-session-presentation'
import { orderSessionsForSidebar } from './sidebar-order'

interface DialogFocusProps {
  restoreFocusRef?: RefObject<HTMLElement | null>
}

export interface WorkspacePickerDialogProps extends DialogFocusProps {
  harness?: 'chat' | 'auto-quant' | 'prediction'
  open: boolean
  workspaces: readonly Workspace[]
  currentWorkspaceId: string | null
  onOpenChange: (open: boolean) => void
  onSelectWorkspace: (workspaceId: string) => void
}

export function WorkspacePickerDialog(props: WorkspacePickerDialogProps): ReactElement {
  const { t } = useTranslation()
  const isAutoQuant = props.harness === 'auto-quant'
  const isPrediction = props.harness === 'prediction'
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (props.open) setQuery('')
  }, [props.open])

  const visibleWorkspaces = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return props.workspaces
    return props.workspaces.filter((workspace) => [
      workspace.displayName,
      workspace.tag,
      workspace.description,
    ].some((value) => value?.toLocaleLowerCase().includes(normalized)))
  }, [props.workspaces, query])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="flex h-[min(34rem,calc(100dvh-1rem))] w-[calc(100%-1rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:h-[32rem] sm:w-[calc(100%-2rem)] sm:max-w-2xl"
        initialFocus={searchRef}
        finalFocus={props.restoreFocusRef}
      >
        <DialogHeader className="border-b border-border/70 px-5 py-4 pr-12">
          <DialogTitle>{t('chat.switchWorkspace')}</DialogTitle>
          <DialogDescription>
            {isAutoQuant
              ? t('autoQuant.workspacePickerDescription')
              : isPrediction
                ? t('autoPrediction.workspacePickerDescription')
                : t('chat.workspacePickerDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border/60 px-4 py-3 sm:px-5">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
            <Search size={15} strokeWidth={2} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t('chat.workspaceSearchPlaceholder')}</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('chat.workspaceSearchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/65"
            />
          </label>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain p-2 sm:p-3">
          <span className="sr-only" role="status" aria-live="polite">
            {t('chat.workspaceResultCount', { count: visibleWorkspaces.length })}
          </span>
          {visibleWorkspaces.length === 0 ? (
            <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {t('chat.noWorkspaceMatches')}
            </div>
          ) : (
            <ul className="space-y-1">
              {visibleWorkspaces.map((workspace) => {
                const current = workspace.id === props.currentWorkspaceId
                const running = workspace.sessions.some((session) => session.state === 'running')
                const lastActiveAt = orderSessionsForSidebar(workspace.sessions)[0]?.lastActiveAt
                return (
                  <li key={workspace.id}>
                    <button
                      type="button"
                      onClick={() => props.onSelectWorkspace(workspace.id)}
                      aria-label={workspaceDisplayTitle(workspace)}
                      aria-current={current ? 'true' : undefined}
                      className={`oa-nav-row flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        current ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                        current ? 'border-primary/25 bg-primary/10 text-primary' : 'border-border/70 bg-secondary text-muted-foreground'
                      }`}>
                        <LayoutGrid size={16} strokeWidth={2} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium" title={workspaceDisplayTitle(workspace)}>
                            {workspaceDisplayName(workspace)}
                          </span>
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'bg-success' : 'bg-muted-foreground/30'}`} aria-hidden />
                        </span>
                        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                          {workspace.displayName?.trim() && workspace.displayName.trim() !== workspace.tag && (
                            <span className="truncate font-mono">{workspace.tag}</span>
                          )}
                          <span>{isAutoQuant
                            ? t('autoQuant.workspaceSessionCount', { count: workspace.sessions.length })
                            : isPrediction
                              ? t('autoPrediction.workspaceSessionCount', { count: workspace.sessions.length })
                              : t('chat.workspaceSessionCount', { count: workspace.sessions.length })}</span>
                          {lastActiveAt && <span>{formatRelativeTime(lastActiveAt)}</span>}
                        </span>
                      </span>
                      {current && <Check size={16} strokeWidth={2.2} className="shrink-0 text-primary" aria-hidden />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

type ConversationScope = 'current' | 'all'
type ConversationStateFilter = 'all' | SessionRecord['state'] | 'archived'

export interface ConversationBrowserDialogProps extends DialogFocusProps {
  harness?: 'chat' | 'auto-quant' | 'prediction'
  open: boolean
  workspaces: readonly Workspace[]
  directories?: ReadonlyMap<string, WorkspaceSessionDirectory>
  includeHeadlessBornSessions?: boolean
  currentWorkspaceId: string | null
  isRowActive?: (row: HarnessSession) => boolean
  activeSessionId?: string | null
  onOpenChange: (open: boolean) => void
  onSelectSession: (row: HarnessSession) => void
  onRestoreSession?: (row: HarnessSession) => void
}

export function ConversationBrowserDialog(props: ConversationBrowserDialogProps): ReactElement {
  const { t } = useTranslation()
  const isAutoQuant = props.harness === 'auto-quant'
  const isPrediction = props.harness === 'prediction'
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<ConversationScope>('current')
  const [stateFilter, setStateFilter] = useState<ConversationStateFilter>('all')
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!props.open) return
    setQuery('')
    setScope(props.currentWorkspaceId ? 'current' : 'all')
    setStateFilter('all')
  }, [props.currentWorkspaceId, props.open])

  const sessions = useMemo(() => props.workspaces
    .filter((workspace) => scope === 'all' || workspace.id === props.currentWorkspaceId)
    .flatMap((workspace) => {
      const rows = joinWorkspaceHarnessSessions(
        workspace,
        props.directories?.get(workspace.id) ?? null,
        {
          presence: stateFilter === 'archived' ? 'archived' : 'active',
          includeHeadlessBornSessions: props.includeHeadlessBornSessions,
        },
      )
      return rows.map((row) => ({ workspace, row }))
    })
    .sort((left, right) => {
      const running = Number(right.row.occupancyRunning) - Number(left.row.occupancyRunning)
      if (running !== 0) return running
      const occupancy = right.row.occupancyAt - left.row.occupancyAt
      if (occupancy !== 0) return occupancy
      return left.row.resumeId.localeCompare(right.row.resumeId)
    }), [props.currentWorkspaceId, props.directories, props.includeHeadlessBornSessions, props.workspaces, scope, stateFilter])

  const visibleSessions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return sessions.filter(({ workspace, row }) => {
      if (stateFilter === 'running' && !row.occupancyRunning) return false
      if (stateFilter === 'paused' && row.occupancyRunning) return false
      if (!normalized) return true
      return [
        row.title,
        row.resumeId,
        row.agent,
        row.issueId,
        row.directory?.latestExecution?.issueId,
        row.directory?.latestExecution?.assistantPreview,
        row.session?.name,
        workspace.displayName,
        workspace.tag,
      ].some((value) => value?.toLocaleLowerCase().includes(normalized))
    })
  }, [query, sessions, stateFilter])

  const scopeOptions: readonly { value: ConversationScope; label: string; disabled?: boolean }[] = [
    { value: 'current', label: t('chat.currentWorkspace'), disabled: props.currentWorkspaceId === null },
    { value: 'all', label: t('chat.allWorkspaces') },
  ]
  const stateOptions: readonly { value: ConversationStateFilter; label: string }[] = [
    { value: 'all', label: t('workspace.filterAll') },
    { value: 'running', label: t('workspace.filterRunning') },
    { value: 'paused', label: t('workspace.filterPaused') },
    { value: 'archived', label: t('workspace.filterArchived') },
  ]

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="flex h-[min(44rem,calc(100dvh-1rem))] w-[calc(100%-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:h-[min(40rem,calc(100dvh-2rem))] sm:w-[calc(100%-2rem)] sm:max-w-4xl"
        initialFocus={searchRef}
        finalFocus={props.restoreFocusRef}
      >
        <DialogHeader className="border-b border-border/70 px-5 py-4 pr-12">
          <DialogTitle>{isAutoQuant
            ? t('autoQuant.browseResearch')
            : isPrediction
              ? t('autoPrediction.browseResearch')
              : t('chat.browseWorkspace')}</DialogTitle>
          <DialogDescription>
            {isAutoQuant
              ? t('autoQuant.researchBrowserDescription')
              : isPrediction
                ? t('autoPrediction.researchBrowserDescription')
                : t('chat.conversationBrowserDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 border-b border-border/60 px-4 py-3 sm:px-5">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
            <Search size={15} strokeWidth={2} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">
              {isAutoQuant
                ? t('autoQuant.researchSearchPlaceholder')
                : isPrediction
                  ? t('autoPrediction.researchSearchPlaceholder')
                  : t('chat.conversationSearchPlaceholder')}
            </span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={isAutoQuant
                ? t('autoQuant.researchSearchPlaceholder')
                : isPrediction
                  ? t('autoPrediction.researchSearchPlaceholder')
                  : t('chat.conversationSearchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/65"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-lg bg-muted/70 p-0.5" role="group" aria-label={isAutoQuant
              ? t('autoQuant.researchScope')
              : isPrediction
                ? t('autoPrediction.researchScope')
                : t('chat.conversationScope')}>
              {scopeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  aria-pressed={scope === option.value}
                  onClick={() => setScope(option.value)}
                  className={`min-h-8 rounded-md px-2.5 text-xs transition-colors ${
                    scope === option.value ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  } disabled:cursor-default disabled:opacity-40`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1" role="group" aria-label={t('workspace.filterSessions')}>
              {stateOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={stateFilter === option.value}
                  onClick={() => setStateFilter(option.value)}
                  className={`min-h-8 rounded-md border px-2.5 text-xs transition-colors ${
                    stateFilter === option.value
                      ? 'border-primary/30 bg-primary/10 font-medium text-primary'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain p-2 sm:p-3">
          <span className="sr-only" role="status" aria-live="polite">
            {isAutoQuant
              ? t('autoQuant.researchResultCount', { count: visibleSessions.length })
              : isPrediction
                ? t('autoPrediction.researchResultCount', { count: visibleSessions.length })
                : t('chat.conversationResultCount', { count: visibleSessions.length })}
          </span>
          {visibleSessions.length === 0 ? (
            <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {isAutoQuant
                ? t('autoQuant.noResearchMatches')
                : isPrediction
                  ? t('autoPrediction.noResearchMatches')
                  : t('chat.noConversationMatches')}
            </div>
          ) : (
            <ul className="space-y-1">
              {visibleSessions.map(({ workspace, row }) => {
                const title = row.headlessOccupying
                  ? t('workspace.sessionRunning', { title: row.title })
                  : row.title
                const sourceLabel = harnessSessionSourceLabel(row.sourceKind, t)
                const active = props.isRowActive?.(row)
                  ?? (workspace.id === props.currentWorkspaceId && row.session?.id === props.activeSessionId)
                const occupancyIso = row.occupancyAt > 0
                  ? new Date(row.occupancyAt).toISOString()
                  : row.session?.lastActiveAt
                return (
                  <li key={`${workspace.id}:${row.resumeId}`} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (!row.headlessOccupying) props.onSelectSession(row)
                      }}
                      disabled={row.headlessOccupying}
                      aria-label={title}
                      aria-current={active ? 'page' : undefined}
                      className={`oa-nav-row flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        active ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-muted'
                      } disabled:cursor-default disabled:opacity-70`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                        row.occupancyRunning
                          ? 'border-success/25 bg-success/10 text-success'
                          : 'border-border/70 bg-secondary text-muted-foreground'
                      }`}>
                        <Bot size={16} strokeWidth={2} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-medium ${row.failed ? 'text-muted-foreground/70' : ''}`} title={row.title}>{row.title}</span>
                        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                          {sourceLabel && <span className="truncate">{sourceLabel}</span>}
                          <span className="truncate">{workspaceDisplayName(workspace)}</span>
                          <span className="font-mono">{row.agent}</span>
                          {occupancyIso && <span>{formatRelativeTime(occupancyIso)}</span>}
                        </span>
                      </span>
                      <span className={`hidden shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium sm:inline-flex ${
                        row.presence === 'archived'
                          ? 'bg-muted text-muted-foreground'
                          : row.occupancyRunning
                            ? 'bg-success/10 text-success'
                            : 'bg-muted text-muted-foreground'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${row.occupancyRunning && row.presence !== 'archived' ? 'bg-success' : 'bg-muted-foreground/45'}`} aria-hidden />
                        {row.presence === 'archived'
                          ? t('workspace.filterArchived')
                          : row.occupancyRunning ? t('workspace.filterRunning') : t('workspace.paused')}
                      </span>
                      <Clock3 size={14} strokeWidth={2} className="shrink-0 text-muted-foreground/50" aria-hidden />
                    </button>
                    {row.presence === 'archived' && props.onRestoreSession && (
                      <button
                        type="button"
                        onClick={() => props.onRestoreSession?.(row)}
                        disabled={row.headlessOccupying}
                        aria-label={t('workspace.restoreSession', { title: row.title })}
                        className="oa-icon-action flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <RotateCcw size={15} strokeWidth={2} aria-hidden />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
