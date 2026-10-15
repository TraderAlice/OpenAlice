import { Collapsible, CollapsibleContent } from '../components/ui/collapsible'
import { ConversationTranscriptItem } from '../components/conversation/ConversationTranscript'
import aliceWave from '../../../default/stickers/alice-color/wave.png'
import { layout, prepare } from '@chenglou/pretext'
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { AgentChatComposer } from '../components/workspace/AgentChatComposer'
import { ConversationLayout } from '../components/conversation/ConversationLayout'
import { PageTopBar } from '../components/PageTopBar'
import {
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
  LoaderCircle,
  ExternalLink,
  RefreshCw,
  SearchCheck,
  type LucideIcon,
} from 'lucide-react'

import { useWorkspaces } from '../contexts/workspaces-context'
import { installHintFor } from '../components/workspace/agentInstall'
import { QuickChatError } from '../components/workspace/api'
import {
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
import { useWorkspace } from '../tabs/store'
import { useAliceProject } from '../hooks/useAliceProject'
import { useAgentRuntimes } from '../hooks/useAgentRuntimes'
import {
  useAgentLaunchConfig,
  useAgentLaunchPreferences,
  useWorkspaceAgentLaunchPreferences,
} from '../hooks/useAgentLaunchConfig'
import { chatLandingExampleGroups } from '../lib/chat-landing-examples'
import { resolveChatWorkspaceTarget } from '../lib/chat-workspace-target'
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

interface LandingPageProps {
  spec: { params: { targetWsId?: string; initialPrompt?: string } }
  showHeader?: boolean
  onPromptChange?: (prompt: string) => void
}

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

export function HarnessLandingPage({
  spec,
  mode,
  showHeader = true,
  onPromptChange,
}: LandingPageProps & {
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
  const copyKey = mode === 'auto-quant'
    ? 'autoQuantLanding'
    : mode === 'prediction' ? 'autoPredictionLanding' : 'chatLanding'
  // Targeted launch: the chat sidebar's Workspace row and per-workspace "+"
  // route here with a targetWsId. The composer launches the session in this
  // workspace and carries the selected target through send.
  const targetWsId = spec.params.targetWsId
  const targetWs = targetWsId ? workspaces.find((w) => w.id === targetWsId) : undefined
  const installationLaunchPreferences = useAgentLaunchPreferences()
  const selectedHarnessWorkspace = useMemo(
    () => mode !== 'chat'
      ? targetWs ?? null
      : resolveChatWorkspaceTarget(
          workspaces,
          targetWsId ?? null,
          installationLaunchPreferences.recentChatWorkspaceId,
          templateName,
        ),
    [workspaces, templateName, targetWsId, mode, installationLaunchPreferences.recentChatWorkspaceId],
  )
  const workspaceTarget = targetWs ?? selectedHarnessWorkspace
  const launchPreferences = useWorkspaceAgentLaunchPreferences(
    mode === 'chat' ? workspaceTarget : null,
    installationLaunchPreferences,
  )
  // The selectable agent runtimes = the agent CLIs (the bare shell has no agent
  // loop, so it can't be seeded with a first message).
  const cliAgents = agents.filter((a) => a.kind !== 'utility')

  const [value, setDraftValue] = useState(spec.params.initialPrompt ?? '')
  const setValue = (next: string) => {
    setDraftValue(next)
    onPromptChange?.(next)
  }
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
  const [uiMode, setUiMode] = useState<'terminal' | 'webpi'>(import.meta.env.VITE_DEMO_MODE ? 'webpi' : 'terminal')
  const selectedInfo = launchConfig.selectedAgent
  const supportsGui = Boolean(selectedInfo?.capabilities.web?.freshSession)
  const surface = supportsGui ? uiMode : 'terminal'
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
        surface,
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
    <ConversationLayout
      welcome={!launching}
      header={showHeader && <PageTopBar title={t(mode === 'chat' ? 'chat.newChat' : mode === 'auto-quant' ? 'autoQuant.newResearch' : 'autoPrediction.newResearch')} />}
      composer={<>
        <AgentChatComposer
          config={launchConfig}
          onConfigureProvider={goConfigureProvider}
          configurationDisabled={launching}
          hasWorkspaceTarget={!!credentialWorkspace}
          value={launching ? '' : value}
          onChange={setValue}
          onSubmit={() => void submit()}
          placeholder={t(`${copyKey}.placeholder`)}
          inputRef={textareaRef}
          autoFocus
          canSend={canSend}
          pending={launching}
          disabled={launching}
          sendLabel={t('chatLanding.send')}
          context={<>
            <AgentLaunchSelectors
              ref={launchSelectorsRef}
              config={launchConfig}
              onConfigureProvider={goConfigureProvider}
              showAi={false}
              menuPlacement="up"
              toolbar
            />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label={`${t('chatLanding.uiMode')}: ${surface === 'webpi' ? 'GUI' : 'TUI'}`} disabled={launching} />}>
                <LayoutGrid size={14} aria-hidden />
                <span>{surface === 'webpi' ? 'GUI' : 'TUI'}</span><ChevronDown size={14} aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                <DropdownMenuRadioGroup value={surface} onValueChange={value => setUiMode(value as 'terminal' | 'webpi')}>
                  <DropdownMenuRadioItem value="terminal" closeOnClick>TUI</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="webpi" disabled={!supportsGui} closeOnClick>GUI</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

          </>}

          />

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
      </>}
    >
      {launching ? <div className="oa-chat-launch-preview">
        <ConversationTranscriptItem item={{ kind: 'user', key: 'launch-preview', content: [{ kind: 'markdown', text: value.trim() }] }} working={false} />
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
          {t('chatLanding.startingSession')}
        </div>
      </div> : <>
      {listError !== null && (
        <RefreshNotice
          message={t('workspace.dataStale')}
          actionLabel={t('common.retry')}
          onAction={() => void refresh()}
        />
      )}
      <header className="flex flex-col items-center text-center">
        <img
          src={aliceWave}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="oa-harness-hero-mark h-20 w-20 object-contain select-none sm:h-24 sm:w-24"
        />
        <h1 className="oa-harness-title mt-3 max-w-[38rem] text-balance text-[24px] font-semibold leading-[30px] tracking-[-0.018em] text-foreground @min-[42rem]/harness:text-[28px] @min-[42rem]/harness:leading-[34px]">
          {t(`${copyKey}.heading`)}
        </h1>
      </header>

      <Collapsible open={showStarterIntents}>
      <CollapsibleContent keepMounted
        data-testid="harness-landing-suggestions"
        data-state={showStarterIntents ? 'visible' : 'hidden'}
        className="oa-harness-starters"
        aria-hidden={!showStarterIntents}
        inert={!showStarterIntents}
      >
        <div className="pt-7">
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
      </CollapsibleContent>
      </Collapsible>
      </>}
    </ConversationLayout>
  )
}

