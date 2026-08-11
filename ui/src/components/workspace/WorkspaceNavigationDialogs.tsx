import { useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Check,
  Clock3,
  LayoutGrid,
  MessageSquare,
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
import type { SessionRecord, Workspace } from './api'
import { workspaceDisplayName, workspaceDisplayTitle } from './display'
import { orderSessionsForSidebar } from './sidebar-order'

interface DialogFocusProps {
  restoreFocusRef?: RefObject<HTMLElement | null>
}

export interface WorkspacePickerDialogProps extends DialogFocusProps {
  open: boolean
  workspaces: readonly Workspace[]
  currentWorkspaceId: string | null
  onOpenChange: (open: boolean) => void
  onSelectWorkspace: (workspaceId: string) => void
}

export function WorkspacePickerDialog(props: WorkspacePickerDialogProps): ReactElement {
  const { t } = useTranslation()
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
          <DialogDescription>{t('chat.workspacePickerDescription')}</DialogDescription>
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
                          <span>{t('chat.workspaceSessionCount', { count: workspace.sessions.length })}</span>
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
type ConversationStateFilter = 'all' | SessionRecord['state']

export interface ConversationBrowserDialogProps extends DialogFocusProps {
  open: boolean
  workspaces: readonly Workspace[]
  currentWorkspaceId: string | null
  activeSessionId: string | null
  onOpenChange: (open: boolean) => void
  onSelectSession: (workspaceId: string, sessionId: string) => void
}

export function ConversationBrowserDialog(props: ConversationBrowserDialogProps): ReactElement {
  const { t } = useTranslation()
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
    .flatMap((workspace) => workspace.sessions.map((session) => ({ workspace, session })))
    .sort((a, b) => {
      const active = Date.parse(b.session.lastActiveAt) - Date.parse(a.session.lastActiveAt)
      if (active !== 0) return active
      return b.session.id.localeCompare(a.session.id)
    }), [props.currentWorkspaceId, props.workspaces, scope])

  const visibleSessions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return sessions.filter(({ workspace, session }) => {
      if (stateFilter !== 'all' && session.state !== stateFilter) return false
      if (!normalized) return true
      return [
        session.title,
        session.name,
        session.agent,
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
  ]

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="flex h-[min(44rem,calc(100dvh-1rem))] w-[calc(100%-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:h-[min(40rem,calc(100dvh-2rem))] sm:w-[calc(100%-2rem)] sm:max-w-4xl"
        initialFocus={searchRef}
        finalFocus={props.restoreFocusRef}
      >
        <DialogHeader className="border-b border-border/70 px-5 py-4 pr-12">
          <DialogTitle>{t('chat.browseWorkspace')}</DialogTitle>
          <DialogDescription>{t('chat.conversationBrowserDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 border-b border-border/60 px-4 py-3 sm:px-5">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
            <Search size={15} strokeWidth={2} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t('chat.conversationSearchPlaceholder')}</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('chat.conversationSearchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/65"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-lg bg-muted/70 p-0.5" role="group" aria-label={t('chat.conversationScope')}>
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
            {t('chat.conversationResultCount', { count: visibleSessions.length })}
          </span>
          {visibleSessions.length === 0 ? (
            <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {t('chat.noConversationMatches')}
            </div>
          ) : (
            <ul className="space-y-1">
              {visibleSessions.map(({ workspace, session }) => {
                const title = session.title?.trim() || session.name
                const active = workspace.id === props.currentWorkspaceId && session.id === props.activeSessionId
                return (
                  <li key={`${workspace.id}:${session.id}`}>
                    <button
                      type="button"
                      onClick={() => props.onSelectSession(workspace.id, session.id)}
                      aria-label={title}
                      aria-current={active ? 'page' : undefined}
                      className={`oa-nav-row flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        active ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                        session.state === 'running'
                          ? 'border-success/25 bg-success/10 text-success'
                          : 'border-border/70 bg-secondary text-muted-foreground'
                      }`}>
                        <Bot size={16} strokeWidth={2} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium" title={title}>{title}</span>
                        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                          <span className="truncate">{workspaceDisplayName(workspace)}</span>
                          <span className="font-mono">{session.agent}</span>
                          <span>{formatRelativeTime(session.lastActiveAt)}</span>
                        </span>
                      </span>
                      <span className={`hidden shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium sm:inline-flex ${
                        session.state === 'running'
                          ? 'bg-success/10 text-success'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${session.state === 'running' ? 'bg-success' : 'bg-muted-foreground/45'}`} aria-hidden />
                        {session.state === 'running' ? t('workspace.filterRunning') : t('workspace.paused')}
                      </span>
                      <Clock3 size={14} strokeWidth={2} className="shrink-0 text-muted-foreground/50" aria-hidden />
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
