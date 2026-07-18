/**
 * AI Provider — Alice's credential vault.
 *
 * Post-Workspace-pivot the in-process model loop is gone; the only thing this
 * page manages is the central set of api-key credentials that get injected into
 * workspaces (and pulled/pushed from the per-workspace AI config modal). It is
 * NOT a profile editor anymore — no backend/loginMethod, no active profile, no
 * SDK adapters, and Test runs the lightweight HTTP probe, not the old provider
 * router.
 *
 * Subscription logins (Claude Pro/Max via `claude login`, ChatGPT via
 * `codex login`) are deliberately absent — those live in the CLI's own auth,
 * not in Alice. The preset catalog is reused here purely as an "add credential"
 * helper: it carries each vendor's endpoint + model suggestions + request shape.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type Preset, type WireShape } from '../api'
import type {
  CredentialSummary,
  WorkspaceContextWindow,
  WorkspaceCredentialDefault,
  WorkspaceCredentialDefaultsResponse,
} from '../api/config'
import { PageHeader } from '../components/PageHeader'
import { PageLoading, Skeleton } from '../components/StateViews'
import { SettingsScrollArea, inputClass } from '../components/form'
import { CredentialModal } from '../components/credentials/CredentialModal'
import {
  AGENT_LABELS,
  WIRE_SHAPE_GUIDANCE,
  agentWireShapes,
  compatibleAgentIds,
  describeModelSemantics,
  isApiKeyPreset,
  presetDefaultModel,
  presetModel,
  vendorPreset,
} from '../lib/presetHelpers'
import { notifyWorkspaceDefaultsChanged } from '../lib/workspaceAiEvents'

function credentialLabel(cred: Pick<CredentialSummary, 'slug' | 'vendor' | 'label'>): string {
  return cred.label?.trim() || cred.slug
}

// ==================== Agent runtimes ====================
//
// The four CLI runtimes a workspace can launch. These credentials feed them;
// this panel orients the user on what each is and how it authenticates. Editorial
// copy grounded in the adapters (src/workspaces/adapters/*) — keep it factual.

interface RuntimeInfo {
  id: string
  name: string
  blurbKey: 'aiProvider.runtime.claude.blurb' | 'aiProvider.runtime.codex.blurb' | 'aiProvider.runtime.opencode.blurb' | 'aiProvider.runtime.pi.blurb'
  modelsKey: 'aiProvider.runtime.claude.models' | 'aiProvider.runtime.codex.models' | 'aiProvider.runtime.opencode.models' | 'aiProvider.runtime.pi.models'
  authKey: 'aiProvider.runtime.claude.auth' | 'aiProvider.runtime.codex.auth' | 'aiProvider.runtime.opencode.auth' | 'aiProvider.runtime.pi.auth'
}

const AGENT_RUNTIMES: RuntimeInfo[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    blurbKey: 'aiProvider.runtime.claude.blurb',
    modelsKey: 'aiProvider.runtime.claude.models',
    authKey: 'aiProvider.runtime.claude.auth',
  },
  {
    id: 'codex',
    name: 'Codex',
    blurbKey: 'aiProvider.runtime.codex.blurb',
    modelsKey: 'aiProvider.runtime.codex.models',
    authKey: 'aiProvider.runtime.codex.auth',
  },
  {
    id: 'opencode',
    name: 'opencode',
    blurbKey: 'aiProvider.runtime.opencode.blurb',
    modelsKey: 'aiProvider.runtime.opencode.models',
    authKey: 'aiProvider.runtime.opencode.auth',
  },
  {
    id: 'pi',
    name: 'Pi',
    blurbKey: 'aiProvider.runtime.pi.blurb',
    modelsKey: 'aiProvider.runtime.pi.models',
    authKey: 'aiProvider.runtime.pi.auth',
  },
]

// ==================== Page ====================

export function AIProviderPage() {
  const { t } = useTranslation()
  const [credentials, setCredentials] = useState<CredentialSummary[] | null>(null)
  const [presets, setPresets] = useState<Preset[]>([])
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; cred: CredentialSummary } | null>(null)

  const reload = () => api.config.getCredentials().then(({ credentials: c }) => setCredentials(c)).catch(() => setCredentials([]))

  useEffect(() => {
    void reload()
    api.config.getPresets().then(({ presets: p }) => setPresets(p)).catch(() => {})
  }, [])

  const apiKeyPresets = useMemo(() => presets.filter(isApiKeyPreset), [presets])

  const handleDelete = async (slug: string) => {
    try {
      await api.config.deleteCredential(slug)
      await reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : t('aiProvider.deleteFailed'))
    }
  }

  if (!credentials) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <PageHeader title={t('aiProvider.title')} description={t('aiProvider.description')} />
        <PageLoading />
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('aiProvider.title')} description={t('aiProvider.description')} />
      <SettingsScrollArea className="px-4 py-6 md:px-8">
        <div className="mx-auto grid min-w-0 max-w-[1100px] gap-6 2xl:grid-cols-2">
          {/* ============== Credentials ============== */}
          <section className="min-w-0">
            <div className="rounded-lg border border-border/50 bg-secondary/50 px-4 py-3 mb-4">
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                {t('aiProvider.vaultIntro')}
              </p>
            </div>

            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13px] font-semibold text-foreground uppercase tracking-wide">{t('aiProvider.credentials')}</h2>
              <button
                onClick={() => setModal({ mode: 'add' })}
                className="text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
              >
                + {t('common.add')}
              </button>
            </div>

            <div className="space-y-2.5">
              {credentials.map((cred) => {
                const compatibleAgents = compatibleAgentIds(cred.wires)
                return (
                  <div key={cred.slug} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background px-4 py-3 sm:flex-row sm:items-center">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium text-foreground">{credentialLabel(cred)}</span>
                        {cred.label && (
                          <span className="text-[11px] text-muted-foreground">{cred.vendor}</span>
                        )}
                        <span className="text-[11px] text-muted-foreground font-mono">{cred.slug}</span>
                        {compatibleAgents.map((agentId) => (
                          <span key={agentId} className="text-[10px] text-muted-foreground border border-border rounded px-1">{AGENT_LABELS[agentId] ?? agentId}</span>
                        ))}
                        {cred.hasApiKey && (
                          <span className="text-[10px] text-success border border-success/40 rounded px-1">{t('aiProvider.keySet')}</span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {t('aiProvider.defaultModel')}: <span className="font-mono">{cred.lastModel || t('aiProvider.notSet')}</span>
                        <span className="px-1.5 text-muted-foreground/50">·</span>
                        <span className="font-mono">{Object.values(cred.wires)[0] || t('aiProvider.officialEndpoint')}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2 self-end sm:self-auto">
                      <button
                        onClick={() => setModal({ mode: 'edit', cred })}
                        className="text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        onClick={() => handleDelete(cred.slug)}
                        className="text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-destructive transition-colors"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                )
              })}

              {credentials.length === 0 && (
                <button
                  onClick={() => setModal({ mode: 'add' })}
                  className="w-full p-4 rounded-xl border-2 border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-all text-[13px] font-medium"
                >
                  + {t('aiProvider.addFirst')}
                </button>
              )}
            </div>
          </section>

          {/* ============== Default workspace credentials ============== */}
          <WorkspaceDefaultsSection credentials={credentials} presets={presets} />
        </div>

        {/* Runtime descriptions are reference material, not a prerequisite for
            choosing the creation defaults above. Keep them available without
            pushing the primary settings below several screens of prose. */}
        <details className="group max-w-[1100px] min-w-0 mx-auto mt-6 rounded-lg border border-border bg-background">
          <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-semibold text-foreground">
            <span className="mr-2 inline-block text-muted-foreground transition-transform group-open:rotate-90">▸</span>
            {t('aiProvider.runtimeReference')}
          </summary>
          <div className="border-t border-border p-4">
            <div className="rounded-lg border border-border/50 bg-secondary/50 px-4 py-3 mb-4">
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                {t('aiProvider.runtimeIntro')}
              </p>
            </div>
            <div className="grid gap-2.5 lg:grid-cols-2">
              {AGENT_RUNTIMES.map((rt) => (
                <div key={rt.id} className="rounded-lg border border-border bg-background px-4 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-foreground">{rt.name}</span>
                    <span className="text-[11px] text-muted-foreground font-mono">{rt.id}</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">{t(rt.blurbKey)}</p>
                  <dl className="mt-2 space-y-1">
                    <div className="flex gap-2 text-[11px] leading-snug">
                      <dt className="text-muted-foreground/70 shrink-0 w-[58px]">{t('aiProvider.models')}</dt>
                      <dd className="text-muted-foreground">{t(rt.modelsKey)}</dd>
                    </div>
                    <div className="flex gap-2 text-[11px] leading-snug">
                      <dt className="text-muted-foreground/70 shrink-0 w-[58px]">{t('aiProvider.auth')}</dt>
                      <dd className="text-muted-foreground">{t(rt.authKey)}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </div>
        </details>
      </SettingsScrollArea>

      {modal && (
        <CredentialModal
          mode={modal.mode}
          cred={modal.mode === 'edit' ? modal.cred : undefined}
          presets={apiKeyPresets}
          onClose={() => setModal(null)}
          onSaved={async () => { await reload(); setModal(null) }}
        />
      )}
    </div>
  )
}

// ==================== Default workspace credentials ====================
//
// A user-level "inject my usual key on every new workspace" setting. Per agent,
// pick a vault credential to seed into each new workspace's file-based AI config
// at create time. opencode/pi are the primary case (loginless — they need a key
// to run); Claude Code / Codex run on their own CLI login by default, so they're
// behind an "advanced" reveal — present (some users drive them via an unofficial
// API key) but never pushed.

const PRIMARY_DEFAULT_AGENTS = [
  { id: 'opencode', name: 'opencode' },
  { id: 'pi', name: 'Pi' },
] as const

const ADVANCED_DEFAULT_AGENTS = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
] as const

function WorkspaceDefaultsSection({ credentials, presets }: { credentials: CredentialSummary[]; presets: Preset[] }) {
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
      .catch(() => setData({ defaults: {}, compatibleByAgent: {}, contextWindow: 256_000 }))

  // Re-derive when the vault changes (a deleted cred drops from compatible lists,
  // and the backend also clears any default that pointed at it).
  useEffect(() => { void reload() }, [credentials])

  const credLabel = (slug: string) => {
    const c = credentials.find((x) => x.slug === slug)
    return c ? `${credentialLabel(c)} · ${slug}` : slug
  }

  const persist = async (
    nextDefaults: Record<string, WorkspaceCredentialDefault>,
    contextWindow: WorkspaceContextWindow,
  ) => {
    if (!data) return
    const revision = ++saveRevision.current
    setSaveStatus('saving'); setError('')
    setData({ ...data, defaults: nextDefaults, contextWindow }) // optimistic
    try {
      const res = await api.config.setWorkspaceCredentialDefaults(nextDefaults, contextWindow)
      setData((d) => (d ? { ...d, defaults: res.defaults, contextWindow: res.contextWindow } : d))
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
      const wireShape = cred ? agentWireShapes(cred.wires, agentId)[0] : undefined
      nextDefaults[agentId] = { credentialSlug: slug, ...(wireShape ? { wireShape } : {}) }
    } else {
      delete nextDefaults[agentId]
    }
    await persist(nextDefaults, data.contextWindow)
  }

  const setAgentWire = async (agentId: string, wireShape: WireShape) => {
    if (!data) return
    const current = data.defaults[agentId]
    if (!current) return
    await persist({
      ...data.defaults,
      [agentId]: { ...current, wireShape },
    }, data.contextWindow)
  }

  const setContextWindow = async (contextWindow: WorkspaceContextWindow) => {
    if (!data) return
    await persist(data.defaults, contextWindow)
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
    }, data.contextWindow)
  }

  const renderAgent = (agent: { id: string; name: string }, note?: string) => {
    const options = data?.compatibleByAgent[agent.id] ?? []
    const current = data?.defaults[agent.id]?.credentialSlug ?? ''
    const selectedCredential = credentials.find((candidate) => candidate.slug === current)
    const wireShapes = selectedCredential ? agentWireShapes(selectedCredential.wires, agent.id) : []
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
      <div key={agent.id} className="flex flex-col gap-3 rounded-lg border border-border bg-background px-4 py-3 sm:flex-row sm:items-center">
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
            className={inputClass}
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
              className={inputClass}
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
              <summary className="cursor-pointer">{t('aiProvider.advancedReasoning')}</summary>
              <select
                aria-label={t('aiProvider.reasoningOverrideLabel', { agent: agent.name })}
                className={inputClass + ' mt-1.5'}
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
      <div className="rounded-lg border border-border/50 bg-secondary/50 px-4 py-3 mb-4">
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          {t('aiProvider.defaultsIntro')}
        </p>
      </div>

      <div className="mb-3 flex min-h-5 items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-foreground uppercase tracking-wide">{t('aiProvider.defaultsTitle')}</h2>
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
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-background px-4 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-foreground">{t('aiProvider.defaultContext')}</div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {t('aiProvider.contextDescription')}
              </p>
            </div>
            <select
              aria-label={t('aiProvider.contextWindowLabel')}
              className={inputClass + ' w-full sm:w-[160px]'}
              value={data.contextWindow}
              disabled={saving}
              onChange={(e) => void setContextWindow(Number(e.target.value) as WorkspaceContextWindow)}
            >
              <option value={128_000}>128K</option>
              <option value={256_000}>256K</option>
              <option value={512_000}>512K</option>
              <option value={1_000_000}>1M</option>
            </select>
          </div>

          {PRIMARY_DEFAULT_AGENTS.map((a) => renderAgent(a))}

          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors pt-1"
          >
            {showAdvanced ? '▾' : '▸'} {t('aiProvider.advancedAgents')}
          </button>

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
