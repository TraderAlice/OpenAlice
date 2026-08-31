import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { Bot, CheckCircle2, ChevronDown, CircleAlert, ExternalLink, Eye, EyeOff, KeyRound, Link2, ListChecks, Power, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  api,
  type ConnectorAdapterMutation,
  type ConnectorDefinition,
  type ConnectorHealth,
  type PublicConnectorConfig,
} from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ConnectorDiagnosticDetails } from '../components/ConnectorDiagnosticDetails'
import { PageHeader } from '../components/PageHeader'
import { SaveIndicator } from '../components/SaveIndicator'
import { RecoverySurface, RefreshNotice, Skeleton } from '../components/StateViews'
import { ConfigSection, Field, SettingsScrollArea, inputClass } from '../components/form'
import { useAutoSave, type SaveStatus } from '../hooks/useAutoSave'
import { TelegramDeskPanel } from '../components/TelegramDeskPanel'
import { Toggle } from '../components/Toggle'
import { useConnectorRuntimeHealthState } from '../live/connector-health'
import {
  getConnectorServiceState,
  getConnectorSetupState,
  type ConnectorRuntime,
  type ConnectorSetupState,
} from './connector-setup-state'

const LINK_POLL_MS = 2_500

interface PendingSecretRemoval {
  connectorId: string
  connectorLabel: string
  fieldKey: string
  fieldLabel: string
}

interface PendingSecretReplace extends PendingSecretRemoval {}

const MIN_CONNECTOR_SECRET_LENGTH = 20

interface PendingUnlink {
  connectorId: string
  connectorLabel: string
}

type ConnectorActionFeedback =
  | { connectorId: string; action: 'test'; status: 'success'; probeId: string }
  | { connectorId: string; action: 'test' | 'reconnect'; status: 'error'; message: string }

export function ConnectorsPage() {
  return <ConnectorSettingsSurface />
}

export function ConnectorSettingsPanel({
  connectorId,
  flushRef,
  onSaveFeedback,
}: {
  connectorId: string
  flushRef?: MutableRefObject<(() => void) | null>
  onSaveFeedback?: (status: SaveStatus, retry: () => void) => void
}) {
  return (
    <ConnectorSettingsSurface
      connectorId={connectorId}
      flushRef={flushRef}
      onSaveFeedback={onSaveFeedback}
    />
  )
}

