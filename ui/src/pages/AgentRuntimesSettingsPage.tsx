import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ChevronDown, RefreshCw, Search } from 'lucide-react'

import { ConfigSection, SettingsScrollArea, inputClass } from '../components/form'
import { CountBadge } from '../components/CountBadge'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, PageLoading } from '../components/StateViews'
import { Button } from '../components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import { Toggle } from '../components/Toggle'
import { installHintFor } from '../components/workspace/agentInstall'
import type { AgentInfo, AgentRuntimeReadinessRow } from '../components/workspace/api'
import { useAgentRuntimes } from '../hooks/useAgentRuntimes'
import { AGENT_RUNTIME_QUICK_ACCESS_LIMIT, canAddAgentRuntimeQuickAccess } from '../lib/agentRuntimeQuickAccess'
import { AgentRuntimeIcon } from '../lib/agentRuntimeIcon'
import { agentRuntimeSettingsStatusKey } from '../lib/agentRuntimeReadiness'

const RUNTIME_COPY = {
  claude: {
    models: 'aiProvider.runtime.claude.models',
    auth: 'aiProvider.runtime.claude.auth',
  },
  codex: {
    models: 'aiProvider.runtime.codex.models',
    auth: 'aiProvider.runtime.codex.auth',
  },
  cursor: {
    models: 'aiProvider.runtime.cursor.models',
    auth: 'aiProvider.runtime.cursor.auth',
  },
  agy: {
    models: 'aiProvider.runtime.agy.models',
    auth: 'aiProvider.runtime.agy.auth',
  },
  grok: {
    models: 'aiProvider.runtime.grok.models',
    auth: 'aiProvider.runtime.grok.auth',
  },
  omp: {
    models: 'aiProvider.runtime.omp.models',
    auth: 'aiProvider.runtime.omp.auth',
  },
  opencode: {
    models: 'aiProvider.runtime.opencode.models',
    auth: 'aiProvider.runtime.opencode.auth',
  },
  pi: {
    models: 'aiProvider.runtime.pi.models',
    auth: 'aiProvider.runtime.pi.auth',
  },
} as const

const REPAIR_KEYS = {
  'runtime-install': 'settings.agentRuntimes.repair.runtimeInstall',
  'cli-login': 'settings.agentRuntimes.repair.cliLogin',
  'ai-provider': 'settings.agentRuntimes.repair.aiProvider',
  retry: 'settings.agentRuntimes.repair.retry',
} as const

