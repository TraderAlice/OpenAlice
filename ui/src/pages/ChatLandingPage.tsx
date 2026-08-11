import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  Check,
  ChevronDown,
  KeyRound,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'

import { useWorkspaces } from '../contexts/workspaces-context'
import { installHintFor } from '../components/workspace/agentInstall'
import {
  QuickChatError,
  type Workspace,
} from '../components/workspace/api'
import {
  AgentLaunchDetails,
  AgentLaunchSelectors,
  type AgentLaunchSelectorsHandle,
} from '../components/workspace/AgentLaunchControls'
import { RecoverySurface, RefreshNotice } from '../components/StateViews'
import { workspaceDisplayTitle } from '../components/workspace/display'
import { useWorkspace } from '../tabs/store'
import {
  useAgentLaunchConfig,
  useAgentLaunchPreferences,
  useWorkspaceAgentLaunchPreferences,
} from '../hooks/useAgentLaunchConfig'
import { AutoQuantSetupPage } from './AutoQuantSetupPage'

export { resolveAgentRuntime as resolveChatAgent } from '../lib/agentRuntime'
export {
  formatContextWindow,
  resolveAgentCredential as resolveChatCredential,
  resolveAgentLaunchAiDetails as resolveQuickChatAiDetails,
  resolveAgentLaunchCredentialSlug as resolveQuickChatCredentialSlug,
} from '../hooks/useAgentLaunchConfig'

function workspaceActivityMs(workspace: Pick<Workspace, 'createdAt' | 'sessions'>): number {
  const sessionActivity = workspace.sessions
    .map((session) => Date.parse(session.lastActiveAt))
    .filter(Number.isFinite)
  if (sessionActivity.length > 0) return Math.max(...sessionActivity)
  const created = Date.parse(workspace.createdAt)
  return Number.isFinite(created) ? created : 0
}

/** Resolve the visible global-composer target. Explicit selection wins, then
 *  the persisted recent Chat workspace, then latest activity for upgrades. */
export function resolveChatWorkspaceTarget(
  workspaces: readonly Workspace[],
  explicitWorkspaceId: string | null,
  recentWorkspaceId: string | null,
  templateName = 'chat',
): Workspace | null {
  const chats = workspaces.filter((workspace) => workspace.template === templateName)
  const explicit = explicitWorkspaceId
    ? chats.find((workspace) => workspace.id === explicitWorkspaceId)
    : undefined
  if (explicit) return explicit
  const recent = recentWorkspaceId
    ? chats.find((workspace) => workspace.id === recentWorkspaceId)
    : undefined
  if (recent) return recent
  return [...chats].sort((a, b) => workspaceActivityMs(b) - workspaceActivityMs(a))[0] ?? null
}

/**
 * Quick-chat landing — the "type a message → you're in" front door for the
 * "Ask Alice" activity. A single composer: the user types a first message and
 * hits send; `quickChat` reuses-or-creates the chat workspace, spawns a fresh
 * session seeded with that message (the agent CLI opens already working on it),
 * and focuses into the session's terminal tab. No template/CLI pickers in the
 * way — the bottom row shows the workspace type (Chat) and a small runtime
 * picker for agent CLIs. Shell is not an agent runtime and is excluded here.
 */
type HarnessLandingMode = 'chat' | 'auto-quant'

