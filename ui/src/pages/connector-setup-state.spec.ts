import { describe, expect, it } from 'vitest'
import type { ConnectorDefinition, PublicConnectorConfig } from '../api'
import { getConnectorSetupState } from './connector-setup-state'

const definition: ConnectorDefinition = {
  id: 'telegram',
  label: 'Telegram',
  description: 'Private bot chat.',
  fields: [
    { key: 'botToken', label: 'Bot token', kind: 'secret', required: true },
    { key: 'ownerUserId', label: 'Owner', kind: 'text', required: false, learnedBy: 'link' },
    { key: 'chatId', label: 'Chat', kind: 'text', required: false, learnedBy: 'link' },
  ],
  commands: [{ name: 'link', description: 'Link owner.' }],
}

function adapter(patch: Partial<PublicConnectorConfig['adapters'][string]> = {}): PublicConnectorConfig['adapters'][string] {
  return { enabled: false, settings: {}, configuredSecrets: [], ...patch }
}

describe('Connector setup lifecycle', () => {
  it('moves from credentials to ready, awaiting link, and linked', () => {
    expect(getConnectorSetupState({
      definition,
      adapter: adapter(),
      serviceEnabled: false,
    }).stage).toBe('needs_credentials')

    const ready = adapter({ configuredSecrets: ['botToken'] })
    expect(getConnectorSetupState({ definition, adapter: ready, serviceEnabled: false }).stage)
      .toBe('ready_to_link')

    expect(getConnectorSetupState({
      definition,
      adapter: { ...ready, enabled: true },
      serviceEnabled: true,
      runtime: { id: 'telegram', enabled: true, status: 'awaiting_link' },
    }).stage).toBe('awaiting_link')

    expect(getConnectorSetupState({
      definition,
      adapter: { ...ready, enabled: true },
      serviceEnabled: true,
      runtime: { id: 'telegram', enabled: true, status: 'healthy', owner: 'owner-1' },
    }).stage).toBe('linked')
  })

  it('remembers a linked bot while the service is stopped', () => {
    expect(getConnectorSetupState({
      definition,
      adapter: adapter({
        configuredSecrets: ['botToken'],
        settings: { ownerUserId: 'owner-1', chatId: 'chat-1' },
      }),
      serviceEnabled: false,
    })).toMatchObject({ stage: 'linked_offline', linked: true })
  })
})
