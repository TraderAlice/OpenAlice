import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  Code2,
  Cpu,
  Info,
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

function menuItems(menuRef: RefObject<HTMLDivElement | null>): HTMLButtonElement[] {
  return Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
}

function focusMenuEdge(
  menuRef: RefObject<HTMLDivElement | null>,
  edge: 'first' | 'last',
): void {
  const items = menuItems(menuRef)
  items[edge === 'first' ? 0 : items.length - 1]?.focus()
}

function handleMenuKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  menuRef: RefObject<HTMLDivElement | null>,
  close: () => void,
  triggerRef: RefObject<HTMLButtonElement | null>,
): void {
  const items = menuItems(menuRef)
  if (items.length === 0) return

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    triggerRef.current?.focus()
    return
  }

  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
  let nextIndex: number | null = null
  if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
  if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = items.length - 1
  if (nextIndex === null) return

  event.preventDefault()
  items[nextIndex]?.focus()
}

function AgentLaunchModelEditor({ config }: { config: AgentLaunchConfigState }) {
  const { t } = useTranslation()
  const listId = useId()
  const [draft, setDraft] = useState(config.launchModel ?? '')

  useEffect(() => setDraft(config.launchModel ?? ''), [config.launchModel])

  const commit = () => {
    const next = draft.trim()
    if (next !== (config.launchModel ?? '')) config.selectModel(next || null)
  }
  const defaultLabel = config.defaultModel
    ? t('chatLanding.defaultModelValue', { model: config.defaultModel })
    : t('chatLanding.runtimeDefaultModel')
  const contextLabel = config.aiDetails?.contextWindow
    ? t('chatLanding.contextSummary', {
        limit: formatContextWindow(config.aiDetails.contextWindow),
      })
    : undefined

  return (
    <label className="relative inline-flex min-h-8 min-w-0 max-w-[220px] items-center rounded-md bg-muted text-[11px] text-muted-foreground focus-within:ring-1 focus-within:ring-primary/50">
      <Cpu className="pointer-events-none absolute left-2.5 h-3 w-3 shrink-0" />
      <input
        list={listId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(config.launchModel ?? '')
            event.currentTarget.blur()
          }
        }}
        aria-label={t('chatLanding.selectModel')}
        title={contextLabel}
        placeholder={defaultLabel}
        className="min-w-0 w-[190px] bg-transparent py-1 pl-7 pr-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      <datalist id={listId}>
        {config.modelOptions.map((model) => (
          <option key={model.id} value={model.id}>{model.label}</option>
        ))}
      </datalist>
    </label>
  )
}

