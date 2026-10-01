import {
  type ReactNode,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ChevronDown,
  Cpu,
  Gauge,
  Info,
  KeyRound,
  Settings2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SelectionCheckIcon } from '@/components/ui/selection-check-icon'
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
import { useAgentRuntimes } from '../../hooks/useAgentRuntimes'
import { projectAgentRuntimeQuickAccess } from '../../lib/agentRuntimeQuickAccess'
import { AgentRuntimeIcon } from '../../lib/agentRuntimeIcon'
import { AIProviderIcon } from '@/lib/aiProviderIcon'
import { ModelCatalogStatus } from '../ModelCatalogStatus'
import { ModelCombobox } from '../credentials/PresetFields'
import {
  AgentRuntimePicker,
  type AgentRuntimePickerHandle,
} from './AgentRuntimePicker'

const PROVIDER_ACCESS_LABELS: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic API',
  openai: 'OpenAI API',
  google: 'Google Gemini API',
  xai: 'xAI API',
  minimax: 'MiniMax API',
  glm: 'Z.AI GLM API',
  kimi: 'Kimi API',
  deepseek: 'DeepSeek API',
  longcat: 'LongCat API',
  openrouter: 'OpenRouter',
  cursor: 'Cursor',
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
    ? `${label} — ${credential.slug}`
    : credential.slug
}

export interface AgentLaunchSelectorsProps {
  readonly config: AgentLaunchConfigState
  readonly onConfigureProvider: () => void
  readonly showRuntime?: boolean
  readonly showAi?: boolean
  /** Hide the access menu when a surface owns inherit / native / vault itself. */
  readonly showAccess?: boolean
  readonly menuPlacement?: 'up' | 'down'
  readonly labeled?: boolean
  /** Visually recede selectors into a composer toolbar until hover/focus. */
  readonly toolbar?: boolean
  readonly disabled?: boolean
  /** One provider/model/effort trigger for shared chat composers. */
  readonly combinedAi?: boolean
  /** Present AI controls as full-width setting rows instead of composer chips. */
  readonly layout?: 'inline' | 'settings'
  /** Raise menus above a parent settings dialog. */
  readonly menuPositionerClassName?: string
}

export interface AgentLaunchSelectorsHandle {
  openAgentMenu(): void
}

