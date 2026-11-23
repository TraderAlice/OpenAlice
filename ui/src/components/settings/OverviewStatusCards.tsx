import { useEffect, useState, type ReactNode } from 'react'
import { CandlestickChart, Cpu, Languages, Palette, Plug } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
import { Button } from '../ui/button'

type StatusTone = 'healthy' | 'warning' | 'muted'

function StatusLine({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const dotClass = tone === 'healthy'
    ? 'bg-success'
    : tone === 'warning'
      ? 'bg-warning'
      : 'bg-muted-foreground/50'
  return (
    <p className="flex items-center gap-2 text-xs text-foreground">
      <span className={`size-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </p>
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

  const locale = useLocale()
  const setLocale = useSetLocale()

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
    <div className="@container space-y-5">
      <div className={`grid gap-4 ${hideTrading ? '@[36rem]:grid-cols-2' : '@[48rem]:grid-cols-3'}`}>
        <article className="@container flex flex-col justify-between gap-4 rounded-xl border border-border/70 bg-card p-4">
          <header className="flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-secondary/40 text-muted-foreground" aria-hidden>
              <Cpu className="size-3.5" />
            </span>
            <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
              {t('settings.overview.agentsCard.title')}
            </h3>
          </header>
          <div className="flex-1 space-y-2 text-xs">
            {runtimesLoading && catalog.length === 0 ? (
              <StatusLine tone="muted">
                {t('settings.overview.agentsCard.runtimesLoading')}
              </StatusLine>
            ) : catalog.length === 0 || !readiness ? (
              <StatusLine tone="muted">
                {t('settings.overview.agentsCard.runtimesUnavailable')}
              </StatusLine>
            ) : (
              <StatusLine tone={readyRuntimes > 0 ? 'healthy' : 'warning'}>
                {t('settings.overview.agentsCard.runtimesReady', {
                  ready: readyRuntimes,
                  total: catalog.length,
                })}
              </StatusLine>
            )}
            {credentialCount !== null && (
              <p className="text-muted-foreground">
                {credentialCount > 0
                  ? t('settings.overview.agentsCard.credentialsSaved', { count: credentialCount })
                  : t('settings.overview.agentsCard.noCredentials')}
              </p>
            )}
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openOrFocus({ kind: 'settings', params: { category: 'agent-runtimes' } })}
            >
              {t('settings.overview.agentsCard.openRuntimes')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })}
            >
              {t('settings.overview.agentsCard.openProviders')}
            </Button>
          </footer>
        </article>

        {!hideTrading && (
          <article className="@container flex flex-col justify-between gap-4 rounded-xl border border-border/70 bg-card p-4">
            <header className="flex items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-secondary/40 text-muted-foreground" aria-hidden>
                <CandlestickChart className="size-3.5" />
              </span>
              <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
                {t('settings.overview.tradingCard.title')}
              </h3>
            </header>
            <div className="flex-1 space-y-2 text-xs">
              <div>
                <span className="inline-flex items-center rounded-full border border-border/70 bg-secondary/50 px-2.5 py-0.5 text-xs font-medium text-foreground">
                  {t('settings.overview.tradingCard.currentMode', {
                    mode: t(`settings.agentPermissions.mode.${tradingMode}.label`),
                  })}
                </span>
              </div>
              {utas !== null && (
                enabledUtas.length === 0 ? (
                  <StatusLine tone="muted">
                    {t('settings.overview.tradingCard.noBrokers')}
                  </StatusLine>
                ) : attentionBrokers > 0 ? (
                  <StatusLine tone="warning">
                    {t('settings.overview.tradingCard.brokersSummary', {
                      connected: connectedBrokers,
                      attention: attentionBrokers,
                    })}
                  </StatusLine>
                ) : (
                  <StatusLine tone="healthy">
                    {t('settings.overview.tradingCard.brokersHealthy', {
                      connected: connectedBrokers,
                    })}
                  </StatusLine>
                )
              )}
            </div>
            <footer className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openOrFocus({ kind: 'settings', params: { category: 'agent-permissions' } })}
              >
                {t('settings.overview.tradingCard.openMode')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openOrFocus({ kind: 'settings', params: { category: 'trading' } })}
              >
                {t('settings.overview.tradingCard.openBrokers')}
              </Button>
            </footer>
          </article>
        )}

        <article className="@container flex flex-col justify-between gap-4 rounded-xl border border-border/70 bg-card p-4">
          <header className="flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-secondary/40 text-muted-foreground" aria-hidden>
              <Plug className="size-3.5" />
            </span>
            <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
              {t('settings.overview.connectorsCard.title')}
            </h3>
          </header>
          <div className="flex-1 space-y-2 text-xs">
            {connectorSnapshot !== null && (
              enabledAdapters.length === 0 && connectorAttention === 0 ? (
                <StatusLine tone="muted">
                  {t('settings.overview.connectorsCard.noneConfigured')}
                </StatusLine>
              ) : connectorAttention > 0 ? (
                <StatusLine tone="warning">
                  {t('settings.overview.connectorsCard.activeSummary', {
                    connected: connectedConnectors,
                    attention: connectorAttention,
                  })}
                </StatusLine>
              ) : (
                <StatusLine tone="healthy">
                  {t('settings.overview.connectorsCard.healthySummary', {
                    connected: connectedConnectors,
                  })}
                </StatusLine>
              )
            )}
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openOrFocus({ kind: 'settings', params: { category: 'connectors' } })}
            >
              {t('settings.overview.connectorsCard.openConnectors')}
            </Button>
          </footer>
        </article>
      </div>

      <article className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
            <Palette className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t('settings.overview.quickPrefs.appearance')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label={t('settings.overview.quickPrefs.appearance')}
            >
              {(['auto', 'day', 'night'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTheme(mode)}
                  aria-pressed={theme === mode}
                  className={`oa-pressable h-7 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                    theme === mode
                      ? 'border-primary bg-primary-muted text-primary'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t(`theme.mode.${mode}`)}
                </button>
              ))}
            </div>
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-secondary/50 px-2.5 text-xs text-muted-foreground">
              <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
              <span>{activePaletteLabel}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => openOrFocus({ kind: 'settings', params: { category: 'appearance' } })}
            >
              {t('settings.overview.quickPrefs.customizeSkin')}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
            <Languages className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{t('settings.overview.quickPrefs.language')}</span>
          </div>
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label={t('settings.overview.quickPrefs.language')}
          >
            {(['en', 'zh', 'ja', 'zh-Hant'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                aria-pressed={locale === l}
                className={`oa-pressable h-7 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                  locale === l
                    ? 'border-primary bg-primary-muted text-primary'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {LOCALE_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
      </article>
    </div>
  )
}
