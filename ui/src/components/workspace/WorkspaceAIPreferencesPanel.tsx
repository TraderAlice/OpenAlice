import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Check, Cpu, KeyRound, Pencil, RotateCcw } from 'lucide-react'

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useAgentLaunchConfig,
  type AgentLaunchPreferencesState,
} from '@/hooks/useAgentLaunchConfig'
import { AgentLaunchSelectors, credentialAccessLabel } from './AgentLaunchControls'
import {
  listAgentCredentials,
  updateWorkspaceRuntimeDefaults,
  type AgentInfo,
  type SavedCredential,
  type Workspace,
  type WorkspaceRuntimePreference,
  type WorkspaceRuntimeScenario,
  type WorkspaceRuntimeScenarioSettings,
} from './api'

interface Props {
  readonly workspace: Workspace
  readonly agents: readonly AgentInfo[]
  readonly onSaved: () => Promise<void> | void
  readonly onConfigureProvider: () => void
}

const EMPTY_SCENARIO: WorkspaceRuntimeScenarioSettings = {
  agents: {},
  recent: { agents: {} },
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
  readonly onApply: (preference: WorkspaceRuntimePreference | null) => void
  readonly onConfigureProvider: () => void
}) {
  const { t } = useTranslation()
  const [useFixed, setUseFixed] = useState(fixed !== undefined)
  const [draft, setDraft] = useState<QuickChatLaunchPreference>(() => (
    launchFromPreference(agent.id, fixed ?? recent)
  ))

  useEffect(() => {
    if (!open) return
    setUseFixed(fixed !== undefined)
    setDraft(launchFromPreference(agent.id, fixed ?? recent))
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="z-[70]"
        className="z-[70] max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
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
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <AgentLaunchSelectors
              config={config}
              showRuntime={false}
              showAi
              labeled
              menuPlacement="down"
              onConfigureProvider={onConfigureProvider}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              {t('workspaceSettings.preferences.nativeAccessHelp')}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => {
            onApply(useFixed ? preferenceFromLaunch(draft) : null)
            onOpenChange(false)
          }}>
            {t('workspaceSettings.preferences.apply')}
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
  const [scenario, setScenario] = useState<WorkspaceRuntimeScenario>('askAlice')
  const persisted = workspace.runtimeSettings?.runtime[scenario] ?? EMPTY_SCENARIO
  const [defaultAgent, setDefaultAgent] = useState<string | null>(persisted.defaultAgent ?? null)
  const [fixedAgents, setFixedAgents] = useState<Record<string, WorkspaceRuntimePreference>>({ ...persisted.agents })
  const [editingAgent, setEditingAgent] = useState<AgentInfo | null>(null)
  const [credentials, setCredentials] = useState<Record<string, SavedCredential>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const next = workspace.runtimeSettings?.runtime[scenario] ?? EMPTY_SCENARIO
    setDefaultAgent(next.defaultAgent ?? null)
    setFixedAgents({ ...next.agents })
  }, [scenario, workspace.id, workspace.runtimeSettings])

  useEffect(() => {
    setSaved(false)
    setError(null)
  }, [scenario, workspace.id])

  useEffect(() => {
    let live = true
    void Promise.all(runtimeAgents.map((agent) => listAgentCredentials(agent.id).catch(() => [])))
      .then((lists) => {
        if (!live) return
        setCredentials(Object.fromEntries(lists.flat().map((credential) => [credential.slug, credential])))
      })
    return () => { live = false }
  }, [runtimeAgents])

  const compatibleAgents = scenario === 'issues'
    ? runtimeAgents.filter((agent) => agent.capabilities.headless)
    : runtimeAgents
  const currentPersisted = workspace.runtimeSettings?.runtime[scenario] ?? EMPTY_SCENARIO
  const dirty = defaultAgent !== (currentPersisted.defaultAgent ?? null) ||
    JSON.stringify(fixedAgents) !== JSON.stringify(currentPersisted.agents)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateWorkspaceRuntimeDefaults(workspace.id, scenario, { defaultAgent, agents: fixedAgents })
      await onSaved()
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1800)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('workspaceSettings.preferences.title')}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t('workspaceSettings.preferences.description')}
            </p>
          </div>

          <Tabs value={scenario} onValueChange={(value) => setScenario(value as WorkspaceRuntimeScenario)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="askAlice">{t('workspaceSettings.preferences.askAlice')}</TabsTrigger>
              <TabsTrigger value="issues">{t('workspaceSettings.preferences.issues')}</TabsTrigger>
            </TabsList>
            <TabsContent value="askAlice" className="mt-3 text-[11px] text-muted-foreground">
              {t('workspaceSettings.preferences.askAliceHelp')}
            </TabsContent>
            <TabsContent value="issues" className="mt-3 text-[11px] text-muted-foreground">
              {t('workspaceSettings.preferences.issuesHelp')}
            </TabsContent>
          </Tabs>

          <section className="rounded-lg border border-border bg-muted/20 p-3">
            <label htmlFor="workspace-scenario-agent" className="text-xs font-medium text-foreground">
              {t('workspaceSettings.preferences.defaultRuntime')}
            </label>
            <select
              id="workspace-scenario-agent"
              value={defaultAgent ?? ''}
              onChange={(event) => setDefaultAgent(event.target.value || null)}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary"
            >
              <option value="">{t('workspaceSettings.preferences.followRecentRuntime')}</option>
              {compatibleAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}
            </select>
          </section>

          <section className="overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)_auto] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>{t('workspaceSettings.preferences.runtime')}</span>
              <span>{t('workspaceSettings.preferences.resolvedPreference')}</span>
              <span className="sr-only">{t('common.edit')}</span>
            </div>
            {compatibleAgents.map((agent) => {
              const fixed = fixedAgents[agent.id]
              const recent = currentPersisted.recent.agents[agent.id]
              const summary = preferenceSummary(fixed ?? recent, credentials, t('workspaceSettings.preferences.agentLogin'))
              return (
                <div key={agent.id} className="grid grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)_auto] items-center gap-3 border-b border-border/70 px-3 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-foreground">{agent.displayName}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {fixed ? t('workspaceSettings.preferences.fixed') : t('workspaceSettings.preferences.recent')}
                    </div>
                  </div>
                  <div className="min-w-0 space-y-1 text-[11px]">
                    <div className="flex min-w-0 items-center gap-1.5 text-foreground"><KeyRound size={12} className="shrink-0" /><span className="truncate">{summary.access}</span></div>
                    <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground"><Cpu size={12} className="shrink-0" /><span className="truncate">{summary.inference}</span></div>
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditingAgent(agent)} aria-label={t('workspaceSettings.preferences.editRuntime', { runtime: agent.displayName })}>
                    <Pencil size={14} />
                  </Button>
                </div>
              )
            })}
          </section>

          <div className="flex items-center justify-between gap-3">
            <div className="min-h-5 text-[11px]">
              {saved && <span className="text-success">{t('workspaceSettings.preferences.saved')}</span>}
              {error && <span className="text-destructive">{error}</span>}
            </div>
            <Button disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </div>

      {editingAgent && (
        <RuntimePreferenceDialog
          open
          onOpenChange={(open) => { if (!open) setEditingAgent(null) }}
          workspaceId={workspace.id}
          agent={editingAgent}
          fixed={fixedAgents[editingAgent.id]}
          recent={currentPersisted.recent.agents[editingAgent.id]}
          onConfigureProvider={onConfigureProvider}
          onApply={(preference) => setFixedAgents((current) => {
            if (preference) return { ...current, [editingAgent.id]: preference }
            const next = { ...current }
            delete next[editingAgent.id]
            return next
          })}
        />
      )}
    </div>
  )
}
