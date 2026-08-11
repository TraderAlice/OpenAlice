import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, BrainCircuit, Check, ChevronDown, Cpu, KeyRound, Pencil, RotateCcw, Settings2 } from 'lucide-react'

import type { QuickChatLaunchPreference } from '@/api/preferences'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useAgentLaunchConfig,
  type AgentLaunchConfigState,
  type AgentLaunchPreferencesState,
} from '@/hooks/useAgentLaunchConfig'
import { credentialAccessDetail, credentialAccessLabel } from './AgentLaunchControls'
import {
  listAgentCredentials,
  updateWorkspaceRuntimeDefaults,
  type AgentInfo,
  type SavedCredential,
  type Workspace,
  type WorkspaceRuntimePreference,
  type WorkspaceRuntimeMode,
  type WorkspaceRuntimeModeSettings,
} from './api'

interface Props {
  readonly workspace: Workspace
  readonly agents: readonly AgentInfo[]
  readonly onSaved: () => Promise<void> | void
  readonly onConfigureProvider: () => void
}

const EMPTY_MODE: WorkspaceRuntimeModeSettings = {
  agents: {},
  recent: { agents: {} },
}

type WorkspaceRuntimeDrafts = Record<WorkspaceRuntimeMode, {
  defaultAgent: string | null
  agents: Record<string, WorkspaceRuntimePreference>
}>

type PreferenceSaveState =
  | { mode: WorkspaceRuntimeMode; status: 'saving' | 'saved' }
  | {
    mode: WorkspaceRuntimeMode
    status: 'error'
    message: string
    next: WorkspaceRuntimeDrafts
    previous: WorkspaceRuntimeDrafts
  }

function launchFromPreference(
  agent: string,
  preference: WorkspaceRuntimePreference | undefined,
): QuickChatLaunchPreference {
  return {
    agent,
    accessMode: preference?.accessMode ?? 'native',
    credentialSlug: preference?.accessMode === 'vault' ? preference.credentialSlug ?? null : null,
    model: preference?.model ?? null,
    reasoningEffort: preference?.reasoningEffort ?? null,
  }
}

function preferenceFromLaunch(launch: QuickChatLaunchPreference): WorkspaceRuntimePreference {
  const modelAndEffort = {
    ...(launch.model ? { model: launch.model } : {}),
    ...(launch.reasoningEffort ? { reasoningEffort: launch.reasoningEffort } : {}),
  }
  return launch.accessMode === 'vault' && launch.credentialSlug
    ? { accessMode: 'vault', credentialSlug: launch.credentialSlug, ...modelAndEffort }
    : { accessMode: 'native', ...modelAndEffort }
}

function preferenceSummary(
  preference: WorkspaceRuntimePreference | undefined,
  credentials: Readonly<Record<string, SavedCredential>>,
  nativeLabel: string,
): { access: string; inference: string } {
  if (!preference) return { access: nativeLabel, inference: '—' }
  const credential = preference.accessMode === 'vault' && preference.credentialSlug
    ? credentials[preference.credentialSlug]
    : undefined
  const access = preference.accessMode === 'vault'
    ? credentialAccessLabel(credential ?? null) || preference.credentialSlug || 'Vault'
    : nativeLabel
  const inference = [preference.model, preference.reasoningEffort].filter(Boolean).join(' · ') || 'Runtime default'
  return { access, inference }
}