function AgentLaunchEffortEditor({ config }: { config: AgentLaunchConfigState }) {
  const { t } = useTranslation()
  const current = config.launchReasoningEffort
  const options = current && !config.effortOptions.includes(current)
    ? [current, ...config.effortOptions]
    : config.effortOptions
  const details = config.aiDetails
  const resolvedDefault = details?.reasoningEffort
    ? t('chatLanding.reasoningEffortSummary', { effort: details.reasoningEffort })
    : details?.reasoningMode === 'required'
      ? t('chatLanding.reasoningRequiredSummary')
      : details?.reasoningMode === 'adaptive'
        ? t('chatLanding.reasoningAdaptiveSummary')
        : details?.reasoningMode === 'none' || details?.reasoning === false
          ? t('chatLanding.reasoningDisabledSummary')
          : details?.reasoning === true
            ? t('chatLanding.reasoningEnabledSummary')
            : details?.reasoningMode === 'optional'
              ? t('chatLanding.reasoningOptionalSummary')
              : t('chatLanding.reasoningRuntimeSummary')
  const defaultLabel = details
    ? t('chatLanding.defaultEffortValue', { effort: resolvedDefault })
    : t('chatLanding.defaultEffort')
  return (
    <label className="relative inline-flex min-h-8 min-w-0 max-w-[190px] items-center rounded-md bg-muted text-[11px] text-muted-foreground focus-within:ring-1 focus-within:ring-primary/50">
      <BrainCircuit className="pointer-events-none absolute left-2.5 h-3 w-3 shrink-0" />
      <select
        value={current ?? ''}
        onChange={(event) => config.selectReasoningEffort(
          event.target.value
            ? event.target.value as NonNullable<AgentLaunchConfigState['launchReasoningEffort']>
            : null,
        )}
        aria-label={t('chatLanding.selectEffort')}
        className="min-w-0 max-w-[190px] appearance-none bg-transparent py-1 pl-7 pr-7 text-[11px] text-foreground outline-none"
      >
        <option value="">{defaultLabel}</option>
        {options.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 opacity-60" />
    </label>
  )
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
  const agentTriggerRef = useRef<HTMLButtonElement>(null)
  const credentialTriggerRef = useRef<HTMLButtonElement>(null)
  const agentMenuRef = useRef<HTMLDivElement>(null)
  const credentialMenuRef = useRef<HTMLDivElement>(null)
  const agentFocusEdgeRef = useRef<'first' | 'last'>('first')
  const credentialFocusEdgeRef = useRef<'first' | 'last'>('first')
  const SelectedIcon = config.selectedAgent ? AGENT_ICONS[config.selectedAgent.id] : undefined

  useImperativeHandle(ref, () => ({
    openAgentMenu() {
      agentFocusEdgeRef.current = 'first'
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

  useEffect(() => {
    if (!agentMenuOpen) return
    focusMenuEdge(agentMenuRef, agentFocusEdgeRef.current)
    agentFocusEdgeRef.current = 'first'
  }, [agentMenuOpen])

  useEffect(() => {
    if (!credentialMenuOpen) return
    focusMenuEdge(credentialMenuRef, credentialFocusEdgeRef.current)
    credentialFocusEdgeRef.current = 'first'
  }, [credentialMenuOpen])

  return (
    <>
      <div
        ref={agentBoxRef}
        className="relative"
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null
          if (!next || !event.currentTarget.contains(next)) setAgentMenuOpen(false)
        }}
      >
        <button
          ref={agentTriggerRef}
          type="button"
          onClick={() => {
            agentFocusEdgeRef.current = 'first'
            setAgentMenuOpen((open) => !open)
            setCredentialMenuOpen(false)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault()
            agentFocusEdgeRef.current = event.key === 'ArrowUp' ? 'last' : 'first'
            setCredentialMenuOpen(false)
            setAgentMenuOpen(true)
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
            ref={agentMenuRef}
            role="menu"
            onKeyDown={(event) => handleMenuKeyDown(
              event,
              agentMenuRef,
              () => setAgentMenuOpen(false),
              agentTriggerRef,
            )}
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
                  tabIndex={-1}
                  onClick={() => {
                    config.selectAgent(agent.id)
                    setAgentMenuOpen(false)
                    agentTriggerRef.current?.focus()
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

      {config.canSelectCredential && !config.noCredentials && config.credentials && config.credentials.length > 0 && (
        <div
          ref={credentialBoxRef}
          className="relative"
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null
            if (!next || !event.currentTarget.contains(next)) setCredentialMenuOpen(false)
          }}
        >
          <button
            ref={credentialTriggerRef}
            type="button"
            onClick={() => {
              credentialFocusEdgeRef.current = 'first'
              setCredentialMenuOpen((open) => !open)
              setAgentMenuOpen(false)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
              event.preventDefault()
              credentialFocusEdgeRef.current = event.key === 'ArrowUp' ? 'last' : 'first'
              setAgentMenuOpen(false)
              setCredentialMenuOpen(true)
            }}
            aria-haspopup="menu"
            aria-expanded={credentialMenuOpen}
            aria-label={t('chatLanding.selectCredential')}
            className="oa-pressable inline-flex min-h-8 max-w-[190px] items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <KeyRound className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {config.credential?.label?.trim() || config.credential?.slug || t('chatLanding.runtimeDefaultModel')}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          </button>
          {credentialMenuOpen && (
            <div
              ref={credentialMenuRef}
              role="menu"
              onKeyDown={(event) => handleMenuKeyDown(
                event,
                credentialMenuRef,
                () => setCredentialMenuOpen(false),
                credentialTriggerRef,
              )}
              className="oa-popover-enter absolute bottom-full left-0 z-20 mb-1 min-w-[200px] rounded-lg border border-border/70 bg-secondary py-1 shadow-lg"
            >
              {!config.needsCredential && config.detectedCredential?.configured !== true && (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    config.selectRuntimeDefault()
                    setCredentialMenuOpen(false)
                    credentialTriggerRef.current?.focus()
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-muted ${config.effectiveCredential === null ? 'text-primary' : 'text-foreground'}`}
                >
                  <span className="min-w-0 flex-1 truncate">{t('chatLanding.runtimeDefaultModel')}</span>
                  {config.effectiveCredential === null && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              )}
              {config.credentials.map((credential) => {
                const active = credential.slug === config.effectiveCredential
                return (
                  <button
                    key={credential.slug}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => {
                      config.selectCredential(credential.slug)
                      setCredentialMenuOpen(false)
                      credentialTriggerRef.current?.focus()
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

      {config.selectedAgent && (
        <div
          data-testid="agent-launch-inference-group"
          className="contents sm:flex sm:shrink-0 sm:items-center sm:gap-2"
        >
          <AgentLaunchModelEditor config={config} />
          <AgentLaunchEffortEditor config={config} />
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

/** Compact launch scope. Model and effort belong in their editors above; this
 * row only explains where the selected tuple applies and links to its owner. */
export function AgentLaunchDetails({
  config,
  hasWorkspaceTarget,
  onAdjustAi,
  className = '',
}: AgentLaunchDetailsProps) {
  const { t } = useTranslation()

  if (hasWorkspaceTarget && !config.workspaceConfigResolved) return null

  let scope: {
    label: string
    detail?: string
    actionLabel?: string
  } | null = null
  if (config.aiDetails) {
    const workspaceSaved = config.aiDetails.source === 'workspace'
    const actionLabel = hasWorkspaceTarget
      ? workspaceSaved
        ? t('chatLanding.adjustWorkspaceAi')
        : t('chatLanding.configureWorkspaceAi')
      : t('chatLanding.providerSettings')
    scope = workspaceSaved
      ? {
          label: t('chatLanding.workspaceAiScope'),
          actionLabel,
        }
      : {
          label: t('chatLanding.newSessionAiScope'),
          detail: hasWorkspaceTarget
            ? config.willOverwriteCredential && config.credential && config.detectedCredential?.slug
              ? t('chatLanding.sessionCredentialOverride', {
                  from: config.detectedCredential.slug,
                  to: config.credential.slug,
                })
              : t('chatLanding.workspaceAiUnchanged')
            : t('chatLanding.newSessionAiReady'),
          actionLabel,
        }
  } else if (config.selectedAgent && (!config.needsCredential || config.selectedRuntimeUsesGlobalConfig)) {
    scope = {
      label: t('chatLanding.runtimeAiScope', { runtime: config.selectedAgent.displayName }),
      detail: t('chatLanding.runtimeManagedAi', { runtime: config.selectedAgent.displayName }),
      ...(!config.needsCredential && hasWorkspaceTarget
        ? { actionLabel: t('chatLanding.configureWorkspaceAi') }
        : {}),
    }
  }

  const setupStatus = config.detectedCredential?.interactiveSetupStatus
  const setupNotice = setupStatus === 'runtime-onboarding-required'
    ? t('chatLanding.claudeOnboardingRequired')
    : setupStatus === 'workspace-trust-required'
      ? t('chatLanding.claudeWorkspaceTrustRequired')
      : null

  if (scope === null && setupNotice === null) return null
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      {scope !== null && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground">
          <span className="inline-flex min-h-6 shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-muted/45 px-2 font-medium text-foreground/80">
            <Info className="h-3 w-3 shrink-0" />
            {scope.label}
          </span>
          {scope.detail && (
            <span className="hidden min-w-0 flex-1 truncate sm:block" title={scope.detail}>
              {scope.detail}
            </span>
          )}
          {scope.actionLabel && (
            <button
              type="button"
              onClick={onAdjustAi}
              className="oa-pressable ml-auto inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md px-2 py-1 text-primary hover:bg-primary/10"
              aria-label={scope.actionLabel}
              title={scope.actionLabel}
            >
              <Settings2 className="h-3 w-3" />
              {scope.actionLabel}
            </button>
          )}
        </div>
      )}
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
