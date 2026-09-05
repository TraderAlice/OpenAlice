import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { PageTopBar } from '../components/PageTopBar'
import {
  ArrowLeft,
  ArrowUp,
  ClipboardCheck,
  GitMerge,
  Loader2,
  Network,
  RefreshCw,
  UsersRound,
} from 'lucide-react'
import '@xterm/xterm/css/xterm.css'

import {
  MANAGER_WORKSPACE_ID,
} from '../components/workspace/api'
import {
  AgentLaunchDetails,
  AgentLaunchSelectors,
  type AgentLaunchSelectorsHandle,
} from '../components/workspace/AgentLaunchControls'
import { TerminalView } from '../components/workspace/Terminal'
import { WebPiView } from '../components/workspace/WebPiView'
import { ResumeCta } from '../components/workspace/ResumeCta'
import { Button } from '../components/ui/button'
import { useWorkspaces } from '../contexts/workspaces-context'
import { useAgentLaunchConfig, useAgentLaunchPreferences } from '../hooks/useAgentLaunchConfig'
import { useAgentRuntimes } from '../hooks/useAgentRuntimes'
import { isWorkspaceAiAgent } from '../lib/agentRuntime'
import { AgentRuntimeIcon } from '../lib/agentRuntimeIcon'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'

type ManagerSpec = Extract<ViewSpec, { kind: 'workspace-manager' }>

const SUGGESTION_ICONS = [ClipboardCheck, UsersRound, GitMerge, RefreshCw] as const

