import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  ClipboardCheck,
  Compass,
  GitBranch,
  ListChecks,
  Loader2,
  Play,
  Radar,
  Settings,
} from 'lucide-react'
import '@xterm/xterm/css/xterm.css'

import { COMMANDER_WORKSPACE_ID, type CommanderOpenInput } from '../components/workspace/api'
import {
  AgentLaunchDetails,
  AgentLaunchSelectors,
  type AgentLaunchSelectorsHandle,
} from '../components/workspace/AgentLaunchControls'
import { SessionSettingsDialog } from '../components/workspace/SessionSettingsDialog'
import { SessionTakeoverBubble } from '../components/workspace/SessionTakeoverDialog'
import { TerminalView } from '../components/workspace/Terminal'
import { WebSessionView } from '../components/workspace/WebSessionView'
import { Button } from '../components/ui/button'
import { isImeComposing } from '../components/form'
import { PrimaryNavigationContext } from '../contexts/PrimaryNavigationContext'
import { useWorkspaces } from '../contexts/workspaces-context'
import { useAgentLaunchConfig, useAgentLaunchPreferences } from '../hooks/useAgentLaunchConfig'
import { useAgentRuntimes } from '../hooks/useAgentRuntimes'
import { isWorkspaceAiAgent } from '../lib/agentRuntime'
import { AgentRuntimeIcon } from '../lib/agentRuntimeIcon'
import { useWorkspace } from '../tabs/store'

interface CommanderPageProps {
  readonly visible?: boolean
}

const STARTER_SPECS = [
  {
    id: 'triage',
    icon: ClipboardCheck,
    titleKey: 'commander.starterTriageTitle',
    promptKey: 'commander.starterTriagePrompt',
  },
  {
    id: 'delegate',
    icon: GitBranch,
    titleKey: 'commander.starterDelegateTitle',
    promptKey: 'commander.starterDelegatePrompt',
  },
  {
    id: 'audit',
    icon: Radar,
    titleKey: 'commander.starterAuditTitle',
    promptKey: 'commander.starterAuditPrompt',
  },
] as const