export function ChatLandingPage({ spec, ...presentation }: LandingPageProps) {
  const ctx = useWorkspaces()
  const hasChatWorkspace = ctx.workspaces.some((workspace) => workspace.template === 'chat')
  if (!hasChatWorkspace) return <ChatSetupPage />
  return <HarnessLandingPage spec={spec} mode="chat" {...presentation} />
}

export function AutoQuantLandingPage({ spec, ...presentation }: LandingPageProps) {
  const ctx = useWorkspaces()
  const workspace = ctx.workspaces.find((candidate) =>
    candidate.id === ctx.autoQuantDefaultWorkspaceId
    && candidate.template === 'auto-quant-v2')
  if (!workspace) return <AutoQuantSetupPage />
  return <HarnessLandingPage spec={{ params: { targetWsId: workspace.id, initialPrompt: spec.params.initialPrompt } }} mode="auto-quant" {...presentation} />
}

export function AutoPredictionLandingPage({ spec, ...presentation }: LandingPageProps) {
  const ctx = useWorkspaces()
  const workspace = ctx.workspaces.find((candidate) =>
    candidate.id === ctx.autoPredictionDefaultWorkspaceId
    && candidate.template === 'auto-prediction')
  if (!workspace) return <AutoPredictionSetupPage />
  return <HarnessLandingPage spec={{ params: { targetWsId: workspace.id, initialPrompt: spec.params.initialPrompt } }} mode="prediction" {...presentation} />
}