function HarnessLandingPage({
  spec,
  mode,
}: {
  spec: { params: { targetWsId?: string } }
  mode: HarnessLandingMode
}) {
  const { t } = useTranslation()
  const {
    quickChat,
    agents,
    workspaces,
    defaultAgent,
    hasLoaded,
    listError,
    refresh,
  } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const templateName = mode === 'auto-quant' ? 'auto-quant-v2' : 'chat'
  const landingKind = mode === 'auto-quant' ? 'auto-quant-landing' : 'chat-landing'
  const copyKey = mode === 'auto-quant' ? 'autoQuantLanding' : 'chatLanding'
  // Targeted launch: the chat sidebar's Workspace row and per-workspace "+"
  // route here with a targetWsId — "Ask Alice, but spawn the session in THIS
  // workspace" rather than the recent Chat workspace. Same composer; the send
  // just carries the target.
  const targetWsId = spec.params.targetWsId
  const targetWs = targetWsId ? workspaces.find((w) => w.id === targetWsId) : undefined
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const installationLaunchPreferences = useAgentLaunchPreferences()
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const workspaceBoxRef = useRef<HTMLDivElement>(null)
  const activeWorkspaceOptionRef = useRef<HTMLButtonElement>(null)
  const selectedHarnessWorkspace = useMemo(
    () => mode === 'auto-quant'
      ? targetWs ?? null
      : resolveChatWorkspaceTarget(
          workspaces,
          targetWsId ?? selectedWorkspaceId,
          installationLaunchPreferences.recentChatWorkspaceId,
          templateName,
        ),
    [workspaces, templateName, targetWsId, selectedWorkspaceId, mode, installationLaunchPreferences.recentChatWorkspaceId],
  )
  const workspaceTarget = targetWs ?? selectedHarnessWorkspace
  const launchPreferences = useWorkspaceAgentLaunchPreferences(
    mode === 'chat' ? workspaceTarget : null,
    installationLaunchPreferences,
  )
  const chatWorkspaceOptions = useMemo(
    () => workspaces
      .filter((workspace) => workspace.template === templateName)
      .sort((a, b) => workspaceActivityMs(b) - workspaceActivityMs(a)),
    [workspaces, templateName],
  )

  // The selectable agent runtimes = the agent CLIs (the bare shell has no agent
  // loop, so it can't be seeded with a first message).
  const cliAgents = agents.filter((a) => a.kind !== 'utility')

  const [value, setValue] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [examplePage, setExamplePage] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const launchSelectorsRef = useRef<AgentLaunchSelectorsHandle>(null)
  const credentialWorkspace = workspaceTarget
  const launchConfig = useAgentLaunchConfig({
    agents: cliAgents,
    defaultAgent: workspaceTarget?.defaultAgent ?? defaultAgent,
    preferences: launchPreferences,
    workspaceId: credentialWorkspace?.id ?? null,
    hasWorkspace: credentialWorkspace !== null && credentialWorkspace !== undefined,
    managedWorkspaceLaunch: mode === 'chat' && credentialWorkspace !== null && credentialWorkspace !== undefined,
  })
  const effectiveAgent = launchConfig.effectiveAgent
  const selectedInfo = launchConfig.selectedAgent
  const installHint = selectedInfo ? installHintFor(selectedInfo.id) : undefined
  const exampleGroups = mode === 'chat'
    ? [
        [
          {
            id: 'market',
            label: t('chatLanding.marketBriefLabel'),
            title: t('chatLanding.marketBriefTitle'),
            prompt: t('chatLanding.marketBriefPrompt'),
          },
          {
            id: 'portfolio',
            label: t('chatLanding.portfolioReviewLabel'),
            title: t('chatLanding.portfolioReviewTitle'),
            prompt: t('chatLanding.portfolioReviewPrompt'),
          },
          {
            id: 'thesis',
            label: t('chatLanding.researchMemoLabel'),
            title: t('chatLanding.researchMemoTitle'),
            prompt: t('chatLanding.researchMemoPrompt'),
          },
        ],
        [
          {
            id: 'workspace',
            label: t('chatLanding.workspaceAuditLabel'),
            title: t('chatLanding.workspaceAuditTitle'),
            prompt: t('chatLanding.workspaceAuditPrompt'),
          },
          {
            id: 'automation',
            label: t('chatLanding.automationLabel'),
            title: t('chatLanding.automationTitle'),
            prompt: t('chatLanding.automationPrompt'),
          },
          {
            id: 'quant',
            label: t('chatLanding.quantDeskLabel'),
            title: t('chatLanding.quantDeskTitle'),
            prompt: t('chatLanding.quantDeskPrompt'),
          },
        ],
      ]
    : [[
        { id: 'quant-1', label: null, title: t('autoQuantLanding.ex1'), prompt: t('autoQuantLanding.ex1') },
        { id: 'quant-2', label: null, title: t('autoQuantLanding.ex2'), prompt: t('autoQuantLanding.ex2') },
        { id: 'quant-3', label: null, title: t('autoQuantLanding.ex3'), prompt: t('autoQuantLanding.ex3') },
      ]]
  const examples = exampleGroups[examplePage % exampleGroups.length]!

  const goConfigureProvider = () => {
    openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })
  }

  // A missing runtime choice should open the picker, not leave a mysteriously
  // disabled send button. submit() already handles that branch.
  const canSend = value.trim().length > 0 && !launching && launchConfig.credentialSelectionReady
  const effectiveTargetWorkspaceId = targetWsId ?? workspaceTarget?.id

  useEffect(() => {
    if (!workspaceMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (workspaceBoxRef.current && !workspaceBoxRef.current.contains(e.target as Node)) {
        setWorkspaceMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [workspaceMenuOpen])

  // The picker opens below the session-context row. Keep the active option inside
  // its own scroll viewport so a long Workspace history cannot push recent or
  // currently selected targets beyond the top of the window.
  useEffect(() => {
    if (!workspaceMenuOpen) return
    const frame = requestAnimationFrame(() => {
      activeWorkspaceOptionRef.current?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [workspaceMenuOpen, workspaceTarget?.id])

  const submit = async () => {
    const prompt = value.trim()
    if (!prompt || launching) return
    if (!launchConfig.credentialSelectionReady) return
    if (effectiveAgent === null) {
      launchSelectorsRef.current?.openAgentMenu()
      return
    }
    if (launchConfig.needsProviderSetup) {
      goConfigureProvider()
      return
    }
    setError(null)
    setLaunching(true)
    try {
      // Native runtime auth is an explicit access choice beside Workspace and
      // vault sources. The provider/model choice
      // seeds this new product Session; the backend persists a secret-free
      // binding and never rewrites the Workspace merely to start it.
      // On success this focuses the new session's terminal tab; the landing tab
      // stays open in the background, so clear it for next time.
      const workspaceId = await quickChat(
        prompt,
        effectiveAgent,
        launchConfig.launchCredentialSlug,
        effectiveTargetWorkspaceId,
        templateName,
        launchConfig.launchModel,
        launchConfig.launchReasoningEffort,
        launchConfig.accessMode === 'native' ? 'native' : undefined,
      )
      if (mode === 'chat') launchPreferences.adoptRecentChatWorkspace(workspaceId)
      setValue('')
    } catch (err) {
      // Backend says no compatible credential — bounce to the provider settings.
      if (err instanceof QuickChatError && err.code === 'no_ai_credential') {
        goConfigureProvider()
        return
      }
      console.error('chatLanding.quick_chat_failed', err)
      setError(t('chatLanding.error'))
    } finally {
      setLaunching(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits; Shift+Enter inserts a newline (standard chat-composer feel).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const useExample = (text: string) => {
    setValue(text)
    textareaRef.current?.focus()
  }

  if (!hasLoaded && listError !== null) {
    return (
      <RecoverySurface
        eyebrow={t('workspace.dataUnavailableEyebrow')}
        title={t('workspace.dataUnavailableTitle')}
        description={t('workspace.dataUnavailableDescription')}
        actionLabel={t('common.retry')}
        onAction={() => void refresh()}
      />
    )
  }

  return (
    <div
      data-testid="harness-landing-scroll"
      className="relative flex h-full w-full flex-col items-center justify-start overflow-x-hidden overflow-y-auto overscroll-contain bg-background px-4 py-4 md:px-6 md:py-10"
    >
      {/* Ask-Alice backdrop — full-bleed, responsive-only layers (gradient wash
          + faint grid). The #302 mock's %-positioned circle / diagonal bars were
          dropped: they drift on portrait and read as pixel-placed art, not a
          responsive surface. pointer-events-none so it never intercepts clicks. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-accent to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-accent-strong to-transparent" />
        <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,var(--foreground)_1px,transparent_1px),linear-gradient(to_bottom,var(--foreground)_1px,transparent_1px)] [background-size:96px_96px]" />
      </div>

      <div
        data-testid="harness-landing-stack"
        className="relative z-10 my-auto flex w-full max-w-2xl flex-col gap-3 md:gap-5"
      >
        {listError !== null && (
          <RefreshNotice
            message={t('workspace.dataStale')}
            actionLabel={t('common.retry')}
            onAction={() => void refresh()}
          />
        )}
        <div className="text-center space-y-1.5">
          {targetWs && mode === 'chat' ? (
            <>
              <h1 className="text-xl md:text-2xl font-semibold text-foreground">
                {t(`${copyKey}.targetHeading`)}
              </h1>
              <div className="flex items-center justify-center gap-2 pt-1">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 pl-2.5 pr-1.5 py-1 text-[12.5px] font-medium text-primary">
                  <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                  {targetWs.tag}
                  <button
                    type="button"
                    onClick={() => openOrFocus({ kind: landingKind, params: {} })}
                    aria-label={t(`${copyKey}.clearTarget`)}
                    title={t(`${copyKey}.clearTarget`)}
                    className="oa-icon-action ml-0.5 rounded-full p-0.5 text-primary/70 hover:text-primary hover:bg-primary/20 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-[19px] md:text-2xl font-semibold text-foreground leading-tight">{t(`${copyKey}.heading`)}</h1>
              <p className="text-[13px] md:text-sm text-muted-foreground leading-relaxed">{t(`${copyKey}.subheading`)}</p>
            </>
          )}
        </div>

        <div
          data-testid="harness-landing-context"
          className="flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 px-1 text-[11px] text-muted-foreground"
        >
          {/* Session context stays outside the composer: it answers where the
              Session will live and which native runtime will own it. */}
          {mode === 'chat' && (
            <>
              <span className="shrink-0">{t('chatLanding.startIn')}</span>
              <div ref={workspaceBoxRef} className="relative min-w-0">
                <button
                  type="button"
                  onClick={() => setWorkspaceMenuOpen((open) => !open)}
                  disabled={chatWorkspaceOptions.length === 0 || targetWs !== undefined}
                  aria-haspopup="menu"
                  aria-expanded={workspaceMenuOpen}
                  aria-label={t(`${copyKey}.selectWorkspace`)}
                  className="oa-pressable inline-flex min-h-8 max-w-[220px] items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-[11px] text-foreground hover:bg-muted/80 disabled:cursor-default"
                >
                  <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    {workspaceTarget
                      ? workspaceDisplayTitle(workspaceTarget)
                      : t(`${copyKey}.newWorkspaceTarget`)}
                  </span>
                  {chatWorkspaceOptions.length > 0 && targetWs === undefined && (
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                  )}
                </button>
                {workspaceMenuOpen && targetWs === undefined && chatWorkspaceOptions.length > 0 && (
                  <div
                    role="menu"
                    className="oa-popover-enter absolute left-0 top-full z-20 mt-1 max-h-[min(24rem,calc(100vh-8rem))] min-w-[220px] max-w-[320px] overflow-y-auto overscroll-contain rounded-lg border border-border/70 bg-secondary py-1 shadow-lg [scrollbar-gutter:stable]"
                  >
                    {chatWorkspaceOptions.map((workspace) => {
                      const active = workspace.id === workspaceTarget?.id
                      return (
                        <button
                          key={workspace.id}
                          ref={active ? activeWorkspaceOptionRef : undefined}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSelectedWorkspaceId(workspace.id)
                            launchConfig.resetCredentialSelection()
                            setWorkspaceMenuOpen(false)
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-muted ${active ? 'text-primary' : 'text-foreground'}`}
                        >
                          <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{workspaceDisplayTitle(workspace)}</span>
                          {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
          <span className="shrink-0">{t('chatLanding.runWith')}</span>
          <AgentLaunchSelectors
            ref={launchSelectorsRef}
            config={launchConfig}
            onConfigureProvider={goConfigureProvider}
            showAi={false}
            menuPlacement="down"
          />
        </div>

        <div
          className={`rounded-xl px-3 pb-2 pt-3 shadow-[0_18px_50px_-40px_var(--foreground)] transition-[border-color,box-shadow] md:rounded-2xl ${
            targetWs && mode === 'chat'
              ? 'bg-primary/[0.04] border border-primary/45 ring-1 ring-primary/15 focus-within:border-primary/70'
              : 'border border-border/80 bg-secondary/70 focus-within:border-primary/60 focus-within:shadow-[0_20px_55px_-38px_var(--primary)]'
          }`}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t(`${copyKey}.placeholder`)}
            rows={3}
            autoFocus
            className="min-h-[72px] max-h-[40vh] w-full resize-none bg-transparent px-2 py-1.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <div
            data-testid="harness-landing-controls"
            className="flex items-end justify-between gap-2 px-1 pt-1"
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              <AgentLaunchSelectors
                config={launchConfig}
                onConfigureProvider={goConfigureProvider}
                showRuntime={false}
                toolbar
              />
            </div>
            <div className="flex shrink-0 items-center justify-end gap-1.5">
              <button
                type="button"
                disabled
                title={t('chatLanding.attachSoon')}
                aria-label={t('chatLanding.attach')}
                className="w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-muted-foreground/50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSend}
                title={t('chatLanding.send')}
                aria-label={t('chatLanding.send')}
                className="oa-icon-action w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <AgentLaunchDetails
            config={launchConfig}
            hasWorkspaceTarget={credentialWorkspace !== null && credentialWorkspace !== undefined}
            showScopeDisclosure={false}
            className="mx-1 mt-2 border-t border-border/50 px-1 pt-2"
          />
        </div>

        {error !== null && <div className="text-[12px] text-destructive px-1">{error}</div>}

        {/* Runtime guidance. A normal packaged build should expose managed Pi;
            no-runtime is now an abnormal setup/debug state, not a prompt to
            make a fresh user install a CLI. */}
        {launchConfig.agentsKnown && !launchConfig.anyInstalled ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-[12px] space-y-1.5">
            <div className="font-medium text-foreground">{t('chatLanding.noAgentsTitle')}</div>
            <p className="text-muted-foreground">{t('chatLanding.noAgentsBody')}</p>
          </div>
        ) : launchConfig.selectedMissing && selectedInfo ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-[12px] space-y-1.5">
            <p className="text-muted-foreground">
              {t('chatLanding.agentMissing', { name: selectedInfo.displayName })}
            </p>
            {installHint?.cmd && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('chatLanding.installLabel')}</span>
                <code className="font-mono text-[11px] text-foreground bg-muted rounded px-2 py-1 select-all">
                  {installHint.cmd}
                </code>
              </div>
            )}
            {installHint?.url && (
              <a
                href={installHint.url}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-primary hover:underline"
              >
                {t('chatLanding.installDocs')} ↗
              </a>
            )}
          </div>
        ) : null}

        {/* Loginless runtime has no provider configured — the conversion
            dead-end. Guide the user to set one up instead of a silent failure. */}
        {launchConfig.noCredentials && selectedInfo && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-[12px] space-y-1.5">
            <p className="text-muted-foreground">
              {t('chatLanding.noCredBody', { name: selectedInfo.displayName })}
            </p>
            <button
              type="button"
              onClick={goConfigureProvider}
              className="inline-flex items-center gap-1.5 text-primary hover:underline"
            >
              <KeyRound className="w-3 h-3" />
              {t('chatLanding.configureProvider')} ↗
            </button>
          </div>
        )}

        <div data-testid="harness-landing-suggestions" className="relative -mx-4 md:mx-0">
          <div className="flex items-center gap-2 px-4 pb-2 md:px-1">
            <Sparkles aria-hidden className="h-3 w-3 shrink-0 text-primary/75" />
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t(`${copyKey}.examplesLabel`)}
            </span>
            <span aria-hidden className="h-px min-w-4 flex-1 bg-border/45" />
            {mode === 'chat' && (
              <button
                type="button"
                onClick={() => setExamplePage((page) => (page + 1) % exampleGroups.length)}
                disabled={launching}
                className="oa-pressable inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/55 hover:text-foreground disabled:opacity-40"
                aria-label={t('chatLanding.moreExamples')}
              >
                <RefreshCw aria-hidden className="h-3 w-3" />
                {t('chatLanding.moreExamples')}
              </button>
            )}
          </div>
          <div className="scrollbar-hide flex gap-2 overflow-x-auto px-4 pb-1 pr-14 md:overflow-visible md:px-1 md:pr-1 md:pb-0">
            {examples.map((example, index) => (
              <button
                key={`${examplePage}-${example.id}`}
                type="button"
                onClick={() => useExample(example.prompt)}
                disabled={launching}
                style={{ animationDelay: `${index * 55}ms` }}
                className="group oa-pressable oa-suggestion-enter flex min-h-[54px] w-[230px] shrink-0 flex-col justify-center rounded-lg border border-border/45 bg-secondary/45 px-3.5 py-2 text-left hover:border-border hover:bg-muted/70 focus-visible:border-primary/60 md:min-w-0 md:flex-1 disabled:opacity-40"
              >
                {example.label && (
                  <span className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-primary/75">
                    {example.label}
                  </span>
                )}
                <span className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground group-hover:text-foreground">
                  {example.title}
                </span>
              </button>
            ))}
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-bg via-bg/90 to-transparent md:hidden"
          />
        </div>
      </div>
    </div>
  )
}

export function ChatLandingPage({ spec }: { spec: { params: { targetWsId?: string } } }) {
  return <HarnessLandingPage spec={spec} mode="chat" />
}

export function AutoQuantLandingPage({ spec }: { spec: { params: { targetWsId?: string } } }) {
  const ctx = useWorkspaces()
  const workspace = ctx.workspaces.find((candidate) =>
    candidate.id === ctx.autoQuantDefaultWorkspaceId
    && candidate.template === 'auto-quant-v2')
  if (!workspace) return <AutoQuantSetupPage />
  return <HarnessLandingPage spec={{ params: { targetWsId: workspace.id } }} mode="auto-quant" />
}