function ConnectorSettingsSurface({
  connectorId,
  flushRef,
  onSaveFeedback,
}: {
  connectorId?: string
  flushRef?: MutableRefObject<(() => void) | null>
  onSaveFeedback?: (status: SaveStatus, retry: () => void) => void
}) {
  const { t } = useTranslation()
  const liveRuntime = useConnectorRuntimeHealthState()
  const [definitions, setDefinitions] = useState<ConnectorDefinition[]>([])
  const [config, setConfig] = useState<PublicConnectorConfig | null>(null)
  const [health, setHealth] = useState<ConnectorHealth | null>(null)
  const [loadError, setLoadError] = useState(false)
  const refreshTimerIdsRef = useRef<number[]>([])
  const mountedRef = useRef(false)
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({})
  const [savingSecret, setSavingSecret] = useState<string | null>(null)
  const [secretErrors, setSecretErrors] = useState<Record<string, string>>({})
  const [pendingRuntimeFocus, setPendingRuntimeFocus] = useState<string | null>(null)
  const [pendingSecretRemoval, setPendingSecretRemoval] = useState<PendingSecretRemoval | null>(null)
  const [pendingSecretReplace, setPendingSecretReplace] = useState<PendingSecretReplace | null>(null)
  const [pendingUnlink, setPendingUnlink] = useState<PendingUnlink | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<ConnectorActionFeedback | null>(null)
  const [credentialEditors, setCredentialEditors] = useState<Record<string, boolean>>({})
  const savedConfigRef = useRef<PublicConnectorConfig | null>(null)

  const load = useCallback(async () => {
    try {
      const snapshot = await api.connectors.load()
      setDefinitions(snapshot.definitions)
      setConfig((current) => {
        if (current === null) savedConfigRef.current = snapshot.config
        return JSON.stringify(current) === JSON.stringify(snapshot.config) ? current : snapshot.config
      })
      setHealth(snapshot.health)
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [])

  const refreshRuntime = useCallback(async () => {
    try {
      const snapshot = await api.connectors.load()
      // Runtime refresh never replaces form configuration or credential drafts.
      setHealth(snapshot.health)
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (liveRuntime.health) setHealth(liveRuntime.health)
    if (liveRuntime.health || liveRuntime.error) setLoadError(liveRuntime.error !== null)
  }, [liveRuntime.error, liveRuntime.health])

  const scheduleRuntimeRefresh = useCallback(() => {
    refreshTimerIdsRef.current.forEach((timerId) => window.clearTimeout(timerId))
    refreshTimerIdsRef.current = [
      window.setTimeout(() => { void refreshRuntime() }, 900),
      window.setTimeout(() => { void refreshRuntime() }, 2_400),
    ]
  }, [refreshRuntime])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      refreshTimerIdsRef.current.forEach((timerId) => window.clearTimeout(timerId))
    }
  }, [])

  const save = useCallback(async (next: PublicConnectorConfig) => {
    let saved = savedConfigRef.current
    if (!saved) return
    for (const definition of definitions) {
      const mutation = adapterMutation(
        definition,
        saved.adapters[definition.id] ?? emptyAdapter(),
        next.adapters[definition.id] ?? emptyAdapter(),
      )
      if (!mutation) continue
      const response = await api.connectors.mutateAdapter(definition.id, mutation)
      saved = {
        ...saved,
        serviceEnabled: response.serviceEnabled,
        adapters: { ...saved.adapters, [definition.id]: response.adapter },
      }
      savedConfigRef.current = saved
    }
    if (saved.serviceEnabled !== next.serviceEnabled) {
      const response = await api.connectors.setService(next.serviceEnabled)
      saved = { ...saved, serviceEnabled: response.serviceEnabled }
      savedConfigRef.current = saved
    }
    if (!mountedRef.current) return
    scheduleRuntimeRefresh()
  }, [definitions, scheduleRuntimeRefresh])

  const { status, flush, retry } = useAutoSave({
    data: config!,
    save,
    enabled: config !== null,
    delay: 700,
  })

  useEffect(() => {
    onSaveFeedback?.(status, retry)
  }, [onSaveFeedback, retry, status])

  useEffect(() => {
    if (!pendingRuntimeFocus) return
    const target = document.getElementById(`connector-${pendingRuntimeFocus}-runtime-toggle`)
    if (!target) return
    target.focus()
    setPendingRuntimeFocus(null)
  }, [config, pendingRuntimeFocus])

  useEffect(() => {
    if (!flushRef) return
    flushRef.current = flush
    return () => {
      if (flushRef.current === flush) flushRef.current = null
    }
  }, [flush, flushRef])

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
        serviceStatus: health?.status,
        runtime: adapterHealth.get(definition.id),
      })
      return setup.stage === 'starting' || setup.stage === 'awaiting_link'
    })
  }, [adapterHealth, config, definitions, health?.status])

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

  const unlinkAdapter = useCallback((id: string) => {
    const definition = definitions.find((item) => item.id === id)
    if (!definition) return
    const learnedKeys = definition.fields.filter((field) => field.learnedBy).map((field) => field.key)
    setConfig((current) => {
      if (!current) return current
      const existing = current.adapters[id] ?? emptyAdapter()
      const settings = { ...existing.settings }
      for (const key of learnedKeys) settings[key] = ''
      return {
        ...current,
        adapters: {
          ...current.adapters,
          [id]: { ...existing, settings },
        },
      }
    })
  }, [definitions])

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

  const saveSecrets = useCallback(async (id: string, keys: string[], grouped = false) => {
    if (!config) return
    const drafts = keys.map((key) => ({
      key,
      draftKey: connectorFieldKey(id, key),
      value: secretDrafts[connectorFieldKey(id, key)] ?? '',
    })).filter((draft) => draft.value.length > 0)
    if (drafts.length === 0) return

    const invalidDrafts = drafts.filter((draft) => !isPlausibleConnectorSecret(draft.value))
    if (invalidDrafts.length > 0) {
      setSecretErrors((current) => ({
        ...current,
        ...Object.fromEntries(invalidDrafts.map((draft) => [
          draft.draftKey,
          t('connectorSettings.tokenTooShort'),
        ])),
      }))
      window.requestAnimationFrame(() => {
        document.getElementById(`connector-${id}-${invalidDrafts[0].key}`)?.focus()
      })
      return
    }

    const savingKey = grouped ? connectorFieldKey(id, '__connection__') : drafts[0].draftKey
    const errorKeys = [...drafts.map((draft) => draft.draftKey), connectorFieldKey(id, '__connection__')]
    setSavingSecret(savingKey)
    setSecretErrors((current) => omitRecordKeys(current, errorKeys))
    try {
      const response = await api.connectors.mutateAdapter(id, {
        setSecrets: Object.fromEntries(drafts.map((draft) => [draft.key, draft.value])),
      })
      const baseline = savedConfigRef.current
      if (baseline) {
        savedConfigRef.current = {
          ...baseline,
          serviceEnabled: response.serviceEnabled,
          adapters: { ...baseline.adapters, [id]: response.adapter },
        }
      }
      if (!mountedRef.current) return
      setConfig((current) => {
        if (!current) return current
        const currentAdapter = current.adapters[id] ?? emptyAdapter()
        const configuredSecrets = response.adapter.configuredSecrets
        if (sameStrings(currentAdapter.configuredSecrets, configuredSecrets)) return current
        return {
          ...current,
          adapters: {
            ...current.adapters,
            [id]: { ...currentAdapter, configuredSecrets },
          },
        }
      })
      setSecretDrafts((current) => omitRecordKeys(current, drafts.map((draft) => draft.draftKey)))
      scheduleRuntimeRefresh()
      if (grouped) setPendingRuntimeFocus(id)
    } catch (error) {
      if (!mountedRef.current) return
      const errorKey = grouped ? connectorFieldKey(id, '__connection__') : drafts[0].draftKey
      setSecretErrors((current) => ({
        ...current,
        [errorKey]: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      if (mountedRef.current) {
        setSavingSecret((current) => current === savingKey ? null : current)
      }
    }
  }, [config, scheduleRuntimeRefresh, secretDrafts, t])

  const test = useCallback(async (id: string) => {
    setTesting(id)
    setActionFeedback(null)
    try {
      const result = await api.connectors.test(id)
      setActionFeedback({ connectorId: id, action: 'test', status: 'success', probeId: result.probeId })
      await refreshRuntime()
    } catch (error) {
      setActionFeedback({
        connectorId: id,
        action: 'test',
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setTesting(null)
    }
  }, [refreshRuntime])

  const reconnect = useCallback(async (id: string) => {
    setReconnecting(id)
    setActionFeedback(null)
    try {
      await api.connectors.reconnect(id)
      await refreshRuntime()
    } catch (error) {
      setActionFeedback({
        connectorId: id,
        action: 'reconnect',
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setReconnecting(null)
    }
  }, [refreshRuntime])

  const adapterOnly = connectorId !== undefined
  const visibleDefinitions = adapterOnly
    ? definitions.filter((definition) => definition.id === connectorId)
    : definitions

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {!adapterOnly && (
        <PageHeader
          title={t('connectorSettings.title')}
          description={t('connectorSettings.description')}
          right={<SaveIndicator status={status} onRetry={retry} />}
        />
      )}

      <SettingsScrollArea
        scroll={!adapterOnly}
        className={adapterOnly ? 'px-4 py-3 sm:px-6 sm:py-4' : 'px-4 pb-5 md:px-8'}
      >
        <div className="max-w-[920px] mx-auto">
          {!adapterOnly && <div data-connector-settings-top-spacer aria-hidden className="h-5" />}
          {!config && !loadError && (
            <ConnectorSettingsSkeleton compact={adapterOnly} label={t('connectorSettings.loading')} />
          )}
          {!config && loadError && (
            <div className={`overflow-hidden rounded-2xl border border-border/70 ${adapterOnly
              ? 'h-[min(34rem,calc(100dvh-9rem))]'
              : 'h-[28rem]'
            }`}>
              <RecoverySurface
                title={t('connectorSettings.loadErrorTitle')}
                description={t('connectorSettings.loadErrorDescription')}
                actionLabel={t('common.retry')}
                onAction={() => { void load() }}
              />
            </div>
          )}
          {config && loadError && (
            <RefreshNotice
              message={t('connectorSettings.refreshError')}
              actionLabel={t('common.retry')}
              onAction={() => { void refreshRuntime() }}
              className="mb-4"
            />
          )}
          {config && (
            <>
              {!adapterOnly && (
                <ConnectorSectionNav
                  definitions={visibleDefinitions}
                  config={config}
                  health={health}
                  adapterHealth={adapterHealth}
                  t={t}
                />
              )}

              {!adapterOnly && (
                <ConfigSection
                  title={t('connectorStatus.serviceTitle')}
                  description={t('connectorSettings.serviceDescription')}
                >
                  <div className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card/70 px-4 py-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Power className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h4 className="text-[13px] font-medium text-foreground">{t('connectorSettings.runService')}</h4>
                        <p className="mt-0.5 max-w-2xl text-[12px] leading-5 text-muted-foreground">
                          {t('connectorSettings.runServiceDescription')}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3 pl-11 sm:justify-end sm:pl-0">
                      <HealthBadge health={health} t={t} />
                      <Toggle
                        checked={config.serviceEnabled}
                        onChange={(checked) => setConfig({ ...config, serviceEnabled: checked })}
                        ariaLabel={t('connectorSettings.runServiceAria')}
                      />
                    </div>
                  </div>
                </ConfigSection>
              )}

              {visibleDefinitions.map((definition) => {
                const adapter = config.adapters[definition.id] ?? emptyAdapter()
                const runtime = adapterHealth.get(definition.id)
                const setup = getConnectorSetupState({
                  definition,
                  adapter,
                  serviceEnabled: config.serviceEnabled,
                  serviceStatus: health?.status,
                  runtime,
                })
                const credentialsOpen =
                  credentialEditors[definition.id] ?? setup.stage === 'needs_credentials'
                return (
                  <ConnectorAdapterSection
                    key={definition.id}
                    definition={definition}
                    compact={adapterOnly}
                    t={t}
                  >
                    <div className="space-y-4">
                      {setup.stage !== 'needs_credentials' && (
                        <SetupStatePanel
                          definition={definition}
                          setup={setup}
                          runtime={runtime}
                          saving={status === 'saving'}
                          testing={testing}
                          reconnecting={reconnecting}
                          actionFeedback={actionFeedback?.connectorId === definition.id ? actionFeedback : null}
                          onStart={() => startAdapter(definition.id)}
                          onStop={() => updateAdapter(definition.id, { enabled: false })}
                          onTest={() => void test(definition.id)}
                          onReconnect={() => void reconnect(definition.id)}
                          t={t}
                        />
                      )}

                      <ConnectorCredentialsEditor
                        definition={definition}
                        adapter={adapter}
                        ready={setup.ready}
                        linked={setup.linked}
                        open={credentialsOpen}
                        savingSecret={savingSecret}
                        secretDrafts={secretDrafts}
                        secretErrors={secretErrors}
                        onToggle={() => setCredentialEditors((current) => ({
                          ...current,
                          [definition.id]: !credentialsOpen,
                        }))}
                        onSettingChange={(key, value) => updateSetting(definition.id, key, value)}
                        onSecretDraftChange={(draftKey, value) => {
                          setSecretDrafts((current) => ({ ...current, [draftKey]: value }))
                          setSecretErrors((current) => omitRecordKey(current, draftKey))
                        }}
                        onSaveConnection={(keys) => {
                          void saveSecrets(definition.id, keys, true)
                        }}
                        onReplaceSecret={(key, fieldLabel) => {
                          const draftKey = connectorFieldKey(definition.id, key)
                          if (!isPlausibleConnectorSecret(secretDrafts[draftKey] ?? '')) {
                            setSecretErrors((current) => ({
                              ...current,
                              [draftKey]: t('connectorSettings.tokenTooShort'),
                            }))
                            return
                          }
                          setPendingSecretReplace({
                            connectorId: definition.id,
                            connectorLabel: definition.label,
                            fieldKey: key,
                            fieldLabel,
                          })
                        }}
                        onRemoveSecret={(fieldKey, fieldLabel) => setPendingSecretRemoval({
                          connectorId: definition.id,
                          connectorLabel: definition.label,
                          fieldKey,
                          fieldLabel,
                        })}
                        onUnlink={() => setPendingUnlink({
                          connectorId: definition.id,
                          connectorLabel: definition.label,
                        })}
                        t={t}
                      />

                      <ConnectorPreferences
                        definition={definition}
                        adapter={adapter}
                        onSettingChange={(key, value) => updateSetting(definition.id, key, value)}
                        t={t}
                      />

                      {definition.capabilities?.includes('desk') && (
                        <TelegramDeskPanel
                          connectorId={definition.id}
                          label={definition.label}
                          linked={setup.linked}
                          online={setup.stage === 'linked'}
                        />
                      )}

                    </div>
                  </ConnectorAdapterSection>
                )
              })}
            </>
          )}
        </div>
      </SettingsScrollArea>

      {pendingSecretReplace && (
        <ConfirmDialog
          title={t('connectorSettings.replaceSecretTitle', { name: pendingSecretReplace.connectorLabel })}
          message={t('connectorSettings.replaceSecretMessage', { name: pendingSecretReplace.connectorLabel })}
          confirmLabel={t('connectorSettings.replaceToken')}
          workingLabel={t('connectorSettings.saving')}
          variant="primary"
          onConfirm={async () => {
            await saveSecrets(pendingSecretReplace.connectorId, [pendingSecretReplace.fieldKey])
            setPendingSecretReplace(null)
          }}
          onClose={() => setPendingSecretReplace(null)}
        />
      )}

      {pendingUnlink && (
        <ConfirmDialog
          title={t('connectorSettings.unlinkTitle', { name: pendingUnlink.connectorLabel })}
          message={t('connectorSettings.unlinkMessage', { name: pendingUnlink.connectorLabel })}
          confirmLabel={t('connectorSettings.unlink')}
          workingLabel={t('connectorSettings.unlinking')}
          variant="primary"
          onConfirm={() => {
            unlinkAdapter(pendingUnlink.connectorId)
            setPendingUnlink(null)
          }}
          onClose={() => setPendingUnlink(null)}
        />
      )}

      {pendingSecretRemoval && (
        <ConfirmDialog
          title={t('connectorSettings.removeSecretTitle', { name: pendingSecretRemoval.connectorLabel })}
          message={(
            <>
              {t('connectorSettings.removeSecretBefore')}{' '}
              <strong>{pendingSecretRemoval.fieldLabel}</strong> for{' '}
              <strong>{pendingSecretRemoval.connectorLabel}</strong>.{' '}
              {t('connectorSettings.removeSecretAfter')}
            </>
          )}
          confirmLabel={t('connectorSettings.removeToken')}
          workingLabel={t('connectorSettings.removing')}
          onConfirm={() => {
            setConfig((current) => {
              if (!current) return current
              const currentAdapter = current.adapters[pendingSecretRemoval.connectorId] ?? emptyAdapter()
              return {
                ...current,
                adapters: {
                  ...current.adapters,
                  [pendingSecretRemoval.connectorId]: {
                    ...currentAdapter,
                    settings: {
                      ...currentAdapter.settings,
                      [pendingSecretRemoval.fieldKey]: '',
                    },
                    configuredSecrets: currentAdapter.configuredSecrets.filter(
                      (key) => key !== pendingSecretRemoval.fieldKey,
                    ),
                  },
                },
              }
            })
            setCredentialEditors((current) => ({
              ...current,
              [pendingSecretRemoval.connectorId]: true,
            }))
            setPendingSecretRemoval(null)
          }}
          onClose={() => setPendingSecretRemoval(null)}
        />
      )}
    </div>
  )
}

function ConnectorSettingsSkeleton({ compact, label }: { compact: boolean; label: string }) {
  const rows = compact ? 3 : 5
  return (
    <div role="status" aria-label={label} aria-busy="true" className="space-y-4">
      {Array.from({ length: rows }).map((_, index) => (
        <section
          key={index}
          className={`rounded-xl border border-border/70 bg-secondary/15 ${index === 0 ? 'p-4' : 'px-4 py-3.5'}`}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className={`h-3.5 ${index % 2 === 0 ? 'w-36' : 'w-28'}`} />
              <Skeleton className="h-3 w-full max-w-md" />
            </div>
            <Skeleton className="h-6 w-12 rounded-full" />
          </div>
          {index === 0 && <Skeleton className="mt-4 h-14 w-full rounded-lg" />}
        </section>
      ))}
    </div>
  )
}

function ConnectorSectionNav({
  definitions,
  config,
  health,
  adapterHealth,
  t,
}: {
  definitions: ConnectorDefinition[]
  config: PublicConnectorConfig
  health: ConnectorHealth | null
  adapterHealth: Map<string, ConnectorRuntime>
  t: TFunction
}) {
  const navigationRef = useRef<HTMLElement | null>(null)
  const [activeId, setActiveId] = useState<string | null>(definitions[0]?.id ?? null)

  useEffect(() => {
    if (activeId && definitions.some((definition) => definition.id === activeId)) return
    setActiveId(definitions[0]?.id ?? null)
  }, [activeId, definitions])

  useEffect(() => {
    const navigation = navigationRef.current
    const scrollArea = navigation?.closest('[data-settings-scroll-area]')
    if (!(navigation instanceof HTMLElement) || !(scrollArea instanceof HTMLElement)) return

    const syncActiveSection = () => {
      const lastDefinition = definitions.at(-1)
      if (!lastDefinition) return
      const atScrollEnd = scrollArea.scrollTop > 0
        && scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 2
      if (atScrollEnd && scrollArea.scrollHeight > scrollArea.clientHeight) {
        setActiveId((current) => current === lastDefinition.id ? current : lastDefinition.id)
        return
      }

      const scrollAreaTop = scrollArea.getBoundingClientRect().top
      const firstSection = document.getElementById(connectorSectionId(definitions[0].id))
      const sectionScrollMargin = firstSection
        ? Number.parseFloat(window.getComputedStyle(firstSection).scrollMarginTop) || 0
        : 0
      const stickyOffset = window.getComputedStyle(navigation).position === 'sticky'
        ? Math.max(navigation.getBoundingClientRect().height + 16, sectionScrollMargin + 1)
        : 16
      const readingAnchor = scrollAreaTop + stickyOffset
      const sectionPositions = definitions.map((definition) => ({
        id: definition.id,
        top: document.getElementById(connectorSectionId(definition.id))?.getBoundingClientRect().top,
      }))
      const measuredPositions = sectionPositions
        .map(({ top }) => top)
        .filter((top): top is number => top !== undefined)
      if (measuredPositions.length > 1 && measuredPositions.every((top) => top === measuredPositions[0])) {
        setActiveId((current) => current ?? definitions[0]?.id ?? null)
        return
      }
      let nextId = definitions[0]?.id ?? null
      for (const position of sectionPositions) {
        if (position.top === undefined || position.top > readingAnchor) break
        nextId = position.id
      }
      setActiveId((current) => current === nextId ? current : nextId)
    }

    syncActiveSection()
    scrollArea.addEventListener('scroll', syncActiveSection, { passive: true })
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(syncActiveSection)
    resizeObserver?.observe(scrollArea)
    resizeObserver?.observe(navigation)

    return () => {
      scrollArea.removeEventListener('scroll', syncActiveSection)
      resizeObserver?.disconnect()
    }
  }, [definitions])

  return (
    <nav
      ref={navigationRef}
      aria-label={t('connectorSettings.channelNavigation')}
      className="mb-2 rounded-xl border border-border/70 bg-background/95 p-3 shadow-sm backdrop-blur-sm md:sticky md:top-0 md:z-20"
    >
      <div className="mb-2 flex items-center gap-2">
        <ListChecks size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-[12px] font-semibold text-foreground">{t('connectorSettings.channelNavigation')}</p>
        <p className="hidden text-[11.5px] text-muted-foreground sm:block">
          {t('connectorSettings.channelNavigationDescription')}
        </p>
      </div>
      <div
        data-connector-channel-grid
        className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 xl:grid-cols-4"
      >
        {definitions.map((definition) => {
          const adapter = config.adapters[definition.id] ?? emptyAdapter()
          const runtime = adapterHealth.get(definition.id)
          const setup = getConnectorSetupState({
            definition,
            adapter,
            serviceEnabled: config.serviceEnabled,
            serviceStatus: health?.status,
            runtime,
          })
          const badge = setupPresentation(
            setup.stage,
            definition.label,
            `/${setup.linkCommand ?? 'link'}`,
            runtime,
            t,
          ).badge
          const active = activeId === definition.id
          return (
            <button
              key={definition.id}
              type="button"
              aria-current={active ? 'location' : undefined}
              aria-label={t('connectorSettings.channelNavigationAction', {
                name: definition.label,
                status: badge,
              })}
              className={`oa-pressable flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left min-[380px]:min-h-12 min-[380px]:flex-col min-[380px]:items-start min-[380px]:justify-center min-[380px]:gap-1 sm:min-h-10 sm:flex-row sm:items-center sm:justify-between sm:gap-2 ${active
                ? 'border-primary/40 bg-primary/[0.06] ring-1 ring-primary/10'
                : 'border-border/70 bg-secondary/20 hover:border-primary/35 hover:bg-primary/[0.035]'
              }`}
              onClick={() => {
                setActiveId(definition.id)
                focusConnectorSection(definition.id)
              }}
            >
              <span className={`truncate text-[12px] font-medium ${active ? 'text-primary' : 'text-foreground'}`}>
                {definition.label}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${connectorNavBadgeClass(setup.stage)}`}>
                {badge}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function connectorSectionId(id: string): string {
  return `connector-settings-${id}`
}

function focusConnectorSection(id: string): void {
  const target = document.getElementById(connectorSectionId(id))
  if (!target) return
  document.getElementById(`${connectorSectionId(id)}-title`)?.focus({ preventScroll: true })
  target.scrollIntoView?.({ block: 'start' })
}

function connectorNavBadgeClass(stage: ConnectorSetupState['stage']): string {
  switch (stage) {
    case 'linked':
      return 'bg-success/10 text-success'
    case 'error':
      return 'bg-destructive/10 text-destructive'
    case 'ready_to_link':
    case 'starting':
    case 'awaiting_link':
      return 'bg-warning/12 text-warning'
    case 'needs_credentials':
      return 'bg-warning/10 text-warning'
    case 'linked_offline':
      return 'bg-muted text-muted-foreground'
  }
}

function ConnectorAdapterSection({
  definition,
  compact,
  t,
  children,
}: {
  definition: ConnectorDefinition
  compact: boolean
  t: TFunction
  children: ReactNode
}) {
  if (compact) {
    return <section className="py-3 sm:py-4">{children}</section>
  }
  const sectionId = connectorSectionId(definition.id)
  const titleId = `${sectionId}-title`
  return (
    <section
      id={sectionId}
      aria-labelledby={titleId}
      className="scroll-mt-4 md:scroll-mt-[9.5rem] xl:scroll-mt-[7rem]"
    >
      <ConfigSection
        title={definition.label}
        titleId={titleId}
        focusableTitle
        description={t('connectorSettings.adapterDescription', { name: definition.label })}
      >
        {children}
      </ConfigSection>
    </section>
  )
}

function ConnectorPreferences({
  definition,
  adapter,
  onSettingChange,
  t,
}: {
  definition: ConnectorDefinition
  adapter: PublicConnectorConfig['adapters'][string]
  onSettingChange: (key: string, value: string | number | boolean) => void
  t: TFunction
}) {
  const fields = definition.fields.filter((field) => field.group === 'preferences')
  if (fields.length === 0) return null
  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const fieldLabel = t(`connectorSettings.fields.${field.key}`, { defaultValue: field.label })
        const value = adapter.settings[field.key]
        const checked = typeof value === 'boolean' ? value : field.defaultValue !== false
        return (
          <section key={field.key} className="rounded-xl border border-border/70 bg-secondary/10 px-3.5 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-2.5">
                <Send size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <h3 className="text-[12.5px] font-semibold text-foreground">{fieldLabel}</h3>
                  {field.description && (
                    <p className="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">
                      {t(`connectorSettings.fieldDescriptions.${field.key}`, { defaultValue: field.description })}
                    </p>
                  )}
                </div>
              </div>
              <Toggle
                size="sm"
                checked={field.kind === 'boolean' ? checked : Boolean(value)}
                ariaLabel={fieldLabel}
                onChange={(next) => onSettingChange(field.key, next)}
              />
            </div>
          </section>
        )
      })}
    </div>
  )
}

function ConnectorChoiceField({
  id,
  fieldKey,
  label,
  description,
  required,
  options,
  value,
  onChange,
  t,
}: {
  id: string
  fieldKey: string
  label: ReactNode
  description?: string
  required: boolean
  options: NonNullable<ConnectorDefinition['fields'][number]['options']>
  value: string
  onChange: (value: string) => void
  t: TFunction
}) {
  const descriptionId = description ? `${id}-description` : undefined
  return (
    <fieldset className="mb-3.5 last:mb-0" aria-describedby={descriptionId}>
      <legend className="mb-1.5 text-[13px] font-medium text-foreground">{label}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`
          const selected = value === option.value
          const optionLabel = t(`connectorSettings.fieldOptions.${fieldKey}.${option.value}.label`, {
            defaultValue: option.label,
          })
          const optionDescription = option.description
            ? t(`connectorSettings.fieldOptions.${fieldKey}.${option.value}.description`, {
                defaultValue: option.description,
              })
            : undefined
          return (
            <label key={option.value} className="relative min-w-0">
              <input
                id={optionId}
                type="radio"
                name={id}
                value={option.value}
                checked={selected}
                required={required}
                className="peer sr-only"
                aria-label={optionLabel}
                onChange={(event) => {
                  if (event.target.checked) onChange(option.value)
                }}
              />
              <span className={`oa-pressable flex min-h-14 items-center gap-2.5 rounded-lg border px-3 py-2 text-left peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-primary/45 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background ${
                selected
                  ? 'border-primary/45 bg-primary/[0.07] text-foreground'
                  : 'border-border bg-background/60 text-foreground hover:border-primary/25 hover:bg-secondary/35'
              }`}>
                <span
                  className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? 'border-primary' : 'border-muted-foreground/45'
                  }`}
                  aria-hidden
                >
                  <span className={`size-2 rounded-full ${selected ? 'bg-primary' : 'bg-transparent'}`} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold">{optionLabel}</span>
                  {optionDescription && (
                    <span className="mt-0.5 block break-words text-[10.5px] leading-4 text-muted-foreground">
                      {optionDescription}
                    </span>
                  )}
                </span>
              </span>
            </label>
          )
        })}
      </div>
      {description && (
        <p id={descriptionId} className="mt-1 text-[12px] text-muted-foreground/60">
          {description}
        </p>
      )}
    </fieldset>
  )
}

function ConnectorCredentialsEditor({
  definition,
  adapter,
  ready,
  linked,
  open,
  savingSecret,
  secretDrafts,
  secretErrors,
  onToggle,
  onSettingChange,
  onSecretDraftChange,
  onSaveConnection,
  onReplaceSecret,
  onRemoveSecret,
  onUnlink,
  t,
}: {
  definition: ConnectorDefinition
  adapter: PublicConnectorConfig['adapters'][string]
  ready: boolean
  linked: boolean
  open: boolean
  savingSecret: string | null
  secretDrafts: Record<string, string>
  secretErrors: Record<string, string>
  onToggle: () => void
  onSettingChange: (key: string, value: string | number | boolean) => void
  onSecretDraftChange: (draftKey: string, value: string) => void
  onSaveConnection: (keys: string[]) => void
  onReplaceSecret: (key: string, fieldLabel: string) => void
  onRemoveSecret: (fieldKey: string, fieldLabel: string) => void
  onUnlink: () => void
  t: TFunction
}) {
  const credentialsId = `connector-${definition.id}-credentials`
  const [maskedSecrets, setMaskedSecrets] = useState<Record<string, boolean>>({})
  const credentialFields = definition.fields.filter((field) => !field.learnedBy && field.group !== 'preferences')
  const missingSecretFields = credentialFields.filter(
    (field) => field.kind === 'secret' && !adapter.configuredSecrets.includes(field.key),
  )
  const enteredMissingSecretKeys = missingSecretFields
    .filter((field) => (secretDrafts[connectorFieldKey(definition.id, field.key)] ?? '').length > 0)
    .map((field) => field.key)
  const fieldHasValue = (field: ConnectorDefinition['fields'][number]) => {
    if (field.kind === 'secret') {
      return adapter.configuredSecrets.includes(field.key)
        || (secretDrafts[connectorFieldKey(definition.id, field.key)] ?? '').length > 0
    }
    return isConnectorSettingPresent(adapter.settings[field.key] ?? field.defaultValue)
  }
  const missingRequiredFields = credentialFields.filter((field) => field.required && !fieldHasValue(field))
  const requiredConnectionComplete = missingRequiredFields.length === 0
  const missingRequiredLabels = missingRequiredFields.map((field) => (
    t(`connectorSettings.fields.${field.key}`, { defaultValue: field.label })
  ))
  const connectionSavingKey = connectorFieldKey(definition.id, '__connection__')
  const connectionSaving = savingSecret === connectionSavingKey
  const connectionError = secretErrors[connectionSavingKey]
  const connectionHintId = `${credentialsId}-save-hint`
  const connectionHint = missingRequiredLabels.length > 0
    ? t('connectorSettings.missingConnectionFields', { fields: missingRequiredLabels.join(' · ') })
    : enteredMissingSecretKeys.length === 0
      ? t('connectorSettings.enterCredentialToSave')
      : t('connectorSettings.saveConnectionHint')
  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-secondary/10">
      <button
        type="button"
        aria-label={t(open
          ? 'connectorSettings.hideConnectionDetailsAria'
          : 'connectorSettings.manageConnectionDetailsAria', { name: definition.label })}
        aria-expanded={open}
        aria-controls={credentialsId}
        onClick={onToggle}
        className="oa-pressable flex min-h-12 w-full items-center justify-between gap-3 px-3.5 py-3 text-left hover:bg-secondary/35"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <KeyRound size={15} className="shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-[12px] font-medium text-foreground">{t('connectorSettings.connectionDetails')}</span>
          <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-medium ${
            ready ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
          }`}>
            {ready ? t('connectorSettings.saved') : t('connectorSettings.required')}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground" aria-hidden>
          {open ? t('connectorSettings.hide') : t('connectorSettings.manage')}
          <ChevronDown
            size={14}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>
      <div
        id={credentialsId}
        hidden={!open}
        inert={!open ? true : undefined}
        className="oa-disclosure-enter border-t border-border/60 px-3.5 pb-4 pt-3"
      >
        {!ready && <ConnectorSetupGuide definition={definition} t={t} />}
        <p className="mb-4 text-[11.5px] leading-5 text-muted-foreground">
          {t('connectorSettings.secretsNote')}
        </p>
        {credentialFields.map((field) => {
          const configured = adapter.configuredSecrets.includes(field.key)
          const value = adapter.settings[field.key]
          const draftKey = connectorFieldKey(definition.id, field.key)
          const secretDraft = secretDrafts[draftKey] ?? ''
          const secretSaving = savingSecret === draftKey
          const secretMasked = maskedSecrets[draftKey] ?? true
          const secretError = secretErrors[draftKey]
          const inputId = `connector-${definition.id}-${field.key}`
          const inputErrorId = `${inputId}-error`
          const fieldLabel = t(`connectorSettings.fields.${field.key}`, { defaultValue: field.label })
          const fieldDescription = field.description
            ? t(`connectorSettings.fieldDescriptions.${field.key}`, { defaultValue: field.description })
            : undefined
          const fieldMissing = missingRequiredFields.some((missingField) => missingField.key === field.key)
          const fieldLabelContent = fieldMissing ? (
            <span className="flex items-center gap-1.5">
              <span>{fieldLabel}</span>
              <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[9.5px] font-medium leading-none text-warning">
                {t('connectorSettings.required')}
              </span>
            </span>
          ) : fieldLabel
          if (field.options && field.options.length > 0) {
            return (
              <ConnectorChoiceField
                key={field.key}
                id={inputId}
                fieldKey={field.key}
                label={fieldLabelContent}
                description={fieldDescription}
                required={fieldMissing}
                options={field.options}
                value={String(value ?? field.defaultValue ?? '')}
                onChange={(next) => onSettingChange(field.key, next)}
                t={t}
              />
            )
          }
          return (
            <Field
              key={field.key}
              label={fieldLabelContent}
              description={fieldDescription}
              controlId={inputId}
            >
              {field.kind === 'boolean' ? (
                <input
                  id={inputId}
                  aria-label={`${definition.label} ${fieldLabel}`}
                  type="checkbox"
                  required={fieldMissing}
                  checked={value === true}
                  onChange={(event) => onSettingChange(field.key, event.target.checked)}
                />
              ) : field.kind === 'secret' ? (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative min-w-0 flex-1">
                      <input
                        id={inputId}
                        aria-label={`${definition.label} ${fieldLabel}`}
                        aria-invalid={secretError ? true : undefined}
                        aria-describedby={secretError ? inputErrorId : undefined}
                        className={`${inputClass} min-h-10 pr-10 ${secretError ? '!border-destructive/60 focus:!border-destructive' : ''}`}
                        type={secretMasked ? 'password' : 'text'}
                        required={fieldMissing}
                        value={secretDraft}
                        placeholder={configured
                          ? t('connectorSettings.configuredPlaceholder')
                          : t(`connectorSettings.placeholders.${field.key}`, { defaultValue: field.placeholder ?? '' })}
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        onChange={(event) => onSecretDraftChange(draftKey, event.target.value)}
                      />
                      <button
                        type="button"
                        className="oa-pressable absolute inset-y-0 right-0 flex min-w-10 items-center justify-center px-2.5 text-muted-foreground hover:text-foreground"
                        aria-label={secretMasked
                          ? t('connectorSettings.showDraft')
                          : t('connectorSettings.hideDraft')}
                        aria-pressed={!secretMasked}
                        onClick={() => setMaskedSecrets((current) => ({
                          ...current,
                          [draftKey]: !secretMasked,
                        }))}
                      >
                        {secretMasked
                          ? <Eye size={15} aria-hidden />
                          : <EyeOff size={15} aria-hidden />}
                      </button>
                    </div>
                    {configured && (
                      <>
                        <button
                          type="button"
                          className="oa-pressable inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-border px-3 py-2 text-[12px] text-foreground hover:border-primary/50 disabled:opacity-50"
                          disabled={!secretDraft || savingSecret !== null}
                          onClick={() => onReplaceSecret(field.key, fieldLabel)}
                        >
                          {secretSaving ? t('connectorSettings.saving') : t('connectorSettings.replaceToken')}
                        </button>
                        <button
                          type="button"
                          className="oa-pressable inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground hover:text-destructive"
                          disabled={savingSecret !== null}
                          onClick={() => onRemoveSecret(field.key, fieldLabel)}
                        >
                          {t('connectorSettings.removeToken')}
                        </button>
                      </>
                    )}
                  </div>
                  {secretError && (
                    <p id={inputErrorId} className="mt-1 text-[12px] leading-5 text-destructive" role="alert">
                      {t('connectorSettings.tokenSaveError', { error: secretError })}
                    </p>
                  )}
                </>
              ) : (
                <input
                  id={inputId}
                  aria-label={`${definition.label} ${fieldLabel}`}
                  className={`${inputClass} min-h-10`}
                  type={field.kind}
                  required={fieldMissing}
                  value={String(value ?? '')}
                  placeholder={t(`connectorSettings.placeholders.${field.key}`, { defaultValue: field.placeholder ?? '' })}
                  autoComplete="off"
                  onChange={(event) => onSettingChange(
                    field.key,
                    field.kind === 'number' ? Number(event.target.value) : event.target.value,
                  )}
                />
              )}
            </Field>
          )
        })}
        {missingSecretFields.length > 0 && (
          <div className="mt-4 border-t border-border/60 pt-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p
                id={connectionHintId}
                className="text-[11.5px] leading-5 text-muted-foreground"
                aria-live="polite"
                aria-atomic="true"
              >
                {connectionHint}
              </p>
              <button
                type="button"
                className="oa-pressable inline-flex min-h-10 w-full shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                disabled={!requiredConnectionComplete || enteredMissingSecretKeys.length === 0 || savingSecret !== null}
                aria-describedby={connectionHintId}
                onClick={() => onSaveConnection(enteredMissingSecretKeys)}
              >
                {connectionSaving
                  ? t('connectorSettings.savingConnection')
                  : t('connectorSettings.saveConnection')}
              </button>
            </div>
            {connectionError && (
              <p className="mt-2 text-[12px] text-destructive" role="alert">
                {t('connectorSettings.connectionSaveError', { error: connectionError })}
              </p>
            )}
          </div>
        )}
        {linked && (
          <div className="mt-4 border-t border-border/60 pt-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[12px] font-medium text-foreground">
                  {t('connectorSettings.linkedAccount')}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">
                  {t('connectorSettings.linkedAccountHint')}
                </p>
              </div>
              <button
                type="button"
                className="oa-pressable inline-flex min-h-10 w-full shrink-0 items-center justify-center rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50 sm:w-auto"
                disabled={savingSecret !== null}
                onClick={onUnlink}
              >
                {t('connectorSettings.unlink')}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function ConnectorSetupGuide({ definition, t }: { definition: ConnectorDefinition; t: TFunction }) {
  const steps = [1, 2, 3]
    .map((step) => t(`connectorSettings.setupGuides.${definition.id}.step${step}`, { defaultValue: '' }))
    .filter((step) => typeof step === 'string' && step.trim().length > 0)

  return (
    <aside className="mb-4 rounded-xl border border-primary/15 bg-primary/[0.045] p-3.5">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ListChecks size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-[12.5px] font-semibold text-foreground">
            {t('connectorSettings.setupGuide.title', { name: definition.label })}
          </h4>
          <p className="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">
            {t(`connectorSettings.setupGuides.${definition.id}.description`, {
              defaultValue: t('connectorSettings.setupGuide.description', { name: definition.label }),
            })}
          </p>
        </div>
      </div>
      {definition.setupLinks && definition.setupLinks.length > 0 && (
        <div data-connector-setup-links className="mt-3 flex flex-wrap gap-2 pl-11">
          {definition.setupLinks.map((link) => {
            const label = t(`connectorSettings.setupGuide.links.${link.key}`, {
              defaultValue: t('connectorSettings.setupGuide.openSetup', { name: definition.label }),
            })
            return (
              <a
                key={link.key}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                aria-label={t('connectorSettings.setupGuide.openSetupAria', { label })}
                className="oa-pressable inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-primary/20 bg-background/65 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:border-primary/40 hover:bg-primary/5"
              >
                {label}
                <ExternalLink size={12} aria-hidden />
              </a>
            )
          })}
        </div>
      )}
      {steps.length > 0 && (
        <ol className="mt-3 space-y-2 pl-11 text-[11.5px] leading-5 text-foreground/90">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-background/70 text-[10px] font-semibold text-primary">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}

function SetupStatePanel({
  definition,
  setup,
  runtime,
  saving,
  testing,
  reconnecting,
  actionFeedback,
  onStart,
  onStop,
  onTest,
  onReconnect,
  t,
}: {
  definition: ConnectorDefinition
  setup: ConnectorSetupState
  runtime?: ConnectorRuntime
  saving: boolean
  testing: string | null
  reconnecting: string | null
  actionFeedback: ConnectorActionFeedback | null
  onStart: () => void
  onStop: () => void
  onTest: () => void
  onReconnect: () => void
  t: TFunction
}) {
  const command = `/${setup.linkCommand ?? 'link'}`
  const presentation = setupPresentation(setup.stage, definition.label, command, runtime, t)
  const Icon = presentation.icon
  const running = setup.stage === 'starting' || setup.stage === 'awaiting_link' || setup.stage === 'linked' || setup.stage === 'error'
  const canRun = setup.stage !== 'needs_credentials'
  const runtimeDiagnostic = runtime?.lastError ?? runtime?.detail

  return (
    <section className={`oa-status-surface rounded-xl border border-l-2 px-3.5 py-3 ${presentation.container}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-2.5">
          <Icon size={17} className={`mt-0.5 shrink-0 ${presentation.iconClass}`} />
          <div aria-live="polite" aria-atomic="true">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-semibold text-foreground">{presentation.title}</p>
              <span className="rounded-full border border-current/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                {presentation.badge}
              </span>
            </div>
            <p className="mt-1 max-w-[620px] text-[12px] leading-5 text-muted-foreground">{presentation.description}</p>
            {setup.stage === 'awaiting_link' && (
              <ol className="mt-3 space-y-1 text-[12px] text-foreground">
                <li>1. {t('connectorSettings.linkStepOpen', { name: definition.label })}</li>
                <li>2. {t('connectorSettings.linkStepSendBefore')} <code className="rounded bg-background px-1.5 py-0.5 font-mono text-primary">{command}</code>.</li>
                <li>3. {t('connectorSettings.linkStepWait')}</li>
              </ol>
            )}
          </div>
        </div>
        {canRun && (
          <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
            <div className="mr-1 flex min-h-10 items-center gap-2">
              <span className="text-[12px] font-medium text-foreground">
                {t('connectorSettings.useConnector', { name: definition.label })}
              </span>
              <Toggle
                id={`connector-${definition.id}-runtime-toggle`}
                size="sm"
                checked={running}
                disabled={saving}
                ariaLabel={t('connectorSettings.useConnectorAria', { name: definition.label })}
                onChange={(checked) => checked ? onStart() : onStop()}
              />
            </div>
            {setup.stage === 'error' && (
              <button
                type="button"
                className="oa-pressable inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12px] text-foreground hover:border-primary/50 disabled:opacity-50"
                disabled={reconnecting === definition.id || saving}
                onClick={onReconnect}
              >
                <RefreshCw size={14} className={reconnecting === definition.id ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden />
                {reconnecting === definition.id
                  ? t('connectorStatus.reconnecting')
                  : t('connectorStatus.reconnect')}
              </button>
            )}
            {setup.stage === 'linked' && runtime?.status === 'healthy' && (
            <button
              type="button"
              className="oa-pressable inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12px] text-foreground hover:border-primary/50 disabled:opacity-50"
              disabled={testing !== null}
              onClick={onTest}
            >
              <Send size={14} />
              {testing === definition.id
                ? t('connectorSettings.sending')
                : t('connectorSettings.sendTest')}
            </button>
            )}
          </div>
        )}
      </div>
      {setup.stage === 'error'
        && runtimeDiagnostic
        && runtimeDiagnostic !== 'Adapter is configured but not running.' && (
        <ConnectorDiagnosticDetails summary={t('connectorStatus.technicalDetails')}>
          <span>{runtimeDiagnostic}</span>
          {runtime?.nextAttemptAt && (
            <span className="mt-1 block text-muted-foreground">
              {t('connectorStatus.nextRetryAt', {
                time: formatConnectorDate(runtime.nextAttemptAt),
                count: runtime.consecutiveFailures ?? 1,
              })}
            </span>
          )}
        </ConnectorDiagnosticDetails>
      )}
      {testing === definition.id && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mt-3 flex items-start gap-2 border-t border-current/10 pt-3 text-[12px] text-muted-foreground"
        >
          <RefreshCw size={14} className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
          <span>{t('connectorSettings.testSendingFeedback', { name: definition.label })}</span>
        </div>
      )}
      {testing !== definition.id && actionFeedback?.status === 'success' && (
        <div className="mt-3 border-t border-current/10 pt-3 text-[12px]">
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="flex items-start gap-2 text-success"
          >
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>{t('connectorSettings.testSent', { name: definition.label })}</span>
          </div>
          <details data-connector-test-details className="group/details mt-1 pl-5 text-[11.5px] text-muted-foreground">
            <summary className="oa-pressable flex min-h-10 w-fit cursor-pointer list-none items-center gap-2 font-medium hover:text-foreground">
              <ListChecks size={13} aria-hidden />
              {t('connectorSettings.testDetails')}
            </summary>
            <div className="mb-1 break-words pl-5 leading-5">
              {t('connectorSettings.deliveryReference')}{' '}
              <code className="break-all font-mono text-foreground/80">{actionFeedback.probeId}</code>
            </div>
          </details>
        </div>
      )}
      {testing !== definition.id && actionFeedback?.status === 'error' && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 border-t border-current/10 pt-3 text-[12px] text-destructive"
        >
          <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {actionFeedback.action === 'test'
              ? t('connectorSettings.testFailed', { error: actionFeedback.message })
              : t('connectorSettings.reconnectFailed', { name: definition.label, error: actionFeedback.message })}
          </span>
        </div>
      )}
    </section>
  )
}

function setupPresentation(
  stage: ConnectorSetupState['stage'],
  label: string,
  command: string,
  runtime: ConnectorRuntime | undefined,
  t: TFunction,
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
        title: t('connectorSettings.stage.needsCredentials.title'),
        badge: t('connectorSettings.stage.needsCredentials.badge'),
        description: t('connectorSettings.stage.needsCredentials.description', { name: label }),
        icon: Bot,
        iconClass: 'text-muted-foreground',
        container: 'border-border/80 bg-secondary/20',
      }
    case 'ready_to_link':
      return {
        title: t('connectorSettings.stage.readyToLink.title'),
        badge: t('connectorSettings.stage.readyToLink.badge'),
        description: t('connectorSettings.stage.readyToLink.description', { name: label, command }),
        icon: Link2,
        iconClass: 'text-primary',
        container: 'border-primary/35 bg-primary/[0.035]',
      }
    case 'starting':
      return {
        title: t('connectorSettings.stage.starting.title'),
        badge: t('connectorSettings.stage.starting.badge'),
        description: t('connectorSettings.stage.starting.description', { name: label, command }),
        icon: Power,
        iconClass: 'text-warning',
        container: 'border-warning/35 bg-warning/[0.035]',
      }
    case 'awaiting_link':
      return {
        title: t('connectorSettings.stage.awaitingLink.title'),
        badge: t('connectorSettings.stage.awaitingLink.badge'),
        description: t('connectorSettings.stage.awaitingLink.description', { name: label }),
        icon: Link2,
        iconClass: 'text-warning',
        container: 'border-warning/40 bg-warning/[0.035]',
      }
    case 'linked':
      return {
        title: t('connectorSettings.stage.linked.title'),
        badge: t('connectorSettings.stage.linked.badge'),
        description: t('connectorSettings.stage.linked.description', { name: label }),
        icon: CheckCircle2,
        iconClass: 'text-success',
        container: 'border-success/35 bg-success/[0.035]',
      }
    case 'linked_offline':
      return {
        title: t('connectorSettings.stage.linkedOffline.title'),
        badge: t('connectorSettings.stage.linkedOffline.badge'),
        description: t('connectorSettings.stage.linkedOffline.description', { name: label }),
        icon: Power,
        iconClass: 'text-muted-foreground',
        container: 'border-border/80 bg-secondary/20',
      }
    case 'error':
      return {
        title: t('connectorSettings.stage.error.title'),
        badge: t('connectorSettings.stage.error.badge'),
        description: runtimeErrorDescription(runtime, label, t),
        icon: CircleAlert,
        iconClass: 'text-destructive',
        container: 'border-destructive/40 bg-destructive/[0.035]',
      }
  }
}

function runtimeErrorDescription(
  runtime: ConnectorRuntime | undefined,
  label: string,
  t: TFunction,
): string {
  const detail = runtime?.lastError ?? runtime?.detail
  if (detail === 'Adapter is configured but not running.') {
    return t('connectorSettings.stage.error.configuredNotRunning', { name: label })
  }
  return t('connectorSettings.stage.error.description', { name: label })
}

function formatConnectorDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function HealthBadge({ health, t }: { health: ConnectorHealth | null; t: TFunction }) {
  const state = getConnectorServiceState(health)
  if (state === 'stopped') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <ShieldCheck size={12} aria-hidden />
        {t('connectorSettings.serviceStopped')}
      </span>
    )
  }
  if (state === 'healthy') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-success">
        <ShieldCheck size={12} aria-hidden />
        {t('connectorSettings.serviceOnline')}
      </span>
    )
  }
  if (state === 'running') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-warning/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-warning"
        title={t('connectorStatus.service.runningDescription')}
      >
        <CircleAlert size={12} aria-hidden />
        {t('connectorStatus.service.running')}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-destructive"
      title={t('connectorSettings.serviceUnavailableDescription')}
    >
      <CircleAlert size={12} aria-hidden />
      {t('connectorSettings.serviceUnavailable')}
    </span>
  )
}

function emptyAdapter(): PublicConnectorConfig['adapters'][string] {
  return { enabled: false, settings: {}, configuredSecrets: [] }
}

function isPlausibleConnectorSecret(value: string): boolean {
  const next = value.trim()
  return next.length >= MIN_CONNECTOR_SECRET_LENGTH && !/\s/.test(next)
}

function adapterMutation(
  definition: ConnectorDefinition,
  saved: PublicConnectorConfig['adapters'][string],
  next: PublicConnectorConfig['adapters'][string],
): ConnectorAdapterMutation | null {
  const mutation: ConnectorAdapterMutation = {}
  if (saved.enabled !== next.enabled) mutation.enabled = next.enabled
  const set: Record<string, string | number | boolean> = {}
  const unset: string[] = []
  for (const field of definition.fields) {
    if (field.kind === 'secret') continue
    const before = saved.settings[field.key]
    const after = next.settings[field.key]
    if (before === after) continue
    if (after === undefined || (field.learnedBy && typeof after === 'string' && after.trim() === '')) {
      unset.push(field.key)
    } else {
      set[field.key] = after
    }
  }
  if (Object.keys(set).length > 0) mutation.set = set
  if (unset.length > 0) mutation.unset = unset
  const removeSecrets = saved.configuredSecrets.filter((key) => !next.configuredSecrets.includes(key))
  if (removeSecrets.length > 0) mutation.removeSecrets = removeSecrets
  return Object.keys(mutation).length > 0 ? mutation : null
}

function connectorFieldKey(connectorId: string, fieldKey: string): string {
  return `${connectorId}:${fieldKey}`
}

function omitRecordKey(record: Record<string, string>, key: string): Record<string, string> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function omitRecordKeys(record: Record<string, string>, keys: string[]): Record<string, string> {
  return keys.reduce((current, key) => omitRecordKey(current, key), record)
}

function isConnectorSettingPresent(value: string | number | boolean | undefined): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value !== undefined
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
