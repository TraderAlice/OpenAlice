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
import { ConfigSection, Field, SettingsScrollArea, inputClass } from '../components/form'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/ui/button'
import { Toggle } from '../components/Toggle'
import type { AppConfig, McpConfig } from '../api'

export function MCPPage() {
  const { config, status, loadError, updateConfig, reload, retry } = useConfigPage<McpConfig>({
    section: 'mcp',
    extract: (full: AppConfig) => full.mcp,
  })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="MCP Server" right={<SaveIndicator status={status} onRetry={retry} />} />

      <SettingsScrollArea className="px-4 py-5 md:px-8">
        {config && (
          <div className="max-w-[880px] mx-auto">
            <ConfigSection
              title="HTTP Server"
              description="Expose a local Streamable HTTP endpoint to external MCP clients."
            >
              <div className="flex min-h-12 items-center justify-between gap-4 border-b border-border/60 py-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-foreground">Run endpoint</p>
                  <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
                    Available to local clients while OpenAlice is running.
                  </p>
                </div>
                <Toggle
                  ariaLabel="Run the MCP endpoint"
                  size="sm"
                  checked={config.enabled}
                  onChange={(enabled) => updateConfig({ enabled })}
                />
              </div>
              <Field label="Port" controlId="mcp-server-port">
                <input
                  id="mcp-server-port"
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
        {loadError && (
          <div role="alert" className="mx-auto max-w-[880px] text-center">
            <p className="text-[13px] text-destructive">Failed to load configuration.</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void reload()}>
              Retry
            </Button>
          </div>
        )}
      </SettingsScrollArea>
    </div>
  )
}