function RuntimePreferenceFields({
  config,
  onConfigureProvider,
}: {
  readonly config: AgentLaunchConfigState
  readonly onConfigureProvider: () => void
}) {
  const { t } = useTranslation()
  const modelListId = useId()
  const [accessMenuOpen, setAccessMenuOpen] = useState(false)
  const [modelDraft, setModelDraft] = useState(config.launchModel ?? '')
  const runtimeName = config.selectedAgent?.displayName ?? t('chatLanding.runtimeFallback')
  const nativeAccess = config.accessMode === 'native' || config.effectiveCredential === null
  const selectedAccessLabel = nativeAccess
    ? t('chatLanding.runtimeAccount', { runtime: runtimeName })
    : credentialAccessLabel(config.credential)
  const selectedAccessDetail = nativeAccess
    ? t('chatLanding.runtimeAccountDetail')
    : t('chatLanding.savedAccessDetail', { credential: credentialAccessDetail(config.credential) })
  const effortOptions = config.selectedReasoningEffort
    && !config.effortOptions.includes(config.selectedReasoningEffort)
    ? [config.selectedReasoningEffort, ...config.effortOptions]
    : config.effortOptions
  const defaultModelLabel = config.defaultModel
    ? t('chatLanding.defaultModelValue', { model: config.defaultModel })
    : t('chatLanding.runtimeDefaultModel')

  useEffect(() => setModelDraft(config.launchModel ?? ''), [config.launchModel])

  const commitModel = () => {
    const next = modelDraft.trim()
    if (next !== (config.launchModel ?? '')) config.selectModel(next || null)
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">{t('chatLanding.aiAccess')}</span>
        <DropdownMenu open={accessMenuOpen} onOpenChange={setAccessMenuOpen}>
          <DropdownMenuTrigger
            render={<button
              type="button"
              aria-label={t('chatLanding.selectCredential')}
              className="oa-pressable flex min-h-14 w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left outline-none transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-primary/40"
            />}
          >
            <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">{selectedAccessLabel}</span>
              <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{selectedAccessDetail}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="start"
            sideOffset={6}
            positionerClassName="z-[80]"
            className="z-[80] max-h-52 min-w-[min(28rem,calc(100vw-3rem))] sm:max-h-64"
          >
            <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
              {t('chatLanding.credentialMenuTitle', { runtime: runtimeName })}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={nativeAccess ? 'native' : `vault:${config.effectiveCredential ?? ''}`}
              onValueChange={(value) => {
                const selected = String(value)
                if (selected === 'native') config.selectRuntimeDefault()
                else if (selected.startsWith('vault:')) config.selectCredential(selected.slice('vault:'.length))
                setAccessMenuOpen(false)
              }}
            >
              <DropdownMenuRadioItem value="native" className="py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium">{t('chatLanding.runtimeAccount', { runtime: runtimeName })}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{t('chatLanding.runtimeAccountDetail')}</span>
                </span>
              </DropdownMenuRadioItem>
              {config.credentials?.map((credential) => (
                <DropdownMenuRadioItem
                  key={credential.slug}
                  value={`vault:${credential.slug}`}
                  className="py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">{credentialAccessLabel(credential)}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {t('chatLanding.savedAccessDetail', { credential: credentialAccessDetail(credential) })}
                    </span>
                  </span>
                  {credential.resolvedModel && (
                    <span className="max-w-32 shrink-0 truncate text-[10px] text-muted-foreground">{credential.resolvedModel}</span>
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {config.credentials !== null && config.credentials.length === 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onConfigureProvider}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] text-primary hover:bg-muted"
                >
                  <Settings2 className="h-4 w-4" />
                  {t('chatLanding.configureProvider')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">{t('chatLanding.modelField')}</span>
          <span className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/40">
            <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              list={modelListId}
              value={modelDraft}
              onChange={(event) => setModelDraft(event.target.value)}
              onBlur={commitModel}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  setModelDraft(config.launchModel ?? '')
                  event.currentTarget.blur()
                }
              }}
              aria-label={t('chatLanding.selectModel')}
              placeholder={defaultModelLabel}
              className="min-w-0 flex-1 bg-transparent py-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <datalist id={modelListId}>
              {config.modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </datalist>
          </span>
        </label>

        <label className="space-y-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">{t('chatLanding.effortField')}</span>
          <span className="relative flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/40">
            <BrainCircuit className="h-4 w-4 shrink-0 text-muted-foreground" />
            <select
              value={config.selectedReasoningEffort ?? ''}
              onChange={(event) => config.selectReasoningEffort(
                event.target.value
                  ? event.target.value as NonNullable<AgentLaunchConfigState['launchReasoningEffort']>
                  : null,
              )}
              aria-label={t('chatLanding.selectEffort')}
              className="min-w-0 flex-1 appearance-none bg-transparent py-2 pr-5 text-[12px] text-foreground outline-none"
            >
              <option value="">{t('chatLanding.effortNotSpecified')}</option>
              {effortOptions.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" />
          </span>
        </label>
      </div>

      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        {t('workspaceSettings.preferences.nativeAccessHelp')}
      </p>
    </div>
  )
}

function RuntimePreferenceDialog({
  open,
  onOpenChange,
  workspaceId,
  agent,
  fixed,
  recent,
  onApply,
  onConfigureProvider,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly workspaceId: string
  readonly agent: AgentInfo
  readonly fixed: WorkspaceRuntimePreference | undefined
  readonly recent: WorkspaceRuntimePreference | undefined
  readonly onApply: (preference: WorkspaceRuntimePreference | null) => Promise<string | null>
  readonly onConfigureProvider: () => void
}) {
  const { t } = useTranslation()
  const [useFixed, setUseFixed] = useState(fixed !== undefined)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [draft, setDraft] = useState<QuickChatLaunchPreference>(() => (
    launchFromPreference(agent.id, fixed ?? recent)
  ))

  useEffect(() => {
    if (!open) return
    setUseFixed(fixed !== undefined)
    setDraft(launchFromPreference(agent.id, fixed ?? recent))
    setApplyError(null)
  }, [agent.id, fixed, open, recent])

  const rememberLaunch = useCallback(async (launch: QuickChatLaunchPreference) => {
    setDraft(launch)
  }, [])
  const preferences = useMemo<AgentLaunchPreferencesState>(() => ({
    lastCredentialByAgent: draft.credentialSlug ? { [agent.id]: draft.credentialSlug } : {},
    recentChatWorkspaceId: workspaceId,
    recentLaunch: draft,
    loaded: true,
    rememberLaunch,
    adoptRecentChatWorkspace: () => undefined,
  }), [agent.id, draft, rememberLaunch, workspaceId])
  const config = useAgentLaunchConfig({
    agents: [agent],
    defaultAgent: agent.id,
    preferences,
    workspaceId,
    hasWorkspace: true,
    managedWorkspaceLaunch: true,
  })

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!applying) onOpenChange(nextOpen) }}>
      <DialogContent
        overlayClassName="z-[70]"
        className="z-[70] max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{t('workspaceSettings.preferences.editTitle', { runtime: agent.displayName })}</DialogTitle>
          <DialogDescription>{t('workspaceSettings.preferences.editDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('workspaceSettings.preferences.behavior')}>
          <button
            type="button"
            role="radio"
            aria-checked={!useFixed}
            onClick={() => setUseFixed(false)}
            className={`rounded-lg border p-3 text-left transition-colors ${!useFixed ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <RotateCcw size={15} />
              {t('workspaceSettings.preferences.followRecent')}
              {!useFixed && <Check size={14} className="ml-auto text-primary" />}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t('workspaceSettings.preferences.followRecentHelp')}
            </p>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={useFixed}
            onClick={() => setUseFixed(true)}
            className={`rounded-lg border p-3 text-left transition-colors ${useFixed ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Bot size={15} />
              {t('workspaceSettings.preferences.fixedDefault')}
              {useFixed && <Check size={14} className="ml-auto text-primary" />}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t('workspaceSettings.preferences.fixedDefaultHelp')}
            </p>
          </button>
        </div>

        {useFixed && (
          <RuntimePreferenceFields config={config} onConfigureProvider={onConfigureProvider} />
        )}

        {applyError && <p role="alert" className="text-xs text-destructive">{applyError}</p>}

        <DialogFooter>
          <Button variant="outline" disabled={applying} onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button disabled={applying} onClick={() => {
            setApplying(true)
            setApplyError(null)
            void onApply(useFixed ? preferenceFromLaunch(draft) : null)
              .then((message) => {
                if (message) setApplyError(message)
                else onOpenChange(false)
              })
              .finally(() => setApplying(false))
          }}>
            {applying ? t('common.saving') : t('workspaceSettings.preferences.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WorkspaceAIPreferencesPanel({ workspace, agents, onSaved, onConfigureProvider }: Props) {
  const { t } = useTranslation()
  const runtimeAgents = useMemo(
    () => agents.filter((agent) => agent.kind !== 'utility' && agent.id !== 'shell'),
    [agents],
  )
  const persistedRuntime = workspace.runtimeSettings?.runtime ?? {
    interactive: EMPTY_MODE,
    headless: EMPTY_MODE,
  }
  const [drafts, setDrafts] = useState<WorkspaceRuntimeDrafts>(() => ({
    interactive: {
      defaultAgent: persistedRuntime.interactive.defaultAgent ?? null,
      agents: { ...persistedRuntime.interactive.agents },
    },
    headless: {
      defaultAgent: persistedRuntime.headless.defaultAgent ?? null,
      agents: { ...persistedRuntime.headless.agents },
    },
  }))
  const [editing, setEditing] = useState<{ mode: WorkspaceRuntimeMode; agent: AgentInfo } | null>(null)
  const [credentials, setCredentials] = useState<Record<string, SavedCredential>>({})
  const [saveState, setSaveState] = useState<PreferenceSaveState | null>(null)
  const savedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const next = workspace.runtimeSettings?.runtime ?? {
      interactive: EMPTY_MODE,
      headless: EMPTY_MODE,
    }
    setDrafts({
      interactive: {
        defaultAgent: next.interactive.defaultAgent ?? null,
        agents: { ...next.interactive.agents },
      },
      headless: {
        defaultAgent: next.headless.defaultAgent ?? null,
        agents: { ...next.headless.agents },
      },
    })
  }, [workspace.id, workspace.runtimeSettings])

  useEffect(() => {
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
    setSaveState(null)
  }, [workspace.id])

  useEffect(() => () => {
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
  }, [])

  useEffect(() => {
    let live = true
    void Promise.all(runtimeAgents.map((agent) => listAgentCredentials(agent.id).catch(() => [])))
      .then((lists) => {
        if (!live) return
        setCredentials(Object.fromEntries(lists.flat().map((credential) => [credential.slug, credential])))
      })
    return () => { live = false }
  }, [runtimeAgents])

  const persist = useCallback(async (
    mode: WorkspaceRuntimeMode,
    next: WorkspaceRuntimeDrafts,
    previous: WorkspaceRuntimeDrafts,
  ): Promise<string | null> => {
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current)
    setDrafts(next)
    setSaveState({ mode, status: 'saving' })
    try {
      await updateWorkspaceRuntimeDefaults(workspace.id, {
        interactive: next.interactive,
        headless: next.headless,
      })
      await onSaved()
      setSaveState({ mode, status: 'saved' })
      savedTimerRef.current = window.setTimeout(() => setSaveState(null), 1800)
      return null
    } catch (cause) {
      const message = (cause as Error).message
      setDrafts(previous)
      setSaveState({ mode, status: 'error', message, next, previous })
      return message
    }
  }, [onSaved, workspace.id])

  const saving = saveState?.status === 'saving'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('workspaceSettings.preferences.title')}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t('workspaceSettings.preferences.description')}
            </p>
          </div>

          {(['interactive', 'headless'] as const).map((mode) => {
            const title = t(`workspaceSettings.preferences.${mode}`)
            const compatibleAgents = mode === 'headless'
              ? runtimeAgents.filter((agent) => agent.capabilities.headless)
              : runtimeAgents
            const recentAgentId = persistedRuntime[mode].recent.agent
            const recentAgent = runtimeAgents.find((agent) => agent.id === recentAgentId)
            const recentAgentName = recentAgent?.displayName ?? recentAgentId
            const recentSummary = recentAgentId
              ? preferenceSummary(
                persistedRuntime[mode].recent.agents[recentAgentId],
                credentials,
                t('workspaceSettings.preferences.agentLogin'),
              )
              : null
            return (
              <section key={mode} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="border-b border-border bg-muted/25 px-4 py-3">
                  <h4 className="text-[13px] font-semibold text-foreground">{title}</h4>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {t(`workspaceSettings.preferences.${mode}Help`)}
                  </p>
                </div>
                <div className="space-y-4 p-4">
                  <label className="block text-xs font-medium text-foreground">
                    {t('workspaceSettings.preferences.defaultRuntime')}
                    <select
                      aria-label={t('workspaceSettings.preferences.defaultRuntimeFor', { mode: title })}
                      value={drafts[mode].defaultAgent ?? ''}
                      disabled={saving}
                      onChange={(event) => {
                        const next = {
                          ...drafts,
                          [mode]: { ...drafts[mode], defaultAgent: event.target.value || null },
                        }
                        void persist(mode, next, drafts)
                      }}
                      className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary"
                    >
                      <option value="">
                        {recentAgentName
                          ? t('workspaceSettings.preferences.followRecentRuntimeResolved', { runtime: recentAgentName })
                          : t('workspaceSettings.preferences.followRecentRuntime')}
                      </option>
                      {compatibleAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}
                    </select>
                  </label>

                  {recentAgentName && recentSummary && (
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                      <span>
                        {drafts[mode].defaultAgent
                          ? t('workspaceSettings.preferences.recentRuntime')
                          : t('workspaceSettings.preferences.currentlyResolvesTo')}
                      </span>
                      <span className="font-medium text-foreground">{recentAgentName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{recentSummary.access}</span>
                      <span aria-hidden="true">·</span>
                      <span>{recentSummary.inference}</span>
                    </div>
                  )}

                  {saveState?.mode === mode && (
                    <div
                      role={saveState.status === 'error' ? 'alert' : 'status'}
                      className={`flex min-h-5 flex-wrap items-center gap-2 text-[11px] ${saveState.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      {saveState.status === 'saving' && t('common.saving')}
                      {saveState.status === 'saved' && t('common.saved')}
                      {saveState.status === 'error' && (
                        <>
                          <span>{saveState.message}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-destructive"
                            onClick={() => void persist(mode, saveState.next, saveState.previous)}
                          >
                            {t('common.retry')}
                          </Button>
                        </>
                      )}
                    </div>
                  )}

                  <div className="overflow-hidden rounded-lg border border-border">
                    <div className="grid grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)_auto] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span>{t('workspaceSettings.preferences.runtime')}</span>
                      <span>{t('workspaceSettings.preferences.resolvedPreference')}</span>
                      <span className="sr-only">{t('common.edit')}</span>
                    </div>
                    {compatibleAgents.map((agent) => {
                      const fixed = drafts[mode].agents[agent.id]
                      const recent = persistedRuntime[mode].recent.agents[agent.id]
                      const summary = preferenceSummary(fixed ?? recent, credentials, t('workspaceSettings.preferences.agentLogin'))
                      return (
                        <div key={agent.id} className="grid grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)_auto] items-center gap-3 border-b border-border/70 px-3 py-3 last:border-b-0">
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium text-foreground">{agent.displayName}</div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {fixed
                                ? agent.id === recentAgentId
                                  ? t('workspaceSettings.preferences.fixedCurrentRecentRuntime')
                                  : t('workspaceSettings.preferences.fixed')
                                : agent.id === recentAgentId
                                  ? t('workspaceSettings.preferences.currentRecentRuntime')
                                  : t('workspaceSettings.preferences.usesRecentSettings')}
                            </div>
                          </div>
                          <div className="min-w-0 space-y-1 text-[11px]">
                            <div className="flex min-w-0 items-center gap-1.5 text-foreground"><KeyRound size={12} className="shrink-0" /><span className="truncate">{summary.access}</span></div>
                            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground"><Cpu size={12} className="shrink-0" /><span className="truncate">{summary.inference}</span></div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={saving}
                            onClick={() => setEditing({ mode, agent })}
                            aria-label={t('workspaceSettings.preferences.editRuntimeFor', { runtime: agent.displayName, mode: title })}
                          >
                            <Pencil size={14} />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>
            )
          })}

        </div>
      </div>

      {editing && (
        <RuntimePreferenceDialog
          open
          onOpenChange={(open) => { if (!open) setEditing(null) }}
          workspaceId={workspace.id}
          agent={editing.agent}
          fixed={drafts[editing.mode].agents[editing.agent.id]}
          recent={persistedRuntime[editing.mode].recent.agents[editing.agent.id]}
          onConfigureProvider={onConfigureProvider}
          onApply={(preference) => {
            const previous = drafts
            const agents = { ...previous[editing.mode].agents }
            if (preference) agents[editing.agent.id] = preference
            else delete agents[editing.agent.id]
            const next = {
              ...previous,
              [editing.mode]: { ...previous[editing.mode], agents },
            }
            return persist(editing.mode, next, previous)
          }}
        />
      )}
    </div>
  )
}
