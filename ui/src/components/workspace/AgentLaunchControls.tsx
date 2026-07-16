import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
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
          className="oa-pressable inline-flex min-h-8 max-w-[190px] items-center gap-1.5 rounded-md bg-bg-tertiary px-2.5 py-1 text-[11px] text-text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          {SelectedIcon ? <SelectedIcon className="h-3 w-3 shrink-0" /> : <Bot className="h-3 w-3 shrink-0" />}
          <span className="truncate">{config.selectedAgent?.displayName ?? t('chatLanding.selectAgent')}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
        {agentMenuOpen && config.agents.length > 0 && (
          <div
            role="menu"
            className="oa-popover-enter absolute bottom-full left-0 z-20 mb-1 min-w-[180px] rounded-lg border border-border/70 bg-bg-secondary py-1 shadow-lg"
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
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-tertiary ${active ? 'text-accent' : missing ? 'text-text-muted' : 'text-text'}`}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : <span className="w-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{agent.displayName}</span>
                  {missing && <span className="shrink-0 text-[10px] text-text-muted">{t('chatLanding.agentNotInstalled')}</span>}
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
          className="oa-pressable inline-flex min-h-8 items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
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
            className="oa-pressable inline-flex min-h-8 max-w-[190px] items-center gap-1.5 rounded-md bg-bg-tertiary px-2.5 py-1 text-[11px] text-text-muted hover:text-text"
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
              className="oa-popover-enter absolute bottom-full left-0 z-20 mb-1 min-w-[200px] rounded-lg border border-border/70 bg-bg-secondary py-1 shadow-lg"
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
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-tertiary ${active ? 'text-accent' : 'text-text'}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{credential.label?.trim() || credential.slug}</span>
                      {credential.resolvedModel && (
                        <span className="block truncate text-[10px] text-text-muted">{credential.resolvedModel}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] text-text-muted">{credential.vendor}</span>
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

/** Compact, truthful launch metadata. Loginless runtimes show the exact
 * model/context that will be injected; native-login CLIs say who owns it. */
export function AgentLaunchDetails({
  config,
  hasWorkspaceTarget,
  onAdjustAi,
  className = '',
}: AgentLaunchDetailsProps) {
  const { t } = useTranslation()

  if (config.needsCredential && config.aiDetails) {
    const model = config.aiDetails.model ?? t('chatLanding.runtimeDefaultModel')
    const context = formatContextWindow(config.aiDetails.contextWindow)
    return (
      <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-text-muted ${className}`}>
        <span
          className="inline-flex min-w-0 max-w-full items-center gap-1"
          aria-label={t('chatLanding.modelSummary', { model })}
          title={model}
        >
          <Cpu className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono text-text/80">{model}</span>
        </span>
        <span aria-hidden className="text-text-muted/40">·</span>
        <span
          className="inline-flex shrink-0 items-center gap-1"
          aria-label={t('chatLanding.contextSummary', { limit: context })}
        >
          <Gauge className="h-3 w-3" />
          {t('chatLanding.contextSummary', { limit: context })}
        </span>
        <button
          type="button"
          onClick={onAdjustAi}
          className="oa-pressable inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-accent hover:bg-accent/10 sm:ml-auto"
          aria-label={hasWorkspaceTarget ? t('chatLanding.adjustWorkspaceAi') : t('chatLanding.providerSettings')}
          title={hasWorkspaceTarget ? t('chatLanding.adjustWorkspaceAi') : t('chatLanding.providerSettings')}
        >
          <Settings2 className="h-3 w-3" />
          {hasWorkspaceTarget ? t('chatLanding.adjustWorkspaceAi') : t('chatLanding.providerSettings')}
        </button>
      </div>
    )
  }

  if (config.selectedAgent && (!config.needsCredential || config.selectedRuntimeUsesGlobalConfig)) {
    return (
      <div className={`flex min-w-0 items-center gap-1.5 text-[10.5px] text-text-muted ${className}`}>
        <Bot className="h-3 w-3 shrink-0" />
        <span>{t('chatLanding.runtimeManagedAi', { runtime: config.selectedAgent.displayName })}</span>
      </div>
    )
  }

  return null
}
