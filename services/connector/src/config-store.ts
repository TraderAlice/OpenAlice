import type { ConnectorConfig } from '@traderalice/connector-protocol'
import {
  readConnectorConfig,
  updateConnectorAdapterSettings,
} from '@/core/connector-config.js'

export class ConnectorConfigStore {
  async read(): Promise<ConnectorConfig> {
    return readConnectorConfig()
  }

  async patchAdapter(id: string, settings: Record<string, string | number | boolean>): Promise<void> {
    await updateConnectorAdapterSettings(id, settings)
  }
}
