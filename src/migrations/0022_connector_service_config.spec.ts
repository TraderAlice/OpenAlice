import { describe, expect, it } from 'vitest'
import { transformLegacyConnectors } from './0022_connector_service_config/index.js'

describe('0022 connector service config migration', () => {
  it('moves Web port and a single-user Telegram notification config', () => {
    const result = transformLegacyConnectors({
      web: { port: 47331 },
      telegram: { enabled: true, botToken: ' secret ', chatIds: [42, 99] },
    })

    expect(result).toEqual({
      ports: { web: 47331 },
      serviceEnabled: true,
      config: {
        version: 1,
        adapters: {
          telegram: {
            enabled: true,
            settings: { botToken: 'secret', ownerUserId: '42', chatId: '42' },
          },
        },
      },
    })
  })

  it('preserves an existing ports.json choice and discards MCP-Ask', () => {
    const result = transformLegacyConnectors(
      { web: { port: 3002 }, telegram: { enabled: false }, mcpAsk: { enabled: true } } as never,
      { web: 48000 },
    )
    expect(result.ports.web).toBe(48000)
    expect(result.config.adapters).toEqual({})
    expect(result.serviceEnabled).toBe(false)
  })
})