export function CommanderPage({ visible = true }: CommanderPageProps) {
  const { t } = useTranslation()
  const promptId = useId()
  const primaryNavigation = useContext(PrimaryNavigationContext)
  const { recordSuccessfulUse } = useAgentRuntimes()
  const {
    agents,
    defaultAgent,
    commander,
    commanderLoaded,
    commanderError,
    refreshCommander,
    openCommander,
    pauseSession,
    setSessionDisplayName,
    updateSessionRuntime,
    openAgentConfig,
  } = useWorkspaces()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const setSidebar = useWorkspace((state) => state.setSidebar)

  const [draft, setDraft] = useState('')
  const [launching, setLaunching] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const launchSelectorsRef = useRef<AgentLaunchSelectorsHandle>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const autoOpenedSessionRef = useRef<string | null>(null)

  const runtimeAgents = useMemo(() => agents.filter((agent) => agent.kind !== 'utility'), [agents])
  const launchPreferences = useAgentLaunchPreferences()
  const launchConfig = useAgentLaunchConfig({
    agents: runtimeAgents,
    defaultAgent,
    preferences: launchPreferences,
    workspaceId: COMMANDER_WORKSPACE_ID,
    hasWorkspace: true,
  })
  const effectiveAgent = launchConfig.effectiveAgent

  const session = commander?.initialized ? commander.session : null
  const sessionAgentInfo = useMemo(
    () => (session ? agents.find((candidate) => candidate.id === session.agent) ?? null : null),
    [agents, session],
  )
  const sessionWebCapable = Boolean(
    session && (session.surface === 'webpi' || sessionAgentInfo?.capabilities.web),
  )
  const sessionRunningWeb = Boolean(
    session && session.state === 'running' && session.surface === 'webpi',
  )
  const sessionRunningTerminal = Boolean(
    session && session.state === 'running' && (session.surface ?? 'terminal') === 'terminal',
  )
  const needsReopen = Boolean(session && !sessionRunningWeb && !sessionRunningTerminal)

  const reopenExisting = useCallback(async () => {
    setReopening(true)
    setError(null)
    try {
      await openCommander()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('commander.resumeError'))
    } finally {
      setReopening(false)
    }
  }, [openCommander, t])

  useEffect(() => {
    if (!visible || !session || !needsReopen || !sessionWebCapable) return
    if (autoOpenedSessionRef.current === session.id) return
    autoOpenedSessionRef.current = session.id
    void reopenExisting()
  }, [needsReopen, reopenExisting, session, sessionWebCapable, visible])

  useEffect(() => {
    if (!session || sessionRunningWeb || sessionRunningTerminal) {
      autoOpenedSessionRef.current = null
    }
  }, [session, sessionRunningTerminal, sessionRunningWeb])

  const goConfigureProvider = () => {
    setSidebar('settings')
    openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })
  }

  const adjustCommanderAi = () => {
    if (isWorkspaceAiAgent(effectiveAgent)) {
      openAgentConfig(COMMANDER_WORKSPACE_ID, effectiveAgent, 'ai')
      return
    }
    goConfigureProvider()
  }

  const openDispatch = () => {
    setSidebar('issue')
    openOrFocus({ kind: 'issue', params: {} })
  }

  const handleOpenSettings = () => {
    if (session) {
      setSettingsOpen(true)
      return
    }
    adjustCommanderAi()
  }

  const launch = async (explicitPrompt?: string): Promise<void> => {
    if (launching || !launchConfig.credentialSelectionReady) return
    if (!effectiveAgent) {
      launchSelectorsRef.current?.openAgentMenu()
      return
    }
    if (launchConfig.needsProviderSetup) {
      goConfigureProvider()
      return
    }
    setLaunching(true)
    setError(null)
    try {
      const trimmed = explicitPrompt?.trim()
      const input: CommanderOpenInput = {
        ...(trimmed ? { prompt: trimmed } : {}),
        agent: effectiveAgent,
        ...(launchConfig.launchCredentialSlug !== undefined
          ? { credentialSlug: launchConfig.launchCredentialSlug }
          : {}),
        ...(launchConfig.accessMode === 'native' ? { credentialSource: 'native' as const } : {}),
        ...(launchConfig.launchModel ? { model: launchConfig.launchModel } : {}),
        ...(launchConfig.launchReasoningEffort
          ? { reasoningEffort: launchConfig.launchReasoningEffort }
          : {}),
      }
      await openCommander(input)
      void recordSuccessfulUse(effectiveAgent).catch(() => undefined)
      setDraft('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('commander.launchError'))
    } finally {
      setLaunching(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !isImeComposing(event)) {
      if (!draft.trim()) return
      event.preventDefault()
      void launch(draft)
    }
  }

  const activeWorkers = commander?.activeWorkers ?? 0
  const unreadReports = commander?.unreadReports ?? 0
  const statusPill = activeWorkers > 0
    ? {
        label: t('commander.statusCoordinating', { count: activeWorkers }),
        dotClass: 'bg-primary',
        pillClass: 'border-primary/30 bg-primary/10 text-primary',
      }
    : unreadReports > 0
      ? {
          label: t('commander.pendingReports', { count: unreadReports }),
          dotClass: 'bg-amber-500',
          pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
        }
      : {
          label: t('commander.statusReady'),
          dotClass: 'bg-emerald-500',
          pillClass: 'border-border/70 bg-secondary/60 text-muted-foreground',
        }

  const activeRuntimeLabel = session ? runtimeLabel(session.agent, agents) : null

  return (
    <div className="commander-page workspaces-root flex h-full min-h-0 flex-col bg-background">
      <header className="oa-topbar flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          {primaryNavigation}
          <Compass size={15} strokeWidth={2} className="shrink-0 text-primary" aria-hidden="true" />
          <h1 className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
            {t('commander.title')}
          </h1>
          <span
            role="status"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 tabular-nums ${statusPill.pillClass}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusPill.dotClass}`} aria-hidden="true" />
            {statusPill.label}
          </span>
          {session && activeRuntimeLabel && (
            <span
              className="commander-topbar-meta shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium leading-4 text-muted-foreground"
              title={activeRuntimeLabel}
            >
              <AgentRuntimeIcon agentId={session.agent} className="h-3 w-3" />
              <span>{activeRuntimeLabel}</span>
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 min-h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={openDispatch}
            aria-label={t('commander.openDispatch')}
            title={t('commander.openDispatch')}
          >
            <ListChecks size={14} aria-hidden="true" />
            <span className="commander-topbar-meta">{t('commander.openDispatch')}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7 min-h-7 min-w-7 text-muted-foreground hover:text-foreground"
            onClick={handleOpenSettings}
            aria-label={t('commander.settings')}
            title={t('commander.settings')}
          >
            <Settings size={14} aria-hidden="true" />
          </Button>
          <SessionTakeoverBubble />
        </div>
      </header>

      {!commanderLoaded && !commander && !commanderError ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            <span>{t('commander.opening')}</span>
          </div>
        </div>
      ) : !commander && commanderError ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div
            role="alert"
            className="flex max-w-md flex-col items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive"
          >
            <p>{commanderError}</p>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void refreshCommander()}
            >
              {t('common.retry')}
            </Button>
          </div>
        </div>
      ) : session ? (
        <div className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden${sessionRunningTerminal ? '' : ' p-2 md:p-3'}`}>
          {sessionRunningWeb ? (
            <WebSessionView
              hideHeader
              record={session}
              wsId={COMMANDER_WORKSPACE_ID}
              sessionId={session.id}
              agent={session.agent}
              agents={agents}
              label={t('commander.title')}
              onSessionLost={() => void refreshCommander()}
            />
          ) : sessionRunningTerminal ? (
            <TerminalView
              hideHeader
              wsId={COMMANDER_WORKSPACE_ID}
              sessionId={session.id}
              renderer={session.agent === 'opencode' ? 'dom' : 'auto'}
              label={t('commander.title')}
              onSessionLost={() => void refreshCommander()}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <div className="flex max-w-md flex-col items-center gap-3 text-center">
                {reopening ? (
                  <div role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                    <span>{t('commander.opening')}</span>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">{t('commander.pausedHint')}</p>
                    {error && (
                      <div
                        role="alert"
                        className="w-full rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                      >
                        {error}
                      </div>
                    )}
                    <Button
                      type="button"
                      size="default"
                      className="min-h-9 gap-2 px-4"
                      disabled={reopening}
                      onClick={() => void reopenExisting()}
                    >
                      <Play size={14} aria-hidden="true" />
                      {t('commander.resume')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="commander-layout mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center px-4 py-6 md:px-8 md:py-10">
            <div className="mb-5">
              <h2 className="text-xl font-semibold leading-7 tracking-[-0.015em] text-foreground md:text-2xl">
                {t('commander.heading')}
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {t('commander.subheading')}
              </p>
            </div>

            <section className="rounded-lg border border-border/80 bg-secondary/55 p-3 transition-colors focus-within:border-primary/70 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring md:p-4">
              <label htmlFor={promptId} className="sr-only">
                {t('commander.promptLabel')}
              </label>
              <textarea
                ref={textareaRef}
                id={promptId}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t('commander.placeholder')}
                rows={4}
                className="min-h-28 w-full resize-none bg-transparent px-1 py-1 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/55 md:text-[15px]"
              />
              <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
                <div className="commander-composer-actions flex min-w-0 flex-col gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <AgentLaunchSelectors
                      ref={launchSelectorsRef}
                      config={launchConfig}
                      onConfigureProvider={goConfigureProvider}
                    />
                  </div>
                  <Button
                    type="button"
                    size="lg"
                    onClick={() => void launch(draft)}
                    disabled={launching || !launchConfig.credentialSelectionReady}
                    className="self-start px-4 text-[12px]"
                  >
                    {launching
                      ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      : <ArrowUp size={14} aria-hidden="true" />}
                    {launching
                      ? t('commander.launching')
                      : draft.trim()
                        ? t('commander.send')
                        : t('commander.initialize')}
                  </Button>
                </div>
                <AgentLaunchDetails
                  config={launchConfig}
                  hasWorkspaceTarget
                  onAdjustAi={adjustCommanderAi}
                  className="border-t border-border/45 pt-2"
                />
              </div>
            </section>

            {(error ?? commanderError) && (
              <div
                role="alert"
                className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-[12px] leading-[18px] text-destructive"
              >
                <span>{error ?? commanderError}</span>
                {!error && commanderError && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void refreshCommander()}
                  >
                    {t('common.retry')}
                  </Button>
                )}
              </div>
            )}

            <section className="commander-starters-section mt-6 min-w-0">
              <h3 className="mb-2 text-[12px] font-medium leading-[18px] text-muted-foreground">
                {t('commander.startersHeading')}
              </h3>
              <div className="commander-starters grid min-w-0 gap-2.5">
                {STARTER_SPECS.map((starter) => {
                  const Icon = starter.icon
                  const title = t(starter.titleKey)
                  const prompt = t(starter.promptKey)
                  return (
                    <button
                      key={starter.id}
                      type="button"
                      onClick={() => {
                        setDraft(prompt)
                        textareaRef.current?.focus()
                      }}
                      className="group flex min-h-20 flex-col items-start gap-1.5 rounded-lg border border-border/75 bg-card/60 p-3 text-left transition-colors hover:border-border hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="inline-flex items-center gap-2 text-xs font-medium text-foreground">
                        <Icon size={14} className="shrink-0 text-primary" aria-hidden="true" />
                        <span>{title}</span>
                      </span>
                      <span className="line-clamp-2 text-[12px] leading-5 text-muted-foreground group-hover:text-foreground/85">
                        {prompt}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          </div>
        </div>
      )}

      {session && (
        <SessionSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          record={session}
          agents={agents}
          workspaceId={COMMANDER_WORKSPACE_ID}
          onSaveDisplayName={(displayName) =>
            setSessionDisplayName(COMMANDER_WORKSPACE_ID, session.resumeId, displayName)
          }
          onSaveRuntime={(update) =>
            updateSessionRuntime(COMMANDER_WORKSPACE_ID, session.id, update)
          }
          onPause={() => void pauseSession(COMMANDER_WORKSPACE_ID, session.id)}
        />
      )}
    </div>
  )
}

function runtimeLabel(agentId: string, agents: readonly { id: string; displayName: string }[]): string {
  return agents.find((agent) => agent.id === agentId)?.displayName ?? agentId
}
