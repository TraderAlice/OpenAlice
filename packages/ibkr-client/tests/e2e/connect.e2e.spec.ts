/**
 * E2E: basic TWS connection — server version, nextValidId, managedAccounts, currentTime.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { client, available, results, waitFor } from './setup.js'

describe.runIf(available)('TWS connect', () => {
  beforeAll(async () => {
    client.reqCurrentTime()
    await waitFor(() => results.currentTime !== undefined)
  })

  it('connects and receives server version', () => {
    expect(client.serverVersion()).toBeGreaterThanOrEqual(100)
  })

  it('receives nextValidId', () => {
    expect(results.nextValidId).toBeGreaterThanOrEqual(1)
  })

  it('receives managedAccounts', () => {
    expect(results.managedAccounts).toBeTruthy()
  })

  it('receives currentTime', () => {
    expect(results.currentTime).toBeGreaterThan(0)
  })
})
