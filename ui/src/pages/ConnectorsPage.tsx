import { useCallback, useEffect, useMemo, useState, type MutableRefObject, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { Bot, CheckCircle2, ChevronDown, CircleAlert, ExternalLink, Eye, EyeOff, KeyRound, Link2, ListChecks, Power, RefreshCw, Send, ShieldCheck, Unlink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api, type ConnectorDefinition, type ConnectorHealth, type PublicConnectorConfig } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PageHeader } from '../components/PageHeader'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, SettingsScrollArea, inputClass } from '../components/form'
import { useAutoSave } from '../hooks/useAutoSave'
import { TelegramDeskPanel } from '../components/TelegramDeskPanel'
import { Toggle } from '../components/Toggle'
import {
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

export function ConnectorsPage() {
  return <ConnectorSettingsSurface />
}

export function ConnectorSettingsPanel({
  connectorId,
  flushRef,
}: {
  connectorId: string
  flushRef?: MutableRefObject<(() => void) | null>
}) {
  return <ConnectorSettingsSurface connectorId={connectorId} flushRef={flushRef} />
}

function ConnectorSettingsSurface({
  connectorId,
  flushRef,
}: {
  connectorId?: string
  flushRef?: MutableRefObject<(() => void) | null>
}) {
  const { t } = useTranslation()
  const [definitions, setDefinitions] = useState<ConnectorDefinition[]>([])
  const [config, setConfig] = useState<PublicConnectorConfig | null>(null)
  const [health, setHealth] = useState<ConnectorHealth | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({})
  const [savingSecret, setSavingSecret] = useState<string | null>(null)
  const [secretErrors, setSecretErrors] = useState<Record<string, string>>({})
  const [pendingSecretRemoval, setPendingSecretRemoval] = useState<PendingSecretRemoval | null>(null)
  const [pendingSecretReplace, setPendingSecretReplace] = useState<PendingSecretReplace | null>(null)
  const [pendingUnlink, setPendingUnlink] = useState<PendingUnlink | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [lastProbe, setLastProbe] = useState<{ connectorId: string; probeId: string } | null>(null)
  const [credentialEditors, setCredentialEditors] = useState<Record<string, boolean>>({})

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
    const response = await api.connectors.save(omitSecretSettings(next, definitions))
    setConfig((current) => JSON.stringify(current) === JSON.stringify(response.config) ? current : response.config)
    window.setTimeout(() => { void refreshRuntime() }, 900)
    window.setTimeout(() => { void refreshRuntime() }, 2_400)
  }, [definitions, refreshRuntime])

  const { status, flush, retry } = useAutoSave({
    data: config!,
    save,
    enabled: config !== null,
    delay: 700,
  })

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

  const saveSecret = useCallback(async (id: string, key: string) => {
    if (!config) return
    const draftKey = connectorFieldKey(id, key)
    const value = secretDrafts[draftKey] ?? ''
    if (!value) return

    if (!isPlausibleConnectorSecret(value)) {
      setSecretErrors((current) => ({
        ...current,
        [draftKey]: t('connectorSettings.tokenTooShort'),
      }))
      return
    }

    const existing = config.adapters[id] ?? emptyAdapter()
    const next: PublicConnectorConfig = {
      ...config,
      adapters: {
        ...config.adapters,
        [id]: {
          ...existing,
          settings: { ...existing.settings, [key]: value },
          configuredSecrets: [...new Set([...existing.configuredSecrets, key])],
        },
      },
    }

    setSavingSecret(draftKey)
    setSecretErrors((current) => omitRecordKey(current, draftKey))
    try {
      const response = await api.connectors.save(next)
      setConfig((current) => {
        if (!current) return response.config
        const currentAdapter = current.adapters[id] ?? emptyAdapter()
        const savedAdapter = response.config.adapters[id]
        if (!savedAdapter) return current
        const configuredSecrets = savedAdapter.configuredSecrets
        if (sameStrings(currentAdapter.configuredSecrets, configuredSecrets)) return current
        return {
          ...current,
          adapters: {
            ...current.adapters,
            [id]: { ...currentAdapter, configuredSecrets },
          },
        }
      })
      setSecretDrafts((current) => omitRecordKey(current, draftKey))
      window.setTimeout(() => { void refreshRuntime() }, 900)
      window.setTimeout(() => { void refreshRuntime() }, 2_400)
    } catch (error) {
      setSecretErrors((current) => ({
        ...current,
        [draftKey]: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setSavingSecret((current) => current === draftKey ? null : current)
    }
  }, [config, refreshRuntime, secretDrafts, t])

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

  const reconnect = useCallback(async (id: string) => {
    setReconnecting(id)
    setTestError(null)
    try {
      await api.connectors.reconnect(id)
      await refreshRuntime()
    } catch (error) {
      setTestError(error instanceof Error ? error.message : String(error))
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
        className={adapterOnly ? 'px-4 py-3 sm:px-6 sm:py-4' : 'px-4 py-5 md:px-8'}
      >
        <div className="max-w-[920px] mx-auto">
          {adapterOnly && status !== 'idle' && (
            <div className="sticky top-2 z-10 flex h-0 justify-end pr-1">
              <div className="rounded-full border border-border/70 bg-popover px-2.5 py-1 shadow-sm">
                <SaveIndicator status={status} onRetry={retry} />
              </div>
            </div>
          )}
          {config && (
            <>
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
                      <SetupStatePanel
                        definition={definition}
                        setup={setup}
                        runtime={runtime}
                        saving={status === 'saving'}
                        testing={testing}
                        reconnecting={reconnecting}
                        onStart={() => startAdapter(definition.id)}
                        onStop={() => updateAdapter(definition.id, { enabled: false })}
                        onUnlink={() => setPendingUnlink({
                          connectorId: definition.id,
                          connectorLabel: definition.label,
                        })}
                        onTest={() => void test(definition.id)}
                        onReconnect={() => void reconnect(definition.id)}
                        t={t}
                      />

                      <ConnectorCredentialsEditor
                        definition={definition}
                        adapter={adapter}
                        ready={setup.ready}
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
                        onSaveSecret={(key, fieldLabel, configured) => {
                          const draftKey = connectorFieldKey(definition.id, key)
                          if (!isPlausibleConnectorSecret(secretDrafts[draftKey] ?? '')) {
                            setSecretErrors((current) => ({
                              ...current,
                              [draftKey]: t('connectorSettings.tokenTooShort'),
                            }))
                            return
                          }
                          if (configured) {
                            setPendingSecretReplace({
                              connectorId: definition.id,
                              connectorLabel: definition.label,
                              fieldKey: key,
                              fieldLabel,
                            })
                            return
                          }
                          void saveSecret(definition.id, key)
                        }}
                        onRemoveSecret={(fieldKey, fieldLabel) => setPendingSecretRemoval({
                          connectorId: definition.id,
                          connectorLabel: definition.label,
                          fieldKey,
                          fieldLabel,
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
                        />
                      )}

                      {lastProbe?.connectorId === definition.id && (
                        <p className="text-[12px] text-success">
                          {t('connectorSettings.probeSentBefore')}{' '}
                          <code>{lastProbe.probeId}</code>.{' '}
                          {t('connectorSettings.probeSentAfter')}
                        </p>
                      )}
                    </div>
                  </ConnectorAdapterSection>
                )
              })}
            </>
          )}
          {testError && <p className="mt-4 text-[13px] text-destructive">{testError}</p>}
          {loadError && <p className="text-[13px] text-destructive">{t('connectorSettings.loadError')}</p>}
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
            await saveSecret(pendingSecretReplace.connectorId, pendingSecretReplace.fieldKey)
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
  return (
    <ConfigSection
      title={definition.label}
      description={t('connectorSettings.adapterDescription', { name: definition.label })}
    >
      {children}
    </ConfigSection>
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

function ConnectorCredentialsEditor({
  definition,
  adapter,
  ready,
  open,
  savingSecret,
  secretDrafts,
  secretErrors,
  onToggle,
  onSettingChange,
  onSecretDraftChange,
  onSaveSecret,
  onRemoveSecret,
  t,
}: {
  definition: ConnectorDefinition
  adapter: PublicConnectorConfig['adapters'][string]
  ready: boolean
  open: boolean
  savingSecret: string | null
  secretDrafts: Record<string, string>
  secretErrors: Record<string, string>
  onToggle: () => void
  onSettingChange: (key: string, value: string | number | boolean) => void
  onSecretDraftChange: (draftKey: string, value: string) => void
  onSaveSecret: (key: string, fieldLabel: string, configured: boolean) => void
  onRemoveSecret: (fieldKey: string, fieldLabel: string) => void
  t: TFunction
}) {
  const credentialsId = `connector-${definition.id}-credentials`
  const [maskedSecrets, setMaskedSecrets] = useState<Record<string, boolean>>({})
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
        {definition.fields.filter((field) => !field.learnedBy && field.group !== 'preferences').map((field) => {
          const configured = adapter.configuredSecrets.includes(field.key)
          const value = adapter.settings[field.key]
          const draftKey = connectorFieldKey(definition.id, field.key)
          const secretDraft = secretDrafts[draftKey] ?? ''
          const secretSaving = savingSecret === draftKey
          const secretMasked = maskedSecrets[draftKey] ?? true
          const inputId = `connector-${definition.id}-${field.key}`
          const fieldLabel = t(`connectorSettings.fields.${field.key}`, { defaultValue: field.label })
          return (
            <Field
              key={field.key}
              label={fieldLabel}
              description={field.description}
              controlId={inputId}
            >
              {field.kind === 'boolean' ? (
                <input
                  id={inputId}
                  aria-label={`${definition.label} ${fieldLabel}`}
                  type="checkbox"
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
                        className={`${inputClass} pr-10`}
                        type={secretMasked ? 'password' : 'text'}
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
                        className="oa-pressable absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
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
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-border px-3 py-2 text-[12px] text-foreground hover:border-primary/50 disabled:opacity-50"
                      disabled={!secretDraft || secretSaving}
                      onClick={() => onSaveSecret(field.key, fieldLabel, configured)}
                    >
                      {secretSaving
                        ? t('connectorSettings.saving')
                        : configured
                          ? t('connectorSettings.replaceToken')
                          : t('connectorSettings.saveToken')}
                    </button>
                    {configured && (
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground hover:text-destructive"
                        disabled={secretSaving}
                        onClick={() => onRemoveSecret(field.key, fieldLabel)}
                      >
                        {t('connectorSettings.removeToken')}
                      </button>
                    )}
                  </div>
                  {secretErrors[draftKey] && (
                    <p className="mt-1 text-[12px] text-destructive" role="alert">
                      {t('connectorSettings.tokenSaveError', { error: secretErrors[draftKey] })}
                    </p>
                  )}
                </>
              ) : (
                <input
                  id={inputId}
                  aria-label={`${definition.label} ${fieldLabel}`}
                  className={inputClass}
                  type={field.kind}
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
      {definition.setupLinks && definition.setupLinks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 pl-11">
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
                className="oa-pressable inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-background/65 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:border-primary/40 hover:bg-primary/5"
              >
                {label}
                <ExternalLink size={12} aria-hidden />
              </a>
            )
          })}
        </div>
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
  onStart,
  onStop,
  onUnlink,
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
  onStart: () => void
  onStop: () => void
  onUnlink: () => void
  onTest: () => void
  onReconnect: () => void
  t: TFunction
}) {
  const command = `/${setup.linkCommand ?? 'link'}`
  const presentation = setupPresentation(setup.stage, definition.label, command, runtime, t)
  const Icon = presentation.icon
  const running = setup.stage === 'starting' || setup.stage === 'awaiting_link' || setup.stage === 'linked' || setup.stage === 'error'
  const canRun = setup.stage !== 'needs_credentials'

  return (
    <section className={`oa-status-surface rounded-xl border border-l-2 px-3.5 py-3 ${presentation.container}`} aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-2.5">
          <Icon size={17} className={`mt-0.5 shrink-0 ${presentation.iconClass}`} />
          <div>
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
            <div className="mr-1 flex min-h-10 items-center gap-2 rounded-lg border border-border/70 bg-background/60 px-3">
              <span className="text-[12px] font-medium text-foreground">
                {t('connectorSettings.runConnector', { name: definition.label })}
              </span>
              <Toggle
                size="sm"
                checked={running}
                disabled={saving}
                ariaLabel={t('connectorSettings.runConnectorAria', { name: definition.label })}
                onChange={(checked) => checked ? onStart() : onStop()}
              />
            </div>
            {setup.stage === 'error' && (
              <button
                type="button"
                className="oa-pressable inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12px] text-foreground hover:border-primary/50 disabled:opacity-50"
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
              className="oa-pressable inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12px] text-foreground hover:border-primary/50 disabled:opacity-50"
              disabled={testing !== null}
              onClick={onTest}
            >
              <Send size={14} />
              {testing === definition.id
                ? t('connectorSettings.sending')
                : t('connectorSettings.sendTest')}
            </button>
            )}
            {setup.linked && (
            <button
              type="button"
              className="oa-pressable inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={saving}
              onClick={onUnlink}
            >
              <Unlink size={14} />
              {t('connectorSettings.unlink')}
            </button>
            )}
          </div>
        )}
      </div>
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
  return detail ?? t('connectorSettings.stage.error.description', { name: label })
}

function HealthBadge({ health, t }: { health: ConnectorHealth | null; t: TFunction }) {
  if (!health || health.status === 'disabled') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <ShieldCheck size={12} aria-hidden />
        {t('connectorSettings.serviceStopped')}
      </span>
    )
  }
  if (health.status === 'healthy') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-success">
        <ShieldCheck size={12} aria-hidden />
        {t('connectorSettings.serviceOnline')}
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

function omitSecretSettings(
  config: PublicConnectorConfig,
  definitions: ConnectorDefinition[],
): PublicConnectorConfig {
  const secretKeys = new Map(definitions.map((definition) => [
    definition.id,
    new Set(definition.fields.filter((field) => field.kind === 'secret').map((field) => field.key)),
  ]))
  return {
    ...config,
    adapters: Object.fromEntries(Object.entries(config.adapters).map(([id, adapter]) => {
      const secrets = secretKeys.get(id) ?? new Set<string>()
      return [id, {
        ...adapter,
        // Empty secret values stay: they are the explicit "remove token" signal.
        settings: Object.fromEntries(
          Object.entries(adapter.settings).filter(([key, value]) => !secrets.has(key) || value === ''),
        ),
      }]
    })),
  }
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

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
