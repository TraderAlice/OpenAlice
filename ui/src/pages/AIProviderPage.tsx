/**
 * AI Provider — Alice's credential vault.
 *
 * Post-Workspace-pivot the in-process model loop is gone; the only thing this
 * page manages is the central set of api-key credentials that can be selected
 * for per-process Workspace Session bindings. The native-project config editor
 * is retained separately as a deprecated compatibility export. This page is
 * NOT a profile editor anymore — no backend/loginMethod, no active profile, no
 * SDK adapters, and Test runs the lightweight HTTP probe, not the old provider
 * router.
 *
 * Subscription logins (Claude Pro/Max via `claude login`, ChatGPT via
 * `codex login`) are deliberately absent — those live in the CLI's own auth,
 * not in Alice. The preset catalog is reused here purely as an "add credential"
 * helper: it carries each vendor's endpoint + model suggestions + request shape.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { api, type Preset, type WireShape } from '../api'
import type {
  CredentialSummary,
  WorkspaceCredentialDefault,
  WorkspaceCredentialDefaultsResponse,
} from '../api/config'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, PageLoading, RecoverySurface, Skeleton } from '../components/StateViews'
import { SettingsScrollArea, inputClass } from '../components/form'
import { CredentialModal } from '../components/credentials/CredentialModal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  AGENT_LABELS,
  WIRE_SHAPE_GUIDANCE,
  agentWireShapes,
  compatibleAgentIds,
  credentialMatchesQuery,
  describeModelSemantics,
  isApiKeyPreset,
  presetDefaultModel,
  presetModel,
  vendorLabel,
  vendorPreset,
} from '../lib/presetHelpers'
import { notifyWorkspaceDefaultsChanged } from '../lib/workspaceAiEvents'
import type { AgentInfo } from '../components/workspace/api'
import { useAgentRuntimes } from '../hooks/useAgentRuntimes'
import { useWorkspace } from '../tabs/store'
import { Button } from '../components/ui/button'

function credentialLabel(cred: Pick<CredentialSummary, 'slug' | 'vendor' | 'label'>): string {
  return cred.label?.trim() || cred.slug
}

// ==================== Page ====================

export function AIProviderPage() {
  const { t } = useTranslation()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const { agents } = useAgentRuntimes()
  const [credentials, setCredentials] = useState<CredentialSummary[] | null>(null)
  const [credentialsLoadError, setCredentialsLoadError] = useState(false)
  const [presets, setPresets] = useState<Preset[]>([])
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; cred: CredentialSummary } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<CredentialSummary | null>(null)
  const [vaultQuery, setVaultQuery] = useState('')

  const reload = useCallback(async () => {
    setCredentials(null)
    setCredentialsLoadError(false)
    try {
      const { credentials: next } = await api.config.getCredentials()
      setCredentials(next)
    } catch {
      setCredentialsLoadError(true)
    }
  }, [])

  useEffect(() => {
    void reload()
    api.config.getPresets().then(({ presets: p }) => setPresets(p)).catch(() => {})
  }, [reload])

  const apiKeyPresets = useMemo(() => presets.filter(isApiKeyPreset), [presets])
  const visibleCredentials = useMemo(
    () => (credentials ?? []).filter((cred) => credentialMatchesQuery(cred, vaultQuery)),
    [credentials, vaultQuery],
  )

  const handleDelete = async (slug: string): Promise<boolean> => {
    try {
      await api.config.deleteCredential(slug)
      await reload()
      return true
    } catch (err) {
      alert(err instanceof Error ? err.message : t('aiProvider.deleteFailed'))
      return false
    }
  }

  if (!credentials) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <PageHeader title={t('aiProvider.title')} />
        {credentialsLoadError ? (
          <RecoverySurface
            title={t('aiProvider.loadErrorTitle')}
            description={t('aiProvider.loadErrorDescription')}
            actionLabel={t('common.retry')}
            onAction={() => void reload()}
          />
        ) : (
          <PageLoading />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('aiProvider.title')} />
      <SettingsScrollArea className="px-4 py-5 md:px-8">
        <div className="mx-auto grid min-w-0 max-w-[1100px] gap-6 2xl:grid-cols-2">
          {/* ============== Credentials ============== */}
          <section className="min-w-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex min-w-0 items-baseline gap-1.5">
                <h2 className="text-[14px] font-semibold text-foreground">{t('aiProvider.credentials')}</h2>
                {credentials.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {vaultQuery.trim()
                      ? t('aiProvider.credentialsFiltered', {
                          shown: visibleCredentials.length,
                          total: credentials.length,
                        })
                      : t('aiProvider.credentialsCount', { count: credentials.length })}
                  </span>
                )}
              </div>
              <Button
                type="button"
                onClick={() => setModal({ mode: 'add' })}
                variant="outline"
                size="sm"
              >
                <Plus aria-hidden className="size-3.5" />
                {t('common.add')}
              </Button>
            </div>

            {credentials.length > 0 && (
              <input
                className={`${inputClass} mb-3 h-8 py-1.5`}
                value={vaultQuery}
                onChange={(event) => setVaultQuery(event.target.value)}
                placeholder={t('aiProvider.searchCredentials')}
                aria-label={t('aiProvider.searchCredentials')}
              />
            )}

            <div className="space-y-2.5">
              {visibleCredentials.map((cred) => {
                const compatibleAgents = compatibleAgentIds(cred.wires, agents)
                const displayLabel = credentialLabel(cred)
                const displayVendor = vendorLabel(cred.vendor)
                const showVendor = displayVendor.toLocaleLowerCase() !== displayLabel.toLocaleLowerCase()
                return (
                  <div key={cred.slug} className="flex min-h-12 min-w-0 flex-col gap-3 rounded-lg border border-border bg-background px-4 py-3 sm:flex-row sm:items-center">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-[13px] font-medium text-foreground">{displayLabel}</span>
                        {showVendor && (
                          <span className="text-[11px] text-muted-foreground">{displayVendor}</span>
                        )}
                        {cred.label && (
                          <span className="text-[11px] text-muted-foreground font-mono">{cred.slug}</span>
                        )}
                        {cred.hasApiKey && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success">
                            <Check aria-hidden className="size-3" />
                            {t('aiProvider.keySet')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex min-w-0 flex-col gap-0.5 text-[11px] text-muted-foreground">
                        <span className="truncate">
                          {t('aiProvider.defaultModel')}: <span className="font-mono">{cred.lastModel || t('aiProvider.notSet')}</span>
                        </span>
                        <span className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
                          <span className="truncate font-mono">{Object.values(cred.wires)[0] || t('aiProvider.officialEndpoint')}</span>
                          {compatibleAgents.length > 0 && (
                            <span>{compatibleAgents.map((agentId) => AGENT_LABELS[agentId] ?? agentId).join(', ')}</span>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2 self-end sm:self-auto">
                      <Button
                        type="button"
                        onClick={() => setModal({ mode: 'edit', cred })}
                        aria-label={t('aiProvider.editCredentialAria', {
                          credential: credentialLabel(cred),
                        })}
                        variant="outline"
                        size="sm"
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => setPendingDelete(cred)}
                        aria-label={t('aiProvider.deleteCredentialAria', {
                          credential: credentialLabel(cred),
                        })}
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        {t('common.delete')}
                      </Button>
                    </div>
                  </div>
                )
              })}

              {credentials.length > 0 && visibleCredentials.length === 0 && (
                <div className="rounded-lg border border-dashed border-border">
                  <EmptyState title={t('aiProvider.noCredentialMatches', { query: vaultQuery })} />
                </div>
              )}

              {credentials.length === 0 && (
                <Button
                  type="button"
                  onClick={() => setModal({ mode: 'add' })}
                  variant="outline"
                  className="h-auto min-h-12 w-full border-dashed text-muted-foreground hover:text-primary"
                >
                  <Plus aria-hidden className="size-3.5" />
                  {t('aiProvider.addFirst')}
                </Button>
              )}
            </div>
          </section>

          {/* ============== Default workspace credentials ============== */}
          <WorkspaceDefaultsSection credentials={credentials} presets={presets} agents={agents} />
        </div>

        <div className="mx-auto mt-6 flex min-h-12 max-w-[1100px] items-center justify-between gap-4 border-t border-border/60 py-3">
          <p className="min-w-0 text-[12px] leading-5 text-muted-foreground">{t('aiProvider.openAgentRuntimesDescription')}</p>
          <Button
            type="button"
            onClick={() => openOrFocus({ kind: 'settings', params: { category: 'agent-runtimes' } })}
            variant="outline"
            size="sm"
            className="shrink-0"
          >
            {t('aiProvider.openAgentRuntimes')}
          </Button>
        </div>
      </SettingsScrollArea>

      {modal && (
        <CredentialModal
          mode={modal.mode}
          cred={modal.mode === 'edit' ? modal.cred : undefined}
          presets={apiKeyPresets}
          agents={agents}
          onClose={() => setModal(null)}
          onSaved={async () => { await reload(); setModal(null) }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={t('aiProvider.deleteConfirmTitle', {
            credential: credentialLabel(pendingDelete),
          })}
          message={t('aiProvider.deleteConfirmMessage', {
            slug: pendingDelete.slug,
          })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          onConfirm={async () => {
            if (await handleDelete(pendingDelete.slug)) {
              setPendingDelete(null)
            }
          }}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

// ==================== Legacy new-Workspace creation seeds ====================
// Existing installation-level defaults are translated into the new Workspace's
// secret-free `.alice/settings.json`. They never write native CLI project files.

const PRIMARY_DEFAULT_AGENTS = [
  { id: 'opencode', name: 'opencode' },
  { id: 'pi', name: 'Pi' },
] as const

const ADVANCED_DEFAULT_AGENTS = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
] as const

function WorkspaceDefaultsSection({
  credentials,
  presets,
  agents,
}: {
  credentials: CredentialSummary[]
  presets: Preset[]
  agents: readonly AgentInfo[]
}) {
  const { t } = useTranslation()
  const [data, setData] = useState<WorkspaceCredentialDefaultsResponse | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveRevision = useRef(0)
  const [error, setError] = useState('')
  const saving = saveStatus === 'saving'

  const reload = () =>
    api.config.getWorkspaceCredentialDefaults()
      .then(setData)
      .catch(() => setData({ defaults: {}, compatibleByAgent: {} }))

  // Re-derive when the vault changes (a deleted cred drops from compatible lists,
  // and the backend also clears any default that pointed at it).
  useEffect(() => { void reload() }, [credentials])

  const credLabel = (slug: string) => {
    const c = credentials.find((x) => x.slug === slug)
    return c ? `${credentialLabel(c)} — ${slug}` : slug
  }

  const persist = async (
    nextDefaults: Record<string, WorkspaceCredentialDefault>,
  ) => {
    if (!data) return
    const revision = ++saveRevision.current
    setSaveStatus('saving'); setError('')
    setData({ ...data, defaults: nextDefaults }) // optimistic
    try {
      const res = await api.config.setWorkspaceCredentialDefaults(nextDefaults)
      setData((d) => (d ? { ...d, defaults: res.defaults } : d))
      notifyWorkspaceDefaultsChanged()
      if (saveRevision.current === revision) {
        setSaveStatus('saved')
        setTimeout(() => {
          if (saveRevision.current === revision) setSaveStatus('idle')
        }, 1800)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiProvider.saveFailed'))
      await reload()
      if (saveRevision.current === revision) setSaveStatus('idle')
    }
  }

  const setAgentDefault = async (agentId: string, slug: string) => {
    if (!data) return
    const nextDefaults = { ...data.defaults }
    if (slug) {
      const cred = credentials.find((candidate) => candidate.slug === slug)
      const wireShape = cred ? agentWireShapes(cred.wires, agents, agentId, cred.vendor)[0] : undefined
      nextDefaults[agentId] = { credentialSlug: slug, ...(wireShape ? { wireShape } : {}) }
    } else {
      delete nextDefaults[agentId]
    }
    await persist(nextDefaults)
  }

  const setAgentWire = async (agentId: string, wireShape: WireShape) => {
    if (!data) return
    const current = data.defaults[agentId]
    if (!current) return
    await persist({
      ...data.defaults,
      [agentId]: { ...current, wireShape },
    })
  }

  const setReasoningOverride = async (
    agentId: 'pi' | 'opencode',
    modelId: string | undefined,
    reasoning: boolean | null,
  ) => {
    if (!data) return
    const current = data.defaults[agentId]
    if (!current) return
    const {
      reasoning: _previous,
      reasoningModel: _previousModel,
      ...withoutReasoning
    } = current
    await persist({
      ...data.defaults,
      [agentId]: {
        ...withoutReasoning,
        ...(typeof reasoning === 'boolean' && modelId
          ? { reasoning, reasoningModel: modelId }
          : {}),
      },
    })
  }

  const renderAgent = (agent: { id: string; name: string }, note?: string) => {
    const options = data?.compatibleByAgent[agent.id] ?? []
    const current = data?.defaults[agent.id]?.credentialSlug ?? ''
    const selectedCredential = credentials.find((candidate) => candidate.slug === current)
    const wireShapes = selectedCredential
      ? agentWireShapes(selectedCredential.wires, agents, agent.id, selectedCredential.vendor)
      : []
    const configuredWire = data?.defaults[agent.id]?.wireShape
    const selectedWire = configuredWire && wireShapes.includes(configuredWire)
      ? configuredWire
      : wireShapes[0] ?? ''
    const selectedPreset = selectedCredential ? vendorPreset(selectedCredential.vendor, presets) : undefined
    const selectedModelId = data?.defaults[agent.id]?.model?.trim()
      || selectedCredential?.lastModel?.trim()
      || presetDefaultModel(selectedPreset)
    const selectedSemantics = presetModel(selectedPreset, selectedModelId)?.semantics ?? null
    const semanticsSummary = describeModelSemantics(selectedSemantics)
    return (
      <div key={agent.id} className="flex min-h-12 flex-col gap-3 rounded-lg border border-border bg-background px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-foreground">{agent.name}</span>
            <span className="text-[11px] text-muted-foreground font-mono">{agent.id}</span>
          </div>
          {note && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{note}</p>}
          {options.length === 0 && (
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-snug">{t('aiProvider.noCompatible')}</p>
          )}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[260px]">
          <select
            aria-label={t('aiProvider.defaultCredentialLabel', { agent: agent.name })}
            className={`${inputClass} h-8 py-1.5`}
            value={current}
            disabled={saving || options.length === 0}
            onChange={(e) => void setAgentDefault(agent.id, e.target.value)}
          >
            <option value="">{t('aiProvider.dontSeed')}</option>
            {options.map((slug) => <option key={slug} value={slug}>{credLabel(slug)}</option>)}
          </select>
          {current && wireShapes.length > 1 && (
            <select
              aria-label={t('aiProvider.apiProtocolLabel', { agent: agent.name })}
              className={`${inputClass} h-8 py-1.5`}
              value={selectedWire}
              disabled={saving}
              onChange={(e) => void setAgentWire(agent.id, e.target.value as WireShape)}
            >
              {wireShapes.map((shape) => (
                <option key={shape} value={shape}>{WIRE_SHAPE_GUIDANCE[shape]}</option>
              ))}
            </select>
          )}
          {current && wireShapes.length === 1 && (
            <p className="px-1 text-[10.5px] text-muted-foreground">
              {t('aiProvider.protocol', { protocol: WIRE_SHAPE_GUIDANCE[wireShapes[0]!] })}
            </p>
          )}
          {(agent.id === 'pi' || agent.id === 'opencode') && current && semanticsSummary && (
            <p className="px-1 text-[10.5px] leading-snug text-muted-foreground">
              {t('aiProvider.model', { model: selectedModelId })}<br />
              {t('aiProvider.automatic', { summary: semanticsSummary })}
            </p>
          )}
          {(agent.id === 'pi' || agent.id === 'opencode') && current && !selectedSemantics?.reasoning && (
            <details className="px-1 text-[10.5px] text-muted-foreground">
              <summary className="inline-flex min-h-8 cursor-pointer items-center">{t('aiProvider.advancedReasoning')}</summary>
              <select
                aria-label={t('aiProvider.reasoningOverrideLabel', { agent: agent.name })}
                className={`${inputClass} mt-1.5 h-8 py-1.5`}
                value={typeof data?.defaults[agent.id]?.reasoning !== 'boolean' ||
                  data.defaults[agent.id]?.reasoningModel !== selectedModelId
                  ? 'auto'
                  : data.defaults[agent.id]!.reasoning ? 'enabled' : 'disabled'}
                disabled={saving}
                onChange={(event) => void setReasoningOverride(
                  agent.id as 'pi' | 'opencode',
                  selectedModelId,
                  event.target.value === 'auto' ? null : event.target.value === 'enabled',
                )}
              >
                <option value="auto">{t('aiProvider.useRuntimeDefault')}</option>
                <option value="enabled">{t('aiProvider.supportsReasoning')}</option>
                <option value="disabled">{t('aiProvider.noReasoning')}</option>
              </select>
            </details>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="min-w-0">
      <div className="mb-3 flex min-h-5 items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold text-foreground">{t('aiProvider.defaultsTitle')}</h2>
        <span aria-live="polite" className={`text-[11px] ${saveStatus === 'saved' ? 'text-success' : 'text-muted-foreground'}`}>
          {saveStatus === 'saving' ? t('common.saving') : saveStatus === 'saved' ? t('common.saved') : ''}
        </span>
      </div>

      {!data ? (
        <div className="space-y-2.5" aria-hidden="true">
          {PRIMARY_DEFAULT_AGENTS.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-3.5 w-28 rounded" />
                <Skeleton className="h-2.5 w-44 rounded" />
              </div>
              <Skeleton className="h-8 w-[240px] max-w-[240px] rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {PRIMARY_DEFAULT_AGENTS.map((a) => renderAgent(a))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="text-muted-foreground"
          >
            <ChevronDown
              aria-hidden
              className={`size-3.5 transition-transform duration-[var(--motion-fast)] ${showAdvanced ? 'rotate-180' : ''}`}
            />
            {t('aiProvider.advancedAgents')}
          </Button>

          {showAdvanced && (
            <>
              <p className="text-[11px] text-muted-foreground/80 leading-snug px-1">
                {t('aiProvider.advancedAgentsDescription')}
              </p>
              {ADVANCED_DEFAULT_AGENTS.map((a) => renderAgent(a))}
            </>
          )}

          {error && <p className="text-[12px] text-destructive">{error}</p>}
        </div>
      )}
    </section>
  )
}
