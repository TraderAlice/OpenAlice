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

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatContextWindow, type AgentLaunchConfigState } from '../../hooks/useAgentLaunchConfig'

const AGENT_ICONS: Record<string, LucideIcon> = {
  claude: Sparkles,
  codex: Cpu,
  opencode: Code2,
  pi: Bot,
}

const PROVIDER_ACCESS_LABELS: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic API',
  openai: 'OpenAI API',
  google: 'Google Gemini API',
  minimax: 'MiniMax API',
  glm: 'Z.AI GLM API',
  kimi: 'Kimi API',
  deepseek: 'DeepSeek API',
  longcat: 'LongCat API',
}

export function credentialAccessLabel(credential: AgentLaunchConfigState['credential']): string {
  if (!credential) return ''
  return PROVIDER_ACCESS_LABELS[credential.vendor.toLowerCase()]
    || credential.label?.trim()
    || credential.vendor
}

export function credentialAccessDetail(credential: AgentLaunchConfigState['credential']): string {
  if (!credential) return ''
  const label = credential.label?.trim()
  return label && label !== credentialAccessLabel(credential)
    ? `${label} · ${credential.slug}`
    : credential.slug
}

export interface AgentLaunchSelectorsProps {
  readonly config: AgentLaunchConfigState
  readonly onConfigureProvider: () => void
  readonly showRuntime?: boolean
  readonly showAi?: boolean
  readonly menuPlacement?: 'up' | 'down'
  readonly labeled?: boolean
  /** Visually recede selectors into a composer toolbar until hover/focus. */
  readonly toolbar?: boolean
  /** Present AI controls as full-width setting rows instead of composer chips. */
  readonly layout?: 'inline' | 'settings'
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

function AgentLaunchModelEditor({
  config,
  labeled = false,
}: {
  config: AgentLaunchConfigState
  labeled?: boolean
}) {
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
    <label className={`relative inline-flex min-w-0 items-center rounded-md bg-muted text-[11px] text-muted-foreground focus-within:ring-1 focus-within:ring-primary/50 ${labeled ? 'min-h-12 w-full max-w-none sm:w-auto sm:max-w-[220px]' : 'min-h-8 max-w-[220px]'}`}>
      <Cpu className={`pointer-events-none absolute left-2.5 h-3 w-3 shrink-0 ${labeled ? 'top-6' : ''}`} />
      {labeled && (
        <span className="pointer-events-none absolute left-2.5 top-1.5 text-[9.5px] font-medium text-muted-foreground">
          {t('chatLanding.modelField')}
        </span>
      )}
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
        className={`min-w-0 bg-transparent pl-7 pr-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground ${labeled ? 'w-full pb-1 pt-5 sm:w-[190px]' : 'w-[190px] py-1'}`}
      />
      <datalist id={listId}>
        {config.modelOptions.map((model) => (
          <option key={model.id} value={model.id}>{model.label}</option>
        ))}
      </datalist>
    </label>
  )
}

