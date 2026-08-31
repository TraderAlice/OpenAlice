import { describe, expect, it } from 'vitest'
import { createDemoConnectorSnapshot } from '../demo/fixtures/connectors'
import { decodeConnectorSettingsSnapshot } from './connectors'

describe('decodeConnectorSettingsSnapshot', () => {
  it('accepts the complete Connector settings contract', () => {
    const snapshot = createDemoConnectorSnapshot()

    expect(decodeConnectorSettingsSnapshot(snapshot)).toEqual(snapshot)
    expect(snapshot.definitions[0]?.setupLinks?.[0]?.url).toBe('https://discord.com/developers/applications')
    expect(snapshot.definitions.find((definition) => definition.id === 'feishu')
      ?.fields.find((field) => field.key === 'domain')?.options?.map((option) => option.value))
      .toEqual(['feishu', 'lark'])
  })

  it('rejects the demo catch-all empty object instead of letting a page crash', () => {
    expect(() => decodeConnectorSettingsSnapshot({})).toThrow('Invalid Connector settings response.')
  })
})
