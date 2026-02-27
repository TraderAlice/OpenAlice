import { useConfigPage } from '../hooks/useConfigPage'
import { SaveIndicator } from '../components/SaveIndicator'
import { Toggle } from '../components/Toggle'
import { Section, Field, inputClass } from '../components/form'
import type { AppConfig, ConnectorsConfig } from '../api'

export function ConnectorsPage() {
  const { config, status, loadError, updateConfig, updateConfigImmediate, retry } =
    useConfigPage<ConnectorsConfig>({
      section: 'connectors',
      extract: (full: AppConfig) => full.connectors,
    })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border">
        <div className="px-4 md:px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Connectors</h2>
            <p className="text-[12px] text-text-muted mt-1">
              Service ports and external integrations. Port changes require a restart.
            </p>
          </div>
          <SaveIndicator status={status} onRetry={retry} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        {config && (
          <div className="max-w-[640px] space-y-8">
            {/* Web UI — always active */}
            <Section
              title="Web UI"
              description="Browser-based chat and configuration interface. Always active."
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

            {/* MCP Server */}
            <Section
              title="MCP Server"
              description="Exposes trading, analysis, and other tools via the Model Context Protocol. Used by external AI agents."
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[13px] text-text">Enable MCP Server</p>
                  <p className="text-[11px] text-text-muted/60">
                    Restart required after toggling.
                  </p>
                </div>
                <Toggle
                  checked={config.mcp.enabled}
                  onChange={(v) =>
                    updateConfigImmediate({ mcp: { ...config.mcp, enabled: v } })
                  }
                />
              </div>
              {config.mcp.enabled && (
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
              )}
            </Section>

            {/* MCP Ask */}
            <Section
              title="MCP Ask"
              description="Multi-turn conversation endpoint for external agents. Provides askWithSession, listSessions, and getSessionHistory tools."
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[13px] text-text">Enable MCP Ask</p>
                  <p className="text-[11px] text-text-muted/60">
                    Restart required after toggling.
                  </p>
                </div>
                <Toggle
                  checked={config.mcpAsk.enabled}
                  onChange={(v) =>
                    updateConfigImmediate({ mcpAsk: { ...config.mcpAsk, enabled: v } })
                  }
                />
              </div>
              {config.mcpAsk.enabled && (
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
              )}
            </Section>

            {/* Telegram */}
            <Section
              title="Telegram"
              description="Connect a Telegram bot for mobile notifications and two-way chat. Create a bot via @BotFather, paste the token below, and add your chat ID."
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[13px] text-text">Enable Telegram</p>
                  <p className="text-[11px] text-text-muted/60">
                    Restart required after toggling.
                  </p>
                </div>
                <Toggle
                  checked={config.telegram.enabled}
                  onChange={(v) =>
                    updateConfigImmediate({ telegram: { ...config.telegram, enabled: v } })
                  }
                />
              </div>
              {config.telegram.enabled && (
                <>
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
                </>
              )}
            </Section>
          </div>
        )}
        {loadError && <p className="text-[13px] text-red">Failed to load configuration.</p>}
      </div>
    </div>
  )
}