function AgentLaunchEffortEditor({
  config,
  labeled = false,
}: {
  config: AgentLaunchConfigState
  labeled?: boolean
}) {
  const { t } = useTranslation()
  const current = config.selectedReasoningEffort
  const options = current && !config.effortOptions.includes(current)
    ? [current, ...config.effortOptions]
    : config.effortOptions
  const defaultLabel = t('chatLanding.effortNotSpecified')
  return (
    <label className={`relative inline-flex min-w-0 items-center rounded-md bg-muted text-[11px] text-muted-foreground focus-within:ring-1 focus-within:ring-primary/50 ${labeled ? 'min-h-12 w-full max-w-none sm:w-auto sm:max-w-[190px]' : 'min-h-8 max-w-[190px]'}`}>
      <BrainCircuit className={`pointer-events-none absolute left-2.5 h-3 w-3 shrink-0 ${labeled ? 'top-6' : ''}`} />
      {labeled && (
        <span className="pointer-events-none absolute left-2.5 top-1.5 text-[9.5px] font-medium text-muted-foreground">
          {t('chatLanding.effortField')}
        </span>
      )}
      <select
        value={current ?? ''}
        onChange={(event) => config.selectReasoningEffort(
          event.target.value
            ? event.target.value as NonNullable<AgentLaunchConfigState['launchReasoningEffort']>
            : null,
        )}
        aria-label={t('chatLanding.selectEffort')}
        className={`min-w-0 appearance-none bg-transparent pl-7 pr-7 text-[11px] text-foreground outline-none ${labeled ? 'w-full max-w-none pb-1 pt-5 sm:max-w-[190px]' : 'max-w-[190px] py-1'}`}
      >
        <option value="">{defaultLabel}</option>
        {options.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 opacity-60" />
    </label>
  )
}

function AgentLaunchInferenceMenu({
  config,
  menuPlacement,
  settings = false,
}: {
  config: AgentLaunchConfigState
  menuPlacement: 'up' | 'down'
  settings?: boolean
}) {
  const { t } = useTranslation()
  const pendingCustomModelRef = useRef(false)
  const [customModelOpen, setCustomModelOpen] = useState(false)
  const [customModelDraft, setCustomModelDraft] = useState('')

  const details = config.aiDetails
  const effortOptions = config.selectedReasoningEffort
    && !config.effortOptions.includes(config.selectedReasoningEffort)
    ? [config.selectedReasoningEffort, ...config.effortOptions]
    : config.effortOptions
  const resolvedEffort = config.launchReasoningEffort
    ? t('chatLanding.reasoningEffortSummary', { effort: config.launchReasoningEffort })
    : effortOptions.length > 0
      ? t('chatLanding.effortNotSpecified')
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
                : t('chatLanding.effortNotSpecified')
  const resolvedModel = config.launchModel
    ?? config.defaultModel
    ?? t('chatLanding.runtimeDefaultModel')
  const modelValue = config.launchModel ?? ''
  const effortValue = config.selectedReasoningEffort ?? ''
  const knownModels = config.modelOptions.filter((model) => model.id !== config.defaultModel)
  const customCurrentModel = config.launchModel
    && !config.modelOptions.some((model) => model.id === config.launchModel)
    ? config.launchModel
    : null

  const saveCustomModel = () => {
    const model = customModelDraft.trim()
    if (!model) return
    config.selectModel(model)
    setCustomModelOpen(false)
  }

  return (
    <>
      <DropdownMenu
        onOpenChangeComplete={(open) => {
          if (open || !pendingCustomModelRef.current) return
          pendingCustomModelRef.current = false
          setCustomModelOpen(true)
        }}
      >
        <DropdownMenuTrigger
          render={<button
            type="button"
            aria-label={t('chatLanding.selectModelAndEffort')}
            className={settings
              ? 'oa-pressable flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-left transition-colors hover:bg-muted/45'
              : 'oa-pressable inline-flex min-h-8 max-w-[280px] items-center gap-1.5 rounded-md bg-transparent px-1.5 py-1 text-[11px] text-foreground transition-colors hover:bg-muted/55'}
          />}
        >
          <Cpu className={settings ? 'h-4 w-4 shrink-0 text-muted-foreground' : 'h-3 w-3 shrink-0 text-muted-foreground'} />
          {settings ? (
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-medium text-muted-foreground">
                {t('chatLanding.modelField')} · {t('chatLanding.effortField')}
              </span>
              <span className="flex min-w-0 items-baseline gap-1.5 text-sm text-foreground">
                <span className="min-w-0 truncate font-medium">{resolvedModel}</span>
                <span className="shrink-0 text-xs text-muted-foreground">· {resolvedEffort}</span>
              </span>
            </span>
          ) : (
            <>
              <span className="min-w-0 truncate">{resolvedModel}</span>
              <span className="shrink-0 text-muted-foreground">· {resolvedEffort}</span>
            </>
          )}
          <ChevronDown className={settings ? 'h-4 w-4 shrink-0 opacity-60' : 'h-3 w-3 shrink-0 opacity-60'} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side={settings ? 'top' : menuPlacement === 'down' ? 'bottom' : 'top'}
          sideOffset={6}
          aria-label={t('chatLanding.selectModelAndEffort')}
          className="w-[280px] max-w-[calc(100vw-2rem)] rounded-xl border border-border/70 bg-secondary p-1.5 shadow-lg ring-0"
        >
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="min-h-10 px-2.5 py-2 text-[12px]">
              <span className="font-medium">{t('chatLanding.modelField')}</span>
              <span className="ml-auto max-w-[140px] truncate text-muted-foreground">{resolvedModel}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[280px] max-w-[calc(100vw-2rem)] border border-border/70 bg-secondary p-1.5 shadow-lg ring-0">
              <DropdownMenuRadioGroup
                value={modelValue}
                onValueChange={(value) => config.selectModel(value ? String(value) : null)}
              >
                <DropdownMenuRadioItem value="" closeOnClick={false} className="min-h-9 px-2.5 pr-8 text-[12px]">
                  <span className="min-w-0 flex-1 truncate">
                    {config.defaultModel
                      ? t('chatLanding.defaultModelValue', { model: config.defaultModel })
                      : t('chatLanding.runtimeDefaultModel')}
                  </span>
                </DropdownMenuRadioItem>
                {customCurrentModel && (
                  <DropdownMenuRadioItem value={customCurrentModel} closeOnClick={false} className="min-h-9 px-2.5 pr-8 text-[12px]">
                    <span className="min-w-0 flex-1 truncate">{customCurrentModel}</span>
                  </DropdownMenuRadioItem>
                )}
                {knownModels.map((model) => (
                  <DropdownMenuRadioItem key={model.id} value={model.id} closeOnClick={false} className="min-h-9 px-2.5 pr-8 text-[12px]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{model.label}</span>
                      {model.label !== model.id && (
                        <span className="block truncate text-[10px] text-muted-foreground">{model.id}</span>
                      )}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="min-h-9 px-2.5 text-[12px]"
                onClick={() => {
                  setCustomModelDraft(config.launchModel ?? config.defaultModel ?? '')
                  pendingCustomModelRef.current = true
                }}
              >
                {t('chatLanding.customModel')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="min-h-10 px-2.5 py-2 text-[12px]">
              <span className="font-medium">{t('chatLanding.effortField')}</span>
              <span className="ml-auto max-w-[140px] truncate text-muted-foreground">{resolvedEffort}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[220px] max-w-[calc(100vw-2rem)] border border-border/70 bg-secondary p-1.5 shadow-lg ring-0">
              <DropdownMenuRadioGroup
                value={effortValue}
                onValueChange={(value) => config.selectReasoningEffort(
                  value ? String(value) as NonNullable<AgentLaunchConfigState['launchReasoningEffort']> : null,
                )}
              >
                <DropdownMenuRadioItem value="" closeOnClick={false} className="min-h-9 px-2.5 pr-8 text-[12px]">
                  <span className="min-w-0 flex-1 truncate">
                    {t('chatLanding.effortNotSpecified')}
                  </span>
                </DropdownMenuRadioItem>
                {effortOptions.map((effort) => (
                  <DropdownMenuRadioItem key={effort} value={effort} closeOnClick={false} className="min-h-9 px-2.5 pr-8 text-[12px]">
                    {t('chatLanding.reasoningEffortSummary', { effort })}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={customModelOpen} onOpenChange={setCustomModelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('chatLanding.customModelTitle')}</DialogTitle>
            <DialogDescription>{t('chatLanding.customModelDescription')}</DialogDescription>
          </DialogHeader>
          <input
            value={customModelDraft}
            onChange={(event) => setCustomModelDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                saveCustomModel()
              }
            }}
            aria-label={t('chatLanding.customModelId')}
            placeholder={t('chatLanding.customModelId')}
            autoFocus
            className="min-h-9 w-full rounded-lg border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button onClick={saveCustomModel} disabled={!customModelDraft.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Shared runtime and AI-access selectors used by every chat-style launch
 * surface. Selection behavior and presentation now evolve together. */
export const AgentLaunchSelectors = forwardRef<AgentLaunchSelectorsHandle, AgentLaunchSelectorsProps>(function AgentLaunchSelectors(
  {
    config,
    onConfigureProvider,
    showRuntime = true,
    showAi = true,
    menuPlacement = 'up',
    labeled = false,
    toolbar = false,
    layout = 'inline',
  },
  ref,
) {
  const { t } = useTranslation()
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [credentialMenuOpen, setCredentialMenuOpen] = useState(false)
  const agentBoxRef = useRef<HTMLDivElement>(null)
  const agentTriggerRef = useRef<HTMLButtonElement>(null)
  const agentMenuRef = useRef<HTMLDivElement>(null)
  const agentFocusEdgeRef = useRef<'first' | 'last'>('first')
  const settingsLayout = layout === 'settings'
  const SelectedIcon = config.selectedAgent ? AGENT_ICONS[config.selectedAgent.id] : undefined
  const runtimeName = config.selectedAgent?.displayName ?? t('chatLanding.runtimeFallback')
  const workspaceAccess = config.accessMode === 'auto' && config.detectedCredential?.configured === true
  const nativeAccess = config.accessMode === 'native' || (
    config.accessMode === 'auto' && !workspaceAccess && config.effectiveCredential === null
  )
  const selectedAccessLabel = nativeAccess
    ? t('chatLanding.runtimeAccount', { runtime: runtimeName })
    : config.credential
      ? credentialAccessLabel(config.credential)
      : t('chatLanding.workspaceAiAccess')
  const selectedAccessDetail = nativeAccess
    ? t('chatLanding.runtimeAccountDetail')
    : config.credential
      ? workspaceAccess
        ? t('chatLanding.workspaceAccessDetail', { credential: credentialAccessDetail(config.credential) })
        : t('chatLanding.savedAccessDetail', { credential: credentialAccessDetail(config.credential) })
      : config.detectedCredential?.model ?? t('chatLanding.workspaceAccessDetailFallback')

  useImperativeHandle(ref, () => ({
    openAgentMenu() {
      agentFocusEdgeRef.current = 'first'
      setAgentMenuOpen(true)
    },
  }), [])

  useEffect(() => {
    if (!agentMenuOpen) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (agentMenuOpen && agentBoxRef.current && !agentBoxRef.current.contains(target)) {
        setAgentMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [agentMenuOpen])

  useEffect(() => {
    if (!agentMenuOpen) return
    focusMenuEdge(agentMenuRef, agentFocusEdgeRef.current)
    agentFocusEdgeRef.current = 'first'
  }, [agentMenuOpen])

  return (
    <>
      {showRuntime && <div
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
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault()
            agentFocusEdgeRef.current = event.key === 'ArrowUp' ? 'last' : 'first'
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
            className={`oa-popover-enter absolute left-0 z-20 min-w-[180px] rounded-lg border border-border/70 bg-secondary py-1 shadow-lg ${menuPlacement === 'down' ? 'top-full mt-1' : 'bottom-full mb-1'}`}
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
      </div>}

      {showAi && config.needsCredential && config.noCredentials && (
        <button
          type="button"
          onClick={onConfigureProvider}
          className="oa-pressable inline-flex min-h-8 items-center gap-1.5 rounded-md bg-warning/10 px-2.5 py-1 text-[11px] text-warning hover:bg-warning/20"
        >
          <KeyRound className="h-3 w-3" />
          {t('chatLanding.configureProvider')}
        </button>
      )}

      {showAi && config.canSelectCredential && !config.noCredentials && config.credentials && (
        <DropdownMenu open={credentialMenuOpen} onOpenChange={setCredentialMenuOpen}>
          <DropdownMenuTrigger
            type="button"
            aria-label={t('chatLanding.selectCredential')}
            onClick={() => {
              // Base UI opens menus on pointer-down. Keeping a click fallback
              // makes the trigger work for synthetic click-only environments
              // without fighting the native pointer interaction.
              if (!credentialMenuOpen) setCredentialMenuOpen(true)
            }}
            className={`oa-pressable inline-flex min-w-0 items-center gap-2 rounded-lg text-left text-muted-foreground transition-colors hover:text-foreground ${settingsLayout ? 'min-h-14 w-full border border-border/70 bg-muted/25 px-3 py-2 hover:bg-muted/45' : toolbar ? 'min-h-8 max-w-[200px] bg-transparent px-1.5 py-1 hover:bg-muted/55' : labeled ? 'min-h-12 w-full max-w-none bg-muted px-2.5 py-1.5 sm:w-auto sm:max-w-[240px]' : 'min-h-8 max-w-[240px] bg-muted px-2.5 py-1'}`}
          >
            <KeyRound className={settingsLayout ? 'h-4 w-4 shrink-0' : 'h-3 w-3 shrink-0'} />
            <span className="min-w-0 flex-1">
              {(labeled || settingsLayout) && (
                <span className={`block truncate font-medium text-muted-foreground ${settingsLayout ? 'text-[10px]' : 'text-[9.5px]'}`}>
                  {t('chatLanding.aiAccess')}
                </span>
              )}
              <span className={`block truncate text-foreground ${settingsLayout ? 'text-sm font-medium' : 'text-[11px]'}`}>{selectedAccessLabel}</span>
              {(labeled || settingsLayout) && (
                <span className={`block truncate text-muted-foreground ${settingsLayout ? 'text-xs' : 'text-[9.5px]'}`}>{selectedAccessDetail}</span>
              )}
            </span>
            <ChevronDown className={settingsLayout ? 'h-4 w-4 shrink-0 opacity-60' : 'h-3 w-3 shrink-0 opacity-60'} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={menuPlacement === 'down' ? 'bottom' : 'top'}
            sideOffset={6}
            className="w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-xl border border-border/70 bg-secondary p-1.5 shadow-lg ring-0"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="border-b border-border/60 px-2.5 py-2 text-[11px]">
                {t('chatLanding.credentialMenuTitle', { runtime: runtimeName })}
              </DropdownMenuLabel>
              {config.detectedCredential?.configured === true && (
                <DropdownMenuItem
                  onClick={() => {
                    config.selectWorkspaceDefault()
                  }}
                  className={`min-h-11 px-2.5 py-2 text-[12px] ${config.accessMode === 'auto' ? 'text-primary' : 'text-foreground'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{t('chatLanding.workspaceAiAccess')}</span>
                    {config.detectedCredential.model && (
                      <span className="block truncate text-[10px] text-muted-foreground">{config.detectedCredential.model}</span>
                    )}
                  </span>
                  {config.accessMode === 'auto' && <Check className="h-3.5 w-3.5 shrink-0" />}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                  onClick={() => {
                    config.selectRuntimeDefault()
                  }}
                  className={`min-h-11 px-2.5 py-2 text-[12px] ${config.accessMode === 'native' ? 'text-primary' : 'text-foreground'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{t('chatLanding.runtimeAccount', { runtime: runtimeName })}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{t('chatLanding.runtimeAccountDetail')}</span>
                  </span>
                  {config.accessMode === 'native' && <Check className="h-3.5 w-3.5 shrink-0" />}
              </DropdownMenuItem>
              {config.credentials.map((credential) => {
                const active = config.accessMode === 'vault' && credential.slug === config.effectiveCredential
                return (
                  <DropdownMenuItem
                    key={credential.slug}
                    onClick={() => {
                      config.selectCredential(credential.slug)
                    }}
                    className={`min-h-11 px-2.5 py-2 text-[12px] ${active ? 'text-primary' : 'text-foreground'}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{credentialAccessLabel(credential)}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {t('chatLanding.savedAccessDetail', { credential: credentialAccessDetail(credential) })}
                      </span>
                    </span>
                    {credential.resolvedModel && (
                      <span className="max-w-[100px] shrink-0 truncate text-[10px] text-muted-foreground">{credential.resolvedModel}</span>
                    )}
                    {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {showAi && config.selectedAgent && (
        <div
          data-testid="agent-launch-inference-group"
          className={settingsLayout ? 'w-full min-w-0' : `contents sm:flex sm:shrink-0 sm:items-center ${toolbar ? 'sm:gap-1' : 'sm:gap-2'}`}
        >
          {toolbar ? (
            <AgentLaunchInferenceMenu config={config} menuPlacement={menuPlacement} settings={settingsLayout} />
          ) : (
            <>
              <AgentLaunchModelEditor config={config} labeled={labeled} />
              <AgentLaunchEffortEditor config={config} labeled={labeled} />
            </>
          )}
        </div>
      )}
    </>
  )
})

export interface AgentLaunchDetailsProps {
  readonly config: AgentLaunchConfigState
  readonly hasWorkspaceTarget: boolean
  readonly onAdjustAi?: () => void
  readonly showScopeDisclosure?: boolean
  readonly className?: string
}

/** Compact launch scope. Model and effort belong in their editors above; this
 * row only explains where the selected tuple applies and links to its owner. */
export function AgentLaunchDetails({
  config,
  hasWorkspaceTarget,
  onAdjustAi,
  showScopeDisclosure = true,
  className = '',
}: AgentLaunchDetailsProps) {
  const { t } = useTranslation()

  if (hasWorkspaceTarget && !config.workspaceConfigResolved) return null

  let scope: {
    label: string
    detail?: string
    actionLabel?: string
  } | null = null
  if (showScopeDisclosure && config.aiDetails) {
    const workspaceSaved = config.aiDetails.source === 'workspace'
    const actionLabel = onAdjustAi
      ? hasWorkspaceTarget
        ? workspaceSaved
          ? t('chatLanding.adjustWorkspaceAi')
          : t('chatLanding.configureWorkspaceAi')
        : t('chatLanding.providerSettings')
      : undefined
    scope = workspaceSaved
      ? {
          label: t('chatLanding.workspaceAiScope'),
          actionLabel,
        }
      : {
          label: t('chatLanding.newSessionAiScope'),
          actionLabel,
        }
  } else if (
    showScopeDisclosure &&
    config.selectedAgent &&
    (!config.needsCredential || config.selectedRuntimeUsesGlobalConfig)
  ) {
    scope = {
      label: t('chatLanding.runtimeAiScope', { runtime: config.selectedAgent.displayName }),
      detail: t('chatLanding.runtimeManagedAi', { runtime: config.selectedAgent.displayName }),
      ...(!config.needsCredential && hasWorkspaceTarget && onAdjustAi
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
          {scope.actionLabel && onAdjustAi && (
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