function AgentLaunchAccessItems({ config, onConfigureProvider }: {
  config: AgentLaunchConfigState; onConfigureProvider(): void;
}) {
  const { t } = useTranslation()
  const runtimeName = config.selectedAgent?.displayName ?? t('chatLanding.runtimeFallback')
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="border-b border-border/60">
        {t('chatLanding.credentialMenuTitle', { runtime: runtimeName })}
      </DropdownMenuLabel>
      {config.detectedCredential?.configured === true && (
        <DropdownMenuItem
          onClick={() => {
            config.selectWorkspaceDefault()
          }}
          className={`min-h-11 ${config.accessMode === 'auto' ? 'text-primary' : 'text-foreground'}`}
        >
          <Settings2 className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block break-words">{t('chatLanding.workspaceAiAccess')}</span>
            {config.detectedCredential.model && (
              <span className="block break-words text-sm text-muted-foreground">{config.detectedCredential.model}</span>
            )}
          </span>
          {config.accessMode === 'auto' && <SelectionCheckIcon />}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        onClick={() => {
          config.selectRuntimeDefault()
        }}
        className={`min-h-11 ${config.accessMode === 'native' ? 'text-primary' : 'text-foreground'}`}
      >
        <AgentRuntimeIcon agentId={config.effectiveAgent} className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block break-words">{t('chatLanding.runtimeAccount', { runtime: runtimeName })}</span>
          <span className="block break-words text-sm text-muted-foreground">{t('chatLanding.runtimeAccountDetail', { runtime: runtimeName })}</span>
        </span>
        {config.accessMode === 'native' && <SelectionCheckIcon />}
      </DropdownMenuItem>
      {(config.credentials ?? []).map((credential) => {
        const active = config.accessMode === 'vault' && credential.slug === config.effectiveCredential
        return (
          <DropdownMenuItem
            key={credential.slug}
            onClick={() => {
              config.selectCredential(credential.slug)
            }}
            className={`min-h-11 ${active ? 'text-primary' : 'text-foreground'}`}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
              <AIProviderIcon vendor={credential.vendor} className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words">{credentialAccessLabel(credential)}</span>
              <span className="block break-words text-sm text-muted-foreground">
                {t('chatLanding.savedAccessDetail', { credential: credentialAccessDetail(credential) })}
              </span>
            </span>
            {credential.resolvedModel && (
              <span className="max-w-[100px] shrink-0 truncate text-sm text-muted-foreground">{credential.resolvedModel}</span>
            )}
            {active && <SelectionCheckIcon />}
          </DropdownMenuItem>
        )
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onConfigureProvider} className="min-h-11">
        <KeyRound className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block">{t('chatLanding.addApiAccount')}</span>
          <span className="block text-sm text-muted-foreground">{t('chatLanding.addApiAccountDetail')}</span>
        </span>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

function AgentLaunchInferenceMenu({
  config,
  menuPlacement,
  settings = false,
  disabled = false,
  access,
  menuPositionerClassName,
}: {
  config: AgentLaunchConfigState
  menuPlacement: 'up' | 'down'
  settings?: boolean
  disabled?: boolean
  access?: { label: string; icon: ReactNode; items: ReactNode } | undefined
  menuPositionerClassName?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
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
      <DropdownMenu open={open && !disabled} onOpenChange={setOpen}
        onOpenChangeComplete={(open) => {
          if (open || !pendingCustomModelRef.current) return
          pendingCustomModelRef.current = false
          setCustomModelOpen(true)
        }}
      >
        <DropdownMenuTrigger
          render={<button
            type="button"
            disabled={disabled}
            title={access?.label}
            aria-label={access ? `${t('chatLanding.selectCredential')}, ${t('chatLanding.selectModelAndEffort')}` : t('chatLanding.selectModelAndEffort')}
            className={settings
              ? 'group/inference oa-pressable flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-left transition-colors hover:bg-muted/45'
              : 'group/inference oa-pressable inline-flex min-h-9 min-w-0 max-w-full items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm leading-5 text-foreground transition-colors hover:bg-muted'}
          />}
        >
          {access?.icon ?? <Cpu className={settings ? 'h-4 w-4 shrink-0 text-muted-foreground' : 'h-3 w-3 shrink-0 text-muted-foreground'} />}
          {settings ? (
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-muted-foreground">
                {t('chatLanding.selectModelAndEffort')}
              </span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-foreground">
                <span className="min-w-0 truncate font-medium">{resolvedModel}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{resolvedEffort}</span>
              </span>
            </span>
          ) : (
            <>
              <span className="min-w-0 max-w-[240px] truncate">{resolvedModel}</span>
              {config.launchReasoningEffort && <span className="min-w-0 truncate rounded-full bg-background px-2 py-0.5 text-sm text-muted-foreground">{resolvedEffort}</span>}
            </>
          )}
          <ChevronDown className="size-4 shrink-0 opacity-60 transition-transform duration-[var(--motion-standard)] [transition-timing-function:var(--motion-ease-out)] group-aria-expanded/inference:rotate-180 group-focus-visible/inference:transition-none motion-reduce:transition-none" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side={settings ? 'top' : menuPlacement === 'down' ? 'bottom' : 'top'}
          sideOffset={6}
          positionerClassName={menuPositionerClassName}
          aria-label={access ? `${t('chatLanding.selectCredential')}, ${t('chatLanding.selectModelAndEffort')}` : t('chatLanding.selectModelAndEffort')}
          className="w-[336px] max-w-[calc(100vw-2rem)]"
        >
          {access && <DropdownMenuSub>
            <DropdownMenuSubTrigger className="oa-inference-setting">
              <span className="flex size-5 items-center justify-center" aria-hidden>{access.icon}</span>
              <span>{t('chatLanding.selectCredential')}</span>
              <span className="oa-inference-value">{access.label}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[300px] max-w-[calc(100vw-2rem)]">
              {access.items}
            </DropdownMenuSubContent>
          </DropdownMenuSub>}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="oa-inference-setting">
              <Cpu className="size-5 text-muted-foreground" aria-hidden />
              <span>{t('chatLanding.modelField')}</span>
              <span className="oa-inference-value">{resolvedModel}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[300px] max-w-[calc(100vw-2rem)]">
              <ModelCatalogStatus catalog={config.modelCatalog} selectedModel={config.launchModel ?? config.defaultModel} />
              <DropdownMenuRadioGroup
                className="max-h-64 overflow-y-auto"
                value={modelValue}
                onValueChange={(value) => config.selectModel(value ? String(value) : null)}
              >
                {details?.contextWindow && (
                  <DropdownMenuLabel>{t('chatLanding.contextSummary', { limit: formatContextWindow(details.contextWindow) })}</DropdownMenuLabel>
                )}
                <DropdownMenuRadioItem value="" closeOnClick={false}>
                  {config.defaultModel ? (
                    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
                      <span className="shrink-0">{t('chatLanding.defaultLabel')}</span>
                      <span className="min-w-0 break-words text-muted-foreground">{config.defaultModel}</span>
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 break-words">{t('chatLanding.runtimeDefaultModel')}</span>
                  )}
                </DropdownMenuRadioItem>
                {customCurrentModel && (
                  <DropdownMenuRadioItem value={customCurrentModel} closeOnClick={false}>
                    <span className="min-w-0 flex-1 break-words">{customCurrentModel}</span>
                  </DropdownMenuRadioItem>
                )}
                {knownModels.map((model) => (
                  <DropdownMenuRadioItem key={model.id} value={model.id} closeOnClick={false}>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words">{model.label}</span>
                      {model.label !== model.id && (
                        <span className="block break-words text-sm text-muted-foreground">{model.id}</span>
                      )}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
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
            <DropdownMenuSubTrigger className="oa-inference-setting">
              <Gauge className="size-5 text-muted-foreground" aria-hidden />
              <span>{t('chatLanding.effortField')}</span>
              <span className="oa-inference-value">{resolvedEffort}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[220px] max-w-[calc(100vw-2rem)]">
              <DropdownMenuRadioGroup
                value={effortValue}
                onValueChange={(value) => config.selectReasoningEffort(
                  value ? String(value) as NonNullable<AgentLaunchConfigState['launchReasoningEffort']> : null,
                )}
              >
                <DropdownMenuRadioItem value="" closeOnClick={false}>
                  <span className="min-w-0 flex-1 break-words">
                    {t('chatLanding.effortNotSpecified')}
                  </span>
                </DropdownMenuRadioItem>
                {effortOptions.map((effort) => (
                  <DropdownMenuRadioItem key={effort} value={effort} closeOnClick={false}>
                    {t('chatLanding.reasoningEffortSummary', { effort })}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={customModelOpen} onOpenChange={setCustomModelOpen}>
        <DialogContent overlayClassName="z-[80]" className="z-[80]">
          <DialogHeader>
            <DialogTitle>{t('chatLanding.customModelTitle')}</DialogTitle>
            <DialogDescription>{t('modelCatalog.selectHelp')}</DialogDescription>
          </DialogHeader>
          <ModelCombobox
            value={customModelDraft}
            suggestions={config.modelOptions}
            onChange={setCustomModelDraft}
            ariaLabel={t('chatLanding.customModelId')}
            placeholder={t('modelCatalog.selectPlaceholder')}
          />
          <ModelCatalogStatus catalog={config.modelCatalog} selectedModel={customModelDraft} />
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
    showAccess = true,
    menuPlacement = 'up',
    labeled = false,
    toolbar = false,
    layout = 'inline',
    combinedAi = false,
    disabled = false,
    menuPositionerClassName,
  },
  ref,
) {
  const { t } = useTranslation()
  const discovery = useAgentRuntimes()
  const [credentialMenuOpen, setCredentialMenuOpen] = useState(false)
  const agentPickerRef = useRef<AgentRuntimePickerHandle>(null)
  const settingsLayout = layout === 'settings'
  const runtimeName = config.selectedAgent?.displayName ?? t('chatLanding.runtimeFallback')
  const pickerAgents = discovery.catalog.length > 0
    ? discovery.catalog
    : config.agents.filter((agent) => agent.kind !== 'utility')
  const pickerPrimary = useMemo(() => {
    if (discovery.catalog.length > 0) return discovery.primary
    return projectAgentRuntimeQuickAccess(
      pickerAgents,
      discovery.quickAccessIds,
      discovery.recentAgentIds,
    ).primary
  }, [discovery.catalog.length, discovery.primary, discovery.quickAccessIds, discovery.recentAgentIds, pickerAgents])
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
    ? t('chatLanding.runtimeAccountDetail', { runtime: runtimeName })
    : config.credential
      ? workspaceAccess
        ? t('chatLanding.workspaceAccessDetail', { credential: credentialAccessDetail(config.credential) })
        : t('chatLanding.savedAccessDetail', { credential: credentialAccessDetail(config.credential) })
      : config.detectedCredential?.model ?? t('chatLanding.workspaceAccessDetailFallback')
  const selectedVaultVendor = !nativeAccess ? config.credential?.vendor : undefined
  const providerIcon = selectedVaultVendor
    ? <AIProviderIcon vendor={selectedVaultVendor} className="h-4 w-4 shrink-0" />
    : nativeAccess
      ? <AgentRuntimeIcon agentId={config.effectiveAgent} className="h-4 w-4 shrink-0" />
      : <KeyRound className="h-4 w-4 shrink-0" />

  useImperativeHandle(ref, () => ({
    openAgentMenu() {
      agentPickerRef.current?.open()
    },
  }), [])

  return (
    <>
      {showRuntime && (
        <AgentRuntimePicker
          ref={agentPickerRef}
          agents={pickerAgents}
          primary={pickerPrimary}
          selectedId={config.effectiveAgent}
          readiness={config.runtimeReadiness ?? discovery.readiness}
          disabled={pickerAgents.length === 0}
          toolbar={toolbar}
          menuPlacement={menuPlacement}
          onSelect={config.selectAgent}
        />
      )}

      {showAi && showAccess && config.needsCredential && config.noCredentials && (
        <Button
          type="button"
          onClick={onConfigureProvider}
          variant="ghost"
          size="sm"
          className="bg-warning/10 text-sm text-warning hover:bg-warning/20 hover:text-warning"
        >
          <KeyRound className="h-3 w-3" />
          {t('chatLanding.configureProvider')}
        </Button>
      )}

      {!combinedAi && showAi && showAccess && config.canSelectCredential && !config.noCredentials && config.credentials && (
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
            className={`oa-pressable inline-flex min-w-0 items-center rounded-lg text-left text-muted-foreground transition-colors hover:text-foreground ${settingsLayout ? 'min-h-14 w-full gap-2 border border-border/70 bg-muted/25 px-3 py-2 hover:bg-muted/45' : toolbar ? 'min-h-7 max-w-[190px] gap-1.5 bg-transparent px-1.5 py-1 hover:bg-muted' : labeled ? 'min-h-12 w-full max-w-none gap-2 bg-muted px-2.5 py-1.5 sm:w-auto sm:max-w-[240px]' : 'min-h-8 max-w-[240px] gap-2 bg-muted px-2.5 py-1'}`}
          >
            <span className={`flex shrink-0 items-center justify-center ${settingsLayout ? 'h-[18px] w-[18px]' : 'h-4 w-4'}`}>
              {providerIcon}
            </span>
            <span className="min-w-0 flex-1">
              {(labeled || settingsLayout) && (
                <span className="block break-words text-sm font-medium text-muted-foreground">
                  {t('chatLanding.aiAccess')}
                </span>
              )}
              <span className={`block break-words text-sm text-foreground ${settingsLayout ? 'font-medium' : ''}`}>{selectedAccessLabel}</span>
              {(labeled || settingsLayout) && (
                <span className="block break-words text-sm text-muted-foreground">{selectedAccessDetail}</span>
              )}
            </span>
            <ChevronDown className={settingsLayout ? 'h-4 w-4 shrink-0 opacity-60' : 'h-3 w-3 shrink-0 opacity-60'} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={menuPlacement === 'down' ? 'bottom' : 'top'}
            sideOffset={6}
            positionerClassName={menuPositionerClassName}
            className="w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-xl border border-border/70 p-1.5 shadow-lg ring-0"
          >
            <AgentLaunchAccessItems config={config} onConfigureProvider={onConfigureProvider} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {showAi && config.selectedAgent && (
        <div
          data-testid="agent-launch-inference-group"
          className={settingsLayout ? 'w-full min-w-0' : `contents sm:flex sm:shrink-0 sm:items-center ${toolbar ? 'sm:gap-1' : 'sm:gap-2'}`}
        >
          <AgentLaunchInferenceMenu
            config={config}
            menuPlacement={menuPlacement}
            settings={settingsLayout}
            disabled={disabled}
            access={combinedAi && showAccess ? {
              label: selectedAccessLabel,
              icon: providerIcon,
              items: <AgentLaunchAccessItems config={config} onConfigureProvider={onConfigureProvider} />,
            } : undefined}
            menuPositionerClassName={menuPositionerClassName}
          />
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

  const runtimeName = config.selectedAgent?.displayName.trim() || t('chatLanding.runtimeFallback')
  const setupStatus = config.detectedCredential?.interactiveSetupStatus
  const setupNotice = setupStatus === 'runtime-onboarding-required'
    ? t('chatLanding.runtimeOnboardingRequired', { runtime: runtimeName })
    : setupStatus === 'workspace-trust-required'
      ? t('chatLanding.runtimeWorkspaceTrustRequired', { runtime: runtimeName })
      : null

  if (scope === null && setupNotice === null) return null
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      {scope !== null && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
          <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-muted/45 px-2.5 font-medium text-foreground/80">
            <Info className="h-3 w-3 shrink-0" />
            {scope.label}
          </span>
          {scope.detail && (
            <span className="hidden min-w-0 flex-1 break-words sm:block" title={scope.detail}>
              {scope.detail}
            </span>
          )}
          {scope.actionLabel && onAdjustAi && (
            <Button
              type="button"
              onClick={onAdjustAi}
              variant="ghost"
              size="sm"
              className="ml-auto shrink-0 text-[11.5px] text-primary hover:bg-primary/10 hover:text-primary"
              aria-label={scope.actionLabel}
              title={scope.actionLabel}
            >
              <Settings2 className="h-3 w-3" />
              {scope.actionLabel}
            </Button>
          )}
        </div>
      )}
      {setupNotice !== null && (
        <div
          role="status"
          className="flex min-w-0 items-start gap-2 rounded-lg border border-border/70 bg-card/70 px-2.5 py-2 text-[11.5px] leading-[17px] text-muted-foreground"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>{setupNotice}</span>
        </div>
      )}
    </div>
  )
}
