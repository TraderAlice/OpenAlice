import { useConfigPage } from '../hooks/useConfigPage'
import { SaveIndicator } from '../components/SaveIndicator'
import { SDKSelector, CONNECTOR_OPTIONS } from '../components/SDKSelector'
import { Section, Field, inputClass } from '../components/form'
import type { AppConfig, ConnectorsConfig } from '../api'

export function ConnectorsPage() {
  const { config, status, loadError, updateConfig, updateConfigImmediate, retry } =
    useConfigPage<ConnectorsConfig>({
      section: 'connectors',
      extract: (full: AppConfig) => full.connectors,
    })

  // Derive selected connector IDs from enabled flags (web is always included)
  const selected = config
    ? [
        'web',
        ...(config.mcp.enabled ? ['mcp'] : []),
        ...(config.mcpAsk.enabled ? ['mcpAsk'] : []),
        ...(config.telegram.enabled ? ['telegram'] : []),
      ]
    : ['web']

  const handleToggle = (id: string) => {
    if (!config) return
    if (id === 'mcp') {
      updateConfigImmediate({ mcp: { ...config.mcp, enabled: !config.mcp.enabled } })
    } else if (id === 'mcpAsk') {
      updateConfigImmediate({ mcpAsk: { ...config.mcpAsk, enabled: !config.mcpAsk.enabled } })
    } else if (id === 'telegram') {
      updateConfigImmediate({ telegram: { ...config.telegram, enabled: !config.telegram.enabled } })
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Connectors</h2>
            <p className="text-[12px] text-text-muted mt-1">
              Service ports and external integrations. Changes require a restart.
            </p>
          </div>
          <SaveIndicator status={status} onRetry={retry} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {config && (
          <div className="max-w-[640px] space-y-8">
            {/* Connector selector cards */}
            <Section
              title="Active Connectors"
              description="Select which connectors to enable. Web UI is always active."
            >
              <SDKSelector
                options={CONNECTOR_OPTIONS}
                selected={selected}
                onToggle={handleToggle}
              />
            </Section>

            {/* Web UI config — always shown */}
            <Section
              title="Web UI"
              description="Browser-based chat and configuration interface."
            >
              <Field label="Port">
                <input
                  className={inputClass}
                  type="number"
                  value={config.web.port}
                  onChange={(e) => updateConfig({ web: { port: Number(e.target.value) } })}
                />
              </Field>
            </Section>

            {/* MCP Server config */}
            {config.mcp.enabled && (
              <Section
                title="MCP Server"
                description="Exposes tools via MCP for external AI agents."
              >
                <Field label="Port">
                  <input
                    className={inputClass}
                    type="number"
                    value={config.mcp.port ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      updateConfig({ mcp: { ...config.mcp, port: v ? Number(v) : undefined } })
                    }}
                    placeholder="e.g. 3001"
                  />
                </Field>
              </Section>
            )}

            {/* MCP Ask config */}
            {config.mcpAsk.enabled && (
              <Section
                title="MCP Ask"
                description="Multi-turn conversation endpoint for external agents."
              >
                <Field label="Port">
                  <input
                    className={inputClass}
                    type="number"
                    value={config.mcpAsk.port ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      updateConfig({ mcpAsk: { ...config.mcpAsk, port: v ? Number(v) : undefined } })
                    }}
                    placeholder="e.g. 3003"
                  />
                </Field>
              </Section>
            )}

            {/* Telegram config */}
            {config.telegram.enabled && (
              <Section
                title="Telegram"
                description="Create a bot via @BotFather, paste the token below, and add your chat ID."
              >
                <Field label="Bot Token">
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
                <Field label="Bot Username">
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
                <Field label="Allowed Chat IDs">
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
                    placeholder="Comma-separated, e.g. 123456, 789012"
                  />
                </Field>
              </Section>
            )}
          </div>
        )}
        {loadError && <p className="text-[13px] text-red">Failed to load configuration.</p>}
      </div>
    </div>
  )
}
