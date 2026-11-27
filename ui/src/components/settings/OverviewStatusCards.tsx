import { useEffect, useState } from 'react'
import { ArrowRight, Cpu, Plug } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SegmentedControl } from '../SegmentedControl'
import { ContextHelp } from '../ContextHelp'
import { api, type ConnectorSettingsSnapshot, type UTASummary } from '../../api'
import { useAgentRuntimes } from '../../hooks/useAgentRuntimes'
import { useAliceProject } from '../../hooks/useAliceProject'
import { LOCALE_LABELS, useLocale, useSetLocale } from '../../i18n/useLocale'
import { isNanoProduct } from '../../lib/product-surfaces'
import { connectorWarningCount } from '../../live/connector-health'
import { ensureTradingModePolling, useTradingMode } from '../../live/trading-mode'
import { useWorkspace } from '../../tabs/store'
import { THEME_PALETTES } from '../../theme/palettes'
import { useThemeStore } from '../../theme/store'
import { useEffectivePalette } from '../../theme/useEffectiveTheme'

export function LanguageSection() {
  const { t } = useTranslation()
  const locale = useLocale()
  const setLocale = useSetLocale()
  return (
    <SegmentedControl
      value={locale}
      options={(['en', 'zh', 'ja', 'zh-Hant'] as const).map((value) => ({ value, label: LOCALE_LABELS[value] }))}
      onChange={setLocale}
      ariaLabel={t('settings.language.title')}
    />
  )
}

