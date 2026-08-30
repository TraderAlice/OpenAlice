import { useCallback, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import {
  ArrowRight,
  CircleAlert,
  Clock3,
  Hash,
  Link2,
  MessageCircle,
  MessagesSquare,
  Plug,
  RefreshCw,
  Send,
  Settings2,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  ConnectorDefinition,
  ConnectorHealth,
  ConnectorSettingsSnapshot,
  PublicConnectorConfig,
} from '../api'
import { ConfigurationDialog } from '../components/ConfigurationDialog'
import { ConnectorDiagnosticDetails } from '../components/ConnectorDiagnosticDetails'
import { PageHeader } from '../components/PageHeader'
import { SaveIndicator } from '../components/SaveIndicator'
import { RecoverySurface, RefreshNotice, Skeleton } from '../components/StateViews'
import { Toggle } from '../components/Toggle'
import type { SaveStatus } from '../hooks/useAutoSave'
import { ConnectorSettingsPanel } from './ConnectorsPage'
import {
  reconnectConnector,
  refreshConnectorHealth,
  setConnectorEnabled,
  useConnectorHealthState,
} from '../live/connector-health'
import {
  getConnectorServiceState,
  getConnectorSetupState,
  type ConnectorRuntime,
  type ConnectorSetupState,
} from './connector-setup-state'

type ConnectorOverviewActionError =
  | { id: string; action: 'reconnect'; message: string }
  | { id: string; action: 'toggle'; enabled: boolean; message: string }

export function ConnectorStatusPage() {
  const { snapshot, loading, refreshing, error, lastUpdatedAt } = useConnectorHealthState()
  const [reconnectingId, setReconnectingId] = useState<string | null>(null)
  const [toggling, setToggling] = useState<{ id: string; enabled: boolean } | null>(null)
  const [actionError, setActionError] = useState<ConnectorOverviewActionError | null>(null)
  const [configurationOpen, setConfigurationOpen] = useState(false)
  const [configurationId, setConfigurationId] = useState<string | null>(null)
  const configurationTriggerRef = useRef<HTMLButtonElement | null>(null)
  const configurationFlushRef = useRef<(() => void) | null>(null)
  const configurationRetryRef = useRef<() => void>(() => {})
  const [configurationSaveStatus, setConfigurationSaveStatus] = useState<SaveStatus>('idle')
  const { t } = useTranslation()

  const reconnect = useCallback(async (id: string) => {
    setReconnectingId(id)
    setActionError(null)
    try {
      await reconnectConnector(id)
    } catch (reconnectError) {
      setActionError({
        id,
        action: 'reconnect',
        message: reconnectError instanceof Error ? reconnectError.message : String(reconnectError),
      })
    } finally {
      setReconnectingId(null)
    }
  }, [])

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    setToggling({ id, enabled })
    setActionError(null)
    try {
      await setConnectorEnabled(id, enabled)
    } catch (toggleError) {
      setActionError({
        id,
        action: 'toggle',
        enabled,
        message: toggleError instanceof Error ? toggleError.message : String(toggleError),
      })
    } finally {
      setToggling(null)
    }
  }, [])

  const configure = useCallback((id: string, trigger: HTMLButtonElement) => {
    configurationTriggerRef.current = trigger
    setConfigurationSaveStatus('idle')
    setConfigurationId(id)
    setConfigurationOpen(true)
  }, [])

  const handleConfigurationSaveFeedback = useCallback((status: SaveStatus, retrySave: () => void) => {
    configurationRetryRef.current = retrySave
    setConfigurationSaveStatus(status)
  }, [])

  const configuredDefinition = snapshot?.definitions.find((definition) => definition.id === configurationId)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('connectorStatus.title')}
        description={t('connectorStatus.description')}
        right={(
          <div className="flex items-center gap-2">
            {lastUpdatedAt && (
              <span className="hidden text-[11px] text-muted-foreground/60 sm:inline">
                {t('connectorStatus.updated', {
                  time: new Date(lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                })}
              </span>
            )}
            <button
              type="button"
              className="oa-pressable inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-50"
              disabled={refreshing}
              onClick={() => void refreshConnectorHealth()}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              {t('connectorStatus.refresh')}
            </button>
          </div>
        )}
      />

      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-6">
        <div className="mx-auto max-w-[1040px] space-y-6">
          {loading && !snapshot ? (
            <ConnectorOverviewSkeleton label={t('connectorStatus.loading')} />
          ) : snapshot ? (
            <>
              {error && (
                <RefreshNotice
                  message={t('connectorStatus.refreshError')}
                  actionLabel={t('common.retry')}
                  onAction={() => { void refreshConnectorHealth() }}
                />
              )}
              <ConnectorOverview
                snapshot={snapshot}
                onConfigure={configure}
                onReconnect={reconnect}
                onToggle={toggle}
                reconnectingId={reconnectingId}
                toggling={toggling}
                actionError={actionError}
                t={t}
              />
            </>
          ) : error ? (
            <div className="h-[28rem] overflow-hidden rounded-2xl border border-border/70">
              <RecoverySurface
                title={t('connectorStatus.loadErrorTitle')}
                description={t('connectorStatus.loadErrorDescription')}
                actionLabel={t('common.retry')}
                onAction={() => { void refreshConnectorHealth() }}
              />
            </div>
          ) : null}
        </div>
      </div>

      {configuredDefinition && configurationId && (
        <ConfigurationDialog
          open={configurationOpen}
          onOpenChange={(open) => {
            if (!open) configurationFlushRef.current?.()
            setConfigurationOpen(open)
            if (!open) void refreshConnectorHealth()
          }}
          title={t('connectorStatus.configurationDialogTitle', { name: configuredDefinition.label })}
          description={t(
            configuredDefinition.capabilities?.includes('desk')
              ? 'connectorStatus.configurationDialogDescription'
              : 'connectorStatus.configurationDialogDescriptionDelivery',
            { name: configuredDefinition.label },
          )}
          restoreFocusRef={configurationTriggerRef}
          headerAccessory={configurationSaveStatus === 'idle' ? undefined : (
            <SaveIndicator
              status={configurationSaveStatus}
              onRetry={() => configurationRetryRef.current()}
            />
          )}
          keepMounted
        >
          <ConnectorSettingsPanel
            connectorId={configurationId}
            flushRef={configurationFlushRef}
            onSaveFeedback={handleConfigurationSaveFeedback}
          />
        </ConfigurationDialog>
      )}
    </div>
  )
}

function ConnectorOverviewSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="space-y-6">
      <section className="rounded-xl border border-border bg-secondary/20 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-full max-w-lg" />
          </div>
        </div>
      </section>
      <section>
        <div className="mb-3.5 space-y-2 px-0.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <article key={index} className="rounded-2xl border border-border bg-secondary/15 p-5 lg:min-h-[250px]">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className={`h-4 ${index % 2 === 0 ? 'w-24' : 'w-20'}`} />
                  <Skeleton className="h-3 w-2/3" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <div className="mt-5 space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="mt-12 h-9 w-28 rounded-lg" />
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function ConnectorOverview({
  snapshot,
  onConfigure,
  onReconnect,
  onToggle,
  reconnectingId,
  toggling,
  actionError,
  t,
}: {
  snapshot: ConnectorSettingsSnapshot
  onConfigure: (id: string, trigger: HTMLButtonElement) => void
  onReconnect: (id: string) => Promise<void>
  onToggle: (id: string, enabled: boolean) => Promise<void>
  reconnectingId: string | null
  toggling: { id: string; enabled: boolean } | null
  actionError: ConnectorOverviewActionError | null
  t: TFunction
}) {
  const runtimeById = useMemo(
    () => new Map(snapshot.health.service?.adapters.map((adapter) => [adapter.id, adapter]) ?? []),
    [snapshot.health.service?.adapters],
  )
  const service = servicePresentation(snapshot.health, t)
  const adapters = snapshot.definitions.map((definition) => {
    const config = snapshot.config.adapters[definition.id] ?? {
      enabled: false,
      settings: {},
      configuredSecrets: [],
    }
    const runtime = runtimeById.get(definition.id)
    const setup = getConnectorSetupState({
      definition,
      adapter: config,
      serviceEnabled: snapshot.config.serviceEnabled,
      serviceStatus: snapshot.health.status,
      runtime,
    })
    return {
      definition,
      config,
      runtime,
      setup,
      presentation: adapterPresentation(setup, t, definition.label),
    }
  })
  const activeCount = adapters.filter(({ config }) => snapshot.config.serviceEnabled && config.enabled).length
  const attentionCount = adapters.filter(({ presentation }) => presentation.tone === 'danger').length
  const configuredCount = adapters.filter(({ setup }) => setup.ready).length
  const ownedAdapters = adapters.filter(hasStartedConnectorSetup)
  const availableAdapters = adapters.filter((adapter) => !hasStartedConnectorSetup(adapter))
  const showServiceSummary = configuredCount > 0 || activeCount > 0

  return (
    <>
      {showServiceSummary && (
        <section className={`oa-status-surface rounded-xl border px-4 py-3.5 ${service.tone === 'danger'
          ? 'border-destructive/25 bg-destructive/[0.035]'
          : service.tone === 'warning'
            ? 'border-warning/25 bg-warning/[0.035]'
          : 'border-border bg-secondary/25'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${service.tone === 'danger'
                ? 'border-destructive/20 bg-destructive/10 text-destructive'
                : service.tone === 'healthy'
                  ? 'border-success/20 bg-success/10 text-success'
                  : service.tone === 'warning'
                    ? 'border-warning/20 bg-warning/10 text-warning'
                  : 'border-border bg-background text-muted-foreground'
              }`}>
                <Plug size={17} aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-foreground">{t('connectorStatus.serviceTitle')}</h3>
                  <StatusBadge tone={service.tone}>{service.label}</StatusBadge>
                </div>
                <p className="mt-0.5 max-w-[660px] text-[12px] leading-5 text-muted-foreground">
                  {service.description}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <SummaryPill>{t('connectorStatus.configuredCount', { count: configuredCount })}</SummaryPill>
              <SummaryPill>{t('connectorStatus.activeCount', { count: activeCount })}</SummaryPill>
              {attentionCount > 0 && (
                <SummaryPill tone="danger">{t('connectorStatus.attentionCount', { count: attentionCount })}</SummaryPill>
              )}
            </div>
          </div>
          {snapshot.health.lastError && !snapshot.health.service && (
            <ConnectorDiagnosticDetails summary={t('connectorStatus.technicalDetails')}>
              {snapshot.health.lastError}
            </ConnectorDiagnosticDetails>
          )}
        </section>
      )}

      {ownedAdapters.length > 0 && (
        <ConnectorGroup
          title={t('connectorStatus.deliveryTitle')}
          description={t('connectorStatus.deliveryDescription')}
          adapters={ownedAdapters}
          onConfigure={onConfigure}
          onReconnect={onReconnect}
          onToggle={onToggle}
          reconnectingId={reconnectingId}
          toggling={toggling}
          actionError={actionError}
          t={t}
        />
      )}

      {availableAdapters.length > 0 && (
        <AvailableConnectorGroup
          title={t(ownedAdapters.length === 0
            ? 'connectorStatus.chooseTitle'
            : 'connectorStatus.availableTitle')}
          description={t(ownedAdapters.length === 0
            ? 'connectorStatus.chooseDescription'
            : 'connectorStatus.availableDescription')}
          adapters={availableAdapters}
          onConfigure={onConfigure}
          t={t}
        />
      )}
    </>
  )
}

