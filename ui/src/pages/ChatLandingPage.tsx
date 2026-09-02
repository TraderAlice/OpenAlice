import { layout, prepare } from '@chenglou/pretext'
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  BriefcaseBusiness,
  CalendarClock,
  ChartNoAxesCombined,
  ChevronDown,
  CircleAlert,
  Code2,
  FileSearch,
  FlaskConical,
  Inbox,
  KeyRound,
  LayoutGrid,
  Loader2,
  MessageSquare,
  ExternalLink,
  RefreshCw,
  SearchCheck,
  X,
  type LucideIcon,
} from 'lucide-react'

import { useWorkspaces } from '../contexts/workspaces-context'
import { installHintFor } from '../components/workspace/agentInstall'
import { QuickChatError, type Workspace } from '../components/workspace/api'
import {
  AgentLaunchDetails,
  AgentLaunchSelectors,
  type AgentLaunchSelectorsHandle,
} from '../components/workspace/AgentLaunchControls'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { RecoverySurface, RefreshNotice } from '../components/StateViews'
import { Button } from '../components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip'
import { workspaceDisplayName, workspaceDisplayTitle } from '../components/workspace/display'
import { useWorkspace } from '../tabs/store'
import { useAliceProject } from '../hooks/useAliceProject'
import { useAgentRuntimes } from '../hooks/useAgentRuntimes'
import {
  useAgentLaunchConfig,
  useAgentLaunchPreferences,
  useWorkspaceAgentLaunchPreferences,
} from '../hooks/useAgentLaunchConfig'
import { chatLandingExampleGroups } from '../lib/chat-landing-examples'
import { resolveChatWorkspaceTarget, workspaceActivityMs } from '../lib/chat-workspace-target'
import { AutoQuantSetupPage } from './AutoQuantSetupPage'
import { AutoPredictionSetupPage } from './AutoPredictionSetupPage'
import { ChatSetupPage } from './ChatSetupPage'

export { resolveAgentRuntime as resolveChatAgent } from '../lib/agentRuntime'
export {
  formatContextWindow,
  resolveAgentCredential as resolveChatCredential,
  resolveAgentLaunchAiDetails as resolveQuickChatAiDetails,
  resolveAgentLaunchCredentialSlug as resolveQuickChatCredentialSlug,
} from '../hooks/useAgentLaunchConfig'
export { resolveChatWorkspaceTarget } from '../lib/chat-workspace-target'

/**
 * Quick-chat landing — the "type a message → you're in" front door for the
 * "Ask Alice" activity. A new Alice Project with no Chat workspace first
 * shows the shared harness setup page (same chrome as AutoQuant, without a
 * pinned version). After that, a single composer: the user types a first
 * message and hits send; `quickChat` reuses the Chat workspace, spawns a
 * fresh session seeded with that message, and focuses the session tab.
 */
type HarnessLandingMode = 'chat' | 'auto-quant' | 'prediction'

const WORKFLOW_ICONS: Readonly<Record<string, LucideIcon>> = {
  market: ChartNoAxesCombined,
  portfolio: BriefcaseBusiness,
  thesis: FileSearch,
  workspace: SearchCheck,
  automation: CalendarClock,
  quant: FlaskConical,
  'code-review': Code2,
  inbox: Inbox,
}

