/**
 * MCP Server settings — dedicated page lifted out of Connectors.
 *
 * The MCP server exports OpenAlice's ToolCenter to external MCP clients
 * (Claude Desktop, codex inside workspaces, anything that speaks MCP
 * over streamable-http). It's semantically distinct from connectors
 * (which is the chat-input direction: web UI's chat, telegram, mcpAsk),
 * so it lives under its own Settings entry rather than nested inside
 * Connectors.
 */

import { useTranslation } from 'react-i18next'
import { useConfigPage } from '../hooks/useConfigPage'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, inputClass } from '../components/form'
import { PageHeader } from '../components/PageHeader'
import type { AppConfig, McpConfig } from '../api'

export function MCPPage() {
  const { t } = useTranslation()
  const { config, status, loadError, updateConfig, retry } = useConfigPage<McpConfig>({
    section: 'mcp',
    extract: (full: AppConfig) => full.mcp,
  })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('mcp.title')}
        description={t('mcp.description', "Streamable-HTTP endpoint that exposes OpenAlice's ToolCenter to external MCP clients. Changes require a restart.")}
        right={<SaveIndicator status={status} onRetry={retry} />}
      />

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-5">
        {config && (
          <div className="max-w-[880px] mx-auto">
            <ConfigSection
              title={t('mcp.httpServer', 'HTTP Server')}
              description={t('mcp.httpServerDescription', 'Listening port for the streamable-HTTP MCP endpoint (path: /mcp).')}
            >
              <Field label={t('mcp.port', 'Port')}>
                <input
                  className={inputClass}
                  type="number"
                  value={config.port}
                  onChange={(e) => updateConfig({ port: Number(e.target.value) })}
                />
              </Field>
            </ConfigSection>
          </div>
        )}
        {loadError && <p className="text-[13px] text-red">{t('common.failedToLoad')}</p>}
      </div>
    </div>
  )
}