interface AdapterOverviewItem {
  definition: ConnectorDefinition
  config: PublicConnectorConfig['adapters'][string]
  runtime?: ConnectorRuntime
  setup: ConnectorSetupState
  presentation: { label: string; tone: StatusTone; description: string }
}

function hasStartedConnectorSetup({ definition, config, setup }: AdapterOverviewItem): boolean {
  if (setup.stage !== 'needs_credentials' || config.enabled || config.configuredSecrets.length > 0) return true
  return definition.fields.some((field) => field.kind !== 'secret' && hasSettingValue(config.settings[field.key]))
}

function hasSettingValue(value: string | number | boolean | undefined): boolean {
  return typeof value === 'boolean'
    || typeof value === 'number'
    || (typeof value === 'string' && value.trim().length > 0)
}

function ConnectorGroup({
  title,
  description,
  adapters,
  onConfigure,
  onReconnect,
  onToggle,
  reconnectingId,
  toggling,
  actionError,
  t,
}: {
  title: string
  description: string
  adapters: AdapterOverviewItem[]
  onConfigure: (id: string, trigger: HTMLButtonElement) => void
  onReconnect: (id: string) => Promise<void>
  onToggle: (id: string, enabled: boolean) => Promise<void>
  reconnectingId: string | null
  toggling: { id: string; enabled: boolean } | null
  actionError: ConnectorOverviewActionError | null
  t: TFunction
}) {
  return (
    <section>
      <div className="mb-3.5 px-0.5">
        <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {adapters.map((adapter) => (
          <ConnectorOverviewCard
            key={adapter.definition.id}
            adapter={adapter}
            onConfigure={onConfigure}
            onReconnect={onReconnect}
            onToggle={onToggle}
            reconnecting={reconnectingId === adapter.definition.id}
            toggling={toggling?.id === adapter.definition.id ? toggling : null}
            actionsBusy={reconnectingId !== null || toggling !== null}
            actionError={actionError?.id === adapter.definition.id ? actionError : null}
            t={t}
          />
        ))}
      </div>
    </section>
  )
}

