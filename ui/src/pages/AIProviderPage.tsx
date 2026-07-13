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

import { useState, useEffect, useMemo } from 'react'
import { api, type Preset, type WireShape } from '../api'
import type { CredentialSummary, WorkspaceCredentialDefaultsResponse } from '../api/config'
import { PageHeader } from '../components/PageHeader'
import { PageLoading, Skeleton } from '../components/StateViews'
import { inputClass } from '../components/form'
import { CredentialModal } from '../components/credentials/CredentialModal'
import { WIRE_SHAPE_SHORT, isApiKeyPreset } from '../lib/presetHelpers'

const SHAPE_ORDER: WireShape[] = ['anthropic', 'openai-chat', 'openai-responses']

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
  blurb: string
  facts: Array<[label: string, value: string]>
}

const AGENT_RUNTIMES: RuntimeInfo[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    blurb: "Anthropic's coding-agent CLI — the deepest agentic loop.",
    facts: [
      ['Models', 'Claude (Anthropic). Anthropic-compatible gateways — GLM, MiniMax, Kimi, DeepSeek — via base URL + auth header'],
      ['Auth', 'Claude Pro/Max subscription (claude login) or an Anthropic API key'],
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    blurb: "OpenAI's coding-agent CLI.",
    facts: [
      ['Models', 'OpenAI (GPT). Responses API only — Chat-only providers need a Responses proxy (OpenRouter / VibeAround)'],
      ['Auth', 'ChatGPT subscription (codex login) or an OpenAI API key'],
    ],
  },
  {
    id: 'opencode',
    name: 'opencode',
    blurb: 'Provider-agnostic open-source agent CLI (AI SDK + Models.dev, 75+ providers).',
    facts: [
      ['Models', 'Anthropic, OpenAI, Google, OpenRouter, Bedrock/Azure, and anything OpenAI-compatible — incl. local (Ollama, vLLM, LM Studio)'],
      ['Auth', 'Per-provider API key (Claude Pro/Max isn’t sanctioned in opencode — API billing only for Claude models)'],
    ],
  },
  {
    id: 'pi',
    name: 'Pi',
    blurb: 'Minimal open-source agent CLI (earendil-works/pi) — unified multi-provider API.',
    facts: [
      ['Models', 'OpenAI, Anthropic, Google + custom (Ollama, vLLM, LM Studio, proxies); OpenAI-compatible and anthropic-messages wires'],
      ['Auth', 'Per-provider API key'],
    ],
  },
]

// ==================== Page ====================

