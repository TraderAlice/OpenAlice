import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import { Bot, CheckCircle2, ChevronDown, CircleAlert, KeyRound, Link2, Power, Send, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api, type ConnectorDefinition, type ConnectorHealth, type PublicConnectorConfig } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PageHeader } from '../components/PageHeader'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, SettingsScrollArea, inputClass } from '../components/form'
import { useAutoSave } from '../hooks/useAutoSave'
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

export function ConnectorsPage() {
  const { t } = useTranslation()
  const [definitions, setDefinitions] = useState<ConnectorDefinition[]>([])
  const [config, setConfig] = useState<PublicConnectorConfig | null>(null)
  const [health, setHealth] = useState<ConnectorHealth | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({})
  const [savingSecret, setSavingSecret] = useState<string | null>(null)
  const [secretErrors, setSecretErrors] = useState<Record<string, string>>({})
  const [pendingSecretRemoval, setPendingSecretRemoval] = useState<PendingSecretRemoval | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
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

  const saveSecret = useCallback(async (id: string, key: string) => {
    if (!config) return
    const draftKey = connectorFieldKey(id, key)
    const value = secretDrafts[draftKey] ?? ''
    if (!value) return

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
  }, [config, refreshRuntime, secretDrafts])

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
        title={t('connectorSettings.title')}
        description={t('connectorSettings.description')}
        right={<SaveIndicator status={status} onRetry={retry} />}
      />

      <SettingsScrollArea className="px-4 py-5 md:px-8">
        <div className="max-w-[920px] mx-auto">
          {config && (
            <>
              <ConfigSection
                title={t('connectorStatus.serviceTitle')}
                description={t('connectorSettings.serviceDescription')}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-l-2 border-border/80 bg-secondary/20 px-3 py-2.5">
                  <label className="flex min-w-0 flex-1 items-start gap-3">
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={config.serviceEnabled}
                      onChange={(event) => setConfig({ ...config, serviceEnabled: event.target.checked })}
                    />
                    <span>
                      <span className="block text-[13px] font-medium text-foreground">{t('connectorSettings.runService')}</span>
                      <span className="mt-0.5 block text-[12px] leading-5 text-muted-foreground/70">{t('connectorSettings.runServiceDescription')}</span>
                    </span>
                  </label>
                  <HealthBadge health={health} t={t} />
                </div>
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
                const credentialsOpen =
                  credentialEditors[definition.id] ?? setup.stage === 'needs_credentials'
                return (
                  <ConfigSection
                    key={definition.id}
                    title={definition.label}
                    description={t('connectorSettings.adapterDescription', { name: definition.label })}
                  >
                    <div className="space-y-4">
                      <SetupStatePanel
                        definition={definition}
                        setup={setup}
                        runtime={runtime}
                        saving={status === 'saving'}
                        testing={testing}
                        onStart={() => startAdapter(definition.id)}
                        onStop={() => updateAdapter(definition.id, { enabled: false })}
                        onTest={() => void test(definition.id)}
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
                        onSaveSecret={(key) => void saveSecret(definition.id, key)}
                        onRemoveSecret={(fieldKey, fieldLabel) => setPendingSecretRemoval({
                          connectorId: definition.id,
                          connectorLabel: definition.label,
                          fieldKey,
                          fieldLabel,
                        })}
                        t={t}
                      />

                      {lastProbe?.connectorId === definition.id && (
                        <p className="text-[12px] text-success">
                          {t('connectorSettings.probeSentBefore')}{' '}
                          <code>{lastProbe.probeId}</code>.{' '}
                          {t('connectorSettings.probeSentAfter')}
                        </p>
                      )}
                    </div>
                  </ConfigSection>
                )
              })}
            </>
          )}
          {testError && <p className="mt-4 text-[13px] text-destructive">{testError}</p>}
          {loadError && <p className="text-[13px] text-destructive">{t('connectorSettings.loadError')}</p>}
        </div>
      </SettingsScrollArea>

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
  onSaveSecret: (key: string) => void
  onRemoveSecret: (fieldKey: string, fieldLabel: string) => void
  t: TFunction
}) {
  const credentialsId = `connector-${definition.id}-credentials`
  return (
    <div className="border-y border-border/60">
      <button
        type="button"
        aria-label={t(open
          ? 'connectorSettings.hideConnectionDetailsAria'
          : 'connectorSettings.manageConnectionDetailsAria', { name: definition.label })}
        aria-expanded={open}
        aria-controls={credentialsId}
        onClick={onToggle}
        className="oa-pressable flex min-h-11 w-full items-center justify-between gap-3 py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <KeyRound size={15} className="shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-[12px] font-medium text-foreground">{t('connectorSettings.connectionDetails')}</span>
          <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${
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
        className="oa-disclosure-enter pb-4 pt-1"
      >
        <p className="mb-4 text-[11.5px] leading-5 text-muted-foreground">
          {t('connectorSettings.secretsNote')}
        </p>
        {definition.fields.filter((field) => !field.learnedBy).map((field) => {
          const configured = adapter.configuredSecrets.includes(field.key)
          const value = adapter.settings[field.key]
          const draftKey = connectorFieldKey(definition.id, field.key)
          const secretDraft = secretDrafts[draftKey] ?? ''
          const secretSaving = savingSecret === draftKey
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
                    <input
                      id={inputId}
                      aria-label={`${definition.label} ${fieldLabel}`}
                      className={inputClass}
                      type="password"
                      value={secretDraft}
                      placeholder={configured
                        ? t('connectorSettings.configuredPlaceholder')
                        : t(`connectorSettings.placeholders.${field.key}`, { defaultValue: field.placeholder ?? '' })}
                      autoComplete="off"
                      onChange={(event) => onSecretDraftChange(draftKey, event.target.value)}
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-border px-3 py-2 text-[12px] text-foreground hover:border-primary/50 disabled:opacity-50"
                      disabled={!secretDraft || secretSaving}
                      onClick={() => onSaveSecret(field.key)}
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
    </div>
  )
}

function SetupStatePanel({
  definition,
  setup,
  runtime,
  saving,
  testing,
  onStart,
  onStop,
  onTest,
  t,
}: {
  definition: ConnectorDefinition
  setup: ConnectorSetupState
  runtime?: ConnectorRuntime
  saving: boolean
  testing: string | null
  onStart: () => void
  onStop: () => void
  onTest: () => void
  t: TFunction
}) {
  const command = `/${setup.linkCommand ?? 'link'}`
  const presentation = setupPresentation(setup.stage, definition.label, command, runtime, t)
  const Icon = presentation.icon
  const running = setup.stage === 'starting' || setup.stage === 'awaiting_link' || setup.stage === 'linked' || setup.stage === 'error'

  return (
    <div className={`oa-status-surface border-l-2 px-3 py-2.5 ${presentation.container}`} aria-live="polite">
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
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
          {(setup.stage === 'ready_to_link' || setup.stage === 'linked_offline') && (
            <button
              type="button"
              className="oa-pressable inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={saving}
              onClick={onStart}
            >
              <Power size={14} />
              {setup.stage === 'ready_to_link'
                ? t('connectorSettings.startForLinking')
                : t('connectorSettings.startConnector')}
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
          {running && (
            <button
              type="button"
              className="oa-pressable inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={saving}
              onClick={onStop}
            >
              {t('connectorSettings.stop')}
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
        description: runtime?.owner
          ? t('connectorSettings.stage.linked.descriptionWithOwner', { name: label, owner: runtime.owner })
          : t('connectorSettings.stage.linked.description', { name: label }),
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
