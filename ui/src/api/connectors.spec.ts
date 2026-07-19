import { describe, expect, it } from 'vitest'
import { createDemoConnectorSnapshot } from '../demo/fixtures/connectors'
import { decodeConnectorSettingsSnapshot } from './connectors'

describe('decodeConnectorSettingsSnapshot', () => {
  it('accepts the complete Connector settings contract', () => {
    const snapshot = createDemoConnectorSnapshot()

    expect(decodeConnectorSettingsSnapshot(snapshot)).toEqual(snapshot)
  })

  it('rejects the demo catch-all empty object instead of letting a page crash', () => {
    expect(() => decodeConnectorSettingsSnapshot({})).toThrow('Invalid Connector settings response.')
  })
})
