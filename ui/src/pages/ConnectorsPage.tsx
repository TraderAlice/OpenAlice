import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, CheckCircle2, CircleAlert, Link2, Power, Send, ShieldCheck } from 'lucide-react'
import { api, type ConnectorDefinition, type ConnectorHealth, type PublicConnectorConfig } from '../api'
import { PageHeader } from '../components/PageHeader'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, inputClass } from '../components/form'
import { useAutoSave } from '../hooks/useAutoSave'
import {
  getConnectorSetupState,
  type ConnectorRuntime,
  type ConnectorSetupState,
} from './connector-setup-state'

const LINK_POLL_MS = 2_500

export function ConnectorsPage() {
  const [definitions, setDefinitions] = useState<ConnectorDefinition[]>([])
  const [config, setConfig] = useState<PublicConnectorConfig | null>(null)
  const [health, setHealth] = useState<ConnectorHealth | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [lastProbe, setLastProbe] = useState<{ connectorId: string; probeId: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const snapshot = await api.connectors.load()
      setDefinitions(snapshot.definitions)
      setConfig((current) => JSON.stringify(current) === JSON.stringify(snapshot.config) ? current : snapshot.config)
      setHealth(snapshot.health)
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [])

  const refreshRuntime = useCallback(async () => {
    try {
      const snapshot = await api.connectors.load()
      // `/link` updates adapter state inside Connector Service immediately.
      // Poll only runtime health here so an external command can never
      // overwrite a credential draft or trigger a redundant auto-save/restart.
      setHealth(snapshot.health)
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async (next: PublicConnectorConfig) => {
    const response = await api.connectors.save(next)
    setConfig((current) => JSON.stringify(current) === JSON.stringify(response.config) ? current : response.config)
    window.setTimeout(() => { void refreshRuntime() }, 900)
    window.setTimeout(() => { void refreshRuntime() }, 2_400)
  }, [refreshRuntime])

  const { status, retry } = useAutoSave({
    data: config!,
    save,
    enabled: config !== null,
    delay: 700,
  })

  const adapterHealth = useMemo(
    () => new Map(health?.service?.adapters.map((item) => [item.id, item]) ?? []),
    [health],
  )

  const waitingForLink = useMemo(() => {
    if (!config) return false
    return definitions.some((definition) => {
      const adapter = config.adapters[definition.id] ?? emptyAdapter()
      const setup = getConnectorSetupState({
        definition,
        adapter,
        serviceEnabled: config.serviceEnabled,
        runtime: adapterHealth.get(definition.id),
      })
      return setup.stage === 'starting' || setup.stage === 'awaiting_link'
    })
  }, [adapterHealth, config, definitions])

  useEffect(() => {
    if (!waitingForLink) return
    const timer = window.setInterval(() => { void refreshRuntime() }, LINK_POLL_MS)
    return () => window.clearInterval(timer)
  }, [refreshRuntime, waitingForLink])

  const updateAdapter = useCallback((id: string, patch: Partial<PublicConnectorConfig['adapters'][string]>) => {
    setConfig((current) => {
      if (!current) return current
      const existing = current.adapters[id] ?? emptyAdapter()
      return {
        ...current,
        adapters: { ...current.adapters, [id]: { ...existing, ...patch } },
      }
    })
  }, [])

  const startAdapter = useCallback((id: string) => {
    setConfig((current) => {
      if (!current) return current
      const existing = current.adapters[id] ?? emptyAdapter()
      return {
        ...current,
        serviceEnabled: true,
        adapters: {
          ...current.adapters,
          [id]: { ...existing, enabled: true },
        },
      }
    })
  }, [])

  const updateSetting = useCallback((id: string, key: string, value: string | number | boolean) => {
    setConfig((current) => {
      if (!current) return current
      const existing = current.adapters[id] ?? emptyAdapter()
      return {
        ...current,
        adapters: {
          ...current.adapters,
          [id]: { ...existing, settings: { ...existing.settings, [key]: value } },
        },
      }
    })
  }, [])

  const test = useCallback(async (id: string) => {
    setTesting(id)
    setTestError(null)
    try {
      const result = await api.connectors.test(id)
      setLastProbe({ connectorId: id, probeId: result.probeId })
      await refreshRuntime()
    } catch (error) {
      setTestError(error instanceof Error ? error.message : String(error))
    } finally {
      setTesting(null)
    }
  }, [refreshRuntime])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Connectors"
        description="Create a private bot, link its owner, then forward durable Inbox notifications. Delivery never blocks OpenAlice work."
        right={<SaveIndicator status={status} onRetry={retry} />}
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-5">
        <div className="max-w-[920px] mx-auto">
          {config && (
            <>
              <ConfigSection
                title="Connector Service"
                description="Independent, Guardian-managed process. Starting a bot below turns this on automatically; this switch is the global kill switch."
              >
                <label className="flex items-start gap-3 rounded-xl border border-border/70 bg-bg-secondary/35 px-4 py-3">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={config.serviceEnabled}
                    onChange={(event) => setConfig({ ...config, serviceEnabled: event.target.checked })}
                  />
                  <span>
                    <span className="block text-[13px] font-medium text-text">Run external notification connectors</span>
                    <span className="block mt-0.5 text-[12px] text-text-muted/70">Turning this off stops every bot. Local Inbox remains the source of truth.</span>
                  </span>
                </label>
                <HealthLine health={health} />
              </ConfigSection>

              {definitions.map((definition) => {
                const adapter = config.adapters[definition.id] ?? emptyAdapter()
                const runtime = adapterHealth.get(definition.id)
                const setup = getConnectorSetupState({
                  definition,
                  adapter,
                  serviceEnabled: config.serviceEnabled,
                  runtime,
                })
                return (
                  <ConfigSection key={definition.id} title={definition.label} description={definition.description}>
                    <div className="space-y-5">
                      <SetupStatePanel
                        definition={definition}
                        setup={setup}
                        runtime={runtime}
                        saving={status === 'saving'}
                        onStart={() => startAdapter(definition.id)}
                        onStop={() => updateAdapter(definition.id, { enabled: false })}
                      />

                      {definition.fields.filter((field) => !field.learnedBy).map((field) => {
                        const configured = adapter.configuredSecrets.includes(field.key)
                        const value = adapter.settings[field.key]
                        return (
                          <Field key={field.key} label={field.label} description={field.description}>
                            {field.kind === 'boolean' ? (
                              <input
                                type="checkbox"
                                checked={value === true}
                                onChange={(event) => updateSetting(definition.id, field.key, event.target.checked)}
                              />
                            ) : (
                              <div className="flex gap-2">
                                <input
                                  className={inputClass}
                                  type={field.kind === 'secret' ? 'password' : field.kind}
                                  value={field.kind === 'secret' ? '' : String(value ?? '')}
                                  placeholder={configured ? 'Configured — enter a new value to replace' : field.placeholder}
                                  autoComplete="off"
                                  onChange={(event) => updateSetting(
                                    definition.id,
                                    field.key,
                                    field.kind === 'number' ? Number(event.target.value) : event.target.value,
                                  )}
                                />
                                {field.kind === 'secret' && configured && (
                                  <button
                                    type="button"
                                    className="shrink-0 rounded-lg border border-border px-3 text-[12px] text-text-muted hover:text-red"
                                    onClick={() => setConfig((current) => {
                                      if (!current) return current
                                      const currentAdapter = current.adapters[definition.id]!
                                      return {
                                        ...current,
                                        adapters: {
                                          ...current.adapters,
                                          [definition.id]: {
                                            ...currentAdapter,
                                            settings: { ...currentAdapter.settings, [field.key]: '' },
                                            configuredSecrets: currentAdapter.configuredSecrets.filter((key) => key !== field.key),
                                          },
                                        },
                                      }
                                    })}
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                            )}
                          </Field>
                        )
                      })}

                      <div className="flex flex-wrap items-center gap-3 border-t border-border/70 pt-4">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] text-text hover:border-accent/50 disabled:opacity-50"
                          disabled={setup.stage !== 'linked' || runtime?.status !== 'healthy' || testing !== null}
                          onClick={() => void test(definition.id)}
                        >
                          <Send size={14} />
                          {testing === definition.id ? 'Sending…' : 'Send test'}
                        </button>
                        {runtime && (
                          <span className={`text-[12px] ${runtime.status === 'healthy' ? 'text-green' : runtime.status === 'degraded' ? 'text-red' : 'text-text-muted'}`}>
                            {runtime.status.replace('_', ' ')}{runtime.owner ? ` · owner ${runtime.owner}` : ''}
                          </span>
                        )}
                      </div>
                      {runtime?.lastError && <p className="text-[12px] text-red">{runtime.lastError}</p>}
                      {lastProbe?.connectorId === definition.id && (
                        <p className="text-[12px] text-green">Sent probe <code>{lastProbe.probeId}</code>. Confirm this ID in the private chat.</p>
                      )}
                    </div>
                  </ConfigSection>
                )
              })}
            </>
          )}
          {testError && <p className="mt-4 text-[13px] text-red">{testError}</p>}
          {loadError && <p className="text-[13px] text-red">Failed to load connector settings.</p>}
        </div>
      </div>
    </div>
  )
}

function SetupStatePanel({
  definition,
  setup,
  runtime,
  saving,
  onStart,
  onStop,
}: {
  definition: ConnectorDefinition
  setup: ConnectorSetupState
  runtime?: ConnectorRuntime
  saving: boolean
  onStart: () => void
  onStop: () => void
}) {
  const command = `/${setup.linkCommand ?? 'link'}`
  const presentation = setupPresentation(setup.stage, definition.label, command, runtime)
  const Icon = presentation.icon
  const running = setup.stage === 'starting' || setup.stage === 'awaiting_link' || setup.stage === 'linked' || setup.stage === 'error'

  return (
    <div className={`oa-status-surface rounded-xl border px-4 py-4 ${presentation.container}`} aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <Icon size={18} className={`mt-0.5 shrink-0 ${presentation.iconClass}`} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-semibold text-text">{presentation.title}</p>
              <span className="rounded-full border border-current/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                {presentation.badge}
              </span>
            </div>
            <p className="mt-1 max-w-[620px] text-[12px] leading-5 text-text-muted">{presentation.description}</p>
            {setup.stage === 'awaiting_link' && (
              <ol className="mt-3 space-y-1 text-[12px] text-text">
                <li>1. Open your private chat with the {definition.label} bot.</li>
                <li>2. Send <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-accent">{command}</code>.</li>
                <li>3. Keep this page open; it will detect the linked owner automatically.</li>
              </ol>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(setup.stage === 'ready_to_link' || setup.stage === 'linked_offline') && (
            <button
              type="button"
              className="oa-pressable inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
              disabled={saving}
              onClick={onStart}
            >
              <Power size={14} />
              {setup.stage === 'ready_to_link' ? 'Start bot for linking' : 'Start connector'}
            </button>
          )}
          {running && (
            <button
              type="button"
              className="oa-pressable inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12px] text-text-muted hover:text-text disabled:opacity-50"
              disabled={saving}
              onClick={onStop}
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function setupPresentation(
  stage: ConnectorSetupState['stage'],
  label: string,
  command: string,
  runtime?: ConnectorRuntime,
): {
  title: string
  badge: string
  description: string
  icon: typeof Bot
  iconClass: string
  container: string
} {
  switch (stage) {
    case 'needs_credentials':
      return {
        title: `Create your ${label} bot`,
        badge: 'Step 1 · credentials',
        description: 'Add the required bot credentials below. OpenAlice seals secrets locally and never returns them to the browser.',
        icon: Bot,
        iconClass: 'text-text-muted',
        container: 'border-border bg-bg-secondary/35',
      }
    case 'ready_to_link':
      return {
        title: 'Bot created — ready to link',
        badge: 'Step 2 · not linked',
        description: `Credentials are saved. Start the bot so it can receive ${command} from your private ${label} chat.`,
        icon: Link2,
        iconClass: 'text-accent',
        container: 'border-accent/25 bg-accent/5',
      }
    case 'starting':
      return {
        title: 'Starting bot…',
        badge: 'Starting',
        description: `OpenAlice is starting the ${label} adapter. The ${command} instructions will appear as soon as it is online.`,
        icon: Power,
        iconClass: 'text-yellow-500',
        container: 'border-yellow-400/25 bg-yellow-400/5',
      }
    case 'awaiting_link':
      return {
        title: 'Bot online — finish linking',
        badge: 'Waiting for /link',
        description: `The ${label} bot is running, but no owner is linked yet. Complete the three steps below.`,
        icon: Link2,
        iconClass: 'text-yellow-500',
        container: 'border-yellow-400/30 bg-yellow-400/5',
      }
    case 'linked':
      return {
        title: 'Owner linked',
        badge: 'Ready',
        description: `The ${label} bot is online${runtime?.owner ? ` for owner ${runtime.owner}` : ''} and can deliver Inbox notifications.`,
        icon: CheckCircle2,
        iconClass: 'text-green',
        container: 'border-green/25 bg-green/5',
      }
    case 'linked_offline':
      return {
        title: 'Owner linked — connector stopped',
        badge: 'Offline',
        description: `The saved ${label} owner remains linked. Start the connector when you want external Inbox delivery.`,
        icon: Power,
        iconClass: 'text-text-muted',
        container: 'border-border bg-bg-secondary/35',
      }
    case 'error':
      return {
        title: 'Bot needs attention',
        badge: 'Unavailable',
        description: runtime?.lastError ?? runtime?.detail ?? `The ${label} adapter could not start. Check the credentials and Connector logs.`,
        icon: CircleAlert,
        iconClass: 'text-red',
        container: 'border-red/30 bg-red/5',
      }
  }
}

function HealthLine({ health }: { health: ConnectorHealth | null }) {
  if (!health || health.status === 'disabled') {
    return <p className="mt-3 flex items-center gap-2 text-[12px] text-text-muted"><ShieldCheck size={14} /> Service stopped</p>
  }
  if (health.status === 'healthy') {
    return <p className="mt-3 flex items-center gap-2 text-[12px] text-green"><ShieldCheck size={14} /> Service online</p>
  }
  return (
    <div className="mt-3 text-[12px] text-red">
      <p className="flex items-center gap-2">
        <CircleAlert size={14} /> Connector Service unavailable. Alice and Inbox remain online.
      </p>
      {health.lastError && <p className="ml-[22px] mt-1 text-text-muted/70">{health.lastError}</p>}
    </div>
  )
}

function emptyAdapter(): PublicConnectorConfig['adapters'][string] {
  return { enabled: false, settings: {}, configuredSecrets: [] }
}