function ComposerNotice({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'warning' | 'error'
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      data-tone={tone}
      className="oa-composer-notice mt-2 flex min-w-0 items-start gap-2.5 rounded-lg border px-3 py-2 text-[12px] leading-[18px] text-muted-foreground"
    >
      <Icon
        aria-hidden
        className="oa-composer-notice-icon mt-0.5 h-3.5 w-3.5 shrink-0"
        strokeWidth={1.9}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function StableIntentLabel({ children }: { children: string }) {
  const labelRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const label = labelRef.current
    if (!label) return

    const measure = () => {
      if (label.clientWidth <= 0) return
      const style = window.getComputedStyle(label)
      const lineHeight = Number.parseFloat(style.lineHeight)
      if (!style.font || !Number.isFinite(lineHeight)) return
      try {
        label.style.minHeight = `${Math.ceil(
          layout(prepare(children, style.font), label.clientWidth, lineHeight).height,
        )}px`
      } catch {
        label.style.removeProperty('min-height')
      }
    }

    measure()
    void document.fonts?.ready.then(measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(label)
    return () => observer?.disconnect()
  }, [children])

  return (
    <span
      ref={labelRef}
      className="min-w-0 flex-1 text-[14px] font-medium leading-5 text-muted-foreground transition-colors group-hover:text-foreground group-focus-visible:text-foreground"
    >
      {children}
    </span>
  )
}

function HarnessWorkspacePicker({
  mode,
  workspace,
  options,
  locked,
  onSelect,
  onClear,
}: {
  readonly mode: HarnessLandingMode
  readonly workspace: Workspace | null | undefined
  readonly options: readonly Workspace[]
  readonly locked: boolean
  readonly onSelect: (workspaceId: string) => void
  readonly onClear?: (() => void) | undefined
}) {
  const { t } = useTranslation()
  const WorkspaceIcon = mode === 'chat' ? MessageSquare : LayoutGrid
  const label = workspace
    ? workspaceDisplayName(workspace)
    : t(`${mode === 'chat' ? 'chatLanding' : mode === 'auto-quant' ? 'autoQuantLanding' : 'autoPredictionLanding'}.newWorkspaceTarget`)
  const triggerContents = (
    <>
      <WorkspaceIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!locked && options.length > 0 && (
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </>
  )

  if (locked || options.length === 0) {
    return (
      <div className="flex min-h-7 min-w-0 max-w-[17rem] items-center gap-1.5 rounded-md px-2 text-[12px] leading-[18px] font-medium text-foreground">
        {triggerContents}
        {onClear && (
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  type="button"
                  onClick={onClear}
                  aria-label={t('chatLanding.clearTarget')}
                  variant="ghost"
                  size="icon-xs"
                  className="-mr-1 shrink-0 text-muted-foreground"
                />
              )}
            >
              <X className="h-3 w-3" aria-hidden />
            </TooltipTrigger>
            <TooltipContent>{t('chatLanding.clearTarget')}</TooltipContent>
          </Tooltip>
        )}
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            type="button"
            aria-label={`${t('chatLanding.startIn')}: ${label}`}
            variant="ghost"
            size="sm"
            className="min-w-0 max-w-[17rem] justify-start text-[12px]"
          />
        )}
      >
        {triggerContents}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-border/70 bg-popover p-1.5 shadow-lg ring-0"
      >
        <DropdownMenuRadioGroup value={workspace?.id ?? ''} onValueChange={(value) => onSelect(String(value))}>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.id}
              value={option.id}
              closeOnClick
              className="min-h-9 gap-2 px-2.5 pr-8 text-[12px]"
            >
              <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{workspaceDisplayTitle(option)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HarnessLandingPage({
  spec,
  mode,
}: {
  spec: { params: { targetWsId?: string; initialPrompt?: string } }
  mode: HarnessLandingMode
}) {
  const { t } = useTranslation()
  const { project } = useAliceProject()
  const { recordSuccessfulUse } = useAgentRuntimes()
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
  const templateName = mode === 'auto-quant'
    ? 'auto-quant-v2'
    : mode === 'prediction' ? 'auto-prediction' : 'chat'
  const landingKind = mode === 'auto-quant'
    ? 'auto-quant-landing'
    : mode === 'prediction' ? 'auto-prediction-landing' : 'chat-landing'
  const copyKey = mode === 'auto-quant'
    ? 'autoQuantLanding'
    : mode === 'prediction' ? 'autoPredictionLanding' : 'chatLanding'
  // Targeted launch: the chat sidebar's Workspace row and per-workspace "+"
  // route here with a targetWsId. The composer launches the session in this
  // workspace and carries the selected target through send.
  const targetWsId = spec.params.targetWsId
  const targetWs = targetWsId ? workspaces.find((w) => w.id === targetWsId) : undefined
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const installationLaunchPreferences = useAgentLaunchPreferences()
  const selectedHarnessWorkspace = useMemo(
    () => mode !== 'chat'
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

  const [value, setValue] = useState(spec.params.initialPrompt ?? '')
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
    ? chatLandingExampleGroups((key) => t(key as never), project?.product)
    : mode === 'auto-quant' ? [[
        { id: 'quant-1', label: null, title: t('autoQuantLanding.ex1'), prompt: t('autoQuantLanding.ex1') },
        { id: 'quant-2', label: null, title: t('autoQuantLanding.ex2'), prompt: t('autoQuantLanding.ex2') },
        { id: 'quant-3', label: null, title: t('autoQuantLanding.ex3'), prompt: t('autoQuantLanding.ex3') },
      ]] : [[
        { id: 'prediction-1', label: null, title: t('autoPredictionLanding.ex1'), prompt: t('autoPredictionLanding.ex1') },
        { id: 'prediction-2', label: null, title: t('autoPredictionLanding.ex2'), prompt: t('autoPredictionLanding.ex2') },
        { id: 'prediction-3', label: null, title: t('autoPredictionLanding.ex3'), prompt: t('autoPredictionLanding.ex3') },
      ]]
  const examples = exampleGroups[examplePage % exampleGroups.length]!

  const goConfigureProvider = () => {
    openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })
  }

  // A missing runtime choice should open the picker, not leave a mysteriously
  // disabled send button. submit() already handles that branch.
  const canSend = value.trim().length > 0 && !launching && launchConfig.credentialSelectionReady
  const effectiveTargetWorkspaceId = targetWsId ?? workspaceTarget?.id

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const nextHeight = Math.min(168, Math.max(44, textarea.scrollHeight))
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > 168 ? 'auto' : 'hidden'
  }, [value])

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
      void recordSuccessfulUse(effectiveAgent).catch(() => undefined)
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

  const showStarterIntents = value.trim().length === 0 && !launching

  return (
    <div
      data-testid="harness-landing-root"
      className="@container/harness flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
    >
      <div
        data-testid="harness-landing-scroll"
        className="oa-harness-scroll flex min-h-0 flex-1 justify-start overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-8 @min-[42rem]/harness:px-8 @min-[42rem]/harness:py-10"
      >
        <div
          data-testid="harness-landing-stack"
          className="mx-auto my-auto w-full max-w-[42rem]"
        >
          {listError !== null && (
            <RefreshNotice
              message={t('workspace.dataStale')}
              actionLabel={t('common.retry')}
              onAction={() => void refresh()}
            />
          )}
          <header className="flex flex-col items-center text-center">
            <img
              src="/alice.ico"
              alt=""
              aria-hidden="true"
              draggable={false}
              className="oa-harness-hero-mark h-11 w-11 select-none [image-rendering:pixelated]"
            />
            <h1 className="oa-harness-title mt-3 max-w-[38rem] text-balance text-[24px] font-semibold leading-[30px] tracking-[-0.018em] text-foreground @min-[42rem]/harness:text-[28px] @min-[42rem]/harness:leading-[34px]">
              {t(`${copyKey}.heading`)}
            </h1>
          </header>

          <div
            data-testid="harness-landing-suggestions"
            data-state={showStarterIntents ? 'visible' : 'hidden'}
            className={showStarterIntents ? 'oa-harness-starters mt-7' : 'hidden'}
            inert={!showStarterIntents}
          >
            <div className="flex h-7 items-center justify-between px-1">
              <span className="text-[12px] font-medium text-muted-foreground">
                {t(`${copyKey}.examplesLabel`)}
              </span>
              {mode === 'chat' && exampleGroups.length > 1 && (
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button
                        type="button"
                        onClick={() => setExamplePage((page) => (page + 1) % exampleGroups.length)}
                        disabled={launching}
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground"
                        aria-label={t('chatLanding.moreExamples')}
                      />
                    )}
                  >
                    <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{t('chatLanding.moreExamples')}</TooltipContent>
                </Tooltip>
              )}
            </div>
            <div role="group" aria-label={t(`${copyKey}.examplesLabel`)}>
              {examples.map((example) => {
                const IntentIcon = WORKFLOW_ICONS[example.id] ?? SearchCheck
                return (
                  <button
                    key={example.id}
                    type="button"
                    onClick={() => useExample(example.prompt)}
                    disabled={launching}
                    className="group flex min-h-11 w-full items-center gap-3 border-b border-border/70 px-1 text-left outline-none transition-[border-color,color,box-shadow] duration-[var(--motion-fast)] hover:border-border hover:text-foreground focus-visible:[box-shadow:var(--oa-focus-shadow)] disabled:opacity-40"
                  >
                    <IntentIcon
                      aria-hidden
                      className="h-[17px] w-[17px] shrink-0 text-muted-foreground transition-colors duration-[var(--motion-fast)] group-hover:text-foreground group-focus-visible:text-foreground"
                    />
                    <StableIntentLabel>{example.title}</StableIntentLabel>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-3 pb-3 @min-[42rem]/harness:px-6 @min-[42rem]/harness:pb-5">
        <div className="mx-auto w-full max-w-[46rem]">
          <div className="oa-harness-composer isolate">
            <div
              data-testid="harness-landing-context"
              className="oa-harness-context-tray relative z-0 mx-[13px] -mb-3 flex min-h-12 min-w-0 items-center gap-0.5 overflow-hidden rounded-t-[20px] px-3 pb-4 pt-2 text-[12px] leading-4 text-muted-foreground"
            >
              <HarnessWorkspacePicker
                mode={mode}
                workspace={workspaceTarget}
                options={chatWorkspaceOptions}
                locked={targetWs !== undefined || mode !== 'chat'}
                onSelect={(workspaceId) => {
                  setSelectedWorkspaceId(workspaceId)
                  launchConfig.resetCredentialSelection()
                }}
                onClear={targetWs && mode === 'chat'
                  ? () => openOrFocus({ kind: landingKind, params: {} })
                  : undefined}
              />
              <AgentLaunchSelectors
                ref={launchSelectorsRef}
                config={launchConfig}
                onConfigureProvider={goConfigureProvider}
                showAi={false}
                menuPlacement="up"
                toolbar
              />
            </div>
            <div
              data-testid="harness-composer-shell"
              className="oa-harness-composer-shell relative z-10 rounded-[26px] bg-card px-3 pb-2.5 pt-3"
            >
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t(`${copyKey}.placeholder`)}
                rows={1}
                autoFocus
                className="block min-h-[68px] max-h-[168px] w-full resize-none bg-transparent px-1.5 py-1.5 text-[14px] leading-[21px] text-foreground outline-none placeholder:text-muted-foreground/70"
              />
              <div
                data-testid="harness-landing-controls"
                className="flex min-h-8 min-w-0 items-end justify-between gap-2 overflow-hidden px-0.5 pt-1"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 overflow-hidden">
                  <AgentLaunchSelectors
                    config={launchConfig}
                    onConfigureProvider={goConfigureProvider}
                    showRuntime={false}
                    toolbar
                  />
                </div>
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button
                        type="button"
                        onClick={() => void submit()}
                        disabled={!canSend}
                        aria-label={t('chatLanding.send')}
                        aria-busy={launching}
                        size="icon"
                        className="rounded-full bg-foreground text-background hover:bg-foreground/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground/55 disabled:opacity-100"
                      />
                    )}
                  >
                    {launching
                      ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      : <ArrowUp className="h-4 w-4" aria-hidden />}
                  </TooltipTrigger>
                  <TooltipContent>{t('chatLanding.send')}</TooltipContent>
                </Tooltip>
              </div>
              <AgentLaunchDetails
                config={launchConfig}
                hasWorkspaceTarget={credentialWorkspace !== null && credentialWorkspace !== undefined}
                showScopeDisclosure={false}
                className="mx-1 mt-1.5 border-t border-border/45 px-1 pt-2"
              />
            </div>
          </div>

          {error !== null && (
            <ComposerNotice tone="error" icon={CircleAlert}>
              <span className="text-foreground">{error}</span>
            </ComposerNotice>
          )}

          {launchConfig.agentsKnown && !launchConfig.anyInstalled ? (
            <ComposerNotice tone="warning" icon={KeyRound}>
              <span>
                <span className="font-medium text-foreground">{t('chatLanding.noAgentsTitle')}</span>
                {' '}{t('chatLanding.noAgentsBody')}
              </span>
            </ComposerNotice>
          ) : launchConfig.selectedMissing && selectedInfo ? (
            <ComposerNotice tone="warning" icon={CircleAlert}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{t('chatLanding.agentMissing', { name: selectedInfo.displayName })}</span>
                {installHint?.cmd && (
                  <code className="select-all rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-[15px] text-foreground">
                    {installHint.cmd}
                  </code>
                )}
                {installHint?.url && (
                  <a href={installHint.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    {t('chatLanding.installDocs')}
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
              </div>
            </ComposerNotice>
          ) : null}

          {launchConfig.noCredentials && selectedInfo && (
            <ComposerNotice tone="warning" icon={KeyRound}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{t('chatLanding.noCredBody', { name: selectedInfo.displayName })}</span>
                <Button type="button" onClick={goConfigureProvider} variant="link" size="xs" className="h-auto px-0 py-0">
                  {t('chatLanding.configureProvider')}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </Button>
              </div>
            </ComposerNotice>
          )}
        </div>
      </div>
    </div>
  )
}

export function ChatLandingPage({ spec }: { spec: { params: { targetWsId?: string; initialPrompt?: string } } }) {
  const ctx = useWorkspaces()
  const hasChatWorkspace = ctx.workspaces.some((workspace) => workspace.template === 'chat')
  if (!hasChatWorkspace) return <ChatSetupPage />
  return <HarnessLandingPage spec={spec} mode="chat" />
}

export function AutoQuantLandingPage({ spec }: { spec: { params: { targetWsId?: string; initialPrompt?: string } } }) {
  const ctx = useWorkspaces()
  const workspace = ctx.workspaces.find((candidate) =>
    candidate.id === ctx.autoQuantDefaultWorkspaceId
    && candidate.template === 'auto-quant-v2')
  if (!workspace) return <AutoQuantSetupPage />
  return <HarnessLandingPage spec={{ params: { targetWsId: workspace.id, initialPrompt: spec.params.initialPrompt } }} mode="auto-quant" />
}

export function AutoPredictionLandingPage({ spec }: { spec: { params: { targetWsId?: string; initialPrompt?: string } } }) {
  const ctx = useWorkspaces()
  const workspace = ctx.workspaces.find((candidate) =>
    candidate.id === ctx.autoPredictionDefaultWorkspaceId
    && candidate.template === 'auto-prediction')
  if (!workspace) return <AutoPredictionSetupPage />
  return <HarnessLandingPage spec={{ params: { targetWsId: workspace.id, initialPrompt: spec.params.initialPrompt } }} mode="prediction" />
}