export function WorkspaceManagerPage({ spec }: { spec: ManagerSpec }) {
  const { t } = useTranslation()
  const { recordSuccessfulUse } = useAgentRuntimes()
  const {
    agents,
    defaultAgent,
    openAgentConfig,
    workspaceManager: manager,
    workspaceManagerError,
    refreshWorkspaceManager,
    quickStartWorkspaceManager,
    resumeSession,
    openWebPiSession,
  } = useWorkspaces()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const [draft, setDraft] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const launchSelectorsRef = useRef<AgentLaunchSelectorsHandle>(null)

  const runtimeAgents = useMemo(() => agents.filter((agent) => agent.kind !== 'utility'), [agents])
  const launchPreferences = useAgentLaunchPreferences()
  const launchConfig = useAgentLaunchConfig({
    agents: runtimeAgents,
    defaultAgent,
    preferences: launchPreferences,
    workspaceId: MANAGER_WORKSPACE_ID,
    hasWorkspace: true,
  })
  const effectiveAgent = launchConfig.effectiveAgent

  const sessionId = spec.params.sessionId
  const session = sessionId
    ? manager?.sessions.find((candidate) => candidate.id === sessionId) ?? null
    : null

  const suggestions = useMemo(() => [
    t('workspaceManager.suggestionAudit'),
    t('workspaceManager.suggestionOwnership'),
    t('workspaceManager.suggestionIssues'),
    t('workspaceManager.suggestionUpgrade'),
  ], [t])

  const submit = async (): Promise<void> => {
    const prompt = draft.trim()
    if (!prompt || launching) return
    if (!launchConfig.credentialSelectionReady) return
    if (!effectiveAgent) {
      launchSelectorsRef.current?.openAgentMenu()
      return
    }
    if (launchConfig.needsProviderSetup) {
      openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })
      return
    }
    setLaunching(true)
    setError(null)
    try {
      const result = await quickStartWorkspaceManager(
        prompt,
        effectiveAgent,
        launchConfig.launchCredentialSlug,
        launchConfig.launchModel,
        launchConfig.launchReasoningEffort,
        launchConfig.accessMode === 'native' ? 'native' : undefined,
      )
      void recordSuccessfulUse(effectiveAgent).catch(() => undefined)
      setDraft('')
      openOrFocus({ kind: 'workspace-manager', params: { sessionId: result.session.id } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('workspaceManager.launchError'))
    } finally {
      setLaunching(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  const goConfigureProvider = () => {
    openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })
  }

  const adjustManagerAi = () => {
    if (isWorkspaceAiAgent(effectiveAgent)) {
      openAgentConfig(MANAGER_WORKSPACE_ID, effectiveAgent, 'ai')
      return
    }
    goConfigureProvider()
  }

  if (sessionId && session) {
    const terminalCanvas =
      session.state === 'running' &&
      (session.surface ?? 'terminal') === 'terminal'
    const webPiCanvas = session.state === 'running' && session.agent === 'pi' && session.surface === 'webpi'
    const backButton = (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => openOrFocus({ kind: 'workspace-manager', params: {} })}
        className="text-muted-foreground"
        title={t('workspaceManager.back')}
        aria-label={t('workspaceManager.back')}
      >
        <ArrowLeft size={15} />
      </Button>
    )
    const runtimeBadge = (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-2 py-1 text-[10px] leading-[14px] font-medium text-muted-foreground">
        <AgentRuntimeIcon agentId={session.agent} className="h-[11px] w-[11px]" />
        {runtimeLabel(session.agent, agents)} {session.surface === 'webpi' ? 'WebPi' : 'TUI'}
      </span>
    )

    return (
      <div className={`workspaces-root flex h-full min-h-0 flex-col bg-background${terminalCanvas ? ' workspace-manager-terminal-canvas' : ''}`}>
        {!terminalCanvas && !webPiCanvas && (
          <PageTopBar title={session.title ?? session.name} leading={backButton} actions={runtimeBadge} />
        )}
        <div className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden${terminalCanvas ? '' : ' p-2 md:p-3'}`}>
          {session.state === 'paused' ? (
            <ResumeCta
              record={session}
              onResume={() => resumeSession(MANAGER_WORKSPACE_ID, session.id)}
              onOpenWebPi={() => openWebPiSession(MANAGER_WORKSPACE_ID, session.id)}
            />
          ) : session.agent === 'pi' && session.surface === 'webpi' ? (
            <WebPiView
              wsId={MANAGER_WORKSPACE_ID}
              sessionId={sessionId}
              label={t('workspaceManager.title')}
              headerActions={<>{backButton}{runtimeBadge}</>}
              onSessionLost={() => void refreshWorkspaceManager()}
            />
          ) : (
            <TerminalView
              wsId={MANAGER_WORKSPACE_ID}
              sessionId={sessionId}
              renderer={session.agent === 'opencode' ? 'dom' : 'auto'}
              label={terminalCanvas ? t('workspaceManager.title') : `${t('workspaceManager.title')} — ${session.name}`}
              {...(terminalCanvas ? {
                sessionLabel: session.title?.trim() || session.name,
                headerActions: <>{backButton}{runtimeBadge}</>,
              } : {})}
              onSessionLost={() => void refreshWorkspaceManager()}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <PageTopBar title={t('workspaceManager.title')} />
      <div className="workspace-manager-layout mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-6 md:px-8 md:py-10">
        <div className="workspace-manager-hero mb-6">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-7 tracking-[-0.015em] text-foreground md:text-2xl">
              {t('workspaceManager.heading')}
            </h1>
          </div>
        </div>

        <section className="rounded-lg border border-border/80 bg-secondary/55 p-3 md:p-4">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('workspaceManager.placeholder')}
            rows={4}
            className="min-h-28 w-full resize-none bg-transparent px-1 py-1 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/55 md:text-[15px]"
          />
          <div className="workspace-manager-composer-footer mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
            <div className="workspace-manager-composer-actions flex min-w-0 flex-col gap-2">
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
                onClick={() => void submit()}
                disabled={!draft.trim() || launching || !launchConfig.credentialSelectionReady}
                className="self-start px-4 text-[12px]"
              >
                {launching ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
                {launching ? t('workspaceManager.launching') : t('workspaceManager.send')}
              </Button>
            </div>
            <AgentLaunchDetails
              config={launchConfig}
              hasWorkspaceTarget
              onAdjustAi={adjustManagerAi}
              className="border-t border-border/45 pt-2"
            />
          </div>
        </section>

        {(error ?? workspaceManagerError) && (
          <div
            role="alert"
            className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-[12px] leading-[18px] text-destructive"
          >
            <span>{error ?? workspaceManagerError}</span>
            {!error && workspaceManagerError && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="shrink-0"
                onClick={() => void refreshWorkspaceManager()}
              >
                {t('common.retry')}
              </Button>
            )}
          </div>
        )}

        <section className="workspace-manager-suggestions-section mt-7 min-w-0">
          <h2 className="mb-2 text-[12px] leading-[18px] font-medium text-muted-foreground">
            {t('workspaceManager.suggestions')}
          </h2>
          <div className="workspace-manager-suggestions grid min-w-0 gap-2">
            {suggestions.map((suggestion, index) => {
              const Icon = SUGGESTION_ICONS[index] ?? Network
              return (
                <Button
                  key={suggestion}
                  type="button"
                  variant="outline"
                  onClick={() => setDraft(suggestion)}
                  className="group h-auto min-h-10 w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-left whitespace-normal"
                >
                  <Icon size={14} className="shrink-0 text-muted-foreground group-hover:text-foreground" />
                  <span className="text-[12px] leading-5 text-muted-foreground group-hover:text-foreground">{suggestion}</span>
                </Button>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

function runtimeLabel(agentId: string, agents: readonly { id: string; displayName: string }[]): string {
  return agents.find((agent) => agent.id === agentId)?.displayName ?? agentId
}
