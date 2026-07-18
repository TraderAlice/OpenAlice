import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleAlert, Plug, RefreshCw, Settings2 } from 'lucide-react'
import { api, type ConnectorHealth, type ConnectorSettingsSnapshot } from '../api'
import { PageHeader } from '../components/PageHeader'
import { Spinner } from '../components/StateViews'
import { useWorkspace } from '../tabs/store'

const REFRESH_INTERVAL_MS = 15_000

export function ConnectorStatusPage() {
  const [snapshot, setSnapshot] = useState<ConnectorSettingsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    try {
      setSnapshot(await api.connectors.load())
      setLastUpdated(new Date())
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load(true) }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const configure = useCallback(() => {
    openOrFocus({ kind: 'settings', params: { category: 'connectors' } })
  }, [openOrFocus])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Connectors"
        description="External Inbox delivery status. Connector credentials and routing stay in Settings."
        right={(
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="hidden text-[11px] text-text-muted/60 sm:inline">
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              type="button"
              className="oa-pressable inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] text-text-muted hover:text-text hover:border-accent/50 disabled:opacity-50"
              disabled={refreshing}
              onClick={() => void load(true)}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              className="oa-pressable inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-[var(--color-connector-status-page-on-strong-text)] hover:bg-accent/90"
              onClick={configure}
            >
              <Settings2 size={14} />
              Configure
            </button>
          </div>
        )}
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <div className="mx-auto max-w-[960px] space-y-5">
          {loading && !snapshot ? (
            <div className="flex justify-center py-24"><Spinner /></div>
          ) : snapshot ? (
            <ConnectorOverview snapshot={snapshot} onConfigure={configure} />
          ) : null}

          {error && (
            <div className="flex gap-3 rounded-xl border border-red/30 bg-red/5 px-4 py-3 text-[13px] text-red" role="alert">
              <CircleAlert size={17} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Could not read Connector status.</p>
                <p className="mt-0.5 text-text-muted">{error}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ConnectorOverview({
  snapshot,
  onConfigure,
}: {
  snapshot: ConnectorSettingsSnapshot
  onConfigure: () => void
}) {
  const runtimeById = useMemo(
    () => new Map(snapshot.health.service?.adapters.map((adapter) => [adapter.id, adapter]) ?? []),
    [snapshot.health.service?.adapters],
  )
  const service = servicePresentation(snapshot.health)

  return (
    <>
      <section className="oa-status-surface rounded-2xl border border-border bg-bg-secondary/35 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-bg text-text-muted">
              <Plug size={19} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold text-text">Connector Service</h3>
                <StatusBadge tone={service.tone}>{service.label}</StatusBadge>
              </div>
              <p className="mt-1 max-w-[660px] text-[13px] leading-5 text-text-muted">
                {service.description}
              </p>
            </div>
          </div>
          <div className="text-right text-[11px] text-text-muted/70">
            {snapshot.health.checkedAt && <p>Checked {formatDate(snapshot.health.checkedAt)}</p>}
            {snapshot.health.latencyMs !== undefined && <p className="mt-0.5">{snapshot.health.latencyMs} ms</p>}
          </div>
        </div>
        {snapshot.health.lastError && (
          <div className="mt-4 rounded-lg border border-red/20 bg-red/5 px-3 py-2 text-[12px] text-red">
            {snapshot.health.lastError}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-text">Delivery connectors</h3>
            <p className="mt-1 text-[12px] text-text-muted">Each connector delivers to one private owner chat.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {snapshot.definitions.map((definition) => {
            const config = snapshot.config.adapters[definition.id] ?? {
              enabled: false,
              settings: {},
              configuredSecrets: [],
            }
            const runtime = runtimeById.get(definition.id)
            const configured = definition.fields
              .filter((field) => field.required)
              .every((field) => field.kind === 'secret'
                ? config.configuredSecrets.includes(field.key)
                : hasValue(config.settings[field.key]))
            const presentation = adapterPresentation({
              serviceEnabled: snapshot.config.serviceEnabled,
              adapterEnabled: config.enabled,
              configured,
              runtimeStatus: runtime?.status,
            })

            return (
              <article key={definition.id} className="oa-status-surface rounded-2xl border border-border bg-bg-secondary/25 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-[15px] font-semibold text-text">{definition.label}</h4>
                      <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-text-muted">{definition.description}</p>
                  </div>
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${presentation.dot}`} aria-hidden />
                </div>

                <dl className="mt-5 grid grid-cols-[112px_1fr] gap-x-3 gap-y-2 border-t border-border/70 pt-4 text-[12px]">
                  <dt className="text-text-muted">Configuration</dt>
                  <dd className="text-text">{configured ? 'Ready' : 'Needs setup'}</dd>
                  <dt className="text-text-muted">Delivery</dt>
                  <dd className="text-text">{config.enabled ? 'Enabled' : 'Disabled'}</dd>
                  <dt className="text-text-muted">Owner</dt>
                  <dd className="truncate text-text" title={runtime?.owner}>{runtime?.owner ?? 'Not linked'}</dd>
                  <dt className="text-text-muted">Last success</dt>
                  <dd className="text-text">{runtime?.lastSuccessAt ? formatDate(runtime.lastSuccessAt) : 'No delivery yet'}</dd>
                </dl>

                {(runtime?.detail || runtime?.lastError) && (
                  <p className={`mt-4 rounded-lg px-3 py-2 text-[12px] ${runtime.lastError ? 'bg-red/5 text-red' : 'bg-bg-tertiary/55 text-text-muted'}`}>
                    {runtime.lastError ?? runtime.detail}
                  </p>
                )}

                {!configured && (
                  <button
                    type="button"
                    className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
                    onClick={onConfigure}
                  >
                    Configure {definition.label}
                  </button>
                )}
              </article>
            )
          })}
        </div>
      </section>
    </>
  )
}

function servicePresentation(health: ConnectorHealth): {
  label: string
  description: string
  tone: StatusTone
} {
  if (!health.enabled || health.status === 'disabled') {
    return {
      label: 'Off',
      description: 'External delivery is disabled. OpenAlice Inbox remains available and is still the source of truth.',
      tone: 'neutral',
    }
  }
  if (health.status === 'healthy') {
    return {
      label: 'Healthy',
      description: 'The independent Connector Service is online and accepting Inbox notifications.',
      tone: 'healthy',
    }
  }
  return {
    label: 'Needs attention',
    description: 'External delivery is unavailable or one of its connectors is degraded. OpenAlice work is not blocked.',
    tone: 'danger',
  }
}

type AdapterStatus = NonNullable<ConnectorHealth['service']>['adapters'][number]['status']
type StatusTone = 'healthy' | 'warning' | 'danger' | 'neutral'

function adapterPresentation(input: {
  serviceEnabled: boolean
  adapterEnabled: boolean
  configured: boolean
  runtimeStatus?: AdapterStatus
}): { label: string; tone: StatusTone; dot: string } {
  if (!input.serviceEnabled || !input.adapterEnabled) {
    return { label: 'Off', tone: 'neutral', dot: 'bg-text-muted/30' }
  }
  if (!input.configured) {
    return { label: 'Needs setup', tone: 'warning', dot: 'bg-[var(--color-connector-status-page-warning-bg)]' }
  }
  if (input.runtimeStatus === 'healthy') {
    return { label: 'Connected', tone: 'healthy', dot: 'bg-green' }
  }
  if (input.runtimeStatus === 'awaiting_link') {
    return { label: 'Waiting for /link', tone: 'warning', dot: 'bg-[var(--color-connector-status-page-warning-bg)]' }
  }
  if (input.runtimeStatus === 'degraded' || input.runtimeStatus === 'stopped') {
    return { label: 'Needs attention', tone: 'danger', dot: 'bg-red' }
  }
  return { label: 'Starting', tone: 'warning', dot: 'bg-[var(--color-connector-status-page-warning-bg)]' }
}

function StatusBadge({ tone, children }: { tone: StatusTone; children: string }) {
  const styles: Record<StatusTone, string> = {
    healthy: 'border-green/20 bg-green/10 text-green',
    warning: 'border-[var(--color-connector-status-page-warning-border-subtle)] bg-[var(--color-connector-status-page-warning-bg-subtle)] text-[var(--color-connector-status-page-warning-text)] dark:text-[var(--color-connector-status-page-warning-text)]',
    danger: 'border-red/25 bg-red/10 text-red',
    neutral: 'border-border bg-bg-tertiary text-text-muted',
  }
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[tone]}`}>
      {children}
    </span>
  )
}

function hasValue(value: string | number | boolean | undefined): boolean {
  return typeof value === 'boolean' || typeof value === 'number' || (typeof value === 'string' && value.trim().length > 0)
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