export function AgentRuntimesSettingsPage() {
  const { t } = useTranslation()
  const {
    catalog,
    quickAccessIds,
    readiness,
    loading,
    refreshing,
    error,
    refresh,
    saveQuickAccess,
  } = useAgentRuntimes()
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  const pinned = useMemo(
    () => quickAccessIds
      .map((id) => catalog.find((agent) => agent.id === id) ?? {
        id,
        displayName: id,
        kind: 'agent' as const,
        installed: false,
        capabilities: {
          parallelPerCwd: false,
          resumeLast: false,
          resumeById: false,
          transcriptDiscovery: 'none' as const,
        },
      }),
    [catalog, quickAccessIds],
  )
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return catalog
    return catalog.filter((agent) => `${agent.displayName} ${agent.id}`.toLowerCase().includes(needle))
  }, [catalog, query])

  const persist = async (ids: readonly string[]) => {
    setSaving(true)
    await saveQuickAccess(ids).catch(() => undefined)
    setSaving(false)
  }

  const togglePin = (agentId: string, pinnedNow: boolean) => {
    if (pinnedNow) {
      void persist(quickAccessIds.filter((id) => id !== agentId))
      return
    }
    const agent = catalog.find((item) => item.id === agentId)
    if (!agent || !canAddAgentRuntimeQuickAccess(quickAccessIds, agent)) return
    void persist([...quickAccessIds, agentId])
  }

  const movePin = (agentId: string, direction: -1 | 1) => {
    const index = quickAccessIds.indexOf(agentId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= quickAccessIds.length) return
    const next = [...quickAccessIds]
    const [moved] = next.splice(index, 1)
    next.splice(nextIndex, 0, moved!)
    void persist(next)
  }

  if (loading && catalog.length === 0 && !error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title={t('settings.agentRuntimes.title')} />
        <PageLoading />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t('settings.agentRuntimes.title')}
        right={(
          <Button
            variant="outline"
            disabled={refreshing}
            focusableWhenDisabled
            onClick={() => void refresh()}
            aria-label={t('settings.agentRuntimes.refresh')}
          >
            <RefreshCw className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined} />
            {refreshing ? t('settings.agentRuntimes.refreshing') : t('settings.agentRuntimes.refresh')}
          </Button>
        )}
      />
      <SettingsScrollArea className="px-4 py-5 md:px-8">
        <div className="mx-auto max-w-[880px]">
          {error && (
            <p role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <ConfigSection
            title={t('settings.agentRuntimes.quickAccess')}
            accessory={<CountBadge count={pinned.length} label={t('settings.agentRuntimes.quickAccessCount', { count: pinned.length, limit: AGENT_RUNTIME_QUICK_ACCESS_LIMIT })} />}
          >
            {pinned.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">{t('settings.agentRuntimes.quickAccessEmpty')}</p>
            ) : (
              <ol className="overflow-hidden rounded-xl bg-background">
                {pinned.map((agent, index) => {
                  return (
                    <li
                      key={agent.id}
                      className="flex min-h-12 min-w-0 items-center gap-2 border-b border-border/60 px-3 py-2 last:border-b-0"
                    >
                      <span className="w-5 shrink-0 text-sm leading-5 tabular-nums text-muted-foreground">{index + 1}</span>
                      <AgentRuntimeIcon agentId={agent.id} className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-sm leading-5 font-medium">{agent.displayName}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={saving || index === 0}
                          focusableWhenDisabled
                          aria-label={t('settings.agentRuntimes.moveUp', { name: agent.displayName })}
                          onClick={() => movePin(agent.id, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={saving || index === pinned.length - 1}
                          focusableWhenDisabled
                          aria-label={t('settings.agentRuntimes.moveDown', { name: agent.displayName })}
                          onClick={() => movePin(agent.id, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Toggle
                          size="sm"
                          checked
                          pending={saving}
                          ariaLabel={t('settings.agentRuntimes.unpin', { name: agent.displayName })}
                          onChange={() => togglePin(agent.id, true)}
                        />
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </ConfigSection>

          <ConfigSection
            title={t('settings.agentRuntimes.catalog')}
            accessory={<CountBadge count={visible.length} label={t('settings.agentRuntimes.catalogCount', { count: visible.length })} />}
          >
            <label className="relative mb-3 block">
              <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('settings.agentRuntimes.search')}
                aria-label={t('settings.agentRuntimes.search')}
                className={`${inputClass} pl-11`}
              />
            </label>
            {visible.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border">
                <EmptyState title={catalog.length === 0
                  ? t('settings.agentRuntimes.emptyCatalog')
                  : t('settings.agentRuntimes.noMatches', { query })}
                />
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl bg-background">
                {visible.map((agent) => (
                  <RuntimeSettingsCard
                    key={agent.id}
                    agent={agent}
                    row={readiness?.agents[agent.id] ?? null}
                    pinned={quickAccessIds.includes(agent.id)}
                    pinDisabled={!canAddAgentRuntimeQuickAccess(quickAccessIds, agent)}
                    saving={saving}
                    probing={refreshing}
                    onTogglePin={() => togglePin(agent.id, quickAccessIds.includes(agent.id))}
                    onProbe={() => void refresh(agent.id)}
                  />
                ))}
              </div>
            )}
          </ConfigSection>
        </div>
      </SettingsScrollArea>
    </div>
  )
}

function RuntimeSettingsCard({
  agent,
  row,
  pinned,
  pinDisabled,
  saving,
  probing,
  onTogglePin,
  onProbe,
}: {
  agent: AgentInfo
  row: AgentRuntimeReadinessRow | null
  pinned: boolean
  pinDisabled: boolean
  saving: boolean
  probing: boolean
  onTogglePin(): void
  onProbe(): void
}) {
  const { t } = useTranslation()
  const installed = agent.installed !== false
  const hint = installHintFor(agent.id)
  const binPath = row?.binPath ?? agent.binPath ?? null

  const needsAttention = row?.repairTarget && row.status !== 'ready' && row.status !== 'checking'

  return (
    <article className="min-w-0 border-b border-border/60 px-3 last:border-b-0 sm:px-4">
      <Collapsible className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
        <CollapsibleTrigger className="group/runtime flex min-h-[72px] w-full cursor-pointer items-center gap-3 rounded-md text-left outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]">
          <AgentRuntimeIcon agentId={agent.id} className="size-7 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold">{agent.displayName}</span>
            <span className={`block text-sm leading-5 ${needsAttention ? 'text-warning' : 'text-muted-foreground'}`}>
              {t(agentRuntimeSettingsStatusKey(row))}
            </span>
          </span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-fast)] group-data-panel-open/runtime:rotate-180 motion-reduce:transition-none" />
        </CollapsibleTrigger>
        <div className="flex min-h-[72px] shrink-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={probing}
            focusableWhenDisabled
            onClick={onProbe}
            aria-label={`${agent.displayName}: ${t('settings.agentRuntimes.probe')}`}
            title={t('settings.agentRuntimes.probe')}
          >
            <RefreshCw aria-hidden className={row?.status === 'checking' ? 'animate-spin motion-reduce:animate-none' : undefined} />
          </Button>
          <Toggle
            size="sm"
            checked={pinned}
            disabled={!pinned && pinDisabled}
            pending={saving}
            ariaLabel={pinned
              ? t('settings.agentRuntimes.unpin', { name: agent.displayName })
              : !installed
                ? t('settings.agentRuntimes.pinUninstalled', { name: agent.displayName })
                : pinDisabled
                  ? t('settings.agentRuntimes.pinDisabled', { name: agent.displayName })
                  : t('settings.agentRuntimes.pin', { name: agent.displayName })}
            onChange={() => onTogglePin()}
          />
        </div>
        <CollapsibleContent keepMounted className="col-span-2">
          <div className="space-y-2 pb-5 pt-1 sm:pl-10 text-sm leading-5 text-muted-foreground">
            <p>{installed ? t('settings.agentRuntimes.installed') : t('settings.agentRuntimes.notInstalled')}</p>
            <p className="break-all font-mono text-sm">{binPath ?? t('settings.agentRuntimes.unknownPath')}</p>
            {row?.message && <p>{row.message}</p>}
            {agent.id in RUNTIME_COPY && (
              <dl className="grid gap-3 md:grid-cols-2">
                <div>
                  <dt className="mb-1 font-medium text-foreground">{t('settings.agentRuntimes.models')}</dt>
                  <dd>{t(RUNTIME_COPY[agent.id as keyof typeof RUNTIME_COPY].models)}</dd>
                </div>
                <div>
                  <dt className="mb-1 font-medium text-foreground">{t('settings.agentRuntimes.auth')}</dt>
                  <dd>{t(RUNTIME_COPY[agent.id as keyof typeof RUNTIME_COPY].auth)}</dd>
                </div>
              </dl>
            )}
            {!installed && hint && (
              <p>
                {hint.cmd && <span className="mr-2 break-all font-mono">{hint.cmd}</span>}
                <a href={hint.url} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">
                  {t('settings.agentRuntimes.installDocs')}
                </a>
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {needsAttention && row.repairTarget && (
        <p className="pb-3 pl-8 text-xs leading-5 text-warning">{t(REPAIR_KEYS[row.repairTarget])}</p>
      )}
    </article>
  )
}