export function OverviewStatusCards() {
  const { t } = useTranslation()
  const { project } = useAliceProject()
  const hideTrading = isNanoProduct(project?.product)
  const openOrFocus = useWorkspace((s) => s.openOrFocus)

  const { catalog, readiness, loading: runtimesLoading } = useAgentRuntimes()
  const tradingMode = useTradingMode((s) => s.status.mode)

  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const activePalette = useEffectivePalette()
  const activePaletteDefinition = THEME_PALETTES.find((palette) => palette.id === activePalette)
  const activePaletteLabel = activePaletteDefinition
    ? t(activePaletteDefinition.labelKey)
    : activePalette

  const [credentialCount, setCredentialCount] = useState<number | null>(null)
  const [utas, setUtas] = useState<UTASummary[] | null>(null)
  const [connectorSnapshot, setConnectorSnapshot] = useState<ConnectorSettingsSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    if (typeof api.config?.getCredentials === 'function') {
      void api.config.getCredentials()
        .then((res) => {
          if (!cancelled) {
            setCredentialCount(Array.isArray(res?.credentials) ? res.credentials.length : 0)
          }
        })
        .catch(() => {
          if (!cancelled) setCredentialCount(null)
        })
    }
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (hideTrading) return
    ensureTradingModePolling()
    let cancelled = false
    if (typeof api.trading?.listUTASummaries === 'function') {
      void api.trading.listUTASummaries()
        .then((res) => {
          if (!cancelled) {
            setUtas(Array.isArray(res?.utas) ? res.utas : [])
          }
        })
        .catch(() => {
          if (!cancelled) setUtas(null)
        })
    }
    return () => { cancelled = true }
  }, [hideTrading])

  useEffect(() => {
    let cancelled = false
    if (typeof api.connectors?.load === 'function') {
      void api.connectors.load()
        .then((snapshot) => {
          if (!cancelled) setConnectorSnapshot(snapshot ?? null)
        })
        .catch(() => {
          if (!cancelled) setConnectorSnapshot(null)
        })
    }
    return () => { cancelled = true }
  }, [])

  const readyRuntimes = catalog.filter(
    (agent) => readiness?.agents?.[agent.id]?.status === 'ready',
  ).length
  const runtimesReadyKnown = catalog.length > 0 && Boolean(readiness)

  const enabledUtas = utas?.filter((uta) => !uta.health.disabled) ?? []
  const connectedBrokers = enabledUtas.filter((uta) => uta.health.status === 'healthy').length
  const attentionBrokers = enabledUtas.filter((uta) => uta.health.status !== 'healthy').length

  const enabledAdapters = connectorSnapshot?.config.serviceEnabled
    ? connectorSnapshot.definitions.filter(
      (definition) => connectorSnapshot.config.adapters[definition.id]?.enabled,
    )
    : []
  const connectorAttention = connectorSnapshot ? connectorWarningCount(connectorSnapshot) : 0
  const runtimeById = new Map(
    connectorSnapshot?.health.service?.adapters.map((adapter) => [adapter.id, adapter]),
  )
  const connectedConnectors = !connectorSnapshot
    ? 0
    : connectorSnapshot.health.service?.adapters
      ? enabledAdapters.filter((definition) => runtimeById.get(definition.id)?.status === 'healthy').length
      : connectorSnapshot.health.status === 'healthy'
        ? Math.max(0, enabledAdapters.length - connectorAttention)
        : 0

  return (
    <div className="@container space-y-3.5">
      <div
        className={`grid gap-3.5 @[28rem]:grid-cols-2 ${
          hideTrading
            ? '@[42rem]:grid-cols-[1.45fr_1fr]'
            : '@[42rem]:grid-cols-[1.35fr_1.45fr_1fr]'
        }`}
      >
        {!hideTrading && (
          <article className="flex min-w-0 flex-col justify-between gap-3.5 rounded-2xl border border-border/70 bg-card p-4 sm:p-5 @[42rem]:p-4 @[28rem]:col-span-2 @[42rem]:col-span-1">
            <header className="flex items-center justify-between gap-2">
              <h3 className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                {t('settings.overview.tradingCard.title')}
              </h3>
              <button
                type="button"
                onClick={() => openOrFocus({ kind: 'settings', params: { category: 'agent-permissions' } })}
                className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-secondary/50 px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
              >
                {t('settings.overview.tradingCard.currentMode', {
                  mode: t(`settings.agentPermissions.mode.${tradingMode}.label`),
                })}
              </button>
            </header>

            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                  {utas === null ? '—' : connectedBrokers}
                </span>
                {enabledUtas.length > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    / {enabledUtas.length} {t('settings.overview.tradingCard.brokersFractionLabel')}
                  </span>
                )}
              </div>

              {enabledUtas.length > 0 && (
                <div className="flex items-center gap-1" aria-hidden>
                  {enabledUtas.slice(0, 12).map((uta) => (
                    <span
                      key={uta.id}
                      title={`${uta.label}: ${uta.health.status}`}
                      className={`h-2 flex-1 rounded-full ${uta.health.status === 'healthy' ? 'bg-success' : 'bg-warning'}`}
                    />
                  ))}
                </div>
              )}

              {utas !== null && (
                enabledUtas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('settings.overview.tradingCard.noBrokers')}
                  </p>
                ) : attentionBrokers > 0 ? (
                  <p className="text-xs text-warning">
                    {t('settings.overview.tradingCard.brokersSummary', {
                      connected: connectedBrokers,
                      attention: attentionBrokers,
                    })}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('settings.overview.tradingCard.brokersHealthy', {
                      connected: connectedBrokers,
                    })}
                  </p>
                )
              )}
            </div>

            <footer className="flex items-center justify-between gap-2 border-t border-border/55 pt-3 text-xs">
              <button
                type="button"
                onClick={() => openOrFocus({ kind: 'settings', params: { category: 'trading' } })}
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-foreground transition-colors hover:text-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
              >
                <span>{t('settings.overview.tradingCard.openBrokers')}</span>
                <ArrowRight className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => openOrFocus({ kind: 'settings', params: { category: 'agent-permissions' } })}
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
              >
                <span>{t('settings.overview.tradingCard.openMode')}</span>
                <ArrowRight className="size-3.5" aria-hidden />
              </button>
            </footer>
          </article>
        )}

        <article className="flex min-w-0 flex-col justify-between gap-3.5 rounded-2xl border border-border/70 bg-card p-4 sm:p-5 @[42rem]:p-4">
          <header className="flex items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-xs font-medium text-muted-foreground">
              {t('settings.overview.agentsCard.title')}
            </h3>
            <Cpu className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </header>

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => openOrFocus({ kind: 'settings', params: { category: 'agent-runtimes' } })}
                className="min-w-0 rounded-xl border border-border/65 bg-background/60 p-3 text-left transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
              >
                <span
                  className={`block text-lg font-semibold tracking-tight tabular-nums ${
                    !runtimesReadyKnown
                      ? 'text-foreground'
                      : readyRuntimes > 0
                        ? 'text-success'
                        : 'text-warning'
                  }`}
                >
                  {runtimesReadyKnown ? `${readyRuntimes}/${catalog.length}` : '—'}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {t('settings.overview.agentsCard.cliReadyLabel')}
                </span>
              </button>

              <button
                type="button"
                onClick={() => openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })}
                className="min-w-0 rounded-xl border border-border/65 bg-background/60 p-3 text-left transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
              >
                <span className="block text-lg font-semibold tracking-tight tabular-nums text-foreground">
                  {credentialCount !== null ? String(credentialCount) : '—'}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {t('settings.overview.agentsCard.apiKeysLabel')}
                </span>
              </button>
            </div>

            {runtimesLoading && catalog.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('settings.overview.agentsCard.runtimesLoading')}
              </p>
            ) : !runtimesReadyKnown ? (
              <p className="text-xs text-muted-foreground">
                {t('settings.overview.agentsCard.runtimesUnavailable')}
              </p>
            ) : credentialCount === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('settings.overview.agentsCard.noCredentials')}
              </p>
            ) : null}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/55 pt-3 text-xs">
            <button
              type="button"
              onClick={() => openOrFocus({ kind: 'settings', params: { category: 'agent-runtimes' } })}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-foreground transition-colors hover:text-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
            >
              <span>{t('settings.overview.agentsCard.openRuntimes')}</span>
              <ArrowRight className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
            >
              <span>{t('settings.overview.agentsCard.openProviders')}</span>
              <ArrowRight className="size-3.5" aria-hidden />
            </button>
          </footer>
        </article>

        <article className="flex min-w-0 flex-col justify-between gap-3.5 rounded-2xl border border-border/70 bg-card p-4 sm:p-5 @[42rem]:p-4">
          <header className="flex items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-xs font-medium text-muted-foreground">
              {t('settings.overview.connectorsCard.title')}
            </h3>
            <Plug className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </header>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span
                className={`text-2xl font-semibold tracking-tight tabular-nums ${
                  connectorAttention > 0
                    ? 'text-warning'
                    : connectedConnectors > 0
                      ? 'text-success'
                      : 'text-foreground'
                }`}
              >
                {connectorSnapshot === null ? '—' : connectedConnectors}
              </span>
              {connectorSnapshot !== null && (
                <span className="text-xs text-muted-foreground">
                  {t('settings.overview.connectorsCard.activeChannelsLabel')}
                </span>
              )}
            </div>

            {connectorSnapshot !== null && (
              enabledAdapters.length === 0 && connectorAttention === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('settings.overview.connectorsCard.noneConfigured')}
                </p>
              ) : connectorAttention > 0 ? (
                <p className="text-xs text-warning">
                  {t('settings.overview.connectorsCard.activeSummary', {
                    connected: connectedConnectors,
                    attention: connectorAttention,
                  })}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('settings.overview.connectorsCard.healthySummary', {
                    connected: connectedConnectors,
                  })}
                </p>
              )
            )}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t border-border/55 pt-3 text-xs">
            <button
              type="button"
              onClick={() => openOrFocus({ kind: 'settings', params: { category: 'connectors' } })}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-foreground transition-colors hover:text-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
            >
              <span>{t('settings.overview.connectorsCard.openConnectors')}</span>
              <ArrowRight className="size-3.5" aria-hidden />
            </button>
          </footer>
        </article>
      </div>

      <article className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border border-border/70 bg-card px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t('settings.overview.quickPrefs.appearance')}
          </span>
          <SegmentedControl
            value={theme}
            onChange={setTheme}
            ariaLabel={t('settings.overview.quickPrefs.appearance')}
            options={(['auto', 'day', 'night'] as const).map((value) => ({ value, label: t(`theme.mode.${value}`) }))}
          />
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
            <span>{activePaletteLabel}</span>
          </span>
          <button
            type="button"
            onClick={() => openOrFocus({ kind: 'settings', params: { category: 'appearance' } })}
            className="text-xs font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
          >
            {t('settings.overview.quickPrefs.customizeSkin')}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t('settings.overview.quickPrefs.language')}
          </span>
          <ContextHelp label={t('settings.language.title')}>{t('settings.language.description')}</ContextHelp>
          <LanguageSection />
        </div>
      </article>
    </div>
  )
}
