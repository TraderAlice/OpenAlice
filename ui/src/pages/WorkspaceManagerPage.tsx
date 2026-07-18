import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Building2,
  ClipboardCheck,
  GitMerge,
  Loader2,
  Network,
  RefreshCw,
  UsersRound,
  type LucideIcon,
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
import { useWorkspaces } from '../contexts/workspaces-context'
import { useAgentLaunchConfig, useAgentLaunchPreferences } from '../hooks/useAgentLaunchConfig'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'

type ManagerSpec = Extract<ViewSpec, { kind: 'workspace-manager' }>

const SUGGESTION_ICONS = [ClipboardCheck, UsersRound, GitMerge, RefreshCw] as const

export function WorkspaceManagerPage({ spec }: { spec: ManagerSpec }) {
  const { t } = useTranslation()
  const {
    agents,
    defaultAgent,
    setDefaultAgent,
    openAgentConfig,
    workspaceManager: manager,
    workspaceManagerLoaded,
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
  const loading = !workspaceManagerLoaded

  const runtimeAgents = useMemo(() => agents.filter((agent) => agent.kind !== 'utility'), [agents])
  const launchPreferences = useAgentLaunchPreferences()
  const launchConfig = useAgentLaunchConfig({
    agents: runtimeAgents,
    defaultAgent,
    setDefaultAgent,
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
    setLaunching(true)
    setError(null)
    try {
      const runtimeRow = await launchConfig.checkSelectedRuntime()
      if (runtimeRow?.ready !== true) {
        if (runtimeRow?.repairTarget === 'ai-provider' || launchConfig.needsProviderSetup) {
          openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })
          return
        }
        setError(runtimeRow?.message ?? t('chatLanding.runtimeNotReady'))
        return
      }
      const result = await quickStartWorkspaceManager(
        prompt,
        effectiveAgent,
        launchConfig.launchCredentialSlug,
      )
      setDraft('')
      openOrFocus({ kind: 'workspace-manager', params: { sessionId: result.session.id } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('workspaceManager.launchError'))
    } finally {
      setLaunching(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  const goConfigureProvider = () => {
    openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })
  }

  const adjustManagerAi = () => {
    if (effectiveAgent === 'opencode' || effectiveAgent === 'pi') {
      openAgentConfig(MANAGER_WORKSPACE_ID, effectiveAgent, 'ai')
      return
    }
    goConfigureProvider()
  }

  if (sessionId && session) {
    return (
      <div className="workspaces-root flex h-full min-h-0 flex-col bg-bg">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-bg-secondary/35 px-3 py-2 md:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => openOrFocus({ kind: 'workspace-manager', params: {} })}
              className="oa-icon-action rounded-md p-1.5 text-text-muted hover:bg-bg-tertiary hover:text-text"
              title={t('workspaceManager.back')}
              aria-label={t('workspaceManager.back')}
            >
              <ArrowLeft size={15} />
            </button>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
              <Network size={15} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold text-text">{t('workspaceManager.title')}</div>
              <div className="truncate text-[10px] text-text-muted">{session.title ?? session.name}</div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-bg px-2 py-1 text-[10px] font-medium text-text-muted">
            <Bot size={11} /> {runtimeLabel(session.agent, agents)} · {session.surface === 'webpi' ? 'WebPi' : 'TUI'}
          </span>
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2 md:p-3">
          {session.state === 'paused' ? (
            <ResumeCta
              record={session}
              onResume={() => void resumeSession(MANAGER_WORKSPACE_ID, session.id)}
              onOpenWebPi={() => void openWebPiSession(MANAGER_WORKSPACE_ID, session.id)}
            />
          ) : session.agent === 'pi' && session.surface === 'webpi' ? (
            <WebPiView
              wsId={MANAGER_WORKSPACE_ID}
              sessionId={sessionId}
              label={t('workspaceManager.title')}
              onSessionLost={() => void refreshWorkspaceManager()}
            />
          ) : (
            <TerminalView
              wsId={MANAGER_WORKSPACE_ID}
              sessionId={sessionId}
              renderer={session.agent === 'opencode' ? 'dom' : 'auto'}
              label={`${t('workspaceManager.title')} · ${session.name}`}
              onSessionLost={() => void refreshWorkspaceManager()}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full overflow-y-auto bg-bg">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-accent/[0.07] to-transparent" />
        <div className="absolute -right-24 top-12 h-72 w-72 rounded-full border border-accent/10" />
        <div className="absolute -right-8 top-28 h-44 w-44 rounded-full border border-accent/10" />
      </div>

      <div className="workspace-manager-layout relative mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-6 md:px-8 md:py-10">
        <div className="workspace-manager-hero mb-7 flex flex-col gap-5">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/[0.07] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-accent">
              <Network size={12} /> {t('workspaceManager.eyebrow')}
            </div>
            <h1 className="text-2xl font-semibold leading-tight text-text md:text-4xl">
              {t('workspaceManager.heading')}
            </h1>
            <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-text-muted md:text-[15px]">
              {t('workspaceManager.subheading')}
            </p>
          </div>
          <div className="workspace-manager-stats grid max-w-56 grid-cols-1 gap-2">
            <ManagerStat icon={Building2} label={t('workspaceManager.scope')} value={loading ? '—' : String(manager?.activeWorkspaceCount ?? 0)} />
          </div>
        </div>

        <section className="rounded-2xl border border-border/80 bg-bg-secondary/60 p-3 shadow-[0_24px_70px_-58px_var(--color-text)] md:p-4">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('workspaceManager.placeholder')}
            rows={4}
            className="min-h-28 w-full resize-none bg-transparent px-1 py-1 text-[14px] leading-relaxed text-text outline-none placeholder:text-text-muted/55 md:text-[15px]"
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
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!draft.trim() || launching || !launchConfig.credentialSelectionReady}
                className="oa-pressable inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                {launching ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
                {launching ? t('workspaceManager.launching') : t('workspaceManager.send')}
              </button>
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
          <div className="mt-3 rounded-lg border border-red/25 bg-red/10 px-3 py-2 text-[12px] text-red">
            {error ?? workspaceManagerError}
          </div>
        )}

        <section className="workspace-manager-suggestions-section mt-7 min-w-0">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted/70">
            {t('workspaceManager.suggestions')}
          </h2>
          <div className="workspace-manager-suggestions grid min-w-0 gap-2">
            {suggestions.map((suggestion, index) => {
              const Icon = SUGGESTION_ICONS[index] ?? Network
              return (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setDraft(suggestion)}
                  className="oa-pressable group flex items-start gap-3 rounded-xl border border-border/70 bg-bg-secondary/45 p-3 text-left hover:border-accent/30 hover:bg-bg-secondary"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary text-text-muted group-hover:text-accent">
                    <Icon size={14} />
                  </span>
                  <span className="text-[12px] leading-relaxed text-text-muted group-hover:text-text">{suggestion}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-text-muted/65">{t('workspaceManager.guardrail')}</p>
        </section>
      </div>
    </div>
  )
}

function runtimeLabel(agentId: string, agents: readonly { id: string; displayName: string }[]): string {
  return agents.find((agent) => agent.id === agentId)?.displayName ?? agentId
}

function ManagerStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-bg-secondary/55 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-text-muted/60">
        <Icon size={11} /> {label}
      </div>
      <div className="mt-1.5 truncate text-[13px] font-semibold text-text">{value}</div>
    </div>
  )
}