function AvailableConnectorGroup({
  title,
  description,
  adapters,
  onConfigure,
  t,
}: {
  title: string
  description: string
  adapters: AdapterOverviewItem[]
  onConfigure: (id: string, trigger: HTMLButtonElement) => void
  t: TFunction
}) {
  return (
    <section>
      <div className="mb-3.5 px-0.5">
        <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {adapters.map(({ definition }) => (
          <article
            key={definition.id}
            className="oa-status-surface flex min-w-0 flex-col gap-3 rounded-xl border border-border/80 bg-secondary/10 p-4 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <ConnectorGlyph id={definition.id} />
              <div className="min-w-0">
                <h4 className="text-[14px] font-semibold text-foreground">{definition.label}</h4>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Send size={12} aria-hidden />
                    {t('connectorStatus.capabilityDelivery')}
                  </span>
                  {definition.capabilities?.includes('desk') && (
                    <span className="inline-flex items-center gap-1.5">
                      <MessageCircle size={12} aria-hidden />
                      {t('connectorStatus.capabilityChat')}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="oa-pressable inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-[12px] font-medium text-foreground hover:border-primary/45 hover:text-primary sm:w-auto"
              onClick={(event) => onConfigure(definition.id, event.currentTarget)}
            >
              {t('connectorStatus.configureAdapter', { name: definition.label })}
              <ArrowRight size={13} aria-hidden />
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

function ConnectorOverviewCard({
  adapter: { definition, runtime, setup, presentation },
  onConfigure,
  onReconnect,
  onToggle,
  reconnecting,
  toggling,
  actionsBusy,
  actionError,
  t,
}: {
  adapter: AdapterOverviewItem
  onConfigure: (id: string, trigger: HTMLButtonElement) => void
  onReconnect: (id: string) => Promise<void>
  onToggle: (id: string, enabled: boolean) => Promise<void>
  reconnecting: boolean
  toggling: { id: string; enabled: boolean } | null
  actionsBusy: boolean
  actionError: ConnectorOverviewActionError | null
  t: TFunction
}) {
  const supportsLinking = definition.fields.some((field) => Boolean(field.learnedBy))
  const prioritizeConfiguration = setup.stage === 'needs_credentials'
    || setup.stage === 'starting'
    || setup.stage === 'awaiting_link'
  const running = setup.stage === 'starting'
    || setup.stage === 'awaiting_link'
    || setup.stage === 'linked'
    || setup.stage === 'error'
  const ActionIcon = prioritizeConfiguration ? ArrowRight : Settings2
  const runtimeLabel = setup.stage === 'ready_to_link'
    ? t('connectorStatus.startChannel', { name: definition.label })
    : t('connectorSettings.useConnector', { name: definition.label })

  return (
    <article className="oa-status-surface flex flex-col rounded-2xl border border-border/80 bg-secondary/15 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ConnectorGlyph id={definition.id} />
          <h4 className="min-w-0 text-[15px] font-semibold text-foreground">{definition.label}</h4>
        </div>
        <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
      </div>

      <p className="mt-4 text-[12.5px] font-medium leading-5 text-foreground">{presentation.description}</p>

      {setup.ready && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11.5px] text-muted-foreground">
          {supportsLinking && (
            <span className="inline-flex items-center gap-1.5">
              <Link2 size={13} aria-hidden />
              {setup.linked ? t('connectorStatus.privateChatLinked') : t('connectorStatus.privateChatNotLinked')}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5" title={runtime?.lastSuccessAt ? formatDate(runtime.lastSuccessAt) : undefined}>
            <Clock3 size={13} aria-hidden />
            {runtime?.lastSuccessAt
              ? t('connectorStatus.lastDelivered', { time: formatTimeAgo(runtime.lastSuccessAt, t) })
              : t('connectorStatus.noDeliveryYet')}
          </span>
        </div>
      )}

      {(runtime?.detail || runtime?.lastError) && (
        <ConnectorDiagnosticDetails summary={t('connectorStatus.technicalDetails')}>
          <span>{runtime.lastError ?? runtime.detail}</span>
          {runtime.nextAttemptAt && (
            <span className="mt-1 block text-muted-foreground">
              {t('connectorStatus.nextRetryAt', {
                time: formatDate(runtime.nextAttemptAt),
                count: runtime.consecutiveFailures ?? 1,
              })}
            </span>
          )}
        </ConnectorDiagnosticDetails>
      )}

      <div
        data-connector-card-action-rail
        className={`mt-auto flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border/60 pt-4 ${setup.ready ? 'justify-between' : ''}`}
      >
        {setup.ready && (
          <div
            data-connector-runtime-control
            className="flex min-h-10 min-w-[7.5rem] flex-1 items-center justify-between gap-3"
          >
            <span className={`text-[12.5px] font-medium ${setup.stage === 'ready_to_link'
              ? 'text-primary'
              : 'text-foreground'
            }`}>
              {runtimeLabel}
            </span>
            <Toggle
              size="sm"
              checked={running}
              disabled={actionsBusy}
              ariaLabel={t('connectorSettings.useConnectorAria', { name: definition.label })}
              onChange={(enabled) => void onToggle(definition.id, enabled)}
            />
          </div>
        )}
        <div data-connector-card-actions className="flex flex-wrap items-center gap-2">
          {setup.stage === 'error' && (
            <button
              type="button"
              className="oa-pressable inline-flex min-h-10 items-center gap-2 rounded-lg border border-primary bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
              disabled={actionsBusy}
              onClick={() => void onReconnect(definition.id)}
            >
              <RefreshCw size={13} className={reconnecting ? 'animate-spin motion-reduce:animate-none' : ''} />
              {reconnecting ? t('connectorStatus.reconnecting') : t('connectorStatus.reconnect')}
            </button>
          )}
          <button
            type="button"
            className={`oa-pressable inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium ${prioritizeConfiguration
              ? 'border border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
              : 'border border-border bg-background/50 text-foreground hover:border-primary/45 hover:text-primary'
            }`}
            onClick={(event) => onConfigure(definition.id, event.currentTarget)}
          >
            <ActionIcon size={13} aria-hidden />
            {adapterActionLabel(setup.stage, definition.label, t)}
          </button>
        </div>
      </div>
      {(toggling || reconnecting) && (
        <div role="status" aria-live="polite" aria-atomic="true" className="mt-3 flex items-start gap-2 text-[11.5px] text-muted-foreground">
          <RefreshCw size={13} className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
          <span>{t(toggling
            ? (toggling.enabled ? 'connectorStatus.turningOn' : 'connectorStatus.turningOff')
            : 'connectorStatus.reconnectingChannel', { name: definition.label })}</span>
        </div>
      )}
      {!toggling && !reconnecting && actionError && (
        <div role="alert" className="mt-3 flex items-start gap-2 text-[11.5px] text-destructive">
          <CircleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>{t(actionError.action === 'toggle'
            ? (actionError.enabled ? 'connectorStatus.turnOnFailed' : 'connectorStatus.turnOffFailed')
            : 'connectorStatus.reconnectFailed', { name: definition.label, error: actionError.message })}</span>
        </div>
      )}
    </article>
  )
}

function servicePresentation(health: ConnectorHealth, t: TFunction): {
  label: string
  description: string
  tone: StatusTone
} {
  switch (getConnectorServiceState(health)) {
    case 'stopped':
      return {
        label: t('connectorStatus.service.off'),
        description: t('connectorStatus.service.offDescription'),
        tone: 'neutral',
      }
    case 'healthy':
      return {
        label: t('connectorStatus.service.healthy'),
        description: t('connectorStatus.service.healthyDescription'),
        tone: 'healthy',
      }
    case 'running':
      return {
        label: t('connectorStatus.service.running'),
        description: t('connectorStatus.service.runningDescription'),
        tone: 'warning',
      }
    case 'unavailable':
      return {
        label: t('connectorStatus.service.unavailable'),
        description: t('connectorStatus.service.unavailableDescription'),
        tone: 'danger',
      }
  }
}

type StatusTone = 'healthy' | 'warning' | 'danger' | 'neutral'

function adapterPresentation(
  setup: ConnectorSetupState,
  t: TFunction,
  name: string,
): { label: string; tone: StatusTone; description: string } {
  switch (setup.stage) {
    case 'needs_credentials':
      return {
        label: t('connectorStatus.adapter.needsSetup'),
        tone: 'warning',
        description: t('connectorStatus.adapter.needsSetupDescription', { name }),
      }
    case 'ready_to_link':
      return {
        label: t('connectorStatus.adapter.readyToLink'),
        tone: 'warning',
        description: t('connectorStatus.adapter.readyToLinkDescription', { name }),
      }
    case 'starting':
      return {
        label: t('connectorStatus.adapter.starting'),
        tone: 'warning',
        description: t(setup.linked
          ? 'connectorStatus.adapter.startingLinkedDescription'
          : 'connectorStatus.adapter.startingDescription', { name }),
      }
    case 'awaiting_link':
      return {
        label: t('connectorStatus.adapter.awaitingLink'),
        tone: 'warning',
        description: t('connectorStatus.adapter.awaitingLinkDescription', { name }),
      }
    case 'linked':
      return {
        label: t('connectorStatus.adapter.connected'),
        tone: 'healthy',
        description: t('connectorStatus.adapter.connectedDescription'),
      }
    case 'linked_offline':
      return {
        label: t('connectorStatus.adapter.off'),
        tone: 'neutral',
        description: t('connectorStatus.adapter.offDescription'),
      }
    case 'error':
      return {
        label: t('connectorStatus.adapter.needsAttention'),
        tone: 'danger',
        description: t('connectorStatus.adapter.needsAttentionDescription'),
      }
  }
}

function adapterActionLabel(stage: ConnectorSetupState['stage'], name: string, t: TFunction): string {
  if (stage === 'needs_credentials') return t('connectorStatus.configureAdapter', { name })
  if (stage === 'ready_to_link') return t('connectorStatus.setupDetails', { name })
  if (stage === 'awaiting_link') return t('connectorStatus.linkingSteps', { name })
  if (stage === 'starting') return t('connectorStatus.viewProgress', { name })
  if (stage === 'error') return t('connectorStatus.reviewAdapter', { name })
  return t('connectorStatus.manageAdapter', { name })
}

function StatusBadge({ tone, children }: { tone: StatusTone; children: string }) {
  const styles: Record<StatusTone, string> = {
    healthy: 'border-success/20 bg-success/10 text-success',
    warning: 'border-warning/25 bg-warning/10 text-warning',
    danger: 'border-destructive/25 bg-destructive/10 text-destructive',
    neutral: 'border-border bg-muted text-muted-foreground',
  }
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${styles[tone]}`}>
      {children}
    </span>
  )
}

function SummaryPill({ tone = 'neutral', children }: { tone?: 'neutral' | 'danger'; children: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 ${tone === 'danger'
      ? 'border-destructive/20 bg-destructive/10 text-destructive'
      : 'border-border/80 bg-background/55'
    }`}>
      {children}
    </span>
  )
}

function ConnectorGlyph({ id }: { id: string }) {
  const glyphs: Record<string, LucideIcon> = {
    discord: MessageCircle,
    telegram: Send,
    slack: Hash,
    feishu: MessagesSquare,
  }
  const Icon = glyphs[id] ?? Plug
  return (
    <span
      data-connector-glyph
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/60 text-muted-foreground"
      aria-hidden
    >
      <Icon size={18} />
    </span>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatTimeAgo(value: string, t: TFunction): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (elapsedMinutes < 1) return t('connectorStatus.time.justNow')
  if (elapsedMinutes < 60) return t('connectorStatus.time.minutesAgo', { count: elapsedMinutes })
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return t('connectorStatus.time.hoursAgo', { count: elapsedHours })
  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 7) return t('connectorStatus.time.daysAgo', { count: elapsedDays })
  return formatDate(value)
}
