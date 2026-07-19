import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  Code2,
  Cpu,
  Gauge,
  KeyRound,
  Settings2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

import { formatContextWindow, type AgentLaunchConfigState } from '../../hooks/useAgentLaunchConfig'

const AGENT_ICONS: Record<string, LucideIcon> = {
  claude: Sparkles,
  codex: Cpu,
  opencode: Code2,
  pi: Bot,
}

export interface AgentLaunchSelectorsProps {
  readonly config: AgentLaunchConfigState
  readonly onConfigureProvider: () => void
}

export interface AgentLaunchSelectorsHandle {
  openAgentMenu(): void
}

/** The shared runtime + credential selector used by every chat-style launch
 * surface. Selection behavior and presentation now evolve together. */
export const AgentLaunchSelectors = forwardRef<AgentLaunchSelectorsHandle, AgentLaunchSelectorsProps>(function AgentLaunchSelectors(
  { config, onConfigureProvider },
  ref,
) {
  const { t } = useTranslation()
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [credentialMenuOpen, setCredentialMenuOpen] = useState(false)
  const agentBoxRef = useRef<HTMLDivElement>(null)
  const credentialBoxRef = useRef<HTMLDivElement>(null)
  const SelectedIcon = config.selectedAgent ? AGENT_ICONS[config.selectedAgent.id] : undefined

  useImperativeHandle(ref, () => ({
    openAgentMenu() {
      setCredentialMenuOpen(false)
      setAgentMenuOpen(true)
    },
  }), [])

  useEffect(() => {
    if (!agentMenuOpen && !credentialMenuOpen) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (agentMenuOpen && agentBoxRef.current && !agentBoxRef.current.contains(target)) {
        setAgentMenuOpen(false)
      }
      if (credentialMenuOpen && credentialBoxRef.current && !credentialBoxRef.current.contains(target)) {
        setCredentialMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [agentMenuOpen, credentialMenuOpen])

  return (
    <>
      <div ref={agentBoxRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setAgentMenuOpen((open) => !open)
            setCredentialMenuOpen(false)
          }}
          disabled={config.agents.length === 0}
          aria-haspopup="menu"
          aria-expanded={agentMenuOpen}
          aria-label={t('chatLanding.selectAgent')}
          className="oa-pressable inline-flex min-h-8 max-w-[190px] items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {SelectedIcon ? <SelectedIcon className="h-3 w-3 shrink-0" /> : <Bot className="h-3 w-3 shrink-0" />}
          <span className="truncate">{config.selectedAgent?.displayName ?? t('chatLanding.selectAgent')}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
        {agentMenuOpen && config.agents.length > 0 && (
          <div
            role="menu"
            className="oa-popover-enter absolute bottom-full left-0 z-20 mb-1 min-w-[180px] rounded-lg border border-border/70 bg-secondary py-1 shadow-lg"
          >
            {config.agents.map((agent) => {
              const Icon = AGENT_ICONS[agent.id]
              const active = agent.id === config.effectiveAgent
              const missing = agent.installed === false
              return (
                <button
                  key={agent.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    config.selectAgent(agent.id)
                    setAgentMenuOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-muted ${active ? 'text-primary' : missing ? 'text-muted-foreground' : 'text-foreground'}`}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : <span className="w-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{agent.displayName}</span>
                  {missing && <span className="shrink-0 text-[10px] text-muted-foreground">{t('chatLanding.agentNotInstalled')}</span>}
                  {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {config.needsCredential && config.noCredentials && (
        <button
          type="button"
          onClick={onConfigureProvider}
          className="oa-pressable inline-flex min-h-8 items-center gap-1.5 rounded-md bg-warning/10 px-2.5 py-1 text-[11px] text-warning hover:bg-warning/20"
        >
          <KeyRound className="h-3 w-3" />
          {t('chatLanding.configureProvider')}
        </button>
      )}

      {config.needsCredential && !config.noCredentials && config.credentials && config.credentials.length > 0 && (
        <div ref={credentialBoxRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setCredentialMenuOpen((open) => !open)
              setAgentMenuOpen(false)
            }}
            aria-haspopup="menu"
            aria-expanded={credentialMenuOpen}
            aria-label={t('chatLanding.selectCredential')}
            className="oa-pressable inline-flex min-h-8 max-w-[190px] items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <KeyRound className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {config.credential?.label?.trim() || config.credential?.slug || t('chatLanding.selectCredential')}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          </button>
          {credentialMenuOpen && (
            <div
              role="menu"
              className="oa-popover-enter absolute bottom-full left-0 z-20 mb-1 min-w-[200px] rounded-lg border border-border/70 bg-secondary py-1 shadow-lg"
            >
              {config.credentials.map((credential) => {
                const active = credential.slug === config.effectiveCredential
                return (
                  <button
                    key={credential.slug}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      config.selectCredential(credential.slug)
                      setCredentialMenuOpen(false)
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-muted ${active ? 'text-primary' : 'text-foreground'}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{credential.label?.trim() || credential.slug}</span>
                      {credential.resolvedModel && (
                        <span className="block truncate text-[10px] text-muted-foreground">{credential.resolvedModel}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{credential.vendor}</span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </>
  )
})

export interface AgentLaunchDetailsProps {
  readonly config: AgentLaunchConfigState
  readonly hasWorkspaceTarget: boolean
  readonly onAdjustAi: () => void
  readonly className?: string
}

/** Compact, truthful launch metadata. Workspace-local config always wins the
 * disclosure, while absent native fields remain unknown rather than inferred. */
export function AgentLaunchDetails({
  config,
  hasWorkspaceTarget,
  onAdjustAi,
  className = '',
}: AgentLaunchDetailsProps) {
  const { t } = useTranslation()

  if (hasWorkspaceTarget && !config.workspaceConfigResolved) return null

  let summary: ReactNode = null
  if (config.aiDetails) {
    const model = config.aiDetails.model ?? t('chatLanding.runtimeDefaultModel')
    const workspaceSaved = config.aiDetails.source === 'workspace'
    const sourceLabel = workspaceSaved
      ? t('chatLanding.workspaceAiSaved')
      : hasWorkspaceTarget
        ? t('chatLanding.workspaceAiWillInject')
        : t('chatLanding.newWorkspaceAiWillSeed')
    const actionLabel = hasWorkspaceTarget
      ? workspaceSaved
        ? t('chatLanding.adjustWorkspaceAi')
        : t('chatLanding.configureWorkspaceAi')
      : t('chatLanding.providerSettings')
    const reasoningLabel = config.aiDetails.reasoningEffort
      ? t('chatLanding.reasoningEffortSummary', { effort: config.aiDetails.reasoningEffort })
      : config.aiDetails.reasoningMode === 'required'
        ? t('chatLanding.reasoningRequiredSummary')
        : config.aiDetails.reasoningMode === 'adaptive'
          ? t('chatLanding.reasoningAdaptiveSummary')
          : config.aiDetails.reasoningMode === 'none' || config.aiDetails.reasoning === false
            ? t('chatLanding.reasoningDisabledSummary')
            : config.aiDetails.reasoning === true
              ? t('chatLanding.reasoningEnabledSummary')
              : config.aiDetails.reasoningMode === 'optional'
                ? t('chatLanding.reasoningOptionalSummary')
                : t('chatLanding.reasoningRuntimeSummary')
    summary = (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground">
        <span className={workspaceSaved ? 'text-success' : 'text-primary'}>
          {sourceLabel}
        </span>
        <span aria-hidden className="text-muted-foreground/40">·</span>
        <span
          className="inline-flex min-w-0 max-w-full items-center gap-1"
          aria-label={t('chatLanding.modelSummary', { model })}
          title={model}
        >
          <Cpu className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono text-foreground/80">{model}</span>
        </span>
        <span aria-hidden className="text-muted-foreground/40">·</span>
        <span
          className="inline-flex shrink-0 items-center gap-1"
          aria-label={reasoningLabel}
        >
          <BrainCircuit className="h-3 w-3" />
          {reasoningLabel}
        </span>
        {config.aiDetails.contextWindow !== null && (
          <>
            <span aria-hidden className="text-muted-foreground/40">·</span>
            <span
              className="inline-flex shrink-0 items-center gap-1"
              aria-label={t('chatLanding.contextSummary', {
                limit: formatContextWindow(config.aiDetails.contextWindow),
              })}
            >
              <Gauge className="h-3 w-3" />
              {t('chatLanding.contextSummary', {
                limit: formatContextWindow(config.aiDetails.contextWindow),
              })}
            </span>
          </>
        )}
        <button
          type="button"
          onClick={onAdjustAi}
          className="oa-pressable inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-primary hover:bg-primary/10 sm:ml-auto"
          aria-label={actionLabel}
          title={actionLabel}
        >
          <Settings2 className="h-3 w-3" />
          {actionLabel}
        </button>
      </div>
    )
  } else if (config.selectedAgent && (!config.needsCredential || config.selectedRuntimeUsesGlobalConfig)) {
    summary = (
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10.5px] text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Bot className="h-3 w-3 shrink-0" />
          <span>{t('chatLanding.runtimeManagedAi', { runtime: config.selectedAgent.displayName })}</span>
        </span>
        {!config.needsCredential && hasWorkspaceTarget && (
          <button
            type="button"
            onClick={onAdjustAi}
            className="oa-pressable inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-primary hover:bg-primary/10 sm:ml-auto"
            aria-label={t('chatLanding.configureWorkspaceAi')}
            title={t('chatLanding.configureWorkspaceAi')}
          >
            <Settings2 className="h-3 w-3" />
            {t('chatLanding.configureWorkspaceAi')}
          </button>
        )}
      </div>
    )
  }

  const setupStatus = config.detectedCredential?.interactiveSetupStatus
  const setupNotice = setupStatus === 'runtime-onboarding-required'
    ? t('chatLanding.claudeOnboardingRequired')
    : setupStatus === 'workspace-trust-required'
      ? t('chatLanding.claudeWorkspaceTrustRequired')
      : null

  if (summary === null && setupNotice === null) return null
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      {summary}
      {setupNotice !== null && (
        <div
          role="status"
          className="flex min-w-0 items-start gap-1.5 text-[10.5px] leading-relaxed text-warning"
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{setupNotice}</span>
        </div>
      )}
    </div>
  )
}
