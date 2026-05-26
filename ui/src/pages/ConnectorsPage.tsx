import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useConfigPage } from '../hooks/useConfigPage'
import { SaveIndicator } from '../components/SaveIndicator'
import { SDKSelector, CONNECTOR_OPTIONS } from '../components/SDKSelector'
import { ConfigSection, Field, inputClass } from '../components/form'
import { PageHeader } from '../components/PageHeader'
import type { AppConfig, ConnectorsConfig } from '../api'

export function ConnectorsPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [pendingChatId, setPendingChatId] = useState<number | null>(null)

  const { config, status, loadError, updateConfig, updateConfigImmediate, retry } =
    useConfigPage<ConnectorsConfig>({
      section: 'connectors',
      extract: (full: AppConfig) => full.connectors,
    })

  // Pick up ?addChatId= from URL
  useEffect(() => {
    const raw = searchParams.get('addChatId')
    if (!raw) return
    const id = Number(raw)
    if (!isNaN(id) && id !== 0) setPendingChatId(id)
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  const handleAuthorize = () => {
    if (!config || !pendingChatId) return
    if (!config.telegram.chatIds.includes(pendingChatId)) {
      updateConfigImmediate({
        telegram: { ...config.telegram, chatIds: [...config.telegram.chatIds, pendingChatId] },
      })
    }
    setPendingChatId(null)
  }

  // Derive selected connector IDs from enabled flags. Web UI is always
  // included; MCP server lives at top-level config now (Settings → MCP Server),
  // not under connectors.
  const selected = config
    ? [
        'web',
        ...(config.mcpAsk.enabled ? ['mcpAsk'] : []),
        ...(config.telegram.enabled ? ['telegram'] : []),
      ]
    : ['web']

  const handleToggle = (id: string) => {
    if (!config) return
    if (id === 'mcpAsk') {
      updateConfigImmediate({ mcpAsk: { ...config.mcpAsk, enabled: !config.mcpAsk.enabled } })
    } else if (id === 'telegram') {
      updateConfigImmediate({ telegram: { ...config.telegram, enabled: !config.telegram.enabled } })
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('connectors.title')}
        description={t('connectors.description', 'Service ports and external integrations. Changes require a restart.')}
        right={<SaveIndicator status={status} onRetry={retry} />}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-5">
        {config && (
          <div className="max-w-[880px] mx-auto">
            {/* Telegram chat authorization banner */}
            {pendingChatId !== null && (
              <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-[13px]">
                <span>
                  {t('connectors.authorizeTelegramChat', 'Authorize Telegram chat')} <code className="font-mono font-semibold">{pendingChatId}</code>?
                </span>
                <span className="flex gap-2 shrink-0">
                  <button
                    className="rounded-md bg-blue-600 px-3 py-1 text-white hover:bg-blue-500"
                    onClick={handleAuthorize}
                  >
                    {t('connectors.authorize', 'Authorize')}
                  </button>
                  <button
                    className="rounded-md border border-border px-3 py-1 hover:bg-bg-2"
                    onClick={() => setPendingChatId(null)}
                  >
                    {t('common.dismiss', 'Dismiss')}
                  </button>
                </span>
              </div>
            )}
            {/* Connector selector cards */}
            <ConfigSection
              title={t('connectors.activeConnectors', 'Active Connectors')}
              description={t('connectors.activeConnectorsDesc', 'Select which chat surfaces to enable. Web UI is always active.')}
            >
              <SDKSelector
                options={CONNECTOR_OPTIONS}
                selected={selected}
                onToggle={handleToggle}
              />
            </ConfigSection>

            {/* Web UI config — always shown */}
            <ConfigSection
              title={t('connectors.webUI', 'Web UI')}
              description={t('connectors.webUIDesc', 'Browser-based chat and configuration interface.')}
            >
              <Field label={t('connectors.port', 'Port')}>
                <input
                  className={inputClass}
                  type="number"
                  value={config.web.port}
                  onChange={(e) => updateConfig({ web: { port: Number(e.target.value) } })}
                />
              </Field>
            </ConfigSection>

            {/* MCP Ask config */}
            {config.mcpAsk.enabled && (
              <ConfigSection
                title={t('connectors.mcpAsk', 'MCP Ask')}
                description={t('connectors.mcpAskDesc', 'Multi-turn conversation endpoint for external agents.')}
              >
                <Field label={t('connectors.port', 'Port')}>
                  <input
                    className={inputClass}
                    type="number"
                    value={config.mcpAsk.port ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      updateConfig({ mcpAsk: { ...config.mcpAsk, port: v ? Number(v) : undefined } })
                    }}
                    placeholder={t('connectors.portPlaceholder', 'e.g. 3003')}
                  />
                </Field>
              </ConfigSection>
            )}

            {/* Telegram config */}
            {config.telegram.enabled && (
              <ConfigSection
                title={t('connectors.telegram', 'Telegram')}
                description={t('connectors.telegramDesc', 'Create a bot via @BotFather, paste the token below, and add your chat ID.')}
              >
                <Field label={t('connectors.botToken', 'Bot Token')}>
                  <input
                    className={inputClass}
                    type="password"
                    value={config.telegram.botToken ?? ''}
                    onChange={(e) =>
                      updateConfig({
                        telegram: { ...config.telegram, botToken: e.target.value || undefined },
                      })
                    }
                    placeholder="123456:ABC-DEF..."
                  />
                </Field>
                <Field label={t('connectors.botUsername', 'Bot Username')}>
                  <input
                    className={inputClass}
                    value={config.telegram.botUsername ?? ''}
                    onChange={(e) =>
                      updateConfig({
                        telegram: { ...config.telegram, botUsername: e.target.value || undefined },
                      })
                    }
                    placeholder="my_bot"
                  />
                </Field>
                <Field label={t('connectors.allowedChatIds', 'Allowed Chat IDs')}>
                  <input
                    className={inputClass}
                    value={config.telegram.chatIds.join(', ')}
                    onChange={(e) =>
                      updateConfig({
                        telegram: {
                          ...config.telegram,
                          chatIds: e.target.value
                            ? e.target.value
                                .split(',')
                                .map((s) => Number(s.trim()))
                                .filter((n) => !isNaN(n))
                            : [],
                        },
                      })
                    }
                    placeholder={t('connectors.chatIdsPlaceholder', 'Comma-separated, e.g. 123456, 789012')}
                  />
                </Field>
              </ConfigSection>
            )}
          </div>
        )}
        {loadError && <p className="text-[13px] text-red">{t('common.failedToLoad')}</p>}
      </div>
    </div>
  )
}
