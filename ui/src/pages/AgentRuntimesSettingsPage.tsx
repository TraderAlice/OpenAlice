import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react'

import { ConfigSection, SettingsScrollArea, inputClass } from '../components/form'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/StateViews'
import { Button } from '../components/ui/button'
import { Toggle } from '../components/Toggle'
import { installHintFor } from '../components/workspace/agentInstall'
import type { AgentInfo, AgentRuntimeReadinessRow } from '../components/workspace/api'
import { useAgentRuntimes } from '../hooks/useAgentRuntimes'
import { canAddAgentRuntimeQuickAccess } from '../lib/agentRuntimeQuickAccess'
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
    try {
      await saveQuickAccess(ids)
    } finally {
      setSaving(false)
    }
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
        <PageHeader
          title={t('settings.agentRuntimes.title')}
          description={t('settings.agentRuntimes.description')}
        />
        <PageLoading />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t('settings.agentRuntimes.title')}
        description={t('settings.agentRuntimes.description')}
        right={(
          <Button
            variant="outline"
            disabled={refreshing}
            onClick={() => void refresh()}
            aria-label={t('settings.agentRuntimes.refresh')}
          >
            <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
            {refreshing ? t('settings.agentRuntimes.refreshing') : t('settings.agentRuntimes.refresh')}
          </Button>
        )}
      />
      <SettingsScrollArea className="px-4 py-6 md:px-8">
        <div className="mx-auto max-w-[880px]">
          {error && (
            <p role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {error}
            </p>
          )}

          <ConfigSection
            title={t('settings.agentRuntimes.quickAccess')}
            description={t('settings.agentRuntimes.quickAccessDescription')}
          >
            {pinned.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">{t('settings.agentRuntimes.quickAccessEmpty')}</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {pinned.map((agent, index) => {
                  return (
                    <li
                      key={agent.id}
                      className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2"
                    >
                      <span className="w-5 shrink-0 text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                      <AgentRuntimeIcon agentId={agent.id} className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{agent.displayName}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={saving || index === 0}
                          aria-label={t('settings.agentRuntimes.moveUp', { name: agent.displayName })}
                          onClick={() => movePin(agent.id, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={saving || index === pinned.length - 1}
                          aria-label={t('settings.agentRuntimes.moveDown', { name: agent.displayName })}
                          onClick={() => movePin(agent.id, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Toggle
                          size="sm"
                          checked
                          disabled={saving}
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
            description={t('settings.agentRuntimes.catalogDescription')}
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('settings.agentRuntimes.search')}
              aria-label={t('settings.agentRuntimes.search')}
              className={`${inputClass} mb-3`}
            />
            {visible.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
                {catalog.length === 0
                  ? t('settings.agentRuntimes.emptyCatalog')
                  : t('settings.agentRuntimes.noMatches', { query })}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
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

  return (
    <article className="min-w-0 rounded-lg border border-border/70 bg-background px-4 py-3">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <AgentRuntimeIcon agentId={agent.id} className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h3 className="min-w-0 truncate text-[13px] font-semibold text-foreground">{agent.displayName}</h3>
              <span className="font-mono text-[11px] text-muted-foreground">{agent.id}</span>
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {installed ? t('settings.agentRuntimes.installed') : t('settings.agentRuntimes.notInstalled')}
              <span className="px-1.5 text-muted-foreground/50">·</span>
              {t(agentRuntimeSettingsStatusKey(row))}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={binPath ?? undefined}>
              {binPath ?? t('settings.agentRuntimes.unknownPath')}
            </p>
            {row?.message && (
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{row.message}</p>
            )}
            {row?.repairTarget && (
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t(REPAIR_KEYS[row.repairTarget])}</p>
            )}
            {agent.id in RUNTIME_COPY && (
              <dl className="mt-2 space-y-1 text-[11px] leading-snug text-muted-foreground">
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-muted-foreground/70">{t('settings.agentRuntimes.models')}</dt>
                  <dd>{t(RUNTIME_COPY[agent.id as keyof typeof RUNTIME_COPY].models)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-muted-foreground/70">{t('settings.agentRuntimes.auth')}</dt>
                  <dd>{t(RUNTIME_COPY[agent.id as keyof typeof RUNTIME_COPY].auth)}</dd>
                </div>
              </dl>
            )}
            {!installed && hint && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                {hint.cmd && <span className="mr-2 font-mono">{hint.cmd}</span>}
                <a href={hint.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  {t('settings.agentRuntimes.installDocs')}
                </a>
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-end sm:flex-col sm:items-end sm:self-start">
          <Toggle
            size="sm"
            checked={pinned}
            disabled={saving || (!pinned && pinDisabled)}
            ariaLabel={pinned
              ? t('settings.agentRuntimes.unpin', { name: agent.displayName })
              : !installed
                ? t('settings.agentRuntimes.pinUninstalled', { name: agent.displayName })
                : pinDisabled
                  ? t('settings.agentRuntimes.pinDisabled', { name: agent.displayName })
                  : t('settings.agentRuntimes.pin', { name: agent.displayName })}
            onChange={() => onTogglePin()}
          />
          <Button variant="outline" size="sm" disabled={probing} onClick={onProbe}>
            {t('settings.agentRuntimes.probe')}
          </Button>
        </div>
      </div>
    </article>
  )
}