export function AIProviderPage() {
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
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  if (!credentials) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <PageHeader title="AI Provider" description="Credentials Alice holds and injects into workspaces." />
        <PageLoading />
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="AI Provider" description="Credentials Alice holds and injects into workspaces." />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <div className="max-w-[1100px] mx-auto grid gap-6 lg:grid-cols-2">
          {/* ============== Credentials ============== */}
          <section>
            <div className="rounded-lg border border-border/50 bg-bg-secondary/50 px-4 py-3 mb-4">
              <p className="text-[13px] text-text-muted leading-relaxed">
                The API keys Alice keeps centrally. Templates inject them into new
                workspaces, and a workspace's AI config can load any of them. Subscription
                logins (Claude Pro/Max, ChatGPT) aren't stored here — they live in the agent
                CLI's own login (<code className="font-mono text-[11.5px]">claude login</code> /{' '}
                <code className="font-mono text-[11.5px]">codex login</code>).
              </p>
            </div>

            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13px] font-semibold text-text uppercase tracking-wide">Credentials</h2>
              <button
                onClick={() => setModal({ mode: 'add' })}
                className="text-[11px] px-2 py-1 rounded-md border border-border text-text-muted hover:text-accent hover:border-accent transition-colors"
              >
                + Add
              </button>
            </div>

            <div className="space-y-2.5">
              {credentials.map((cred) => (
                <div key={cred.slug} className="flex items-center gap-3 rounded-lg border border-border bg-bg px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium text-text">{credentialLabel(cred)}</span>
                      {cred.label && (
                        <span className="text-[11px] text-text-muted">{cred.vendor}</span>
                      )}
                      <span className="text-[11px] text-text-muted font-mono">{cred.slug}</span>
                      {(SHAPE_ORDER.filter((s) => s in cred.wires)).map((s) => (
                        <span key={s} className="text-[10px] text-text-muted border border-border rounded px-1">{WIRE_SHAPE_SHORT[s]}</span>
                      ))}
                      {cred.hasApiKey && (
                        <span className="text-[10px] text-green border border-green/40 rounded px-1">key set</span>
                      )}
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5 font-mono truncate">
                      {Object.values(cred.wires)[0] || 'default endpoint'}
                    </div>
                  </div>
                  <button
                    onClick={() => setModal({ mode: 'edit', cred })}
                    className="text-[11px] px-2 py-1 rounded-md border border-border text-text-muted hover:text-text transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(cred.slug)}
                    className="text-[11px] px-2 py-1 rounded-md border border-border text-text-muted hover:text-red transition-colors"
                  >
                    Delete
                  </button>
                </div>
              ))}

              {credentials.length === 0 && (
                <button
                  onClick={() => setModal({ mode: 'add' })}
                  className="w-full p-4 rounded-xl border-2 border-dashed border-border text-text-muted hover:border-accent/50 hover:text-accent transition-all text-[13px] font-medium"
                >
                  + Add your first credential
                </button>
              )}
            </div>
          </section>

          {/* ============== Agent runtimes ============== */}
          <section>
            <div className="rounded-lg border border-border/50 bg-bg-secondary/50 px-4 py-3 mb-4">
              <p className="text-[13px] text-text-muted leading-relaxed">
                The agent runtimes a workspace can launch — a credential above feeds whichever
                one a workspace (or cron job) runs. Pick by the models/provider you want; every
                runtime reaches the full OpenAlice tool surface either way (native MCP where
                supported, the <code className="font-mono text-[11.5px]">alice</code> CLI on PATH
                otherwise). The model is chosen per workspace, not here.
              </p>
            </div>

            <h2 className="text-[13px] font-semibold text-text uppercase tracking-wide mb-3">Agent runtimes</h2>

            <div className="space-y-2.5">
              {AGENT_RUNTIMES.map((rt) => (
                <div key={rt.id} className="rounded-lg border border-border bg-bg px-4 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-text">{rt.name}</span>
                    <span className="text-[11px] text-text-muted font-mono">{rt.id}</span>
                  </div>
                  <p className="text-[12px] text-text-muted mt-0.5 leading-snug">{rt.blurb}</p>
                  <dl className="mt-2 space-y-1">
                    {rt.facts.map(([label, value]) => (
                      <div key={label} className="flex gap-2 text-[11px] leading-snug">
                        <dt className="text-text-muted/70 shrink-0 w-[58px]">{label}</dt>
                        <dd className="text-text-muted">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ============== Default workspace credentials ============== */}
        <WorkspaceDefaultsSection credentials={credentials} />
      </div>

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

function WorkspaceDefaultsSection({ credentials }: { credentials: CredentialSummary[] }) {
  const [data, setData] = useState<WorkspaceCredentialDefaultsResponse | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const reload = () =>
    api.config.getWorkspaceCredentialDefaults()
      .then(setData)
      .catch(() => setData({ defaults: {}, compatibleByAgent: {} }))

  // Re-derive when the vault changes (a deleted cred drops from compatible lists,
  // and the backend also clears any default that pointed at it).
  useEffect(() => { void reload() }, [credentials])

  const credLabel = (slug: string) => {
    const c = credentials.find((x) => x.slug === slug)
    return c ? `${credentialLabel(c)} · ${slug}` : slug
  }

  const setAgentDefault = async (agentId: string, slug: string) => {
    if (!data) return
    const nextDefaults = { ...data.defaults }
    if (slug) nextDefaults[agentId] = { credentialSlug: slug }
    else delete nextDefaults[agentId]
    setSaving(true); setError('')
    setData({ ...data, defaults: nextDefaults }) // optimistic
    try {
      const res = await api.config.setWorkspaceCredentialDefaults(nextDefaults)
      setData((d) => (d ? { ...d, defaults: res.defaults } : d))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      await reload()
    } finally {
      setSaving(false)
    }
  }

  const renderAgent = (agent: { id: string; name: string }, note?: string) => {
    const options = data?.compatibleByAgent[agent.id] ?? []
    const current = data?.defaults[agent.id]?.credentialSlug ?? ''
    return (
      <div key={agent.id} className="flex items-center gap-3 rounded-lg border border-border bg-bg px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-text">{agent.name}</span>
            <span className="text-[11px] text-text-muted font-mono">{agent.id}</span>
          </div>
          {note && <p className="text-[11px] text-text-muted mt-0.5 leading-snug">{note}</p>}
          {options.length === 0 && (
            <p className="text-[11px] text-text-muted/70 mt-0.5 leading-snug">No compatible credential in the vault yet.</p>
          )}
        </div>
        <select
          className={inputClass + ' max-w-[240px]'}
          value={current}
          disabled={saving || options.length === 0}
          onChange={(e) => void setAgentDefault(agent.id, e.target.value)}
        >
          <option value="">Don’t seed</option>
          {options.map((slug) => <option key={slug} value={slug}>{credLabel(slug)}</option>)}
        </select>
      </div>
    )
  }

  return (
    <section className="max-w-[1100px] mx-auto mt-6">
      <div className="rounded-lg border border-border/50 bg-bg-secondary/50 px-4 py-3 mb-4">
        <p className="text-[13px] text-text-muted leading-relaxed">
          Seed a default credential into every <em>new</em> workspace, so you don’t open the
          per-workspace AI config each time. It’s written into the workspace’s own agent config
          files at create — existing workspaces are untouched, and you can still override any
          workspace afterwards. opencode and Pi need a key to run; Claude Code and Codex normally
          run on their own CLI login (<code className="font-mono text-[11.5px]">claude login</code> /{' '}
          <code className="font-mono text-[11.5px]">codex login</code>) and don’t need this.
        </p>
      </div>

      <h2 className="text-[13px] font-semibold text-text uppercase tracking-wide mb-3">Default workspace credentials</h2>

      {!data ? (
        <div className="space-y-2.5" aria-hidden="true">
          {PRIMARY_DEFAULT_AGENTS.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border bg-bg px-4 py-3">
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

          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-[11px] text-text-muted hover:text-text transition-colors pt-1"
          >
            {showAdvanced ? '▾' : '▸'} Advanced — Claude Code / Codex (unofficial API)
          </button>

          {showAdvanced && (
            <>
              <p className="text-[11px] text-text-muted/80 leading-snug px-1">
                Only set these if you drive Claude Code / Codex through an unofficial API key
                instead of their built-in login. A default here overwrites the CLI login in each
                new workspace.
              </p>
              {ADVANCED_DEFAULT_AGENTS.map((a) => renderAgent(a))}
            </>
          )}

          {error && <p className="text-[12px] text-red">{error}</p>}
        </div>
      )}
    </section>
  )
}
