/**
 * MCP Server settings — separate from external notification connectors.
 *
 * The MCP server exports OpenAlice's ToolCenter to external MCP clients
 * (Claude Desktop, codex inside workspaces, anything that speaks MCP
 * over streamable-http). It is an exported tool protocol, while Connector
 * Service owns optional outbound notifications to external IM platforms.
 */

import { useConfigPage } from '../hooks/useConfigPage'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, inputClass } from '../components/form'
import { PageHeader } from '../components/PageHeader'
import type { AppConfig, McpConfig } from '../api'

export function MCPPage() {
  const { config, status, loadError, updateConfig, retry } = useConfigPage<McpConfig>({
    section: 'mcp',
    extract: (full: AppConfig) => full.mcp,
  })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="MCP Server"
        description="Optional Streamable-HTTP endpoint for external MCP clients. Workspace tools use the built-in CLI gateway by default."
        right={<SaveIndicator status={status} onRetry={retry} />}
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-5">
        {config && (
          <div className="max-w-[880px] mx-auto">
            <ConfigSection
              title="HTTP Server"
              description="Disabled by default. Enable only when you intentionally want another local MCP client to call OpenAlice."
            >
              <Field label="Enabled">
                <label className="inline-flex items-center gap-2 text-[13px] text-text">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => updateConfig({ enabled: e.target.checked })}
                  />
                  Run the MCP endpoint
                </label>
              </Field>
              <Field label="Port">
                <input
                  className={inputClass}
                  type="number"
                  disabled={!config.enabled}
                  value={config.port}
                  onChange={(e) => updateConfig({ port: Number(e.target.value) })}
                />
              </Field>
            </ConfigSection>
          </div>
        )}
        {loadError && <p className="text-[13px] text-red">Failed to load configuration.</p>}
      </div>
    </div>
  )
}
